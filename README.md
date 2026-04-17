# LioranDB

![LioranDB Social Card](./static/img/liorandb-social-card.jpg)

**LioranDB** is a high-performance, developer-friendly database designed for speed, scalability, and simplicity. It is built for modern applications that need reliable data storage with minimal overhead.

---

## 📚 Table of Contents

* [Overview](#overview)
* [Getting Started](#getting-started)
* [Core Concepts](#core-concepts)
* [Examples](#examples)
* [Branches](#branches)
* [Documentation](#documentation)
* [Community](#community)
* [License](#license)

---

## 🚀 Overview

LioranDB is designed to be:

* ⚡ **Fast** — Optimized for performance
* 🧩 **Modular** — Core, drivers, and studio separated by design
* 🛠️ **Developer-first** — Simple APIs and predictable behavior
* 📦 **Lightweight** — Minimal dependencies

It can be used for:

* Web applications
* APIs and microservices
* Local-first apps
* Edge and server environments

---

## ⚡ Getting Started

### 1. Install

```bash
npm install @liorandb/core
```

### 2. Create a Database

```ts
import { LioranManager } from "@liorandb/core";

const db = new LioranManager({
  root: "./db"
});

await db.init();
```

### 3. Insert Data

```ts
await db.collection("users").insert({
  id: 1,
  name: "John Doe",
  age: 25
});
```

### 4. Query Data

```ts
const users = await db.collection("users").find({
  age: { $gt: 18 }
});

console.log(users);
```

---

## 🧠 Core Concepts

### Collections

Collections store documents.

### Documents

Documents are JSON-like objects.

### Indexing

Indexes improve query performance.

---

## 💡 Examples

### Create Collection

```ts
await db.createCollection("products");
```

### Update Document

```ts
await db.collection("users").update(
  { id: 1 },
  { $set: { age: 26 } }
);
```

### Delete Document

```ts
await db.collection("users").delete({ id: 1 });
```

---

## 🌿 Branches

Quick navigation to different parts of the ecosystem:

* **Core**
  [https://github.com/LioranGroupOfficial/Liorandb/tree/core](https://github.com/LioranGroupOfficial/Liorandb/tree/core)

* **Driver**
  [https://github.com/LioranGroupOfficial/Liorandb/tree/driver](https://github.com/LioranGroupOfficial/Liorandb/tree/driver)

* **Studio**
  [https://github.com/LioranGroupOfficial/Liorandb/tree/studio](https://github.com/LioranGroupOfficial/Liorandb/tree/studio)

---

## 📖 Documentation

Full documentation will include:

* Architecture
* API reference
* Performance benchmarks
* Deployment guides

---

## 🤝 Community

Contributions are welcome.

You can help by:

* Reporting bugs
* Suggesting features
* Submitting pull requests

---

## 📄 License

MIT License
