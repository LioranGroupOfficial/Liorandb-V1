# 🏗️ LioranDB Production Architecture

## Directory Structure

```
src/
├── core/
│   ├── cursor.ts                 ⭐ Cursor-based pagination
│   ├── mvcc.ts                   ⭐ Multi-version concurrency control
│   ├── coveringIndex.ts          ⭐ Zero-copy index queries
│   ├── cacheInvalidation.ts      ⭐ TTL cache + dependency tracking
│   ├── walAdvanced.ts            ⭐ Group commit + segmentation
│   ├── tcpServer.ts              ⭐ Network layer + compression
│   ├── backpressure.ts           ⭐ Load management + rate limiting
│   ├── observability.ts          ⭐ Tracing + metrics + alerts
│   ├── storageOptimization.ts    ⭐ Compression + bloom filters
│   ├── productionEngine.ts       ⭐ Integration layer
│   ├── database.ts               ✅ (existing, enhanced)
│   ├── collection.ts             ✅ (existing, enhanced)
│   ├── index.ts                  ✅ (existing, enhanced)
│   ├── wal.ts                    ✅ (existing, enhanced)
│   ├── transaction.ts            ✅ (existing)
│   └── ... (other files)
│
├── cluster/
│   ├── raft-advanced.ts          ⭐ Raft consensus engine
│   ├── raft.ts                   ✅ (existing, enhanced)
│   └── controller.ts             ✅ (existing)
│
├── sharding/
│   ├── partitionRouter.ts        ⭐ Partition-aware routing
│   ├── hash.ts                   ✅ (existing)
│   └── shardedCollection.ts      ✅ (existing, enhanced)
│
├── replication/
│   ├── coordinator.ts            ✅ (existing)
│   ├── replicator.ts             ✅ (existing)
│   └── walStream.ts              ✅ (existing)
│
├── ipc/
├── metrics/
├── types/
├── utils/
└── background/

⭐ = New files created
✅ = Existing files (can be enhanced to use new features)
```

---

## Layer Architecture

```
┌─────────────────────────────────────────┐
│         CLIENT APPLICATIONS             │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   TCP Server & Compression              │  ← tcpServer.ts
│   (Binary Protocol, Connection Pool)    │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Backpressure & Rate Limiting          │  ← backpressure.ts
│   (Adaptive, Token Bucket, Priorities)  │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Query Router & Partition Planner      │  ← partitionRouter.ts
│   (Consistent Hashing, Scatter-Gather)  │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Covering Index Planner                │  ← coveringIndex.ts
│   (Zero-Copy Detection)                 │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   MVCC & Transaction Manager            │  ← mvcc.ts
│   (Snapshot Isolation, Versions)        │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Cache Layer                           │  ← cacheInvalidation.ts
│   (TTL, Invalidation, LRU)              │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Query Executor                        │  ← query.ts (enhanced)
│   (Filter, Project, Aggregate)          │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Cursor Pagination                     │  ← cursor.ts
│   (Stable Results, Safe Boundaries)     │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Write-Ahead Log (WAL)                 │  ← walAdvanced.ts
│   (Group Commit, Segmentation)          │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Storage Engine                        │  ← storageOptimization.ts
│   (Bloom Filter, Compression)           │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Raft Replication                      │  ← raft-advanced.ts
│   (Quorum Writes, Log Replication)      │
└────────────────────┬────────────────────┘
                     │
┌────────────────────▼────────────────────┐
│   Persistent Storage (LevelDB)          │
│   (Indexed, Compressed, Checksummed)    │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│   Observability Layer (Async)           │  ← observability.ts
│   (Tracing, Metrics, Alerts, Health)    │
└─────────────────────────────────────────┘
```

---

## Data Flow Diagrams

### 1. Read Query Flow

```
Client Query
    ↓
TCP Server (Decompress if needed)
    ↓
Backpressure Check (Token bucket)
    ↓
Query Router (Which shard?)
    ↓
Covering Index Planner (Zero-copy possible?)
    ├─→ YES: CoveringIndexResultSet (O(k))
    ├─→ NO: Cache Check
    │       ├─→ HIT: Return cached result
    │       └─→ MISS:
    │               ↓
    │           MVCC Snapshot (Get read version)
    │               ↓
    │           Query Executor
    │               ├─→ Index Lookup
    │               ├─→ Filter Matching
    │               └─→ Projection
    │               ↓
    │           Cursor Pagination (Add next cursor)
    │               ↓
    │           Cache Store (With TTL)
    │               ↓
    └─→ Return to Client
    
┌─ Async: Record metrics, check slow threshold
└─ Async: Update observability (traces, alerts)
```

