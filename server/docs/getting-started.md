# Getting Started

## Create a Manager

```ts
import { LioranManager } from "@liorandb/core";

const manager = new LioranManager({
  rootPath: "./data",
  encryptionKey: "my-secret"
});
```

`LioranManager` owns the database root path, encryption key configuration, and process mode.

## Open a Database

```ts
const db = await manager.db("app");
```

Each database lives in its own folder under the manager root path.

## Open a Collection

```ts
const users = db.collection<{ name: string; age: number }>("users");
```

Collections store JSON-like documents and expose the main CRUD API.

## Basic CRUD

```ts
await users.insertOne({ name: "Ava", age: 25 });

const all = await users.find();
const one = await users.findOne({ name: "Ava" });

await users.updateOne(
  { name: "Ava" },
  { $set: { age: 26 } }
);

await users.deleteOne({ name: "Ava" });
```

## Indexing

```ts
await db.createIndex("users", "email", { unique: true });
await db.createIndex("users", "age");
```

Indexes improve equality lookups and range-routing for supported query patterns.

## Close Everything

```ts
await manager.closeAll();
```
