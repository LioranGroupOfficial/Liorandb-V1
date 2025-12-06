# @liorandb/core

**LioranDB Core Module** – Lightweight, local-first, peer-to-peer database management for Node.js.

This is the **core system-level module** of LioranDB. It provides foundational database management functionality, including collections, queries, updates, encryption, and environment setup. **Note:** This is not the final database product, but a core module designed to be used in larger systems.

---

## Table of Contents

* [Installation](#installation)
* [Overview](#overview)
* [Getting Started](#getting-started)
* [API Reference](#api-reference)

  * [LioranManager](#lioranmanager)
  * [LioranDB](#liorandb)
  * [Collection](#collection)
  * [Query Operators](#query-operators)
  * [Update Operators](#update-operators)
  * [Utilities](#utilities)
* [Encryption](#encryption)
* [Environment Setup](#environment-setup)
* [License](#license)

---

## Installation

```bash
npm install @liorandb/core
```

> Node.js v18+ recommended.

---

## Overview

`@liorandb/core` provides:

* Local-first, file-based database directories.
* MongoDB-style API (`db`, `collection`, `insertOne`, `find`, `updateOne`, etc.).
* Peer-to-peer-friendly design.
* Data encryption at rest.
* Automatic environment configuration.
* TypeScript typings for full developer support.

This module is intended for **Node.js projects** and can serve as the core database engine for larger LioranDB systems.

---

## Getting Started

```javascript
import { LioranManager } from "@liorandb/core";

async function main() {
  const manager = new LioranManager();
  const db = await manager.db("myDatabase");

  const users = db.collection("users");

  // Insert a document
  const user = await users.insertOne({ name: "Alice", age: 25 });

  // Query documents
  const results = await users.find({ age: { $gte: 18 } });

  console.log(results);
}

main();
```

---

## API Reference

### LioranManager

Manages databases and provides MongoDB-style client access.

```ts
class LioranManager {
  rootPath: string;
  db(name: string): Promise<LioranDB>;
  createDatabase(name: string): Promise<LioranDB>;
  openDatabase(name: string): Promise<LioranDB>;
  closeDatabase(name: string): Promise<void>;
  renameDatabase(oldName: string, newName: string): Promise<boolean>;
  deleteDatabase(name: string): Promise<boolean>;
  dropDatabase(name: string): Promise<boolean>;
  listDatabases(): Promise<string[]>;
}
```

**Example:**

```javascript
const manager = new LioranManager();
await manager.createDatabase("testDB");
const db = await manager.db("testDB");
```

### LioranDB

Represents a single database instance with multiple collections.

```ts
class LioranDB {
  basePath: string;
  dbName: string;
  collection<T>(name: string): Collection<T>;
  createCollection(name: string): Promise<boolean>;
  deleteCollection(name: string): Promise<boolean>;
  dropCollection(name: string): Promise<boolean>;
  renameCollection(oldName: string, newName: string): Promise<boolean>;
  listCollections(): Promise<string[]>;
}
```

**Example:**

```javascript
const users = db.collection("users");
await db.createCollection("products");
const collections = await db.listCollections();
```

### Collection

Handles documents within a database.

```ts
class Collection<T extends { _id?: string }> {
  insertOne(doc: T): Promise<T>;
  insertMany(docs: T[]): Promise<T[]>;
  find(query?: FilterQuery<T>): Promise<T[]>;
  findOne(query?: FilterQuery<T>): Promise<T | null>;
  updateOne(filter: FilterQuery<T>, update: UpdateQuery<T>, options?: { upsert?: boolean }): Promise<T | null>;
  updateMany(filter: FilterQuery<T>, update: UpdateQuery<T>): Promise<T[]>;
  deleteOne(filter: FilterQuery<T>): Promise<boolean>;
  deleteMany(filter: FilterQuery<T>): Promise<number>;
  countDocuments(filter?: FilterQuery<T>): Promise<number>;
  close(): Promise<void>;
}
```

**Example:**

```javascript
await users.insertOne({ name: "Bob", age: 30 });
const adults = await users.find({ age: { $gte: 18 } });
await users.updateOne({ name: "Bob" }, { $inc: { age: 1 } });
await users.deleteOne({ name: "Alice" });
```

### Query Operators

* `$gt`, `$gte`, `$lt`, `$lte`, `$ne`, `$eq`, `$in`

**Example:**

```javascript
users.find({ age: { $gte: 18, $lt: 65 } });
```

### Update Operators

* `$set` – set field values
* `$inc` – increment numeric fields

**Example:**

```javascript
users.updateOne({ name: "Alice" }, { $set: { city: "Mumbai" }, $inc: { age: 1 } });
```

### Utilities

```ts
function getBaseDBFolder(): string;
```

Returns the root folder for LioranDB databases. Automatically sets environment variables if missing.

---

## Encryption

All documents are encrypted using **AES-256-GCM**.

* Uses a master key stored in `.secureKey` within the base folder.
* Data is encrypted automatically before storage and decrypted on retrieval.

**Utility Functions:**

* `encryptData(obj)`
* `decryptData(encStr)`

**Master Key Management:**

* Managed via `getMasterKey()`
* Auto-generates 256-bit key if not found.

---

## Environment Setup

* `getBaseDBFolder()` ensures `LIORANDB_PATH` is set.
* Auto-generates scripts for **Windows PowerShell** or **Linux/macOS bash**.
* Guides users to set system-wide environment variables if missing.

---

## License

**Author:** Swaraj Puppalwar
**License:** LIORANDB LICENSE

---

**Keywords:** p2p-database, lioran, liorandb, p2p-db, peer-to-peer-db, peer-to-peer-database, localfirst-db, localfirst-database
