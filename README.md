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

The client accepts these URI formats:

```txt
http://<host>:<port>
https://<host>:<port>
liorandb://<dbUsername>:<dbPassword>@<host>:<port>/<dbName>
lioran://<username>:<password>@<host>:<port>
```

Examples:

```txt
http://localhost:4000
https://db.example.com:4000
liorandb://app_user:app_pass@localhost:4000/app
lioran://admin:password123@localhost:4000 (legacy)
```

Use `http(s)://...` when you want to call `login()`, `superAdminLogin()`, `setToken()`, or `setConnectionString()` yourself.

Use `liorandb://...` when you want `connect()` (or `setConnectionString()`) to authenticate using a database connection string.

Use `lioran://...` when you want `connect()` to log in from URI credentials (legacy format).

## Authentication

### Login with username and password

```ts
const client = new LioranClient("http://localhost:4000");
const auth = await client.login("admin", "password123");

console.log(auth.user.username);
console.log(client.getToken());
```

### Super admin login

```ts
const client = new LioranClient("http://localhost:4000");
await client.superAdminLogin(process.env.LIORAN_SUPER_ADMIN_SECRET!);
```

### Register a user

```ts
const client = new LioranClient("http://localhost:4000");
await client.login("admin", "password123");

await client.register("editor", "password123");
```

### Connect from a `lioran://` URI

```ts
const client = new LioranClient(
  "lioran://admin:password123@localhost:4000"
);

await client.connect();
```

### Connect from a `liorandb://` connection string

```ts
const client = new LioranClient(
  "liorandb://app_user:app_pass@localhost:4000/app"
);

await client.connect();

const db = client.db("app");
```

### Reuse an existing JWT

```ts
const client = new LioranClient("http://localhost:4000");
client.setToken(process.env.LIORAN_TOKEN!);
```

### Use an existing database connection string

```ts
const client = new LioranClient("http://localhost:4000");
client.setConnectionString(process.env.LIORANDB_CONNECTION_STRING!);
```

Protected driver methods throw until the client is authenticated (via `login()`, `superAdminLogin()`, `connect()`, `setToken()`, or `setConnectionString()`).

## Client API

### Constructor

```ts
const client = new LioranClient(uri);
```

### `connect()`

Supports:

- `liorandb://...`: stores the connection string and authenticates via `x-liorandb-connection-string`
- `lioran://...`: logs in via `/auth/login` (legacy format)
- `http(s)://user:pass@host:port`: logs in via `/auth/login`

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
  user: { userId: string, username: string, role: "super_admin" | "admin" | "user" },
  token: string
}
```

### `superAdminLogin(secret)`

```ts
const auth = await client.superAdminLogin(process.env.LIORAN_SUPER_ADMIN_SECRET!);
```

Returns the same shape as `login()`.

### `register(username, password)`

```ts
await client.login("admin", "password123");
await client.register("editor", "password123");
```

Requires authentication and returns the same shape as `login()`.

### `register(input)`

Create a user with more control (user id, role, external id).

```ts
await client.login("admin", "password123");
await client.register({
  userId: "editor_1",
  username: "editor",
  password: "password123",
  role: "user",
  externalUserId: "auth0|abc123"
});
```

### `me()`

Calls `GET /auth/me` and updates `client.getUser()`.

```ts
const me = await client.me();
console.log(me.user.role);
```

### `listUsers()`

Calls `GET /auth/users`.

```ts
const users = await client.listUsers();
```

### `issueUserToken(userId)`

Calls `POST /auth/users/:userId/token`.

```ts
const { token } = await client.issueUserToken("editor_1");
```

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

### `setConnectionString(connectionString)`

```ts
client.setConnectionString("liorandb://user:pass@localhost:4000/app");
```

### `getToken()`

```ts
const token = client.getToken();
```

### `getConnectionString()`

```ts
const cs = client.getConnectionString();
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

Clears the in-memory JWT/connection-string auth state and current user.

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

### `countDatabases(userId?)`

Calls `GET /databases/count` (optionally filtered by `userId`).

```ts
const { count } = await client.countDatabases();
```

### `listUserDatabases(userId)`

Calls `GET /databases/user/:userId`.

```ts
const res = await client.listUserDatabases("editor_1");
console.log(res.count, res.databases);
```

### `createDatabase(name)`

Calls `POST /databases`.

```ts
const res = await client.createDatabase("app");
```

Response:

```ts
{ ok: true, database: { databaseName: "app", ... } }
```

### `createDatabase({ name, ownerUserId? })`

```ts
const res = await client.createDatabase({ name: "app", ownerUserId: "editor_1" });
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

### `getCredentials()`

Calls `GET /databases/:db/credentials`.

```ts
const creds = await db.getCredentials();
console.log(creds.username, creds.password);
```

### `setCredentials({ username, password })`

Calls `PUT /databases/:db/credentials`.

```ts
await db.setCredentials({ username: "app_user", password: "app_pass" });
```

### `getConnectionString()`

Calls `GET /databases/:db/connection-string`.

```ts
const { connectionString } = await db.getConnectionString();
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

The package also exports the shared TypeScript types from `src/types.ts` (for example: `Filter`, `UpdateQuery`, and response types).

## License

MIT
