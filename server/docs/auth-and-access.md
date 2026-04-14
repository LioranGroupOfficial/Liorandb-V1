# Auth And Access

## Overview

The server supports two access modes:

- JWT auth for `super_admin`, `admin`, and `user`
- Database connection-string auth for direct access to one managed database

## Secret Key Bootstrap

The server reads the repository root `secret.key` file on startup.

- Valid file present: reuse it
- Missing or invalid file: generate a new random secret and persist it

That secret is the JWT signing key for the whole server.

## Roles

### `super_admin`

- Logs in with `POST /auth/super-admin/login`
- Uses the raw `secret.key` value
- Can create `admin` and `user` accounts
- Can manage all databases

### `admin`

- Local managed user account
- Can create `user` accounts
- Can manage all databases

### `user`

- Local managed user account
- Can manage only their own databases
- Their managed database names are prefixed with their `userId`

## User Model

Managed users store:

- `userId`
- `username`
- `role`
- `externalUserId`
- `passwordHash`
- audit fields such as `createdAt`, `updatedAt`, and `createdBy`

`externalUserId` is meant for mapping to an external auth provider such as Clerk.

## JWT Endpoints

### `POST /auth/super-admin/login`

Request:

```json
{
  "secret": "value-from-secret.key"
}
```

Response:

```json
{
  "user": {
    "authType": "jwt",
    "userId": "super-admin",
    "username": "super-admin",
    "role": "super_admin"
  },
  "token": "<jwt>",
  "secretBacked": true
}
```

### `POST /auth/login`

Request:

```json
{
  "username": "user_123",
  "password": "strongpass123"
}
```

### `POST /auth/register`

Requires admin or super-admin JWT.

Request:

```json
{
  "userId": "user_123",
  "username": "user_123",
  "password": "strongpass123",
  "role": "user",
  "externalUserId": "clerk_user_123"
}
```

Rules:

- `super_admin` can create `admin` or `user`
- `admin` can create only `user`
- password is optional, but without it password login is disabled for that user

### `GET /auth/users`

Lists all managed users for admin and super-admin.

### `POST /auth/users/:userId/token`

Issues a JWT for a managed user.

This is useful when an admin wants to mint a token for an app-owned user record.

### `GET /auth/me`

Returns the current authenticated identity.

## Connection-String Auth

The server accepts:

```http
x-liorandb-connection-string: liorandb://<dbUsername>:<dbPassword>@<host>/<databaseName>
```

Behavior:

- the database name must exist in managed database metadata
- the username must match the database's single assigned username
- the password must match the database's stored password hash
- access is restricted to that one database

This auth mode works on database, collection, and document routes that pass through `authMiddleware`.

## Current Limitation

External auth ids such as Clerk ids are stored, but external JWT/session verification is not yet part of the server. Today, external ids are metadata and ownership identifiers, not direct login credentials.
