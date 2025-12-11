# @liorandb/driver

A fully MongoDB-style, TypeScript-first Node.js driver for **LioranDB Server**.

This driver mimics the official **MongoDB Node.js Driver** patterns:

* `client.connect()` → connects & authenticates
* `client.db(name)` → select database
* `db.collection(name)` → select a collection
* Collection helpers that look like MongoDB: `insertOne`, `find`, `findOne`, `updateOne`, `deleteOne`

---

# 🚀 Features

* 100% **MongoDB-like driver API**
* URI authentication (`lioran://user:pass@host:port`)
* `client.db().collection()` pattern
* Auto JWT login & token injection
* Full TypeScript support
* Zero dependencies except Axios

---

# 📦 Installation

```
npm install @liorandb/driver
```

Dev tools (if contributing):

```
npm install -D typescript ts-node-dev @types/node
```

---

# 🔌 Connection String Format

```
lioran://username:password@host:port
```

Example:

```
lioran://admin:secret@localhost:8080
```

---

# 🧩 Quick Start (MongoDB Style)

```ts
import { LioranDBClient } from "@liorandb/driver";

const client = new LioranDBClient("lioran://admin:admin@localhost:8080");

await client.connect();

const db = client.db("testDB");
const users = db.collection("users");

await users.insertOne({ name: "Swaraj", age: 17 });

const res = await users.find({ age: 17 });
console.log(res);
```

---

# 📚 Full API Reference

## 🌐 `client.connect()`

Authenticates using URI credentials and stores JWT internally.

---

# 🗄️ Databases

### `client.db(name)`

Selects a database.

---

# 📁 Collections

### `db.collection(name)`

Selects a collection from the database.

---

# 📄 Document Methods (MongoDB Style)

### `insertOne(document)`

Inserts a single document.

```ts
await users.insertOne({ username: "dev" });
```

### `find(query)`

Returns an array of matching documents.

```ts
await users.find({ active: true });
```

### `findOne(query)`

Returns the first matching document.

```ts
await users.findOne({ id: "abc" });
```

### `updateOne(filter, update)`

Updates fields of a single document.

```ts
await users.updateOne({ id: "abc" }, { age: 18 });
```

### `deleteOne(filter)`

Deletes one document.

```ts
await users.deleteOne({ id: "abc" });
```

---

# 🏗 Project Structure

```
src/
  client.ts          // LioranDBClient
  db.ts              // DB wrapper
  collection.ts      // Collection wrapper
  index.ts
  types.ts
  utils/
    parseUri.ts
```

---

# 📤 Publishing

```
npm login
npm publish
```

---

# 🤝 Contributing

Follow MongoDB-style API structure. PRs welcome.

---

# 📄 License

MIT License
