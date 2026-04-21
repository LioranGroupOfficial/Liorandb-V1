# LioranDB Server

LioranDB Server is the HTTP host for managing LioranDB databases, collections, documents, users, and database-scoped credentials.

## What Changed

The server now supports:

- Persistent repo-root `secret.key` bootstrap for JWT signing
- `super_admin`, `admin`, and `user` roles
- Managed users tied to an internal `userId` or an external auth id such as Clerk or Mongo auth
- Per-user database ownership
- User databases named as `${userId}-${databaseName}`
- Per-database username/password credentials
- Database connection strings for direct DB access
- Access control on database, collection, and document routes

## Secret Key

On startup the server checks for [../secret.key](/d:/pro_projects/Liorandb/secret.key).

- If the file exists and contains a valid secret, that secret is reused
- If it is missing or invalid, a new random secret is generated once and written there
- All JWT tokens are signed and verified with this secret

This means token validity is stable across restarts until `secret.key` changes.

## Roles

- `super_admin`: authenticated with the repo `secret.key`; can manage all users and all databases
- `admin`: local managed account with full database access and permission to create normal users
- `user`: scoped to their own databases only

The server also creates a default `admin/admin` account on first startup if no `admin` user exists yet.

## Authentication Modes

### 1. JWT authentication

Send:

```http
Authorization: Bearer <token>
```

JWTs are used for:

- super-admin actions
- admin actions
- user actions

### 2. Database connection-string authentication

Send:

```http
x-liorandb-connection-string: liorandb://<dbUsername>:<dbPassword>@<host>/<databaseName>
```

This grants access only to the specific database embedded in that connection string.

## Quick Start

### Install

```bash
cd server
npm install
```

### Run in development

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Start production build

```bash
npm start
```

Server default URL:

```text
http://localhost:4000
```

## Dashboard

Built-in admin UI (served by the same server):

```text
http://localhost:4000/dashboard/
```

Features:

- Login / logout
- List databases + collections
- Run `find`, `aggregate`, `insert`, `updateMany`, `deleteMany`, `count`, `explain`
- Browse markdown docs (`/docs/*`)
- Trigger and list snapshots (admin-only)

## Production Hardening

The server ships with:

- JSON body size limits (`LIORANDB_BODY_LIMIT`, default `1mb`)
- Security headers (CSP for `/dashboard/`, HSTS only when request is HTTPS)
- Concurrency limiting (`LIORANDB_MAX_INFLIGHT_GLOBAL`, `LIORANDB_MAX_INFLIGHT_PER_IP`)
- IP rate limiting (`LIORANDB_RATE_LIMIT_*`) and stricter auth rate limiting (`LIORANDB_AUTH_RATE_LIMIT_*`)
- Per-user allowed browser origins (`PUT /auth/me/cors`)

If you run behind a reverse proxy/load balancer, set:

```text
LIORANDB_TRUST_PROXY=1
```

## Snapshots (Backups)

Hourly snapshots are enabled by default.

Environment variables:

```text
LIORANDB_SNAPSHOT_ENABLED=1
LIORANDB_SNAPSHOT_INTERVAL_MS=3600000
LIORANDB_SNAPSHOT_DIR=./snapshots
LIORANDB_SNAPSHOT_RETENTION_HOURS=48
```

Admin API:

- `GET /maintenance/snapshots`
- `POST /maintenance/snapshots`

## Main API Flow

### 1. Super-admin login with `secret.key`

```bash
curl -X POST http://localhost:4000/auth/super-admin/login \
  -H "Content-Type: application/json" \
  -d "{\"secret\":\"<contents-of-../secret.key>\"}"
```

### 2. Create an app user

```bash
curl -X POST http://localhost:4000/auth/register \
  -H "Authorization: Bearer <super-admin-or-admin-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_123",
    "username": "user_123",
    "password": "strongpass123",
    "role": "user",
    "externalUserId": "clerk_user_123"
  }'
```

### 3. Login as that user

```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "user_123",
    "password": "strongpass123"
  }'
```

### 4. Create a user-owned database

```bash
curl -X POST http://localhost:4000/databases \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"analytics"}'
```

Stored database name:

```text
user_123-analytics
```

### 5. Set database credentials

```bash
curl -X PUT http://localhost:4000/databases/user_123-analytics/credentials \
  -H "Authorization: Bearer <user-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "analytics_user",
    "password": "analytics_pass_123"
  }'
```

### 6. Use the database connection string

```bash
curl -X GET http://localhost:4000/databases/user_123-analytics/connection-string \
  -H "Authorization: Bearer <user-token>"
```

Then use that connection string on collection/document endpoints with:

```http
x-liorandb-connection-string: liorandb://analytics_user:analytics_pass_123@localhost:4000/user_123-analytics
```

## Core Endpoints

### Auth

- `POST /auth/super-admin/login`
- `POST /auth/login`
- `GET /auth/me`
- `GET /auth/users`
- `POST /auth/register`
- `POST /auth/users/:userId/token`

### Databases

- `GET /databases`
- `GET /databases/count`
- `GET /databases/user/:userId`
- `POST /databases`
- `DELETE /databases/:db`
- `GET /databases/:db/stats`
- `GET /databases/:db/credentials`
- `PUT /databases/:db/credentials`
- `GET /databases/:db/connection-string`

### Collections

- `GET /db/:db/collections`
- `POST /db/:db/collections`
- `DELETE /db/:db/collections/:col`
- `PATCH /db/:db/collections/:col/rename`
- `GET /db/:db/collections/:col/stats`

### Documents

- `POST /db/:db/collections/:col`
- `POST /db/:db/collections/:col/bulk`
- `POST /db/:db/collections/:col/find`
- `PATCH /db/:db/collections/:col/updateMany`
- `POST /db/:db/collections/:col/deleteMany`
- `POST /db/:db/collections/:col/count`

## Database Ownership Rules

- `user` can create and manage only their own databases
- `user` databases are stored as `${userId}-${databaseName}`
- `admin` can access all databases and create normal users
- `super_admin` can access all databases and create admins or users
- Each managed database has one username and one password at a time

## Project Structure

```text
src/
  app.ts
  server.ts
  cli/
  config/
  controllers/
  middleware/
  routes/
  types/
  utils/
```

Important files:

- [src/utils/secret.ts](/d:/pro_projects/Liorandb/server/src/utils/secret.ts)
- [src/utils/token.ts](/d:/pro_projects/Liorandb/server/src/utils/token.ts)
- [src/utils/auth.ts](/d:/pro_projects/Liorandb/server/src/utils/auth.ts)
- [src/utils/databaseAccess.ts](/d:/pro_projects/Liorandb/server/src/utils/databaseAccess.ts)
- [src/controllers/auth.controller.ts](/d:/pro_projects/Liorandb/server/src/controllers/auth.controller.ts)
- [src/controllers/database.controller.ts](/d:/pro_projects/Liorandb/server/src/controllers/database.controller.ts)

## Docs

- [docs/auth-and-access.md](./docs/auth-and-access.md)
- [docs/managed-databases.md](./docs/managed-databases.md)
- [docs/getting-started.md](./docs/getting-started.md)
- [docs/security-and-reliability.md](./docs/security-and-reliability.md)
- [API.md](./API.md)

## Notes

- `externalUserId` is stored for integration with systems like Clerk, but Clerk JWT verification is not implemented yet
- Existing unmanaged on-disk databases are still visible to admins
- Database rename is intentionally disabled for managed databases
