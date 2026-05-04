/**
 * Cache Invalidation & TTL System
 * Maintains cache consistency with multi-layer invalidation strategy
 * Supports write-through invalidation and TTL-based eviction
 */

export type InvalidationStrategy = "aggressive" | "lazy" | "hybrid";

export interface CacheKey {
  type: "document" | "query" | "index";
  keys: (string | number)[];
}

export interface CacheInvalidationEvent {
  strategy: InvalidationStrategy;
  timestamp: number;
  affectedKeys: Set<CacheKey>;
  cause: "write" | "index-update" | "ttl-expiry" | "memory-pressure";
}

/**
 * TTL-based cache entry
 */
export interface TTLCacheEntry<T> {
  key: CacheKey;
  value: T;
  createdAt: number;
  lastAccessAt: number;
  ttlMs: number;
  hits: number;
  sizeBytes: number;
}

/**
 * Cache invalidation engine
 * Tracks dependencies and invalidates affected entries
 */
export class CacheInvalidationEngine {
  private entryDependencies = new Map<string, Set<CacheKey>>();
  private keyDependents = new Map<string, Set<CacheKey>>();
  private invalidationListeners: Set<(event: CacheInvalidationEvent) => void> = new Set();
  private strategy: InvalidationStrategy;
  private stats = {
    totalInvalidations: 0,
    totalDependenciesTracked: 0
  };

  constructor(strategy: InvalidationStrategy = "hybrid") {
    this.strategy = strategy;
  }

  /**
   * Register dependency between cache keys
   * When sourceKey is invalidated, affectedKey is also invalidated
   */
  registerDependency(sourceKey: CacheKey, affectedKey: CacheKey): void {
    const sourceStr = this.keyToString(sourceKey);
    const affectedStr = this.keyToString(affectedKey);

    if (!this.keyDependents.has(sourceStr)) {
      this.keyDependents.set(sourceStr, new Set());
    }
    this.keyDependents.get(sourceStr)!.add(affectedKey);

    if (!this.entryDependencies.has(affectedStr)) {
      this.entryDependencies.set(affectedStr, new Set());
    }
    this.entryDependencies.get(affectedStr)!.add(sourceKey);

    this.stats.totalDependenciesTracked++;
  }

  /**
   * Get all keys affected by invalidating a source key
   */
  getAffectedKeys(sourceKey: CacheKey): Set<CacheKey> {
    const affected = new Set<CacheKey>();
    const visited = new Set<string>();
    const queue = [sourceKey];

    while (queue.length > 0) {
      const key = queue.shift()!;
      const keyStr = this.keyToString(key);

      if (visited.has(keyStr)) continue;
      visited.add(keyStr);

      affected.add(key);

      // Get all keys that depend on this one
      const dependents = this.keyDependents.get(keyStr);
      if (dependents) {
        for (const dependent of dependents) {
          queue.push(dependent);
        }
      }
    }

    return affected;
  }

  /**
   * Trigger invalidation with dependency cascade
   */
  invalidate(sourceKey: CacheKey, cause: "write" | "index-update" | "ttl-expiry" | "memory-pressure"): Set<CacheKey> {
    const affectedKeys = this.getAffectedKeys(sourceKey);

    const event: CacheInvalidationEvent = {
      strategy: this.strategy,
      timestamp: Date.now(),
      affectedKeys,
      cause
    };

    // Notify listeners
    for (const listener of this.invalidationListeners) {
      listener(event);
    }

    this.stats.totalInvalidations++;
    return affectedKeys;
  }

  /**
   * Subscribe to invalidation events
   */
  onInvalidation(listener: (event: CacheInvalidationEvent) => void): () => void {
    this.invalidationListeners.add(listener);
    return () => this.invalidationListeners.delete(listener);
  }

  /**
   * Clear all dependencies (for reset)
   */
  clear(): void {
    this.entryDependencies.clear();
    this.keyDependents.clear();
  }

  /**
   * Convert cache key to string for comparison
   */
  private keyToString(key: CacheKey): string {
    return `${key.type}:${key.keys.join(":")}`;
  }

  /**
   * Get invalidation statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
}

/**
 * TTL Cache with invalidation support
 */
export class TTLCache<V = any> {
  private entries = new Map<string, TTLCacheEntry<any>>();
  private expirationQueue: Array<{ keyStr: string; expireAt: number }> = [];
  private invalidationEngine: CacheInvalidationEngine;
  private maxBytes: number;
  private currentBytes = 0;
  private checkIntervalMs = 1000;
  private checkInterval?: NodeJS.Timeout;

  constructor(
    maxBytes: number = 100 * 1024 * 1024, // 100MB default
    invalidationEngine?: CacheInvalidationEngine
  ) {
    this.maxBytes = maxBytes;
    this.invalidationEngine = invalidationEngine ?? new CacheInvalidationEngine();
    this.startExpirationCheck();
  }

