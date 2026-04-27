# LioranDB Host API

Base URL: `http://<host>:4000`

## Authentication

Public routes:

- `GET /`
- `GET /health`
- `GET /docs`
- `GET /docs/:id`
- `GET /dashboard/`
- `POST /auth/login`
- `POST /auth/super-admin/login`

Protected routes accept either:

```http
Authorization: Bearer <jwt>
```

or:

```http
x-liorandb-connection-string: liorandb://<dbUsername>:<dbPassword>@<host>/<databaseName>
```

Notes:

- JWT auth is used for `super_admin`, `admin`, and `user`
- Connection-string auth only grants access to the single database encoded in the connection string
- `POST /auth/register` is protected now; it is no longer a public signup route

## Startup Behavior

On startup the server checks the repository root `secret.key`.

- If `secret.key` exists and is valid, it is reused
- If it is missing or invalid, a new random secret is generated and written once
- All JWT signing and verification uses that file-backed secret

The server also ensures a default local admin account exists:

```text
username: admin
password: admin
role: admin
```

## Health

### `GET /health`

Response:

```json
{
  "ok": true,
  "time": "2026-04-14T12:00:00.000Z"
}
```

### `GET /`

Response:

```json
{
  "name": "LioranDB",
  "role": "Database Host",
  "status": "online"
}
```

## Auth Endpoints

### `POST /auth/super-admin/login`

Authenticate as the JWT super-admin by using the raw value from `secret.key`.

Body:

```json
{
  "secret": "<contents-of-secret.key>"
}
```

Success response:

```json
{
  "user": {
    "authType": "jwt",
    "userId": "super-admin",
    "username": "super-admin",
    "role": "super_admin"
  },
  "token": "<jwt_token>",
  "secretBacked": true
}
```

Possible errors:

```json
{ "error": "secret required" }
{ "error": "invalid super admin secret" }
```

### `POST /auth/login`

Login with a managed local username/password.

Body:

```json
{
  "username": "admin",
  "password": "admin"
}
```

Success response:

```json
{
  "user": {
    "userId": "admin",
    "username": "admin",
    "role": "admin",
    "authType": "jwt"
  },
  "token": "<jwt_token>"
}
```

Possible errors:

```json
{ "error": "username and password required" }
{ "error": "password login is not enabled for this user" }
{ "error": "invalid credentials" }
```

### `GET /auth/me`

Return the currently authenticated identity.

Success response:

```json
{
  "user": {
    "authType": "jwt",
    "userId": "admin",
    "username": "admin",
    "role": "admin"
  }
}
```

### `PUT /auth/me/cors`

Set per-user allowed browser origins for this JWT identity. If set, requests with an `Origin` header that is not in the list are rejected with `403`.

Body:

```json
{ "origins": ["https://app.example.com"] }
```

Notes:

- Send `[]` to clear the restriction.
- Send `["*"]` to allow any origin for this user.

### `PUT /auth/users/:userId/cors`

Admin-only version of the same setting.

### `GET /auth/users`

List all managed users.

Requires: `admin` or `super_admin`

Success response:

```json
{
  "users": [
    {
      "userId": "admin",
      "username": "admin",
      "role": "admin",
      "externalUserId": null,
      "createdAt": "2026-04-14T12:00:00.000Z",
      "updatedAt": "2026-04-14T12:00:00.000Z",
      "createdBy": "system",
      "passwordEnabled": true
    }
  ]
}
```

### `POST /auth/register`

Create a managed user.

Requires:

- `super_admin` to create `admin` or `user`
- `admin` to create `user`

Body:

```json
{
  "userId": "user_123",
  "username": "user_123",
  "password": "strongpass123",
  "role": "user",
  "externalUserId": "clerk_user_123"
}
```

Success response:

```json
{
  "user": {
    "userId": "user_123",
    "username": "user_123",
    "role": "user",
    "externalUserId": "clerk_user_123",
    "authType": "jwt"
  },
  "token": "<jwt_token>",
  "secretBacked": false
}
```

Possible errors:

```json
{ "error": "admin access required" }
{ "error": "cannot create this role" }
{ "error": "userId or username is required" }
{ "error": "password must be at least 6 characters" }
{ "error": "userId already exists" }
{ "error": "username already exists" }
```

### `POST /auth/users/:userId/token`

Issue a JWT for an existing managed user.

Requires: `admin` or `super_admin`

Success response:

```json
{
  "user": {
    "userId": "user_123",
    "username": "user_123",
    "role": "user",
    "externalUserId": "clerk_user_123",
    "authType": "jwt"
  },
  "token": "<jwt_token>"
}
```

## Database Endpoints

Managed databases store metadata in `_auth.databases`.

Ownership rules:

- `user` can only manage databases where `ownerUserId === user.userId`
- `user` databases are physically stored as `${userId}-${databaseName}`
- `admin` and `super_admin` can manage all databases
- each managed database can have exactly one username/password pair at a time

### `GET /databases`

List visible databases for the current identity.

Success response:

