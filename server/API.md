# LioranDB Host API

Base URL: `http://<host>:4000`

All endpoints except `/` and `/health` require JSON requests. All routes except `/health`, `/`, and `/auth/*` require a JWT bearer token:

```http
Authorization: Bearer <token>
```

## Startup Requirement

The server will not start until at least one admin user exists in the auth database.

Create the first admin with the CLI before starting the host:

```bash
ldb-cli 'admin.create("admin","password123")'
```

After that, start the server and use `/auth/login` to obtain a token. `POST /auth/register` is still available, but it cannot be used to create the very first user because the host refuses to boot without one.

## Health

### `GET /health`

Response:

```json
{
  "ok": true,
  "time": "2026-04-13T12:00:00.000Z"
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

## Authentication

### `POST /auth/register`

Create another user account.

Body:

```json
{
  "username": "editor",
  "password": "password123"
}
```

Success response:

```json
{
  "user": {
    "id": "<user_id>",
    "username": "editor"
  },
  "token": "<jwt_token>"
}
```

Possible errors:

```json
{ "error": "username and password required" }
{ "error": "invalid types" }
{ "error": "password must be at least 6 characters" }
{ "error": "username already exists" }
```

### `POST /auth/login`

Body:

```json
{
  "username": "admin",
  "password": "password123"
}
```

Success response:

```json
{
  "user": {
    "id": "<user_id>",
    "username": "admin"
  },
  "token": "<jwt_token>"
}
```

Possible errors:

```json
{ "error": "username and password required" }
{ "error": "invalid credentials" }
```

## Databases

### `GET /databases`

List database directories, excluding the internal auth database.

Response:

```json
{
  "databases": ["app", "analytics"]
}
```

### `POST /databases`

Body:

```json
{
  "name": "app"
}
```

Success response:

```json
{
  "ok": true,
  "db": "app"
}
```

Validation errors return `400`, for example:

```json
{ "error": "database name required" }
{ "error": "invalid database name" }
```

### `DELETE /databases/:db`

Success response:

```json
{
  "ok": true
}
```

If the database does not exist:

```json
{
  "ok": false
}
```

### `PATCH /databases/:db/rename`

Body:

```json
{
  "newName": "app_v2"
}
```

Success response:

```json
{
  "ok": true,
  "old": "app",
  "new": "app_v2"
}
```

Possible `400` errors include:

```json
{ "error": "newName required" }
{ "error": "database not found" }
{ "error": "target database already exists" }
```

### `GET /databases/:db/stats`

Response:

```json
{
  "name": "app",
  "collections": 2,
  "documents": 154
}
```

## Collections

Base path: `/db/:db/collections`

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

## Documents

Base path: `/db/:db/collections/:col`

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
  "query": {
    "age": { "$gt": 18 }
  }
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
  "updated": 3
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

## Auth Flow

1. Create the first admin with `ldb-cli`.
2. Start the server.
3. Call `POST /auth/login`.
4. Send the returned token in the `Authorization` header for protected routes.

## Status Codes

| Code | Meaning |
| --- | --- |
| `200` | Success |
| `400` | Bad request or validation failure |
| `401` | Unauthorized |
| `409` | Conflict |
| `500` | Server error |
