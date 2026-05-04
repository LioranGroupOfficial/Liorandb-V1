# @liorandb/core

LioranDB Core is an encrypted, local-first embedded database for Node.js with a Mongo-like collection API, secondary indexes, schema migration hooks, WAL-backed transactions, and TypeScript-friendly ergonomics.

## Install

```bash
npm install @liorandb/core
```

## Quick Start

```ts
import { LioranManager } from "@liorandb/core";

const manager = new LioranManager({
  rootPath: "./data",
  encryptionKey: "my-secret"
});

const db = await manager.db("app");
const users = db.collection<{ name: string; email: string; age: number }>("users");

await users.insertOne({
  name: "Ava",
  email: "ava@example.com",
  age: 25
});

await db.createIndex("users", "email", { unique: true });

const result = await users.find(
  { age: 25 },
  {
    projection: ["name", "email"],
    limit: 10,
    offset: 0
  }
);

console.log(result);
```

## Highlights

- Encrypted document storage with AES-256-GCM.
- Secondary indexes for equality and range-style query routing.
- `collection.count()` in O(1) time.
- `find()` pagination and projection support.
- `aggregate()` pipeline support with `$match`, `$group`, `$project`, `$skip`, and `$limit`.
- Query explain plans through `collection.explain()` and `db.explain(...)`.
- WAL-backed transaction recovery.
- Encryption key rotation for stored documents and WAL files.
- Multi-node building blocks: Raft leader election (cluster mode), push-based WAL streaming replication, read-replica nodes, and optional per-collection sharding.

## Main API

### Manager

```ts
const manager = new LioranManager({
  rootPath: "./data",
  encryptionKey: "secret",
  ipc: "primary" // optional: "primary" | "client" | "readonly"
});
```

### Cluster (Raft + WAL streaming)

Run multiple nodes with the same `cluster.peers` list; Raft elects a leader, followers stream WAL in near real-time.

```ts
const manager = new LioranManager({
  rootPath: "./data-node-1",
  cluster: {
    enabled: true,
    nodeId: "n1",
    host: "127.0.0.1",
    raftPort: 7101,
    walStreamPort: 7201,
    peers: [
      { id: "n2", host: "127.0.0.1", raftPort: 7102, walStreamPort: 7202 },
      { id: "n3", host: "127.0.0.1", raftPort: 7103, walStreamPort: 7203 }
    ],
    // optional: waitForMajority: true
  }
});
```

Followers are read-replicas by default; writes are only accepted on the elected leader.

### Sharding

```ts
const manager = new LioranManager({
  rootPath: "./data",
  ipc: "primary",
  sharding: { shards: 8 } // routes by hash(_id) % N
});
```

### Storage Tuning (Bloom / Compaction / LevelDB options)

```ts
const manager = new LioranManager({
  rootPath: "./data",
  ipc: "primary",
  storage: {
    // classic-level uses a Bloom filter internally (10 bits/key by default).
    bloomFilterBits: 10,

    // Adaptive compaction (uses write load + read amplification heuristics).
    adaptiveCompaction: {
      enabled: true,
      writeOpsPerMin: 50_000,
      readAmplificationThreshold: 25
    },

    // Pass-through LevelDB tuning knobs (classic-level).
    leveldb: {
      cacheSize: 256 * 1024 * 1024,
      writeBufferSize: 64 * 1024 * 1024,
      blockSize: 16 * 1024,
      maxOpenFiles: 500,
      compression: true
    }
  }
});
```

### Latency Budgets (<100ms reads/writes)

Budgets are best-effort by default (warn on violations). You can switch to hard timeouts with `onViolation: "throw"`.

```ts
const manager = new LioranManager({
  rootPath: "./data",
  ipc: "primary",
  latency: {
    readBudgetMs: 100,
    writeBudgetMs: 100,
    walAppendBudgetMs: 5,
    onViolation: "warn" // "none" | "warn" | "throw"
  },
  // For low-latency writes, prefer async durability (avoids fsync-on-commit).
  durability: { level: "async" }
});
```

### Metrics & Observability

Get production-ready stats (latency p50/p95/p99, cache hit rate, WAL lag, replication delay):

```ts
const stats = (await manager.db("app")).stats();
console.log(stats.latencyMs.read, stats.cache.query, stats.replication);
```

### Background Tasks

Enable a central scheduler (primary nodes) for:

- Auto index rebuild (if index files are missing)
- Auto compaction (reuses the existing maintenance logic)
- Cache cleanup (light decay)

```ts
const manager = new LioranManager({
  rootPath: "./data",
  ipc: "primary",
  background: { intervalMs: 10_000 }
});
```

### Database

```ts
const db = await manager.db("app");

await db.createIndex("users", "email", { unique: true });
await db.compactAll();
await db.rotateEncryptionKey("new-secret");

const explain = await db.explain("users", { email: "ava@example.com" });
```

### Collection

```ts
const users = db.collection("users");

await users.insertOne({ name: "Ava", age: 25 });
await users.insertMany([{ name: "Ben", age: 30 }]);

const docs = await users.find(
  { age: { $gte: 18 } },
  { projection: ["name"], limit: 20, offset: 0 }
);

const one = await users.findOne(
  { name: "Ava" },
  { projection: ["name", "age"] }
);

const total = await users.count();

const grouped = await users.aggregate([
  { $match: { age: { $gte: 18 } } },
  { $group: { _id: "$age", count: { $sum: 1 } } }
]);
```

## Transactions

```ts
await db.transaction(async (tx) => {
  tx.collection("users").insertOne({
    name: "Ava",
    email: "ava@example.com"
  });
});
```

Transactional writes are recorded in the WAL and recovered on restart if needed.

## Docs

- [Getting Started](docs/getting-started.md)
- [Collections and Queries](docs/collections.md)
- [Security and Reliability](docs/security-and-reliability.md)
- [Source Map](docs/source-map.md)

## Notes

- Document payloads are encrypted at rest.
- WAL records are encrypted.
- Index contents are stored separately from documents and are not currently encrypted.
- Query projection reduces returned payload size and response serialization work, but documents are still stored as encrypted blobs, so matched documents are still fully read and decrypted before projection is applied.

## License

LDEP
