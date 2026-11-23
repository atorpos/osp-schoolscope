# SchoolScope — School Performance Explorer

A **full-stack, presentation-ready portfolio project** inspired by the requirements of a *hypothetical* New York City Public Schools Office of School Performance Web Developer assessment.

> **Independent demo, not an official NYCPS assessment or application.** All 30 performance rows, school names, school codes, and scores are fictional. This project is for demonstration and learning, not for handling real pupil data.

## Tech stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | Responsive dashboard, accessible filters, charts, CSV export |
| Backend | Node.js 22, Express, TypeScript | REST API, validation, parameterized PostgreSQL queries |
| Database | PostgreSQL 16 | School metadata and yearly reporting records |
| Deployment | Docker Compose, multi-stage Dockerfiles, Nginx | One-command launch, internal API/database network |
| Testing | Node.js test runner, Vitest, curl | Filter unit tests, UI utility unit tests, smoke checks |

## Quick start: Docker (recommended)

Install **Docker Engine + Docker Compose V2** or Docker Desktop. In the project root:

```bash
cp .env.example .env
# Edit .env and choose a strong POSTGRES_PASSWORD.
docker compose up --build -d
```

Open **http://localhost:3008**. For a different host port, change `APP_PORT` in `.env`. If you already have a `.env` file, update its existing `APP_PORT` value to `3008` before restarting Compose.

```bash
docker compose ps                       # Health and container status
docker compose logs -f api              # Backend/migration logs
./scripts/smoke-test.sh                 # Test health, summary, filtering
docker compose down                     # Stop containers without deleting data
```

**Important:** `docker compose down -v` removes the PostgreSQL data volume. Do that only when you intend to reset the demo data.

### What happens on startup?

1. PostgreSQL initializes with a persistent Docker volume and a readiness health check.
2. The Node API waits until PostgreSQL is healthy, then creates two tables and indices if needed.
3. The API seeds the **same 30 fictional school-year records** used in the earlier two-hour mock exercise. Seed inserts are idempotent; restarting does not duplicate or overwrite existing records.
4. The React frontend is compiled and served by Nginx. Requests beginning with `/api/` are proxied internally to the Node API.
5. Only Nginx port `3008` is published to the host. PostgreSQL and the backend are private to the Compose network.

### Docker with Amazon RDS PostgreSQL

Use this option if you have an existing RDS PostgreSQL instance. It starts the API and web containers without a local PostgreSQL container.

1. Create a dedicated database and user on RDS. The user needs permission to connect and create tables and indexes in the target schema, and to read and insert data. The API creates its tables and inserts fictional demo records on startup. Use a separate database or schema so it does not affect unrelated tables.
2. Allow the Docker host to reach the RDS endpoint and configure the RDS security group to allow the host on the PostgreSQL port.
3. Create the RDS configuration file and set the real endpoint, port, user, password, and database:

   ```bash
   cp .env.rds.example .env.rds
   chmod 600 .env.rds
   # Edit .env.rds; keep it private.
   ```

   Compose supports single-quoted values for passwords containing characters such as `$` or `#`. The RDS hostname must match the server certificate; use the RDS endpoint rather than an IP address. Shell environment variables override values in `.env.rds`.

4. Download the AWS RDS CA bundle. The API verifies the RDS certificate and hostname using this bundle:

   ```bash
   mkdir -p certs
   curl --fail --show-error --location \
     https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
     -o certs/rds-ca-bundle.pem
   ```

   Keep the bundle current when AWS rotates certificates. The bundle must be present before starting the API container.

5. If you already started the local PostgreSQL stack, stop it first with `docker compose down` using its original configuration. Do not add `-v`; that would delete its database volume. Switching to RDS does not migrate existing data.

6. Start the RDS configuration from the project root:

   ```bash
   docker compose --env-file .env.rds -f compose.rds.yaml up -d --build
   docker compose --env-file .env.rds -f compose.rds.yaml ps
   docker compose --env-file .env.rds -f compose.rds.yaml logs --tail=50 api
   curl --fail http://127.0.0.1:3008/api/health
   ```

Use the same `--env-file .env.rds -f compose.rds.yaml` options for other Compose commands. The example health URL assumes `APP_PORT=3008`. To stop this stack, run `docker compose --env-file .env.rds -f compose.rds.yaml down`; it does not delete RDS data.

### Development without Docker

You need Node.js 22+, PostgreSQL 16+, and npm. Create a local PostgreSQL database and user; use `backend/.env.example` as a reference.

Terminal A — backend:

```bash
cd backend
npm install
# Set DATABASE_URL in your terminal or use an environment loader:
export DATABASE_URL='postgres://schoolscope:local_password@localhost:5432/schoolscope'
npm run dev
```

