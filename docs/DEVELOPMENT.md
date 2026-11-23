# Development options

## All Docker

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD

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

## Backend dev against Docker PostgreSQL

You can similarly expose PostgreSQL **only on loopback** by adding this local `compose.dev.yaml`:

```yaml
services:
  database:
    ports:
      - "127.0.0.1:5432:5432"
```

Then set `DATABASE_URL` with the database name/username/password from `.env`, and run `cd backend && npm run dev`.

## Full system verification

```bash
docker compose ps
./scripts/smoke-test.sh
cd backend && npm test
cd ../frontend && npm test
```

The repo intentionally doesn't commit package-lock files. After running npm install, commit both generated lock files and switch Dockerfiles to `npm ci` to obtain reproducible dependency resolution.
