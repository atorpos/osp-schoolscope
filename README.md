# SchoolScope — School Performance Explorer

A **full-stack, presentation-ready portfolio project** inspired by the requirements of a *hypothetical* New York City Public Schools Office of School Performance Web Developer assessment.

> **Independent demo, not an official NYCPS assessment or application.** The 30 performance rows (school names, codes and scores in the dashboard and directory) are fictional. The **school map uses real, public school locations** from NYC Open Data. This project is for demonstration and learning, not for handling real pupil data.

## Tech stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | React 19, TypeScript, Vite | Responsive dashboard, accessible filters, charts, CSV export, login page |
| Maps | Apple MapKit JS 5 | Clustered pins for every NYC public school over the 32 school district outlines |
| Backend | Node.js 22, Express, TypeScript | REST API, validation, parameterized SQLite queries, login, MapKit token signing |
| Auth | scrypt, `jose` (JWT) | Password login with short-lived access tokens and rotating refresh tokens, as in the VgemsAI app |
| Database | SQLite | Fictional performance records, real school locations, accounts and logins |
| Deployment | Docker Compose, multi-stage Dockerfiles, Nginx | One-command launch, API and persistent database volume |
| Testing | Node.js test runner, Vitest, curl | API, auth and data tests; UI helper and session tests; smoke checks |

## Quick start: Docker (recommended)

Install **Docker Engine + Docker Compose V2** or Docker Desktop. In the project root:

```bash
test -f .env || cp .env.example .env
# Edit .env: add at least one reviewer account to DEMO_ACCOUNTS (see "Reviewer accounts").
# Optionally set APP_PORT and the MAPKIT_* values for Apple Maps.
docker compose up --build -d
```

Open **http://localhost:3008** and log in with a reviewer account. For a different host port, change `APP_PORT` in `.env`. If you already have a `.env` file, update its existing `APP_PORT` value to `3008` before restarting Compose.

```bash
docker compose ps                       # Health and container status
docker compose logs -f api              # Backend/migration logs
./scripts/smoke-test.sh                 # Test health, summary, filtering
docker compose down                     # Stop containers without deleting data
```

**Important:** `docker compose down -v` removes the SQLite data volume. Do that only when you intend to reset the demo data.

### What happens on startup?

1. The API opens a SQLite database in a persistent Docker volume and creates the tables and indexes if needed.
2. The API seeds the same 30 fictional school-year records. Seed inserts are idempotent; restarting does not duplicate or overwrite existing records.
3. The API loads the real school locations from `backend/data/school_locations.json`, replacing the previous copy, so the table always matches the snapshot the image was built with.
4. The API creates or updates the accounts in `DEMO_ACCOUNTS`.
5. Nginx serves the React frontend and proxies requests beginning with `/api/` to the API.
6. The web service is published on host port `3008` by default; the API is private to the Compose network.

**Switching from PostgreSQL or RDS:** This version creates a new SQLite database from the fictional seed data. It does not migrate data from an existing PostgreSQL volume or RDS. Back up any data you need before switching. If the old Compose stack is running, stop it before updating: use `docker compose down` for the local database stack or `docker compose --env-file .env.rds -f compose.rds.yaml down` for the RDS stack. Do not add `-v`. This does not delete the old PostgreSQL volume or any RDS resources.

### Development without Docker

You need Node.js 22.13 or later and npm. The API creates its local SQLite file automatically. Set `SQLITE_PATH` to choose another file, or see `backend/.env.example` for the default.

Terminal A — backend:

```bash
cd backend
npm install
npm run dev
```

Terminal B — frontend:

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` requests to `http://localhost:4000`. Outside production, with no `DEMO_ACCOUNTS` and no accounts yet, the API creates **`reviewer@schoolscope.test` / `schoolscope-review`** and prints it on startup. `npm run dev` and `npm run accounts` read `backend/.env` if it exists (see `backend/.env.example`). See `docs/DEVELOPMENT.md` for other development options.

**Want a quick look at the design?** Open `docs/STATIC_DESIGN_PREVIEW.html` locally. It is a non-interactive visual mockup; the actual React app is served by Docker.

## Reviewer accounts

Everything except `/api/health` needs a login. Like the VgemsAI app, the login is email + password. It returns a **60-minute access token** and a **30-day refresh token**. The refresh token is replaced on every renewal, and using a replaced one again ends that login. In the browser, the refresh token is an httpOnly, `SameSite=Strict` cookie that page scripts can't read. The access token is kept only in memory. There is no sign-up: you hand out accounts.

**Option 1 — `DEMO_ACCOUNTS` in `.env`** (good for a fixed set of App Review / interview accounts). It is a JSON array in single quotes:

```bash
DEMO_ACCOUNTS='[{"email":"appreview@example.com","password":"a-long-unique-password","name":"App Review"},{"email":"interviewer@example.com","password":"another-long-password","name":"Interview Panel"}]'
```

On every start the API creates these accounts, or brings them in line. A changed password replaces the old one and ends that account's logins. Passwords need at least 8 characters and are stored as salted scrypt hashes. They are never logged.

