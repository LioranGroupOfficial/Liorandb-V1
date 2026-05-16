# Streaming inserts (NDJSON)

For large ingests, use:

- `POST /db/:db/collections/:col/bulk/stream`

Request body is **NDJSON** (one JSON document per line):

```text
{"a":1}
{"a":2}
{"a":3}
```

Recommended header:

```http
Content-Type: application/x-ndjson
```

Behavior:

- If core exposes `insertManyStream()`, the server forwards streaming docs to it.
- Otherwise the server buffers docs and falls back to `insertMany()` (bounded by `LIORANDB_STREAM_FALLBACK_MAX_DOCS`).