```json
{
  "databases": [
    {
      "ownerUserId": "user_123",
      "ownerRole": "user",
      "requestedName": "analytics",
      "databaseName": "user_123-analytics",
      "createdAt": "2026-04-14T12:00:00.000Z",
      "updatedAt": "2026-04-14T12:00:00.000Z",
      "credentialsConfigured": true,
      "dbUsername": "analytics_user",
      "connectionString": "liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics"
    }
  ]
}
```

### `GET /databases/count`

Count databases visible to the current identity.

Admins may pass `?userId=user_123`.

Success response:

```json
{
  "userId": "user_123",
  "count": 1
}
```

### `GET /databases/user/:userId`

List managed databases for one specific user.

Requires: `admin` or `super_admin`

Success response:

```json
{
  "userId": "user_123",
  "count": 1,
  "databases": [
    {
      "ownerUserId": "user_123",
      "ownerRole": "user",
      "requestedName": "analytics",
      "databaseName": "user_123-analytics",
      "createdAt": "2026-04-14T12:00:00.000Z",
      "updatedAt": "2026-04-14T12:00:00.000Z",
      "credentialsConfigured": false,
      "dbUsername": null,
      "connectionString": null
    }
  ]
}
```

### `POST /databases`

Create a managed database.

User-owned example:

```json
{
  "name": "analytics"
}
```

Admin creating for another user:

```json
{
  "name": "analytics",
  "ownerUserId": "user_123"
}
```

Success response:

```json
{
  "ok": true,
  "database": {
    "ownerUserId": "user_123",
    "ownerRole": "user",
    "requestedName": "analytics",
    "databaseName": "user_123-analytics",
    "createdAt": "2026-04-14T12:00:00.000Z",
    "updatedAt": "2026-04-14T12:00:00.000Z",
    "credentialsConfigured": false,
    "dbUsername": null,
    "connectionString": null
  }
}
```

Possible errors:

```json
{ "error": "jwt auth required" }
{ "error": "database name required" }
{ "error": "cannot create database for another user" }
{ "error": "target user not found" }
{ "error": "database already exists" }
{ "error": "invalid database name" }
```

### `DELETE /databases/:db`

Delete a managed database and remove its metadata.

Success response:

```json
{
  "ok": true
}
```

Possible errors:

```json
{ "error": "managed database not found" }
{ "error": "database access denied" }
```

### `PATCH /databases/:db/rename`

Managed database rename is disabled.

Response:

```json
{
  "error": "database rename is not supported for managed databases"
}
```

### `GET /databases/:db/stats`

Success response:

```json
{
  "name": "user_123-analytics",
  "collections": 2,
  "documents": 154
}
```

### `GET /databases/:db/credentials`

Return the current database credentials and connection string.

Success response:

```json
{
  "databaseName": "user_123-analytics",
  "ownerUserId": "user_123",
  "username": "analytics_user",
  "password": "analytics_pass_123",
  "connectionString": "liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics"
}
```

### `PUT /databases/:db/credentials`

Configure or replace the single username/password pair for a managed database.

Body:

```json
{
  "username": "analytics_user",
  "password": "analytics_pass_123"
}
```

Success response:

```json
{
  "ok": true,
  "credentials": {
    "databaseName": "user_123-analytics",
    "username": "analytics_user",
    "password": "analytics_pass_123",
    "connectionString": "liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics"
  }
}
```

Possible errors:

```json
{ "error": "username and password required" }
{ "error": "password must be at least 8 characters" }
{ "error": "invalid username" }
```

### `GET /databases/:db/connection-string`

Generate the current connection string for a managed database.

Success response:

```json
{
  "databaseName": "user_123-analytics",
  "connectionString": "liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics"
}
```

Possible errors:

```json
{ "error": "managed database not found" }
{ "error": "database access denied" }
{ "error": "database credentials are not configured" }
```

## Collection Endpoints

Base path: `/db/:db/collections`

These routes require access to `:db` through either JWT auth or a valid database connection string.

### `GET /db/:db/collections`

Response:

```json
{
  "collections": ["users", "posts"]
}
```

### `POST /db/:db/collections`

Body:

```json
{
  "name": "users"
}
```

Success response:

```json
{
  "ok": true,
  "collection": "users"
}
```

### `DELETE /db/:db/collections/:col`

Success response:

```json
{
  "ok": true
}
```

If the collection does not exist:

```json
{
  "ok": false
}
```

### `PATCH /db/:db/collections/:col/rename`

Body:

```json
{
  "newName": "customers"
}
```

Success response:

```json
{
  "ok": true,
  "old": "users",
  "new": "customers"
}
```

### `GET /db/:db/collections/:col/stats`

Response:

```json
{
  "name": "users",
  "documents": 42
}
```

## Document Endpoints

Base path: `/db/:db/collections/:col`

These routes require access to `:db` through either JWT auth or a valid database connection string.

### `POST /db/:db/collections/:col`

Insert one document.

Body:

```json
{
  "name": "John",
  "age": 20
}
```

Response:

