/**
 * Backpressure & Rate Limiting System
 * Prevents system overload by rejecting or throttling excess requests
 * Implements token bucket and adaptive backpressure
 */

export type BackpressureStrategy = "reject" | "queue" | "adaptive";
export type PriorityLevel = "critical" | "high" | "normal" | "low";

export interface RateLimitConfig {
  requestsPerSecond: number;
  burstSize?: number; // Allow burst above rate
  windowSizeMs?: number; // Sliding window (default 1000ms)
}

export interface BackpressureConfig {
  strategy: BackpressureStrategy;
  maxQueueSize?: number;
  rejectionThreshold?: number; // CPU/memory threshold for rejection
  lowWaterMark?: number; // Resume accepting when below this
  highWaterMark?: number; // Start rejecting when above this
}

export interface RequestInfo {
  id: string;
  priority: PriorityLevel;
  timestamp: number;
  estimatedBytes: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  tokensAvailable: number;
  tokensRequired: number;
  retryAfterMs?: number;
}

/* ========================
   TOKEN BUCKET LIMITER
======================== */

export class TokenBucketLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // tokens per ms
  private lastRefillTime: number;
  private config: Required<RateLimitConfig>;

  constructor(config: RateLimitConfig) {
    this.config = {
      requestsPerSecond: config.requestsPerSecond,
      burstSize: config.burstSize ?? config.requestsPerSecond,
      windowSizeMs: config.windowSizeMs ?? 1000
    };

    this.maxTokens = this.config.burstSize;
    this.tokens = this.maxTokens;
    this.refillRate = config.requestsPerSecond / 1000; // per millisecond
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume tokens
   */
  tryConsume(tokens: number = 1): RateLimitResult {
    this.refillTokens();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return {
        allowed: true,
        tokensAvailable: Math.floor(this.tokens),
        tokensRequired: tokens
      };
    }

    const deficit = tokens - this.tokens;
    const timeNeeded = deficit / this.refillRate;

    return {
      allowed: false,
      reason: "insufficient-tokens",
      tokensAvailable: Math.floor(this.tokens),
      tokensRequired: tokens,
      retryAfterMs: Math.ceil(timeNeeded)
    };
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const newTokens = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefillTime = now;
  }

  /**
   * Get current token count
   */
  getTokens(): number {
    this.refillTokens();
    return Math.floor(this.tokens);
  }

  /**
   * Reset limiter
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }
}

/* ========================
   ADAPTIVE BACKPRESSURE
======================== */

export class AdaptiveBackpressure {
  private strategy: BackpressureStrategy;
  private config: Required<BackpressureConfig>;
  private queue: RequestInfo[] = [];
  private rejectionCount = 0;
  private acceptanceCount = 0;
  private state: "accepting" | "throttling" | "rejecting" = "accepting";
  private lastStateChange = Date.now();
  private metrics = {
    memoryUsagePercent: 0,
    cpuUsagePercent: 0,
    queueDepth: 0
  };

  constructor(config: BackpressureConfig) {
    this.strategy = config.strategy;
    this.config = {
      strategy: config.strategy,
      maxQueueSize: config.maxQueueSize ?? 10000,
      rejectionThreshold: config.rejectionThreshold ?? 90,
      lowWaterMark: config.lowWaterMark ?? 40,
      highWaterMark: config.highWaterMark ?? 70
    };
  }

  /**
   * Check if request should be accepted
   */
  canAcceptRequest(priority: PriorityLevel, estimatedBytes: number): boolean {
    this.updateMetrics();

    const memoryUsage = this.metrics.memoryUsagePercent;
    const queueDepth = this.metrics.queueDepth;

    // Critical priority always gets through
    if (priority === "critical") {
      return true;
    }

    // Rejecting state
    if (this.state === "rejecting") {
      if (memoryUsage < this.config.lowWaterMark) {
        this.state = "throttling";
      } else if (priority === "high") {
        return true;
      } else {
        this.rejectionCount++;
        return false;
      }
    }

    // Throttling state
    if (this.state === "throttling") {
      if (memoryUsage >= this.config.highWaterMark) {
        this.state = "rejecting";
        return this.canAcceptRequest(priority, estimatedBytes);
      }

      if (priority === "low") {
        return false;
      }
    }

    // Accepting state
    if (this.state === "accepting") {
      if (memoryUsage >= this.config.highWaterMark) {
        this.state = "throttling";
        return this.canAcceptRequest(priority, estimatedBytes);
      }
    }

    if (queueDepth >= this.config.maxQueueSize) {
      return false;
    }

    this.acceptanceCount++;
    return true;
  }

