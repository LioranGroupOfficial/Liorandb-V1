# @liorandb/core

**LioranDB Core** is a lightweight, encrypted, TypeScript-first embedded database engine for Node.js.

Think of it as:

* ⚡ **LevelDB speed** (powered by `classic-level`)
* 🔐 **Built-in encryption** (transparent at rest)
* 🧠 **Mongo-like API** (collections, queries, updates)
* 📦 **Zero external services** (no server, no daemon)
* 🧩 **Type-safe by design** (written 100% in TypeScript)

Perfect for:

* Local-first apps
* Desktop / CLI tools
* Edge & serverless experiments
* P2P & offline-sync systems

---

## Features

* 📂 Multiple databases under one manager
* 📁 Multiple collections per database
* 🔑 Optional encryption (AES-based, transparent)
* 🧵 Write-queue for consistency (no race conditions)
* 🧠 Simple query matching
* 🧩 Strong TypeScript inference
* 🚫 No native bindings
* 🚀 Fast startup & low memory

---

## Installation

```bash
npm install @liorandb/core
```

---

## Quick Start (30 seconds)

```ts
import { LioranManager } from "@liorandb/core"

const manager = new LioranManager({
  encryptionKey: "my-secret-key"
})

const db = await manager.db("app")

const users = db.collection<{ name: string; age: number }>("users")

await users.insertOne({ name: "Swaraj", age: 17 })

const result = await users.find({ name: "Swaraj" })
console.log(result)
```

No config. No server. Just code.

---

## Core Concepts

### 1️⃣ LioranManager

The **root controller**. Manages databases, encryption and lifecycle.

```ts
const manager = new LioranManager({
  rootPath: "./data",        // optional
  encryptionKey: "secret"   // optional
})
```

Responsibilities:

* Creates databases
* Opens databases
* Tracks open instances
* Applies encryption globally

---

### 2️⃣ Database

Each database is a **folder on disk**.

```ts
const db = await manager.db("mydb")
```

* Databases are created automatically if missing
* Re-opening returns the same instance

---

### 3️⃣ Collections

Collections are **LevelDB instances** stored inside the database.

```ts
const posts = db.collection<{ title: string; views: number }>("posts")
```

* One folder per collection
* Fully typed
* JSON documents only

---

## Collection API

### insertOne

```ts
await users.insertOne({ name: "Alex", age: 22 })
```

* Auto-generates `_id`
* `_id` can be provided manually

---

### find

```ts
const all = await users.find()
const adults = await users.find({ age: 18 })
```

* Partial object matching
* Returns an array

---

### updateOne

```ts
await users.updateOne(
  { name: "Alex" },
  { $set: { age: 23 } }
)
```

Supported operators:

* `$set`
* `$unset`
* `$inc`

---

## Encryption

Encryption is **transparent and automatic**.

```ts
const manager = new LioranManager({
  encryptionKey: process.env.DB_KEY
})
```

* Data is encrypted before writing to disk
* Decrypted automatically on read
* Wrong key = unreadable data

> Encryption is global per manager instance.

---

## File Structure on Disk

```
rootPath/
└─ app/
   ├─ users/
   ├─ posts/
   └─ comments/
```

* Human-readable folders
* Binary LevelDB data inside

---

## Type Safety

LioranDB is **TypeScript-native**.

```ts
const users = db.collection<{ name: string; age: number }>("users")

users.insertOne({ name: "Sam" })      // ❌ age missing
users.insertOne({ name: "Sam", age: 20 }) // ✅
```

No `any`. No runtime guessing.

---

## Closing Databases

```ts
await manager.closeDatabase("app")
```

* Closes all collections
* Flushes LevelDB handles

---

## Design Philosophy

* **Simple > clever**
* **Local-first**
* **No magic network calls**
* **Readable source > black box**

LioranDB is intentionally small and hackable.

---

## Roadmap

* 🔁 P2P sync layer
* 🧠 Indexing
* 🧾 Schema validation
* ⚡ WAL (write-ahead log)
* 🌐 Browser storage adapter

---

## License

LDEP

---

## Author

Built by **Swaraj Puppalwar** 🚀

> If you are building local-first or offline-first systems — this DB is for you.
