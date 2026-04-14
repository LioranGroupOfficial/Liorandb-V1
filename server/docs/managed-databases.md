# Managed Databases

## Overview

Managed databases add ownership, credentials, and connection-string access on top of the normal LioranDB storage engine.

Metadata is stored in the `_auth` database under the `databases` collection.

## Naming Rules

### User-owned databases

For normal users, the physical database name is:

```text
${userId}-${databaseName}
```

Example:

```text
user_123-analytics
```

### Admin-owned databases

Admins and super-admins use the provided database name directly.

## Database Record

Each managed database tracks:

- `ownerUserId`
- `ownerRole`
- `requestedName`
- `databaseName`
- `dbUsername`
- encrypted password payload
- password hash
- timestamps and audit fields

## Core Database Endpoints

### `GET /databases`

Returns databases visible to the current identity.

- `user`: only owned databases
- `admin` and `super_admin`: all managed databases, plus unmanaged on-disk databases for visibility

### `POST /databases`

Creates a database.

User example:

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

### `GET /databases/count`

Counts databases visible to the caller.

Admins can also pass `?userId=user_123`.

### `GET /databases/user/:userId`

Admin-only view of all managed databases for one user.

### `DELETE /databases/:db`

Deletes the database folder and removes its metadata record.

### `GET /databases/:db/stats`

Returns collection count and total document count.

## Per-Database Credentials

Each managed database supports exactly one username and one password at a time.

### `PUT /databases/:db/credentials`

Request:

```json
{
  "username": "analytics_user",
  "password": "analytics_pass_123"
}
```

Behavior:

- stores the password hash for authentication
- stores an encrypted copy of the password so the server can generate connection strings later
- replaces any previous database credentials

### `GET /databases/:db/credentials`

Returns:

- database name
- owner
- configured username
- decrypted password
- generated connection string if credentials exist

### `GET /databases/:db/connection-string`

Returns:

```text
liorandb://<dbUsername>:<dbPassword>@<host>/<databaseName>
```

## Authorization Rules

### Super-admin

- full access to all databases

### Admin

- full access to all databases

### User

- can only access databases where `ownerUserId === user.userId`

### Connection string

- can only access the single database encoded in the connection string

## Route Enforcement

The following route groups now enforce managed database access:

- `/databases/*`
- `/db/:db/collections/*`
- `/db/:db/collections/:col/*`

That means collection creation, reads, updates, and deletes all inherit the same ownership model.
