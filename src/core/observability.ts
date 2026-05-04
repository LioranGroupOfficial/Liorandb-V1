/**
 * Observability Layer
 * Query tracing, slow query logs, metrics, and alerting hooks
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  tags: Map<string, string>;
  metrics: Map<string, number>;
}

export interface QueryTrace {
  traceId: string;
  query: any;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  rowsScanned: number;
  rowsReturned: number;
  usedIndex?: string;
  slow: boolean;
  error?: Error;
}

export interface SlowQueryLog {
  timestamp: number;
  query: any;
  durationMs: number;
  threshold: number;
  rowsScanned: number;
  rowsReturned: number;
  collection: string;
  usedIndex?: string;
  executionPlan?: any;
}

export interface MetricPoint {
  timestamp: number;
  name: string;
  value: number;
  tags?: Record<string, string>;
}

export interface AlertEvent {
  timestamp: number;
  level: "critical" | "warning" | "info";
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
}

/* ========================
   TRACE CONTEXT
======================== */

export class TraceContextManager {
  private contexts = new Map<string, TraceContext>();
  private traceIdCounter = 0;

  /**
   * Start new trace
   */
  startTrace(parentSpanId?: string): TraceContext {
    const traceId = `trace-${++this.traceIdCounter}-${Date.now()}`;
    const spanId = `span-${++this.traceIdCounter}`;

    const context: TraceContext = {
      traceId,
      spanId,
      parentSpanId,
      startTime: Date.now(),
      tags: new Map(),
      metrics: new Map()
    };

    this.contexts.set(traceId, context);
    return context;
  }

  /**
   * Get trace context
   */
  getTrace(traceId: string): TraceContext | null {
    return this.contexts.get(traceId) ?? null;
  }

  /**
   * Add tag to trace
   */
  addTag(traceId: string, key: string, value: string): void {
    const context = this.contexts.get(traceId);
    if (context) {
      context.tags.set(key, value);
    }
  }

  /**
   * Record metric
   */
  recordMetric(traceId: string, name: string, value: number): void {
    const context = this.contexts.get(traceId);
    if (context) {
      context.metrics.set(name, value);
    }
  }

  /**
   * End trace
   */
  endTrace(traceId: string): void {
    this.contexts.delete(traceId);
  }

  /**
   * Get trace dump
   */
  dumpTrace(traceId: string): object | null {
    const context = this.contexts.get(traceId);
    if (!context) return null;

    return {
      traceId: context.traceId,
      spanId: context.spanId,
      duration: Date.now() - context.startTime,
      tags: Object.fromEntries(context.tags),
      metrics: Object.fromEntries(context.metrics)
    };
  }
}

/* ========================
   QUERY TRACER
======================== */

export class QueryTracer {
  private traces: QueryTrace[] = [];
  private maxTraces = 10000;
  private slowQueryThreshold = 100; // ms

  constructor(slowQueryThreshold: number = 100) {
    this.slowQueryThreshold = slowQueryThreshold;
  }

