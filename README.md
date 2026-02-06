# @liorandb/driver

Official **MongoDB-styled TypeScript / JavaScript SDK** for interacting with **LioranDB Host API**.

Designed for **simplicity, speed, and developer experience**, this driver gives you a fully MongoDB-like API over a lightweight REST backend.

---

## ✨ Features

* MongoDB-style API
* Promise-based async operations
* Full TypeScript support
* Zero config
* Clean class architecture
* High performance

---

## 📦 Installation

```bash
npm install @liorandb/driver
```

or

```bash
yarn add @liorandb/driver
```

---

## 🚀 Quick Start

```ts
import { LioranClient } from "@liorandb/driver";

const client = new LioranClient("lioran://admin:password@localhost:4000");

await client.connect();

const db = client.db("mydb");
const users = db.collection("users");

await users.insertOne({ name: "Swaraj", age: 17 });

const results = await users.find({ age: { $gt: 16 } });
console.log(results);
```

---

## 🔐 Connection URI Format

```
lioran://<username>:<password>@<host>:<port>
```

Example:

```
lioran://admin:123456@localhost:4000
```

---

## 🧱 API Reference

---

## Client

```ts
const client = new LioranClient(uri);
```

### connect()

```ts
await client.connect();
```

Authenticate and establish connection.

---

### db(name)

```ts
const db = client.db("mydb");
```

Returns a DB instance.

---

### listDatabases()

```ts
await client.listDatabases();
```

---

### createDatabase(name)

```ts
await client.createDatabase("mydb");
```

---

### dropDatabase(name)

```ts
await client.dropDatabase("mydb");
```

---

### renameDatabase(old, new)

```ts
await client.renameDatabase("mydb", "newdb");
```

---

## DB

```ts
const db = client.db("mydb");
```

---

### collection(name)

```ts
const users = db.collection("users");
```

---

### listCollections()

```ts
await db.listCollections();
```

---

### createCollection(name)

```ts
await db.createCollection("users");
```

---

### dropCollection(name)

```ts
await db.dropCollection("users");
```

---

### renameCollection(old, new)

```ts
await db.renameCollection("users", "customers");
```

---

## Collection

```ts
const users = db.collection("users");
```

---

### insertOne(doc)

```ts
await users.insertOne({ name: "John", age: 20 });
```

---

### insertMany(docs)

```ts
await users.insertMany([
  { name: "A" },
  { name: "B" }
]);
```

---

### find(filter)

```ts
await users.find({ age: { $gt: 18 } });
```

---

### findOne(filter)

```ts
await users.findOne({ name: "John" });
```

---

### updateMany(filter, update)

```ts
await users.updateMany(
  { age: { $lt: 18 } },
  { $set: { minor: true } }
);
```

---

### deleteMany(filter)

```ts
await users.deleteMany({ inactive: true });
```

---

### count(filter)

```ts
await users.count({ active: true });
```

---

### stats()

```ts
await users.stats();
```

---

## 🧠 MongoDB Compatibility

| MongoDB        | Lioran Driver |
| -------------- | ------------- |
| insertOne      | insertOne     |
| insertMany     | insertMany    |
| find           | find          |
| findOne        | findOne       |
| updateMany     | updateMany    |
| deleteMany     | deleteMany    |
| countDocuments | count         |

---

## ⚙ TypeScript Support

The driver is fully typed and provides:

* Typed filters
* Typed update operators
* Autocomplete support

---

## 🛡 Error Handling

All functions throw descriptive errors when:

* Authentication fails
* Invalid query
* Network errors

Always wrap in try/catch for production.

---

## 🧪 Example Project Structure

```bash
src/
 ├── db.ts
 ├── index.ts
```

---

## 📄 License

MIT

---

## 🧠 Maintained By

**LioranDB Team** — Building next-gen developer tools 🚀

---

## ⭐ Star Us

If you like LioranDB, please star the repository and help us grow 🙌
