/**
 * Partition-Aware Query Router
 * Routes queries to correct shards based on consistent hashing
 * Handles multi-shard aggregations and scatter-gather operations
 */

export interface ShardLocation {
  shardId: number;
  nodeId: string;
  isPrimary: boolean;
  isHealthy: boolean;
}

export interface PartitionKey {
  field: string;
  value: any;
}

export interface QueryRoute {
  shardId: number;
  nodeId: string;
  query: any;
  aggregation?: "local" | "global" | "none";
}

export interface RoutedQuery {
  routes: QueryRoute[];
  requiresAggregation: boolean;
  aggregationType?: "count" | "sum" | "avg" | "group" | "none";
}

/* ========================
   SHARD LOCATOR
======================== */

export class ShardLocator {
  private shardMap = new Map<number, ShardLocation>();
  private healthCheck = new Map<string, { healthy: boolean; lastCheck: number }>();
  private consistentHash: ConsistentHash;
  private shardCount: number;

  constructor(shardCount: number = 16) {
    this.shardCount = shardCount;
    this.consistentHash = new ConsistentHash(shardCount);
  }

  /**
   * Register shard location
   */
  registerShard(shardId: number, nodeId: string, isPrimary: boolean = true): void {
    this.shardMap.set(shardId, {
      shardId,
      nodeId,
      isPrimary,
      isHealthy: true
    });
  }

  /**
   * Find shard for partition key
   */
  getShardForKey(key: any): ShardLocation | null {
    const shardId = this.consistentHash.getNode(String(key));
    return this.shardMap.get(shardId) ?? null;
  }

  /**
   * Find all shards containing key (includes replicas)
   */
  getReplicasForKey(key: any): ShardLocation[] {
    const shardId = this.consistentHash.getNode(String(key));
    const replicas: ShardLocation[] = [];

    // Get all locations for this shard (primary + replicas)
    for (const [, location] of this.shardMap) {
      if (location.shardId === shardId) {
        replicas.push(location);
      }
    }

    return replicas.sort((a, b) => (b.isPrimary ? 1 : -1));
  }

  /**
   * Mark node as unhealthy
   */
  markNodeUnhealthy(nodeId: string): void {
    for (const location of this.shardMap.values()) {
      if (location.nodeId === nodeId) {
        location.isHealthy = false;
      }
    }
  }

  /**
   * Mark node as healthy
   */
  markNodeHealthy(nodeId: string): void {
    for (const location of this.shardMap.values()) {
      if (location.nodeId === nodeId) {
        location.isHealthy = true;
      }
    }
  }

  /**
   * Get all shards
   */
  getAllShards(): ShardLocation[] {
    return Array.from(this.shardMap.values());
  }

  /**
   * Check if shard is healthy
   */
  isShardHealthy(shardId: number): boolean {
    const shard = this.shardMap.get(shardId);
    return shard ? shard.isHealthy : false;
  }
}

/* ========================
   QUERY ROUTER
======================== */

export class QueryRouter {
  private locator: ShardLocator;
  private routingCache = new Map<string, RoutedQuery>();
  private cacheMaxSize = 10000;

  constructor(locator: ShardLocator) {
    this.locator = locator;
  }

  /**
   * Route single-document query by _id
   */
  routeById(documentId: string): QueryRoute | null {
    const shard = this.locator.getShardForKey(documentId);
    if (!shard) return null;

    return {
      shardId: shard.shardId,
      nodeId: shard.nodeId,
      query: { _id: documentId },
      aggregation: "none"
    };
  }

  /**
   * Route query with partition key
   */
  routeByPartitionKey(query: any, partitionKey: string): RoutedQuery {
    const cacheKey = `${partitionKey}:${JSON.stringify(query)}`;
    const cached = this.routingCache.get(cacheKey);
    if (cached) return cached;

    const keyValue = this.extractPartitionValue(query, partitionKey);

    if (keyValue !== null) {
      // Single shard query
      const shard = this.locator.getShardForKey(keyValue);
      if (shard) {
        const routed: RoutedQuery = {
          routes: [{
            shardId: shard.shardId,
            nodeId: shard.nodeId,
            query,
            aggregation: "local"
          }],
          requiresAggregation: false
        };

        this.cachRoute(cacheKey, routed);
        return routed;
      }
    }

    // Multi-shard scatter-gather
    return this.routeScatterGather(query);
  }

  /**
   * Scatter-gather across all healthy shards
   */
  private routeScatterGather(query: any): RoutedQuery {
    const routes: QueryRoute[] = [];
    const shards = this.locator.getAllShards();

    for (const shard of shards) {
      if (!shard.isHealthy) continue;
      if (!shard.isPrimary) continue; // Only query primary to avoid duplicates

      routes.push({
        shardId: shard.shardId,
        nodeId: shard.nodeId,
        query,
        aggregation: "global"
      });
    }

    return {
      routes,
      requiresAggregation: true,
      aggregationType: this.inferAggregationType(query)
    };
  }

