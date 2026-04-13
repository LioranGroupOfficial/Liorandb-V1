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

## Main API

### Manager

```ts
const manager = new LioranManager({
  rootPath: "./data",
  encryptionKey: "secret",
  ipc: "primary" // optional: "primary" | "client" | "readonly"
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