### 2. Write Query Flow

```
Client Write
    ↓
TCP Server (Decompress if needed)
    ↓
Backpressure Check (Reject if overloaded)
    ↓
MVCC Transaction
    ├─→ Check read set conflicts
    └─→ Prepare write set
    ↓
Group Commit Queue
    ├─→ Buffer record
    ├─→ Check batch size/time
    └─→ Trigger fsync if ready
    ↓
WAL Segment Manager
    ├─→ Write to current segment
    ├─→ Check rotation needed
    └─→ Rotate if >32MB or 1hr old
    ↓
Raft Replication
    ├─→ Send to followers
    ├─→ Wait for quorum ACK
    └─→ Advance commit index
    ↓
Update MVCC Version
    ├─→ Create new version
    └─→ Mark old versions obsolete
    ↓
Cache Invalidation
    ├─→ Identify affected queries
    └─→ Invalidate dependent entries
    ↓
Return Success to Client
    
┌─ Async: Checkpoint creation
├─ Async: Compression tuning
└─ Async: Record metrics & alerts
```

### 3. Pagination Flow

```
Page 1 Request: { limit: 100, field: "email" }
    ↓
Query execution (same as read)
    ↓
Sort results by email
    ↓
Take first 101 rows (limit + 1)
    ↓
Encode last row as cursor:
    base64({
      indexKey: "email",
      indexValue: "user@example.com",
      _id: "doc-123",
      timestamp: now
    })
    ↓
Return:
{
  items: [100 docs],
  nextCursor: "...",  ← Use for Page 2
  hasMore: true,
  count: 100
}

Page 2 Request: { limit: 100, field: "email", cursor: "..." }
    ↓
Decode cursor → CursorPosition
    ↓
Seek index to cursor position
    ↓
Query from there forward
    ↓
Guaranteed no duplicates!
    └─ Cursor prevents overlap
```

### 4. Replication Flow (Raft)

```
Client Write → Leader
    ↓
Leader appends to log
    ↓
Send LogAppendRPC to Followers
    ├─→ Follower appends to log
    ├─→ Send ACK
    └─→ Update match index
    ↓
Wait for Quorum (N/2 + 1)
    ├─→ Got majority? YES:
    │       ↓
    │   Advance commit index
    │       ↓
    │   Apply to state machine
    │       ↓
    │   Return success to client
    │       ↓
    │   Send to followers in next heartbeat
    │
    └─→ Timeout? ABORT & Retry
```

### 5. Backpressure Flow

```
Incoming Request
    ↓
Check System Metrics:
├─→ Memory < 40%: State = "accepting"
├─→ 40% ≤ Memory < 70%: State = "throttling"
└─→ Memory ≥ 70%: State = "rejecting"
    ↓
Check Priority:
├─→ Critical: ALWAYS accept
├─→ High: Accept if not "rejecting"
├─→ Normal: Accept if not "throttling"
└─→ Low: Accept only if "accepting"
    ↓
Check Rate Limit:
├─→ Tokens available? Consume and accept
└─→ No tokens? Add to queue or reject
    ↓
Request proceeds or queued
```

---

## Feature Integration Matrix

| Feature | Uses MVCC | Uses Cache | Uses Cursor | Uses Raft | Uses Routing |
|---------|-----------|-----------|-----------|-----------|--------------|
| Read Query | ✅ | ✅ | ❌ | ❌ | ✅ |
| Pagination | ✅ | ✅ | ✅ | ❌ | ✅ |
| Single Write | ✅ | ✅ | ❌ | ✅ | ✅ |
| Transaction | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| Batch Write | ✅ | ✅ | ❌ | ✅ | ✅ |
| Covering Index | ✅ | ✅ | ❌ | ❌ | ✅ |
| Aggregation | ✅ | ✅ | ❌ | ❌ | ✅ |

---

## Configuration Hierarchy

```
ProductionEngineConfig
├─ nodeId: "db-1"
├─ dataDir: "./data"
├─ port: 9000
├─ replicationEnabled: true
│   └─ RaftConfig: heartbeat, election timeout
├─ observabilityEnabled: true
│   └─ QueryTracerConfig: slowQueryThreshold
├─ shardCount: 16
│   └─ ShardLocatorConfig: vitual nodes
├─ maxConnections: 1000
│   └─ TCPServerConfig: compression, idle timeout
├─ mvccEnabled: true
│   └─ MVCCConfig: maxVersionsPerDoc
├─ cursorPaginationEnabled: true
├─ coveringIndexEnabled: true
├─ cacheEnabled: true
│   └─ CacheConfig: maxBytes, maxEntries
└─ compressionEnabled: true
    └─ StorageOptimizationConfig: type, level
```