Terminal B — frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` requests to `http://localhost:4000`. You can run the backend from Node while keeping only PostgreSQL in a container (see `docs/DEVELOPMENT.md`).

**Want a quick look at the design?** Open `docs/STATIC_DESIGN_PREVIEW.html` locally. It is a non-interactive visual mockup; the actual React app is served by Docker.

## Demo functionality

- Select **2024–25** or **2025–26** (never mixes years in the KPI averages).
- Filter by district, borough, or school name / fictional DBN.
- Sort mathematics proficiency highest or lowest, always placing **NULL last**; name/DBN are deterministic tie-breakers.
- Show school count, unweighted average math proficiency, average ELA proficiency, average attendance, and reported enrollment.
- View two-year average math/ELA trend and the highest-average districts in the current result set.
- Select any school to open a detail drawer with its available year-over-year results.
- Export the *currently filtered rows* as a CSV file.
- View loading, empty, and error states; use responsive controls for narrow screens.

### Important edge cases

1. The data include **missing (`null`) math, ELA, and attendance values**. These do not enter their respective averages.
2. The data include **real zero values** in fictional school performance. A score of `0` is valid; it is **not** treated as missing.
3. The same school may have multiple years, but each school-year row is unique.
4. Searches trim whitespace, ignore case, and support school name or DBN. Special wildcard characters in searches are treated literally.
5. Sorting places missing mathematics scores at the bottom in **both** ascending and descending directions.
6. Borough/district options reflect the selected academic year.

## REST endpoints

All URLs are same-origin through Nginx; requests use JSON.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/health` | Verify API and PostgreSQL connectivity |
| GET | `/api/metadata?year=2025-26` | Years, districts, boroughs, total seeded rows |
| GET | `/api/schools?year=2025-26&district=2&sort=math_desc` | Pageless filtered school directory |
| GET | `/api/summary?year=2025-26&borough=Queens` | KPI averages for filtered results |
| GET | `/api/trends?district=2` | School-year averages across all available years |
| GET | `/api/schools/02M914/history` | Year-by-year details for one fictional DBN |

The directory, summary and trend routes accept `district`, `borough` and `search`; the directory additionally accepts `sort` (`math_desc`, `math_asc`, `name_asc`, `name_desc`). School year is required for comparing a single year's directory/summary but defaults to `2025-26` if omitted.

**Example:**

```bash
curl 'http://localhost:3008/api/schools?year=2025-26&search=academy&sort=math_asc'
curl 'http://localhost:3008/api/summary?year=2025-26'
```

## Tests

```bash
node scripts/validate-dataset.mjs    # Works offline (Node.js only)
cd backend && npm install && npm test && npm run build
cd ../frontend && npm install && npm test && npm run build
cd .. && ./scripts/smoke-test.sh
```

For reproducibility, commit generated `package-lock.json` files after your first successful `npm install`. This handoff does not include generated lock files, since npm registry access was unavailable in the authoring environment. Dockerfiles therefore use `npm install`, not `npm ci`.

## Repository structure

```text
schoolscope/
├── compose.yaml                   # DB + API + web services, persistent volume
├── compose.rds.yaml               # API + web using external RDS PostgreSQL
├── .env.rds.example               # RDS connection settings template
├── .env.example                   # Local demo configuration
├── frontend/
│   ├── src/App.tsx                # Dashboard, graphs, filters, detail drawer
│   ├── src/api.ts                  # Typed fetch wrapper
│   ├── src/utils.ts               # Formatting / CSV / null-aware mean
│   ├── src/styles.css             # Responsive layout
│   ├── Dockerfile                 # Build React -> Nginx
│   └── nginx.conf                 # SPA hosting and /api reverse proxy
├── backend/
│   ├── src/server.ts              # Express routes
│   ├── src/filters.ts             # Safe, parameterized filters and sorting
│   ├── src/seed.ts                # Migration and idempotent demo seeding
│   ├── data/schools.json          # 30 original fictional assessment rows
│   └── Dockerfile                 # TypeScript compilation -> Node runtime
├── scripts/smoke-test.sh
└── docs/
    ├── DEMO_GUIDE.md              # Interview walkthrough and talking points
    ├── ARCHITECTURE.md            # Design and schema decisions
    └── DEVELOPMENT.md             # Partial Docker / local development
```

## Scope and production considerations

This demonstration deliberately has **no login, authorization, rate limiting, per-user permissions, student data, or write API**. For a real NYCPS deployment, add SSO/RBAC, audit logging, privacy review, accessibility testing, TLS, secrets management, monitoring, schema migration tooling, and applicable compliance controls. Do not expose this demo as though it were an official NYCPS product.

**Assessment note:** This full-stack implementation goes beyond the original two-hour front-end task (which required only static JSON and vanilla JavaScript). If an actual take-home test specifies front-end only, follow those exact requirements instead of introducing unnecessary backend infrastructure.