  /**
   * Start tracing query
   */
  startTrace(query: any): QueryTrace {
    const trace: QueryTrace = {
      traceId: `qtrace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      query,
      startTime: Date.now(),
      rowsScanned: 0,
      rowsReturned: 0,
      slow: false
    };

    return trace;
  }

  /**
   * Record query execution
   */
  endTrace(trace: QueryTrace, rowsScanned: number, rowsReturned: number, usedIndex?: string): QueryTrace {
    trace.endTime = Date.now();
    trace.durationMs = trace.endTime - trace.startTime;
    trace.rowsScanned = rowsScanned;
    trace.rowsReturned = rowsReturned;
    trace.usedIndex = usedIndex;
    trace.slow = trace.durationMs > this.slowQueryThreshold;

    this.traces.push(trace);

    // Keep only recent traces
    if (this.traces.length > this.maxTraces) {
      this.traces = this.traces.slice(-Math.floor(this.maxTraces * 0.8));
    }

    return trace;
  }

  /**
   * Record query error
   */
  recordError(trace: QueryTrace, error: Error): void {
    trace.endTime = Date.now();
    trace.durationMs = trace.endTime - trace.startTime;
    trace.error = error;
    trace.slow = true; // Errors are considered "slow"

    this.traces.push(trace);
  }

  /**
   * Get slow queries
   */
  getSlowQueries(limit: number = 100): QueryTrace[] {
    return this.traces
      .filter(t => t.slow && t.durationMs)
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .slice(0, limit);
  }

  /**
   * Get trace by ID
   */
  getTrace(traceId: string): QueryTrace | null {
    return this.traces.find(t => t.traceId === traceId) ?? null;
  }

  /**
   * Get all traces
   */
  getAllTraces(): QueryTrace[] {
    return [...this.traces];
  }

  /**
   * Clear traces
   */
  clear(): void {
    this.traces = [];
  }
}

/* ========================
   METRICS COLLECTOR
======================== */

export class MetricsCollector {
  private metrics: MetricPoint[] = [];
  private maxMetrics = 50000;
  private aggregates = new Map<string, { sum: number; count: number; min: number; max: number }>();

  /**
   * Record metric
   */
  recordMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: MetricPoint = {
      timestamp: Date.now(),
      name,
      value,
      tags
    };

    this.metrics.push(metric);

    // Update aggregate
    const key = name;
    if (!this.aggregates.has(key)) {
      this.aggregates.set(key, { sum: 0, count: 0, min: Infinity, max: -Infinity });
    }

    const agg = this.aggregates.get(key)!;
    agg.sum += value;
    agg.count++;
    agg.min = Math.min(agg.min, value);
    agg.max = Math.max(agg.max, value);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-Math.floor(this.maxMetrics * 0.8));
    }
  }

  /**
   * Get metric statistics
   */
  getMetricStats(name: string): { avg: number; min: number; max: number; count: number } | null {
    const agg = this.aggregates.get(name);
    if (!agg) return null;

    return {
      avg: agg.sum / agg.count,
      min: agg.min,
      max: agg.max,
      count: agg.count
    };
  }

  /**
   * Get metrics by name and time range
   */
  getMetricsByRange(
    name: string,
    startTime: number,
    endTime: number
  ): MetricPoint[] {
    return this.metrics.filter(
      m => m.name === name && m.timestamp >= startTime && m.timestamp <= endTime
    );
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): MetricPoint[] {
    return [...this.metrics];
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics = [];
    this.aggregates.clear();
  }
}

/* ========================
   ALERT ENGINE
======================== */

export class AlertEngine {
  private alerts: AlertEvent[] = [];
  private maxAlerts = 10000;
  private thresholds = new Map<string, { value: number; level: "critical" | "warning" }>();
  private alertHandlers: Array<(alert: AlertEvent) => void> = [];

  /**
   * Set alert threshold
   */
  setThreshold(
    metricName: string,
    value: number,
    level: "critical" | "warning" = "warning"
  ): void {
    this.thresholds.set(metricName, { value, level });
  }

  /**
   * Check metric against threshold
   */
  checkMetric(metricName: string, value: number): void {
    const threshold = this.thresholds.get(metricName);
    if (!threshold) return;

    if (value > threshold.value) {
      this.raiseAlert(
        threshold.level,
        `Metric ${metricName} exceeded threshold`,
        metricName,
        value,
        threshold.value
      );
    }
  }

  /**
   * Raise alert
   */
  raiseAlert(
    level: "critical" | "warning" | "info",
    message: string,
    metric?: string,
    value?: number,
    threshold?: number
  ): void {
    const alert: AlertEvent = {
      timestamp: Date.now(),
      level,
      message,
      metric,
      value,
      threshold
    };

    this.alerts.push(alert);

    // Notify handlers
    for (const handler of this.alertHandlers) {
      handler(alert);
    }

    // Keep only recent alerts
    if (this.alerts.length > this.maxAlerts) {
      this.alerts = this.alerts.slice(-Math.floor(this.maxAlerts * 0.8));
    }
  }

  /**
   * Subscribe to alerts
   */
  onAlert(handler: (alert: AlertEvent) => void): () => void {
    this.alertHandlers.push(handler);
    return () => {
      const idx = this.alertHandlers.indexOf(handler);
      if (idx >= 0) this.alertHandlers.splice(idx, 1);
    };
  }

  /**
   * Get alerts by level and time range
   */
  getAlerts(
    level?: "critical" | "warning" | "info",
    startTime?: number,
    endTime?: number
  ): AlertEvent[] {
    return this.alerts.filter(a => {
      if (level && a.level !== level) return false;
      if (startTime && a.timestamp < startTime) return false;
      if (endTime && a.timestamp > endTime) return false;
      return true;
    });
  }

  /**
   * Get critical alerts
   */
  getCriticalAlerts(): AlertEvent[] {
    return this.getAlerts("critical");
  }

  /**
   * Clear alerts
   */
  clear(): void {
    this.alerts = [];
  }
}

/* ========================
   HEALTH CHECK
======================== */

export class HealthChecker {
  private lastCheckTime = Date.now();
  private healthy = true;
  private failureCount = 0;
  private failureThreshold = 3;
  private checks = new Map<string, () => Promise<boolean>>();

  /**
   * Register health check
   */
  registerCheck(name: string, checkFn: () => Promise<boolean>): void {
    this.checks.set(name, checkFn);
  }

  /**
   * Run all health checks
   */
  async runChecks(): Promise<{ healthy: boolean; results: Record<string, boolean> }> {
    const results: Record<string, boolean> = {};
    let allHealthy = true;

    for (const [name, checkFn] of this.checks) {
      try {
        results[name] = await Promise.race([
          checkFn(),
          new Promise<false>(resolve => setTimeout(() => resolve(false), 5000))
        ]);

        if (!results[name]) allHealthy = false;
      } catch {
        results[name] = false;
        allHealthy = false;
      }
    }

    this.lastCheckTime = Date.now();

    if (!allHealthy) {
      this.failureCount++;

      if (this.failureCount >= this.failureThreshold) {
        this.healthy = false;
      }
    } else {
      this.failureCount = 0;
      this.healthy = true;
    }

    return { healthy: this.healthy, results };
  }

  /**
   * Get health status
   */
  getStatus(): { healthy: boolean; lastCheck: number; failureCount: number } {
    return {
      healthy: this.healthy,
      lastCheck: this.lastCheckTime,
      failureCount: this.failureCount
    };
  }
}
