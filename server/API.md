# LioranDB Host API Documentation

Base URL: `http://<host>:4000`

All endpoints (except health and auth) require **JWT authentication** using:

```
Authorization: Bearer <token>
```

---

## Health & Root

### GET /health

Check server health.

**Response**

```json
{
  "ok": true,
  "time": "2026-02-07T10:20:30.000Z"
}
```

### GET /

Host info.

**Response**

```json
{
  "name": "LioranDB",
  "role": "Database Host",
  "status": "online"
}
```

---

## Authentication

### POST /auth/register

Create a new user.

**Body**

```json
{
  "username": "admin",
  "password": "password123"
}
```

**Response**

```json
{
  "user": {
    "id": "<user_id>",
    "username": "admin"
  },
  "token": "<jwt_token>"
}
```

---

### POST /auth/login

Login existing user.

**Body**

```json
{
  "username": "admin",
  "password": "password123"
}
```

**Response**

```json
{
  "user": {
    "id": "<user_id>",
    "username": "admin"
  },
  "token": "<jwt_token>"
}
```

---

## Databases

All database routes require authentication.

### GET /databases

List all databases.

**Response**

```json
{
  "databases": ["db1", "db2"]
}
```

---

### POST /databases

Create a database.

**Body**

```json
{
  "name": "mydb"
}
```

**Response**

```json
{ "ok": true, "db": "mydb" }
```

---

### DELETE /databases/:db

Delete database.

**Response**

```json
{ "ok": true }
```

---

### PATCH /databases/:db/rename

Rename database.

**Body**

```json
{
  "newName": "newdb"
}
```

**Response**

```json
{ "ok": true, "old": "mydb", "new": "newdb" }
```

---

### GET /databases/:db/stats

Get database statistics.

**Response**

```json
{
  "name": "mydb",
  "collections": 3,
  "documents": 154
}
```

---

## Collections

Base Path:

```
/db/:db/collections
```

### GET /

List collections.

**Response**

```json
{ "collections": ["users", "posts"] }
```

---

### POST /

Create collection.

**Body**

```json
{ "name": "users" }
```

**Response**

```json
{ "ok": true }
```

---

### DELETE /:col

Delete collection.

**Response**

```json
{ "ok": true }
```

---

### PATCH /:col/rename

Rename collection.

**Body**

```json
{ "newName": "customers" }
```

**Response**

```json
{ "ok": true, "old": "users", "new": "customers" }
```

---

### GET /:col/stats

Collection statistics.

**Response**

```json
{
  "name": "users",
  "documents": 42
}
```

---

## Documents

Base Path:

```
/db/:db/collections/:col
```

---

### POST /

Insert single document.

**Body**

```json
{
  "name": "John",
  "age": 20
}
```

**Response**

```json
{ "ok": true, "doc": { ... } }
```

---

### POST /bulk

Insert multiple documents.

**Body**

```json
{
  "docs": [
    { "name": "A" },
    { "name": "B" }
  ]
}
```

**Response**

```json
{ "ok": true, "docs": [ ... ] }
```

---

### POST /find

Find documents.

**Body**

```json
{ "query": { "age": { "$gt": 18 } } }
```

**Response**

```json
{ "results": [ ... ] }
```

---

### PATCH /updateMany

Update documents.

**Body**

```json
{
  "filter": { "age": { "$lt": 18 } },
  "update": { "$set": { "minor": true } }
}
```

**Response**

```json
{ "updated": 3 }
```

---

### POST /deleteMany

Delete documents.

**Body**

```json
{ "filter": { "inactive": true } }
```

**Response**

```json
{ "deleted": 5 }
```

---

### POST /count

Count documents.

**Body**

```json
{ "filter": { "active": true } }
```

**Response**

```json
{ "count": 100 }
```

---

## Authentication Flow

1. Register or login to obtain JWT token
2. Send token in headers for all protected routes

```
Authorization: Bearer <token>
```

---

## Status Codes

| Code | Meaning      |
| ---- | ------------ |
| 200  | Success      |
| 400  | Bad request  |
| 401  | Unauthorized |
| 409  | Conflict     |
| 500  | Server error |

---

## Example CURL

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"123456"}'
```

---

**LioranDB Host – Lightweight Database Hosting API**
