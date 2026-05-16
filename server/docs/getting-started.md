# Getting Started (Server)

This folder documents the **HTTP host** under `server/` (not the embedded core API).

## 1) Start the server

```bash
cd server
npm run dev
```

Default base URL: `http://localhost:4000`

## 2) Get the server secret (`secret.key`)

On startup the server reads or generates the repo-root `secret.key`.

That secret is used for:

- `POST /auth/super-admin/login` (super-admin JWT)
- secret-based maintenance endpoints like `POST /maintenance/stop`

## 3) Login

- Super-admin: `POST /auth/super-admin/login`
- Managed user: `POST /auth/login`

## 4) Create a database (managed)

`POST /databases` creates a managed database record and a DB folder on disk.

## 5) Configure per-database credentials (optional)

`PUT /databases/:db/credentials` sets a single username/password for that DB and enables connection-string access.

## 6) Use collections and documents

Collections:

- `GET /db/:db/collections`
- `POST /db/:db/collections`

Documents (examples):

- `POST /db/:db/collections/:col/find`
- `PATCH /db/:db/collections/:col/updateOne`

## Next

- See `server/API.md` for the full route reference.
- See `api-reference.md` for a grouped overview.
