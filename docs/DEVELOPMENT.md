# Development options

## All Docker

```bash
test -f .env || cp .env.example .env

docker compose up --build -d
```

Rebuild any service after changing source:

```bash
docker compose up --build -d web api
```

## Frontend hot reload against Docker API

Run full stack through Compose, then:

```bash
cd frontend
npm install
npm run dev
```

The React dev server at `http://localhost:5173` expects the API at `http://localhost:4000`, so **the Docker API must be accessible on the host** for this mode. Rather than modifying the main compose file, create a local untracked `compose.dev.yaml` with:

```yaml
services:
  api:
    ports:
      - "127.0.0.1:4000:4000"
```

Start with `docker compose -f compose.yaml -f compose.dev.yaml up -d --build`.

## Backend development with SQLite

Run `cd backend && npm install && npm run dev` with Node.js 22.13 or later. By default, the API creates `backend/data/schoolscope.sqlite`; set `SQLITE_PATH` to use another file. The database is seeded on startup.

`npm run dev` and `npm run accounts` read `backend/.env` when it exists (copy `backend/.env.example`). Without `DEMO_ACCOUNTS`, the first start creates the development account `reviewer@schoolscope.test` / `schoolscope-review`. To try Apple Maps locally, set `MAPKIT_TEAM_ID`, `MAPKIT_KEY_ID`, `MAPKIT_PRIVATE_KEY_FILE` and `MAPKIT_ORIGIN=http://localhost:5173` in `backend/.env`. The key must allow that origin, or leave `MAPKIT_ORIGIN` empty while developing.

To refresh the real school locations from NYC Open Data, run `node scripts/fetch-nyc-schools.mjs` from the project root. Add `NODE_USE_ENV_PROXY=1` if your network needs an HTTPS proxy. Commit the regenerated `backend/data/school_locations.json` and `school_districts.geojson`.

## Full system verification

```bash
docker compose ps
SMOKE_EMAIL=reviewer@example.com SMOKE_PASSWORD='…' ./scripts/smoke-test.sh
cd backend && npm test
cd ../frontend && npm test
```

The repo intentionally doesn't commit package-lock files. After running npm install, commit both generated lock files and switch Dockerfiles to `npm ci` to obtain reproducible dependency resolution.
