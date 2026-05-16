# Migrations (HTTP)

The server exposes a **declarative** migration API over HTTP.

This is not a “run arbitrary JavaScript on the server” API. Instead, you send a list of supported actions and the server translates them into core migration steps.

## DB schemaVersion

- `GET /databases/:db/schemaVersion`
- `PUT /databases/:db/schemaVersion`

## Apply migrations

`POST /databases/:db/migrations/apply`

Body shape:

```json
{
  "targetVersion": "v2",
  "migrations": [
    {
      "from": "v1",
      "to": "v2",
      "actions": [
        { "type": "createIndex", "collection": "users", "field": "email", "options": { "unique": true } }
      ]
    }
  ]
}
```

Supported actions:

- `createIndex`
- `createTextIndex`
- `compactCollection`
- `compactAll`
- `renameCollection`

## Collection document migrations (on read)

These are **HTTP-layer** doc migrations that run when the host returns results from:

- `POST /db/:db/collections/:col/find`
- `POST /db/:db/collections/:col/findOne`

Endpoints:

- `GET /db/:db/collections/:col/migrations`
- `PUT /db/:db/collections/:col/migrations`
- `POST /db/:db/collections/:col/migrations/test`

Notes:

- Config is stored in DB meta under `collectionDocMigrations`.
- If `writeBackOnRead: true`, the host tries a best-effort `updateOne` after migrating a returned document (failures are ignored).