  /**
   * Route aggregation query
   */
  routeAggregation(query: any, aggregationType: string): RoutedQuery {
    const routes: QueryRoute[] = [];
    const shards = this.locator.getAllShards();

    // Send aggregation to all primary shards
    for (const shard of shards) {
      if (!shard.isHealthy || !shard.isPrimary) continue;

      routes.push({
        shardId: shard.shardId,
        nodeId: shard.nodeId,
        query,
        aggregation: "global"
      });
    }

    return {
      routes,
      requiresAggregation: true,
      aggregationType: aggregationType as any
    };
  }

  /**
   * Extract partition key value from query
   */
  private extractPartitionValue(query: any, partitionKey: string): any {
    if (!query || typeof query !== "object") return null;

    const value = query[partitionKey];
    if (value === undefined) return null;

    // Handle equality operators
    if (typeof value === "object" && value !== null) {
      if ("$eq" in value) return value.$eq;
      // Don't use range queries for routing
      return null;
    }

    return value;
  }

  /**
   * Infer aggregation type from query
   */
  private inferAggregationType(query: any): "count" | "sum" | "avg" | "group" | "none" {
    // Simple heuristic - enhance as needed
    if (!query || typeof query !== "object") return "none";

    const queryStr = JSON.stringify(query).toLowerCase();
    if (queryStr.includes("$count")) return "count";
    if (queryStr.includes("$sum")) return "sum";
    if (queryStr.includes("$avg")) return "avg";
    if (queryStr.includes("$group")) return "group";

    return "none";
  }

  /**
   * Cache route
   */
  private cachRoute(key: string, route: RoutedQuery): void {
    if (this.routingCache.size >= this.cacheMaxSize) {
      // Remove first (oldest) entry
      const firstKey = this.routingCache.keys().next().value as string | undefined;
      if (firstKey !== undefined) {
        this.routingCache.delete(firstKey);
      }
    }
    this.routingCache.set(key, route);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.routingCache.clear();
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; maxSize: number } {
    return {
      size: this.routingCache.size,
      maxSize: this.cacheMaxSize
    };
  }
}

/* ========================
   CONSISTENT HASH
======================== */

export class ConsistentHash {
  private ring = new Map<number, number>();
  private sortedKeys: number[] = [];
  private virtualNodes: number;

  constructor(nodeCount: number, virtualNodes: number = 160) {
    this.virtualNodes = virtualNodes;
    this.buildRing(nodeCount);
  }

  /**
   * Build hash ring
   */
  private buildRing(nodeCount: number): void {
    this.ring.clear();

    for (let node = 0; node < nodeCount; node++) {
      for (let v = 0; v < this.virtualNodes; v++) {
        const key = this.hash(`node-${node}-${v}`);
        this.ring.set(key, node);
      }
    }

    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
  }

  /**
   * Get node for key
   */
  getNode(key: string): number {
    if (this.sortedKeys.length === 0) return 0;

    const hash = this.hash(key);

    // Find first key >= hash
    for (const ringKey of this.sortedKeys) {
      if (ringKey >= hash) {
        return this.ring.get(ringKey) ?? 0;
      }
    }

    // Wrap around to first
    return this.ring.get(this.sortedKeys[0]) ?? 0;
  }

  /**
   * Simple hash function
   */
  private hash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

/* ========================
   SHARD HEALTH MONITOR
======================== */

export class ShardHealthMonitor {
  private locator: ShardLocator;
  private checkIntervalMs: number;
  private timeoutMs: number;
  private checkTimer?: NodeJS.Timer;
  private healthChecks = new Map<string, { failures: number; lastCheck: number }>();
  private failureThreshold = 3;
  private recoveryCheckIntervalMs = 10000;

  constructor(
    locator: ShardLocator,
    checkIntervalMs: number = 5000,
    timeoutMs: number = 1000
  ) {
    this.locator = locator;
    this.checkIntervalMs = checkIntervalMs;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Start health monitoring
   */
  start(checkFn: (nodeId: string) => Promise<boolean>): void {
    this.checkTimer = setInterval(() => {
      this.runHealthChecks(checkFn).catch(console.error);
    }, this.checkIntervalMs);
    this.checkTimer.unref?.();
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer as any);
    }
  }

  /**
   * Run health checks
   */
  private async runHealthChecks(checkFn: (nodeId: string) => Promise<boolean>): Promise<void> {
    const shards = this.locator.getAllShards();
    const uniqueNodes = new Set(shards.map(s => s.nodeId));

    for (const nodeId of uniqueNodes) {
      try {
        const healthy = await Promise.race([
          checkFn(nodeId),
          new Promise<false>(resolve => setTimeout(() => resolve(false), this.timeoutMs))
        ]);

        if (healthy) {
          this.recordHealthy(nodeId);
        } else {
          this.recordFailure(nodeId);
        }
      } catch {
        this.recordFailure(nodeId);
      }
    }
  }

  /**
   * Record successful check
   */
  private recordHealthy(nodeId: string): void {
    this.healthChecks.delete(nodeId);
    this.locator.markNodeHealthy(nodeId);
  }

  /**
   * Record failed check
   */
  private recordFailure(nodeId: string): void {
    const check = this.healthChecks.get(nodeId) ?? { failures: 0, lastCheck: Date.now() };
    check.failures++;
    check.lastCheck = Date.now();
    this.healthChecks.set(nodeId, check);

    if (check.failures >= this.failureThreshold) {
      this.locator.markNodeUnhealthy(nodeId);
    }
  }
}