```json
{
  "ok": true,
  "doc": {
    "_id": "<generated_id>",
    "name": "John",
    "age": 20
  }
}
```

### `POST /db/:db/collections/:col/bulk`

Insert multiple documents.

Body:

```json
{
  "docs": [
    { "name": "A" },
    { "name": "B" }
  ]
}
```

Response:

```json
{
  "ok": true,
  "docs": [
    { "_id": "<id1>", "name": "A" },
    { "_id": "<id2>", "name": "B" }
  ]
}
```

### `POST /db/:db/collections/:col/find`

Body:

```json
{
  "query": { "age": { "$gt": 18 } },
  "options": { "limit": 50, "offset": 0, "projection": ["name", "age"] }
}
```

Response:

```json
{
  "results": [
    { "_id": "<id>", "name": "John", "age": 20 }
  ]
}
```

### `POST /db/:db/collections/:col/aggregate`

Body:

```json
{
  "pipeline": [
    { "$match": { "age": { "$gte": 18 } } },
    { "$limit": 10 }
  ]
}
```

Response:

```json
{ "results": [] }
```

### `PATCH /db/:db/collections/:col/updateMany`

Body:

```json
{
  "filter": { "age": { "$lt": 18 } },
  "update": { "$set": { "minor": true } }
}
```

Response:

```json
{
  "updated": 3,
  "docs": []
}
```

### `POST /db/:db/collections/:col/deleteMany`

Body:

```json
{
  "filter": { "inactive": true }
}
```

Response:

```json
{
  "deleted": 5
}
```

### `POST /db/:db/collections/:col/count`

Body:

```json
{
  "filter": { "active": true }
}
```

Response:

```json
{
  "count": 100
}
```

### `POST /db/:db/collections/:col/explain`

Return an execution plan for a query (index used vs full scan).

Body:

```json
{
  "query": { "age": { "$gte": 18 } },
  "options": { "limit": 50, "offset": 0 }
}
```

Response:

```json
{ "explain": { "indexUsed": null } }
```


## Advanced Core Features

### `POST /db/:db/collections/:col/findOne`

Body:

```json
{
  "query": { "_id": "<id>" },
  "options": { "projection": ["name"] }
}
```

Response:

```json
{ "doc": { "_id": "<id>", "name": "John" } }
```

### `PATCH /db/:db/collections/:col/updateOne`

Body:

```json
{
  "filter": { "_id": "<id>" },
  "update": { "$set": { "name": "Jane" } },
  "options": { "upsert": false }
}
```

Response:

```json
{ "ok": true, "doc": null }
```

### `POST /db/:db/collections/:col/deleteOne`

Body:

```json
{ "filter": { "_id": "<id>" } }
```

Response:

```json
{ "ok": true, "doc": null }
```

### `GET /db/:db/collections/:col/indexes`

List indexes for a collection.

### `POST /db/:db/collections/:col/indexes`

Create an index.

Body:

```json
{ "field": "email", "unique": true }
```

### `DELETE /db/:db/collections/:col/indexes/:field`

Drop an index by field name.

### `POST /db/:db/collections/:col/indexes/:field/rebuild`

Rebuild a single index.

### `POST /db/:db/collections/:col/indexes/rebuild`

Rebuild all indexes registered in DB metadata for this collection.

### `POST /db/:db/collections/:col/compact`

Compact a collection (rewrites storage and rebuilds indexes).

### `POST /databases/:db/compact`

Compact all collections in a database.

### `POST /databases/:db/explain`

Explain a query at the database level.

Body:

```json
{ "collection": "users", "query": { "age": { "$gte": 18 } } }
```

### `POST /databases/:db/transaction`

Apply multiple operations as a single transaction.

Body:

```json
{
  "ops": [
    { "col": "users", "op": "insertOne", "args": [ { "name": "A" } ] },
    { "col": "users", "op": "updateMany", "args": [ { "active": true }, { "$set": { "seen": true } } ] }
  ]
}
```

### `POST /maintenance/compact/all`

Admin-only: compact all databases on disk.\n## Docs

### `GET /docs`

List built-in markdown docs (used by `/dashboard/`).

### `GET /docs/:id`

Fetch a single doc by id (returns JSON with `content`).

## Maintenance (Admin)

### `GET /maintenance/status`

Return snapshot configuration and current running state.

### `GET /maintenance/snapshots`

List snapshot files.

### `POST /maintenance/snapshots`

Trigger a snapshot immediately.

## Example Flow

1. Read or generate the repo-root `secret.key`
2. Call `POST /auth/super-admin/login` or `POST /auth/login`
3. If needed, create app users with `POST /auth/register`
4. Create a database with `POST /databases`
5. Set database credentials with `PUT /databases/:db/credentials`
6. Access collections and documents with JWT auth or `x-liorandb-connection-string`

## Status Codes

| Code | Meaning |
| --- | --- |
| `200` | Success |
| `400` | Bad request or validation failure |
| `401` | Unauthorized |
| `403` | Forbidden |
| `404` | Not found |
| `409` | Conflict |
| `500` | Server error |