---

## State Machine Transitions

### Backpressure States

```
         accepting
        /    |    \
       /     |     \
   rejecting|throttling
       \     |     /
        \    |    /
         accepting
```

When to transition:
- `accepting → throttling`: memory ≥ 70%
- `throttling → rejecting`: memory ≥ 90%
- `rejecting → throttling`: memory < 40%
- `throttling → accepting`: memory < 40%

### Raft States

```
    init
     |
  follower ←──────────────┐
   /    \                 │
  /      \                │
candidate→leader ────→ follower
         (win election)
```

---

## Performance Characteristics

| Operation | Complexity | Latency | Notes |
|-----------|-----------|---------|-------|
| **Read (no index)** | O(n) | 10-100ms | Full scan |
| **Read (indexed)** | O(log n) | 1-10ms | B-tree index |
| **Read (covering)** | O(k) | 0.1-1ms | Zero-copy |
| **Write** | O(log n) | 5-50ms | WAL + replication |
| **Pagination** | O(log n + k) | 1-10ms | Cursor-based |
| **Cache hit** | O(1) | 0.01-0.1ms | In-memory |
| **Invalidate** | O(d) | <1ms | d = dependents |
| **Raft commit** | O(1) | 50-100ms | Quorum write |

---

## Monitoring Points

All components expose stats:

```typescript
{
  mvcc: { documentCount, versionCount },
  cache: { entryCount, bytes, utilizationPercent },
  wal: { segments, lastRotateTime },
  raft: { state, term, commitIndex },
  sharding: { activeShard, healthyNodes },
  network: { connections, activeRequests },
  backpressure: { state, queueDepth, rejectionRate },
  observability: {
    traces,
    slowQueries,
    alertsRaised,
    metricsRecorded
  }
}
```

---

## Deployment Topology

### Single Node
```
┌─────────────────┐
│  Client Apps    │
└────────┬────────┘
         │
    TCP 9000
         │
┌────────▼────────────────────────────┐
│  LioranDB Production Engine          │
│  ├─ MVCC + Cache                     │
│  ├─ Query + Pagination               │
│  ├─ WAL (no replication)             │
│  └─ Single node (leader)             │
└────────┬────────────────────────────┘
         │
      LevelDB
```

### Replicated Cluster (3 nodes)
```
┌──────┐  ┌──────┐  ┌──────┐
│ App  │  │ App  │  │ App  │
└───┬──┘  └───┬──┘  └───┬──┘
    │         │         │
  9000      9000      9000
    │         │         │
┌───▼─────────▼─────────▼───┐
│       Raft Cluster        │
├───────────┬───────────┬───┤
│ Leader    │ Follower  │ F │
│ (Writes)  │ (Reads)   │ (R)
└───┬───────┴───────┬───┴───┘
    │               │
   WAL            WAL
    │               │
 LevelDB         LevelDB
```

### Sharded Cluster (3 shards × 3 replicas)
```
┌──────────────────────────────────┐
│         Load Balancer            │
└──────────────┬───────────────────┘
               │
       Router (consistent hash)
      /        |        \
   Shard 0  Shard 1  Shard 2
   /│\       /│\      /│\
  L F F    L F F    L F F
  │ │ │    │ │ │    │ │ │
 DB DB DB DB DB DB DB DB DB

L = Leader, F = Follower
```

---

## Debugging Checklist

**High Latency?**
- [ ] Check if covering index available
- [ ] Review slow query logs
- [ ] Monitor cache hit ratio
- [ ] Check Raft replication lag

**High Memory?**
- [ ] Reduce cache maxBytes
- [ ] Lower MVCC maxVersionsPerDoc
- [ ] Enable compression

**Data Consistency Issues?**
- [ ] Check Raft quorum size
- [ ] Review transaction conflicts
- [ ] Monitor version creation rate

**Replication Lag?**
- [ ] Check network latency
- [ ] Review log size
- [ ] Adjust Raft timeouts

---

## Next Steps

1. **Review** architecture diagrams
2. **Understand** data flows
3. **Study** component interactions
4. **Test** individual pieces
5. **Integrate** into main DB
6. **Monitor** in production