**Option 2 — the accounts CLI** (generates a password and prints it once):

```bash
docker compose exec api node dist/accounts-cli.js add reviewer@example.com "App Reviewer"
docker compose exec api node dist/accounts-cli.js list
docker compose exec api node dist/accounts-cli.js reset-password reviewer@example.com
docker compose exec api node dist/accounts-cli.js remove reviewer@example.com
# Without Docker: cd backend && npm run accounts -- list
```

Accounts listed in `DEMO_ACCOUNTS` are reset to their `.env` password on the next start, so manage each account one way or the other.

Other login settings: `AUTH_SECRET` (32+ characters) keeps access tokens valid across API restarts. Without it, the web app quietly renews them after a restart. Set `COOKIE_SECURE=true` when HTTPS ends at a proxy in front of Nginx. `ACCESS_TOKEN_TTL` and `REFRESH_TOKEN_TTL` (seconds) change the lifetimes. Eight wrong passwords for an email from one address, or 40 from one address, block further attempts for 15 minutes.

Not ported from VgemsAI: sign-up, emailed codes for new devices, passkeys and Face ID / Touch ID. Those need an email service and WebAuthn, which this demo doesn't have.

## Apple Maps (MapKit JS)

The **School map** section shows every school on Apple Maps, with clustered pins and the 32 district outlines. Click a district to filter to it. Without MapKit keys, it draws the same data as a simplified map and says so. To turn on Apple Maps:

1. In your Apple Developer account, open **Certificates, Identifiers & Profiles → Identifiers** and add a **Maps ID**. Then under **Keys**, create a key with **MapKit JS** enabled for that Maps ID, and download the `.p8` file (it can be downloaded only once).
2. Put the values in `.env`:

   ```bash
   MAPKIT_TEAM_ID=ABCDE12345          # Membership details → Team ID
   MAPKIT_KEY_ID=XYZ987WXYZ           # the key's Key ID
   MAPKIT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT…\n-----END PRIVATE KEY-----"
   MAPKIT_ORIGIN=https://schoolscope.example.com   # recommended: the address people open
   ```

   Outside Docker you can use `MAPKIT_PRIVATE_KEY_FILE=/path/to/AuthKey_XYZ987WXYZ.p8` instead (`*.p8` is git-ignored).
3. Restart the API (`docker compose up -d api`). The log says `Apple Maps ready`.

The private key stays on the server. The browser asks `GET /api/mapkit/token` (logged-in users only) for a 30-minute ES256 token, and MapKit JS asks again when it runs out. If Apple rejects the key, the map falls back to the simplified one and says why.

## Real school location data

`backend/data/school_locations.json` holds **1,869 NYC public schools**: DOE district schools, charter schools and District 75 special education schools. Each has its address, borough, community school district, grade level, school type, capacity and coordinates. `backend/data/school_districts.geojson` holds the 32 community school district boundaries. Both come from NYC Open Data:

