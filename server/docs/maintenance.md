# Maintenance

Maintenance is split into:

1) **Secret-based** endpoints (no JWT required), and
2) **Admin JWT** endpoints.

## Secret-based (no JWT)

These require the raw `secret.key` value (same secret used by super-admin login).

- `POST /maintenance/stop`
- `POST /maintenance/pause`
- `POST /maintenance/resume`
- `POST /maintenance/restore`

`restore` may exit/restart the process depending on core behavior.

## Admin JWT

- `GET /maintenance/status` — snapshot config + running state
- `GET /maintenance/snapshots` — list snapshot files
- `POST /maintenance/snapshots` — trigger snapshot now
- `POST /maintenance/compact/all` — compact all DBs on disk

