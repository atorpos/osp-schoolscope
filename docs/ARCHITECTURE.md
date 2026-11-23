# Architecture & data decisions

```text
Browser (React + TypeScript) ─────────── MapKit JS ───> Apple Maps (cdn.apple-mapkit.com)
        |                                   ^
        | HTTP (same origin)    :3008       | token from GET /api/mapkit/token
        v                                   |
Nginx — static Vite build, gzip            |
        |  /api/* reverse proxy             |
        v                                   |
Express API (Node.js + TypeScript) :4000  [internal only] — signs MapKit tokens with the .p8 key
        |
        | parameterized SQL
        v
SQLite database file                    [inside API volume]
        |
    Docker volume: sqlite_data
```

## Login (ported from the VgemsAI app)

```text
POST /api/auth/login {email, password}
  -> 200 {accessToken (HS256 JWT, 60 min), expiresIn, refreshExpiresIn, user}
     Set-Cookie: schoolscope_refresh=<random 256-bit token>; HttpOnly; SameSite=Strict; Path=/api/auth; (Secure on HTTPS)
     Set-Cookie: schoolscope_signed_in=1; Path=/        <- readable hint, no secret

GET /api/... with Authorization: Bearer <accessToken>
  -> 401 when the token is invalid/expired or its login ended; the web app renews once and retries

POST /api/auth/refresh (cookie)
  -> 200 new access token + new refresh cookie; the old refresh token is now "previous"
  -> 409 when the previous token is sent again within 10 s (another tab renewed at the same moment): retry
  -> 401 when the previous token is sent again later (possible theft): the whole login is ended
```

- `users`: email (lowercased, unique), name, scrypt password hash (`N=16384, r=8, p=1`, 16-byte salt), disabled flag.
- `auth_sessions`: one row per login (browser). It holds a SHA-256 of the current refresh token, the one it replaced and when, the expiry (sliding 30 days), user agent and IP, and `revoked_at`. Tokens themselves are never stored.
- `requireAuth` verifies the JWT and then checks its session row, so logging out or changing a password takes effect immediately, not only when the access token expires.
- Access tokens live in memory in the browser, not in `localStorage`, so injected scripts can't read a long-lived credential. Renewal runs once at a time per tab and takes turns across tabs (Web Locks) because the cookie is shared.
- Brute force: in-memory counters per address+email (8 / 15 min) and per address (40 / 15 min). A missing email still checks a dummy hash, so its answer takes as long as a wrong password.
- Accounts come from `DEMO_ACCOUNTS` (synced on start) or `accounts-cli`. There is no sign-up endpoint.

## Real school locations and the map

- `school_locations` is reference data. It is reloaded from `data/school_locations.json` on every start, in one transaction. The fictional `schools` / `school_performance` tables are untouched, and the two datasets are not joined.
- `scripts/fetch-nyc-schools.mjs` builds that file from NYC Open Data: the Facilities Database for the current schools, School Districts for the boundaries (Douglas–Peucker simplified, ~250 KB), and DOE 2019–20 locations for DBNs where the names agree. See the README for the matching rules.
- `/api/locations` validates `district` (1–32) and `borough` / `sector` / `level` against values in the data, then filters with positional parameters. Search is a case-insensitive substring match on name, DBN and address.
- MapKit JS needs a JWT signed with an Apple MapKit key (`ES256`, `kid` = Key ID, `iss` = Team ID, optional `origin`). The API signs 30-minute tokens. The key never reaches the browser, and the token endpoint needs a login. MapKit's `authorizationCallback` fetches a new token when needed.
- The browser asks for a token before loading Apple's script. A 503 (no key) or an "Unauthorized" error from MapKit (bad key or origin) switches to an SVG map of the same data, so the section always works.

## Domain model

`schools` (one row per fictional school)

- `dbn`: string primary key, preserving leading zeroes
- `school_name`: text
- `district`: integer
- `borough`: text

`school_performance` (one row per school-year)

- `(dbn, school_year)`: composite primary key
- `enrollment`: optional nonnegative integer
- `math_pct`, `ela_pct`, `attendance_pct`: optional percentages 0–100
- `dbn` foreign key -> `schools.dbn`

School-year results are represented in a separate table to prevent duplicate school metadata. `AVG()` on numeric columns naturally ignores SQL NULL values **and correctly includes 0**. The API uses `ROUND(AVG(...), 1)` to return JSON numbers (or null when no values exist).

## Query rules

- The browser sends only active filter parameters.
- The server validates `year`, `district`, `borough`, `search` length and `sort`.
- Filter values are always positional SQLite parameters (`?`).
- `sort` is a fixed enum mapped to server-defined SQL. User-provided SQL is never interpolated.
- Search uses parameterized, case-insensitive literal substring matching on school name and DBN, including accented characters.
- Ascending and descending mathematics score sorts use `NULLS LAST`, then name and DBN as tie-breakers.
- `trends` intentionally excludes a single-year filter, to show both school years under matching district / borough / search constraints.

## Reliability and operations

- The API health check confirms the SQLite database can be queried.
- `depends_on` waits for API readiness before starting the frontend.
- Migrations and demo inserts occur within a database transaction on startup.
- Inserts are safe on restart: `ON CONFLICT ... DO NOTHING`.
- Docker persistence survives `docker compose down` but not `down -v`.
- Nginx serves the SPA and forwards `/api/` requests to the API service name.
- CORS is unnecessary in production because the frontend calls the API via the same origin.

## Deliberate tradeoffs

- A 30-row fictional dataset does not need pagination or Redis; avoid adding complexity for show.
- Nginx has no HTTPS termination; add a reverse proxy / load balancer with TLS for production.
- Data migrations in `seed.ts` are intentionally simple. For multi-developer production projects use a versioned migration tool appropriate to the chosen database.
- `SELECT ... JOIN` is efficient for a tiny set. For a much larger directory, add keyset pagination and query-plan/index review.
- Login is for invited reviewers only: no roles, sign-up, email verification or SSO. Login rate limits live in memory, which suits one API process. Several processes would need a shared store.
- No student records or other PII beyond reviewer names and emails. Adding real student records would require a significantly different privacy/security design.
- The location snapshot is committed instead of fetched at runtime, so the app starts offline and the data are reviewable in Git. Refreshing it is a deliberate step.
- ELA and math chart averages are school-level unweighted means, not enrollment-weighted or student-level statistics.
