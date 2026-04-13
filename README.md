# @liorandb/driver

TypeScript and JavaScript driver for the LioranDB Host API.

This package gives you a small MongoDB-style interface on top of the host server running at `http://<host>:4000`.

## Installation

```bash
npm install @liorandb/driver
```

## Before You Connect

The host will not start until at least one admin user exists.

Create the first admin with the CLI:

```bash
ldb-cli 'admin.create("admin","password123")'
```

Then start the host and authenticate through `/auth/login` or `/auth/register`.

## Quick Start

```ts
import { LioranClient } from "@liorandb/driver";

const client = new LioranClient("http://localhost:4000");

await client.login("admin", "password123");

const db = client.db("app");
const users = db.collection<{ name: string; age: number }>("users");

await users.insertOne({ name: "John", age: 20 });

const results = await users.find({ age: { $gt: 18 } });
console.log(results);
```

## Connection Formats

The client accepts either of these formats:

```txt
http://<host>:<port>
https://<host>:<port>
lioran://<username>:<password>@<host>:<port>
```

Examples:

```txt
http://localhost:4000
https://db.example.com:4000
lioran://admin:password123@localhost:4000
```

Use `http(s)://...` when you want to call `login()`, `register()`, or `setToken()` yourself.

Use `lioran://...` when you want `connect()` to log in from the URI credentials.

## Authentication

### Login with username and password

```ts
const client = new LioranClient("http://localhost:4000");
const auth = await client.login("admin", "password123");

console.log(auth.user.username);
console.log(client.getToken());
```

### Register a user

```ts
const client = new LioranClient("http://localhost:4000");
await client.register("editor", "password123");
```

### Connect from a `lioran://` URI

```ts
const client = new LioranClient(
  "lioran://admin:password123@localhost:4000"
);

await client.connect();
```

### Reuse an existing JWT

```ts
const client = new LioranClient("http://localhost:4000");
client.setToken(process.env.LIORAN_TOKEN!);
```

Protected driver methods throw until the client is authenticated.

## Client API

### Constructor

```ts
const client = new LioranClient(uri);
```

### `connect()`

Logs in using credentials from a `lioran://user:pass@host:port` URI.

```ts
await client.connect();
```

### `login(username, password)`

```ts
const auth = await client.login("admin", "password123");
```

Returns:

```ts
{
  user: { id: string, username: string },
  token: string
}
```

### `register(username, password)`

```ts
const auth = await client.register("editor", "password123");
```

Returns the same shape as `login()`.

### `health()`

Calls `GET /health`.

```ts
const health = await client.health();
```

Response:

```ts
{
  ok: true,
  time: "2026-04-13T12:00:00.000Z"
}
```

### `info()`

Calls `GET /`.

```ts
const info = await client.info();
```

Response:

```ts
{
  name: "LioranDB",
  role: "Database Host",
  status: "online"
}
```

### `setToken(token)`

```ts
client.setToken(jwt);
```

### `getToken()`

```ts
const token = client.getToken();
```

### `getUser()`

Returns the last authenticated user from `login()`, `register()`, or `connect()`.

```ts
const user = client.getUser();
```

### `isAuthenticated()`

```ts
if (client.isAuthenticated()) {
  // ...
}
```

### `logout()`

Clears the in-memory token and current user.

```ts
client.logout();
```

### `db(name)`

```ts
const db = client.db("app");
```

### `listDatabases()`

Calls `GET /databases`.

```ts
const databases = await client.listDatabases();
```

### `createDatabase(name)`

Calls `POST /databases`.

```ts
const res = await client.createDatabase("app");
```

Response:

```ts
{ ok: true, db: "app" }
```

### `dropDatabase(name)`

Calls `DELETE /databases/:db`.

```ts
const res = await client.dropDatabase("app");
```

Response:

```ts
{ ok: true }
```

### `renameDatabase(oldName, newName)`

Calls `PATCH /databases/:db/rename`.

```ts
const res = await client.renameDatabase("app", "app_v2");
```

Response:

```ts
{ ok: true, old: "app", new: "app_v2" }
```

### `databaseStats(name)`

Calls `GET /databases/:db/stats`.

```ts
const stats = await client.databaseStats("app");
```

Response:

```ts
{
  name: "app",
  collections: 2,
  documents: 154
}
```

## DB API

```ts
const db = client.db("app");
```

### `collection(name)`

```ts
const users = db.collection("users");
```

You can pass a generic type for better autocomplete:

```ts
type User = {
  name: string;
  age: number;
  active?: boolean;
};

const users = db.collection<User>("users");
```

### `listCollections()`

Calls `GET /db/:db/collections`.

```ts
const collections = await db.listCollections();
```

### `createCollection(name)`

Calls `POST /db/:db/collections`.

```ts
const res = await db.createCollection("users");
```

Response:

```ts
{ ok: true, collection: "users" }
```

### `dropCollection(name)`

Calls `DELETE /db/:db/collections/:col`.

```ts
const res = await db.dropCollection("users");
```

### `renameCollection(oldName, newName)`

Calls `PATCH /db/:db/collections/:col/rename`.

```ts
const res = await db.renameCollection("users", "customers");
```

### `stats()`

Calls `GET /databases/:db/stats`.

```ts
const stats = await db.stats();
```

## Collection API

```ts
const users = db.collection<User>("users");
```

### `insertOne(doc)`

Calls `POST /db/:db/collections/:col`.

```ts
const user = await users.insertOne({ name: "John", age: 20 });
```

### `insertMany(docs)`

Calls `POST /db/:db/collections/:col/bulk`.

```ts
const inserted = await users.insertMany([
  { name: "A", age: 20 },
  { name: "B", age: 21 }
]);
```

### `find(filter)`

Calls `POST /db/:db/collections/:col/find`.

```ts
const adults = await users.find({ age: { $gt: 18 } });
```

### `findOne(filter)`

```ts
const john = await users.findOne({ name: "John" });
```

Returns the first matching document or `null`.

### `updateMany(filter, update)`

Calls `PATCH /db/:db/collections/:col/updateMany`.

```ts
const res = await users.updateMany(
  { age: { $lt: 18 } },
  { $set: { minor: true } }
);
```

Response:

```ts
{ updated: 3 }
```

### `deleteMany(filter)`

Calls `POST /db/:db/collections/:col/deleteMany`.

```ts
const res = await users.deleteMany({ inactive: true });
```

Response:

```ts
{ deleted: 5 }
```

### `count(filter)`

Calls `POST /db/:db/collections/:col/count`.

```ts
const total = await users.count({ active: true });
```

### `stats()`

Calls `GET /db/:db/collections/:col/stats`.

```ts
const stats = await users.stats();
```

Response:

```ts
{
  name: "users",
  documents: 42
}
```

## Error Handling

The driver throws regular `Error` values for client-side validation issues and `HttpError` for failed HTTP requests.

```ts
import { HttpError, LioranClient } from "@liorandb/driver";

try {
  await client.login("admin", "wrong-password");
} catch (error) {
  if (error instanceof HttpError) {
    console.error(error.status);
    console.error(error.data);
  }
}
```

## Exports

```ts
import {
  Collection,
  DB,
  HttpClient,
  HttpError,
  LioranClient
} from "@liorandb/driver";
```

The package also exports the shared TypeScript types from `src/types.ts`.

## License

MIT
