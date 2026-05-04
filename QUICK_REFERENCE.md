# 🎯 LioranDB v2 Quick Reference

## Initialization

```typescript
import { createProductionEngine } from "./core/productionEngine.js";

const engine = await createProductionEngine({
  nodeId: "db-1",
  dataDir: "./data",
  port: 9000,
  replicationEnabled: true,
  shardCount: 16
});

const stats = engine.getStats();
await engine.shutdown();
```

---

## Query Execution

### Basic Query
```typescript
const result = await engine.executeQuery(
  { email: "user@example.com" },
  { projection: ["name", "age"] }
);
```

### Pagination with Cursor
```typescript
const page1 = await engine.executePaginatedQuery(
  { status: "active" },
  { limit: 100, field: "createdAt" }
);

const page2 = await engine.executePaginatedQuery(
  { status: "active" },
  { limit: 100, field: "createdAt", cursor: page1.nextCursor }
);
```

### Transactions
```typescript
const txn = engine.beginTransaction();
try {
  // Query and write operations within snapshot
  engine.commitTransaction(txn);
} catch (err) {
  // Auto-rollback
}
```

---

## MVCC & Concurrency

```typescript
import { MVCCVersionManager, MVCCTransactionManager } from "./core/mvcc.js";

const vm = new MVCCVersionManager();
const txm = new MVCCTransactionManager(vm);

const snapshot = txm.beginTransaction("snapshot");
// All reads see consistent state
txm.commitTransaction(snapshot);
```

---

## Caching & Invalidation

```typescript
import { TTLCache, CacheInvalidationEngine } from "./core/cacheInvalidation.js";

const engine = new CacheInvalidationEngine("hybrid");
const cache = new TTLCache(100 * 1024 * 1024, engine);

// Set with TTL
cache.set({ type: "query", keys: ["users"] }, results, 60000);

// Auto-invalidate on dependencies
engine.registerDependency(
  { type: "document", keys: ["user", "123"] },
  { type: "query", keys: ["users"] }
);

// Listen
cache.onInvalidation(event => {
  console.log(`Invalidated: ${event.cause}`);
});
```

---

## Rate Limiting

```typescript
import { TokenBucketLimiter, AdaptiveBackpressure } from "./core/backpressure.js";

// Per-user limit
const limiter = new TokenBucketLimiter({ requestsPerSecond: 100 });
const canProceed = limiter.tryConsume(1).allowed;

// Adaptive system-wide
const backpressure = new AdaptiveBackpressure({
  strategy: "adaptive",
  highWaterMark: 70,  // Reject when >70% memory
  lowWaterMark: 40
});

if (!backpressure.canAcceptRequest("normal", estimatedBytes)) {
  backpressure.queueRequest(request);
}
```

---

## Observability

```typescript
import {
  QueryTracer,
  MetricsCollector,
  AlertEngine
} from "./core/observability.js";

const tracer = new QueryTracer(100);  // 100ms slow threshold
const trace = tracer.startTrace(query);
// ... query ...
tracer.endTrace(trace, scanned, returned);

const slowQueries = tracer.getSlowQueries(10);

const metrics = new MetricsCollector();
metrics.recordMetric("latency_ms", duration);
const stats = metrics.getMetricStats("latency_ms");

const alerts = new AlertEngine();
alerts.setThreshold("latency_ms", 100, "warning");
alerts.onAlert(alert => console.log(alert));
```

---

## Replication (Raft)

```typescript
import { RaftStateMachine, RaftLogManager } from "./cluster/raft-advanced.js";

const raft = new RaftStateMachine({
  nodeId: "node-1",
  heartbeatIntervalMs: 100,
  electionTimeoutMs: 250
});

const log = new RaftLogManager();
const entry = log.append(currentTerm, command);
log.setCommitIndex(safeIndex);
```

---

## Sharding

```typescript
import { ShardLocator, QueryRouter } from "./sharding/partitionRouter.js";

const locator = new ShardLocator(16);
locator.registerShard(0, "node-1", true);

const router = new QueryRouter(locator);
const route = router.routeById("doc-123");
```

---

## Storage Optimization

```typescript
import { BloomFilter, StorageTuner } from "./core/storageOptimization.js";

const bloom = new BloomFilter(10000, 10);
bloom.add("doc-id");
if (!bloom.mightContain("doc-id")) {
  // Definitely not there - skip disk read
}

const tuner = new StorageTuner();
const compression = tuner.getOptimalCompression(sampleData);
```

---

## Key Files

| File | Purpose |
|------|---------|
| `cursor.ts` | Pagination with cursor tokens |
| `mvcc.ts` | Multi-version concurrency control |
| `coveringIndex.ts` | Zero-copy index execution |
| `cacheInvalidation.ts` | TTL cache with dependency tracking |
| `walAdvanced.ts` | Group commit & segmentation |
| `raft-advanced.ts` | Raft consensus |
| `partitionRouter.ts` | Shard routing |
| `tcpServer.ts` | Network layer |
| `backpressure.ts` | Load management |
| `observability.ts` | Metrics & tracing |
| `storageOptimization.ts` | Compression & bloom filters |
| `productionEngine.ts` | Integration layer |

---

## Performance Tuning

### High-Throughput Writes
- Increase `maxRecordsPerGroup` in WAL
- Enable compression for large values
- Tune bloom filter bits per key

### Low-Latency Reads
- Enable covering indexes
- Use cursor pagination (not offset)
- Increase cache TTL for hot data

### Memory Management
- Configure cache maxBytes appropriately
- Tune MVCC `maxVersionsPerDoc`
- Set backpressure thresholds

### Replication
- Adjust heartbeat/election timeouts
- Configure snapshot intervals
- Monitor replication lag

---

## Monitoring Checklist

- [ ] p99 latency < 100ms
- [ ] Cache hit ratio > 70%
- [ ] Slow queries < 1% of total
- [ ] Replication lag < 100ms
- [ ] Memory usage < 80%
- [ ] Backpressure acceptance rate > 95%

---

## Common Issues

### Slow Queries
```typescript
const slow = tracer.getSlowQueries();
// Check if covering index available
const plan = planner.planCoveringIndexExecution(queryFields);
```

### High Memory
```typescript
const stats = cache.getStats();
// Reduce cache maxBytes or TTL
```

### Replication Lag
```typescript
const state = raft.getState();
// Check network, adjust timeouts
```

---

## Production Deployment

1. Initialize engine with recommended settings
2. Set up monitoring hooks
3. Configure alerting thresholds
4. Enable health checks
5. Test failover scenarios
6. Monitor metrics continuously
