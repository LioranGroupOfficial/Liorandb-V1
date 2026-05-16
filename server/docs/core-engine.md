# Core / Engine (Admin)

These endpoints expose **engine internals** for debugging/ops. They require:

- JWT auth, and
- `admin` or `super_admin` role.

## Status

- `GET /core/status` — IPC/cluster summary + paths
- `GET /core/ipc` — current manager IPC booleans
- `GET /core/managers` — per-manager IPC booleans (cluster)

## Engine database visibility

- `GET /core/databases` — list DB folders on disk (engine view)

## Engine DB inspection (advanced)

- `GET /core/databases/:db/status` — includes raw DB `meta`
- `GET /core/databases/:db/schemaVersion`
- `PUT /core/databases/:db/schemaVersion`

These are meant for tooling and diagnostics, not normal application usage.

