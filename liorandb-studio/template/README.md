# LioranDB Studio (Template)

Next.js (App Router) template for the LioranDB Studio UI. Uses `@liorandb/driver` for all database + admin operations (CRUD, aggregates, indexes, maintenance, docs, users).

## Dev

```bash
npm run dev
```

Open `http://localhost:3000`.

## Login modes

- Credentials: `http(s)://host:port` + username/password
- URI: `lioran://user:pass@host:port` or `liorandb://dbUser:dbPass@host:port/database`
- Token: `http(s)://host:port` + JWT token

## Query editor

- **Find** expects a JSON object filter (example: `{"status":"active"}`)
- **Aggregate** expects a JSON array pipeline (example: `[{ "$match": {} }, { "$limit": 100 }]`)