| Dataset | Publisher | Used for |
| --- | --- | --- |
| [Facilities Database](https://data.cityofnewyork.us/d/ji82-xba5) | NYC Department of City Planning (from DOE's LCGMS) | The current list of schools, names, addresses, coordinates, capacity |
| [School Districts](https://data.cityofnewyork.us/d/8ugf-3d8u) | NYC Department of City Planning | District outlines (simplified to ~10 m) |
| [2019 - 2020 School Locations](https://data.cityofnewyork.us/d/wg9x-4ke6) | NYC Department of Education | DBNs, when the school name matches |

The Facilities Database has no DBN, so DBNs are matched from the DOE file by name, and also by tax lot or borough. A building can hold several schools, so a lot match alone is never used. 1,570 schools get a DBN; schools that opened later keep `dbn: null` rather than a guess. To refresh the snapshot:

```bash
NODE_USE_ENV_PROXY=1 node scripts/fetch-nyc-schools.mjs   # NODE_USE_ENV_PROXY only behind an HTTPS proxy
node scripts/validate-dataset.mjs
```

Set `SOCRATA_APP_TOKEN` to an NYC Open Data app token if anonymous requests are throttled. The data are published under the [NYC Open Data Terms of Use](https://opendata.cityofnewyork.us/overview/#termsofuse). The performance figures elsewhere in the app remain fictional and are not linked to these schools.

## Demo functionality

- Log in with a reviewer account. Reloading keeps you logged in until you log out or the login ends.
- See all 1,869 real NYC public schools on the **School map**. Filter by district, borough, school type or grade level, search by name, DBN or address, and open a school's details or Apple Maps directions.
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

All URLs are same-origin through Nginx; requests use JSON. Every endpoint except health and `/api/auth/*` needs `Authorization: Bearer <accessToken>` and answers 401 without it.

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/api/health` | Verify API and SQLite connectivity (no login) |
| POST | `/api/auth/login` | `{email, password}` → `{accessToken, expiresIn, refreshExpiresIn, user}` and the refresh cookie |
| POST | `/api/auth/refresh` | New tokens from the refresh cookie (401: log in again; 409: another tab just renewed, retry) |
| POST | `/api/auth/logout` | Ends the login on the server |
| GET | `/api/users/me` | The logged-in user |
| GET | `/api/metadata?year=2025-26` | Years, districts, boroughs, total seeded rows |
| GET | `/api/schools?year=2025-26&district=2&sort=math_desc` | Pageless filtered school directory |
| GET | `/api/summary?year=2025-26&borough=Queens` | KPI averages for filtered results |
| GET | `/api/trends?district=2` | School-year averages across all available years |
| GET | `/api/schools/02M914/history` | Year-by-year details for one fictional DBN |
| GET | `/api/locations?district=2&sector=Charter&search=` | Real school locations; also `borough`, `level` |
| GET | `/api/locations/metadata` | Location filter options, counts and data sources |
| GET | `/api/locations/districts` | Community school district boundaries (GeoJSON) |
| GET | `/api/mapkit/token` | A MapKit JS token (503 when Apple Maps isn't configured) |

The directory, summary and trend routes accept `district`, `borough` and `search`; the directory additionally accepts `sort` (`math_desc`, `math_asc`, `name_asc`, `name_desc`). School year is required for comparing a single year's directory/summary but defaults to `2025-26` if omitted.

**Example:**

```bash
TOKEN=$(curl -s -H 'Content-Type: application/json' -d '{"email":"reviewer@example.com","password":"…"}' \
  http://localhost:3008/api/auth/login | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3008/api/schools?year=2025-26&search=academy&sort=math_asc'
curl -H "Authorization: Bearer $TOKEN" 'http://localhost:3008/api/locations?district=2&level=High%20school'
```

## Tests

```bash
node scripts/validate-dataset.mjs    # Works offline (Node.js only)
cd backend && npm install && npm test && npm run build
cd ../frontend && npm install && npm test && npm run build
cd .. && SMOKE_EMAIL=reviewer@example.com SMOKE_PASSWORD='…' ./scripts/smoke-test.sh
```

Both `package-lock.json` files are committed, and the Dockerfiles install with `npm ci`, so every build gets the same dependency versions. After changing dependencies, run `npm install` and commit the updated lock file.

## Repository structure

```text
schoolscope/
├── compose.yaml                   # API + web services, persistent SQLite volume
├── .env.example                   # Local demo configuration
├── frontend/
│   ├── src/App.tsx                # Dashboard, graphs, filters, detail drawer
│   ├── src/LoginPage.tsx          # Login page
│   ├── src/session.ts             # Login state, token renewal (port of VgemsAI's AuthSession)
│   ├── src/SchoolMap.tsx          # School map: Apple Maps or the simplified SVG map
│   ├── src/mapkit-loader.ts       # Loads MapKit JS with server-signed tokens
│   ├── src/geo.ts                 # Map projection and colours
│   ├── src/api.ts                 # Typed fetch wrapper with the access token
│   ├── src/utils.ts               # Formatting / CSV / null-aware mean
│   ├── src/styles.css             # Responsive layout
│   ├── Dockerfile                 # Build React -> Nginx
│   └── nginx.conf                 # SPA hosting, gzip and /api reverse proxy
├── backend/
│   ├── src/server.ts              # Express routes
│   ├── src/auth/                  # Login routes, tokens, passwords, accounts, rate limiting
│   ├── src/accounts-cli.ts        # Add / list / reset / remove accounts
│   ├── src/locations.ts           # Real school locations and district boundaries
│   ├── src/mapkit.ts              # MapKit JS token signing
│   ├── src/filters.ts             # Safe, parameterized filters and sorting
│   ├── src/seed.ts                # Migration and idempotent demo seeding
│   ├── data/schools.json          # 30 original fictional assessment rows
│   ├── data/school_locations.json # 1,869 real NYC school locations (NYC Open Data)
│   ├── data/school_districts.geojson # 32 community school district boundaries
│   └── Dockerfile                 # TypeScript compilation -> Node runtime
├── scripts/fetch-nyc-schools.mjs  # Refreshes the real location snapshot
├── scripts/smoke-test.sh
└── docs/
    ├── DEMO_GUIDE.md              # Interview walkthrough and talking points
    ├── ARCHITECTURE.md            # Design and schema decisions
    └── DEVELOPMENT.md             # Partial Docker / local development
```

## Scope and production considerations

This demonstration has a **password login for invited reviewers** and login rate limiting. It has **no sign-up, roles or per-user permissions, student data, or write API** for school data. For a real NYCPS deployment, add SSO/RBAC, audit logging, privacy review, accessibility testing, TLS, secrets management, monitoring, schema migration tooling, and applicable compliance controls. Login attempts are limited in memory, which suits one API process. Do not expose this demo as though it were an official NYCPS product.

**Assessment note:** This full-stack implementation goes beyond the original two-hour front-end task (which required only static JSON and vanilla JavaScript). If an actual take-home test specifies front-end only, follow those exact requirements instead of introducing unnecessary backend infrastructure.
