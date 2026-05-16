# API Reference (Overview)

This is a grouped overview of **all HTTP routes** exposed by the server.

For full request/response examples, see `server/API.md`.

Base URL: `http://<host>:4000`

## Public

- `GET /` (dashboard SPA)
- `GET /health`
- `GET /api`
- `GET /docs`
- `GET /docs/:id`
- `POST /auth/login`
- `POST /auth/super-admin/login`

## Auth (JWT / Connection-String)

All routes below require auth via:

- `Authorization: Bearer <jwt>` OR
- `x-liorandb-connection-string: liorandb://<dbUsername>:<dbPassword>@<host>/<databaseName>`

### Auth + Users

- `GET /auth/me`
- `PUT /auth/me/cors`
- `GET /auth/users`
- `POST /auth/register`
- `POST /auth/users/:userId/token`
- `PUT /auth/users/:userId/cors`

### Managed Databases

- `GET /databases`
- `GET /databases/count`
- `GET /databases/user/:userId`
- `POST /databases`
- `DELETE /databases/:db`
- `PATCH /databases/:db/rename` (returns `405`)
- `GET /databases/:db/stats`
- `GET /databases/:db/credentials`
- `PUT /databases/:db/credentials`
- `GET /databases/:db/connection-string`
- `POST /databases/:db/compact`
- `POST /databases/:db/explain`
- `POST /databases/:db/transaction`
- `GET /databases/:db/schemaVersion`
- `PUT /databases/:db/schemaVersion`
- `POST /databases/:db/migrations/apply`
- `POST /databases/:db/encryption/rotate`

### Collections

- `GET /db/:db/collections`
- `POST /db/:db/collections`
- `DELETE /db/:db/collections/:col`
- `PATCH /db/:db/collections/:col/rename`
- `GET /db/:db/collections/:col/stats`
- `POST /db/:db/collections/:col/compact`
- `GET /db/:db/collections/:col/options`
- `PATCH /db/:db/collections/:col/options`
- `GET /db/:db/collections/:col/migrations`
- `PUT /db/:db/collections/:col/migrations`
- `POST /db/:db/collections/:col/migrations/test`

### Documents

- `POST /db/:db/collections/:col` (insertOne)
- `POST /db/:db/collections/:col/bulk` (insertMany)
- `POST /db/:db/collections/:col/bulk/stream` (NDJSON streaming insert)
- `POST /db/:db/collections/:col/find`
- `POST /db/:db/collections/:col/findOne`
- `POST /db/:db/collections/:col/aggregate`
- `POST /db/:db/collections/:col/explain`
- `PATCH /db/:db/collections/:col/updateOne`
- `PATCH /db/:db/collections/:col/updateMany`
- `POST /db/:db/collections/:col/deleteOne`
- `POST /db/:db/collections/:col/deleteMany`
- `POST /db/:db/collections/:col/count`

### Indexes

- `GET /db/:db/collections/:col/indexes`
- `POST /db/:db/collections/:col/indexes`
- `POST /db/:db/collections/:col/indexes/text`
- `POST /db/:db/collections/:col/indexes/rebuild`
- `POST /db/:db/collections/:col/indexes/:field/rebuild`
- `POST /db/:db/collections/:col/indexes/text/:field/rebuild`
- `DELETE /db/:db/collections/:col/indexes/:field`
- `DELETE /db/:db/collections/:col/indexes/text/:field`

## Maintenance

### Secret-based (no JWT)

- `POST /maintenance/stop`
- `POST /maintenance/pause`
- `POST /maintenance/resume`
- `POST /maintenance/restore`

### Admin JWT

- `GET /maintenance/status`
- `GET /maintenance/snapshots`
- `POST /maintenance/snapshots`
- `POST /maintenance/compact/all`

## Core / Engine (Admin JWT)

- `GET /core/status`
- `GET /core/ipc`
- `GET /core/managers`
- `GET /core/databases`
- `GET /core/databases/:db/status`
- `GET /core/databases/:db/schemaVersion`
- `PUT /core/databases/:db/schemaVersion`