  /**
   * Set value with TTL
   */
  set<T = V>(key: CacheKey, value: T, ttlMs: number = 60000): void {
    const keyStr = this.keyToString(key);
    const sizeBytes = this.estimateSize(value);

    // Remove old entry if exists
    const existing = this.entries.get(keyStr);
    if (existing) {
      this.currentBytes -= existing.sizeBytes;
      this.entries.delete(keyStr);
    }

    // Check if adding this entry would exceed maxBytes
    if (this.currentBytes + sizeBytes > this.maxBytes) {
      this.evictLRU(sizeBytes);
    }

    const entry: TTLCacheEntry<any> = {
      key,
      value,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
      ttlMs,
      hits: 0,
      sizeBytes
    };

    this.entries.set(keyStr, entry);
    this.currentBytes += sizeBytes;

    // Schedule expiration
    const expireAt = Date.now() + ttlMs;
    this.expirationQueue.push({ keyStr, expireAt });
  }

  /**
   * Get value if exists and not expired
   */
  get(key: CacheKey): V | null {
    const keyStr = this.keyToString(key);
    const entry = this.entries.get(keyStr);

    if (!entry) return null;

    const now = Date.now();
    const age = now - entry.createdAt;

    if (age > entry.ttlMs) {
      // Expired
      this.delete(key);
      return null;
    }

    // Update access time
    entry.lastAccessAt = now;
    entry.hits++;

    return entry.value;
  }

  /**
   * Check if key exists and is valid
   */
  has(key: CacheKey): boolean {
    const keyStr = this.keyToString(key);
    const entry = this.entries.get(keyStr);

    if (!entry) return false;

    const age = Date.now() - entry.createdAt;
    return age <= entry.ttlMs;
  }

  /**
   * Delete entry and cascade invalidations
   */
  delete(key: CacheKey): boolean {
    const keyStr = this.keyToString(key);
    const entry = this.entries.get(keyStr);

    if (!entry) return false;

    this.currentBytes -= entry.sizeBytes;
    this.entries.delete(keyStr);

    // Trigger cascading invalidations
    this.invalidationEngine.invalidate(key, "ttl-expiry");

    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries.clear();
    this.expirationQueue = [];
    this.currentBytes = 0;
  }

  /**
   * Set invalidation listener
   */
  onInvalidation(listener: (event: CacheInvalidationEvent) => void): () => void {
    return this.invalidationEngine.onInvalidation(listener);
  }

  /**
   * Get invalidation engine for dependency management
   */
  getInvalidationEngine(): CacheInvalidationEngine {
    return this.invalidationEngine;
  }

  /**
   * Start TTL expiration check
   */
  private startExpirationCheck(): void {
    this.checkInterval = setInterval(() => {
      this.checkExpiredEntries();
    }, this.checkIntervalMs);
  }

  /**
   * Check and remove expired entries
   */
  private checkExpiredEntries(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [keyStr, entry] of this.entries) {
      const age = now - entry.createdAt;
      if (age > entry.ttlMs) {
        toDelete.push(keyStr);
      }
    }

    for (const keyStr of toDelete) {
      const entry = this.entries.get(keyStr);
      if (entry) {
        this.currentBytes -= entry.sizeBytes;
        this.entries.delete(keyStr);
        this.invalidationEngine.invalidate(entry.key, "ttl-expiry");
      }
    }

    // Cleanup expiration queue
    this.expirationQueue = this.expirationQueue.filter(e => e.expireAt > now);
  }

  /**
   * Evict LRU entries to make space
   */
  private evictLRU(requiredBytes: number): void {
    const sortedByAccess = Array.from(this.entries.values())
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);

    let freedBytes = 0;
    for (const entry of sortedByAccess) {
      if (freedBytes >= requiredBytes) break;
      const keyStr = this.keyToString(entry.key);
      this.currentBytes -= entry.sizeBytes;
      freedBytes += entry.sizeBytes;
      this.entries.delete(keyStr);
      this.invalidationEngine.invalidate(entry.key, "memory-pressure");
    }
  }

  /**
   * Estimate object size in bytes
   */
  private estimateSize(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value === "number") return 8;
    if (typeof value === "boolean") return 1;
    if (Array.isArray(value)) {
      return value.reduce((sum, v) => sum + this.estimateSize(v), 0);
    }
    if (typeof value === "object") {
      return JSON.stringify(value).length;
    }
    return 8;
  }

  /**
   * Convert key to string
   */
  private keyToString(key: CacheKey): string {
    return `${key.type}:${key.keys.join(":")}`;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entryCount: number;
    bytes: number;
    maxBytes: number;
    utilizationPercent: number;
  } {
    return {
      entryCount: this.entries.size,
      bytes: this.currentBytes,
      maxBytes: this.maxBytes,
      utilizationPercent: (this.currentBytes / this.maxBytes) * 100
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval as any);
    }
  }
}