  /**
   * Queue request for later processing
   */
  queueRequest(request: RequestInfo): boolean {
    if (this.queue.length >= this.config.maxQueueSize) {
      return false;
    }

    this.queue.push(request);
    return true;
  }

  /**
   * Get queued requests
   */
  dequeueRequests(limit: number = 10): RequestInfo[] {
    return this.queue.splice(0, limit);
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Update system metrics
   */
  private updateMetrics(): void {
    if (global.gc) {
      global.gc();
    }

    const mem = process.memoryUsage();
    const heapUsedPercent = (mem.heapUsed / mem.heapTotal) * 100;
    const externalPercent = (mem.external / 100 * 1024 * 1024) * 100; // Rough estimate

    this.metrics.memoryUsagePercent = Math.min(100, heapUsedPercent + externalPercent);
    this.metrics.queueDepth = this.queue.length;

    // CPU usage estimation (simplified)
    this.metrics.cpuUsagePercent = Math.random() * 50; // Placeholder
  }

  /**
   * Get current state
   */
  getState(): string {
    return this.state;
  }

  /**
   * Get backpressure stats
   */
  getStats(): {
    state: string;
    queueDepth: number;
    rejectionCount: number;
    acceptanceCount: number;
    acceptanceRate: number;
    metrics: { memoryUsagePercent: number; cpuUsagePercent: number; queueDepth: number };
  } {
    const total = this.rejectionCount + this.acceptanceCount;
    const rate = total > 0 ? this.acceptanceCount / total : 1.0;

    return {
      state: this.state,
      queueDepth: this.queue.length,
      rejectionCount: this.rejectionCount,
      acceptanceCount: this.acceptanceCount,
      acceptanceRate: rate,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    this.rejectionCount = 0;
    this.acceptanceCount = 0;
  }
}

/* ========================
   PRIORITY QUEUE
======================== */

export class PriorityQueue {
  private queues = new Map<PriorityLevel, RequestInfo[]>();
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
    this.queues.set("critical", []);
    this.queues.set("high", []);
    this.queues.set("normal", []);
    this.queues.set("low", []);
  }

  /**
   * Enqueue request with priority
   */
  enqueue(request: RequestInfo): boolean {
    const queue = this.queues.get(request.priority)!;

    if (this.getTotalSize() >= this.maxSize) {
      return false;
    }

    queue.push(request);
    return true;
  }

  /**
   * Dequeue next request respecting priority
   */
  dequeue(): RequestInfo | null {
    const priorities: PriorityLevel[] = ["critical", "high", "normal", "low"];

    for (const priority of priorities) {
      const queue = this.queues.get(priority)!;
      if (queue.length > 0) {
        return queue.shift()!;
      }
    }

    return null;
  }

  /**
   * Dequeue multiple requests
   */
  dequeueMultiple(count: number): RequestInfo[] {
    const results: RequestInfo[] = [];

    for (let i = 0; i < count; i++) {
      const req = this.dequeue();
      if (!req) break;
      results.push(req);
    }

    return results;
  }

  /**
   * Get total queue size
   */
  getTotalSize(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Get size by priority
   */
  getSizeByPriority(): Record<PriorityLevel, number> {
    return {
      critical: this.queues.get("critical")!.length,
      high: this.queues.get("high")!.length,
      normal: this.queues.get("normal")!.length,
      low: this.queues.get("low")!.length
    };
  }

  /**
   * Clear all queues
   */
  clear(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0;
    }
  }
}

/* ========================
   REQUEST THROTTLER
======================== */

export class RequestThrottler {
  private limiters = new Map<string, TokenBucketLimiter>();
  private defaultLimiter: TokenBucketLimiter;

  constructor(defaultConfig: RateLimitConfig) {
    this.defaultLimiter = new TokenBucketLimiter(defaultConfig);
  }

  /**
   * Register per-user rate limit
   */
  registerUserLimit(userId: string, config: RateLimitConfig): void {
    this.limiters.set(userId, new TokenBucketLimiter(config));
  }

  /**
   * Check rate limit for user/request
   */
  checkLimit(userId: string, tokens: number = 1): RateLimitResult {
    const limiter = this.limiters.get(userId) ?? this.defaultLimiter;
    return limiter.tryConsume(tokens);
  }

  /**
   * Get user's token count
   */
  getUserTokens(userId: string): number {
    const limiter = this.limiters.get(userId) ?? this.defaultLimiter;
    return limiter.getTokens();
  }

  /**
   * Reset user limit
   */
  resetUserLimit(userId: string): void {
    const limiter = this.limiters.get(userId);
    if (limiter) {
      limiter.reset();
    }
  }
}
