# Architecture & data decisions

```text
Browser (React + TypeScript)
        |
        | HTTP (same origin)    :3008
        v
Nginx — static Vite build
        |  /api/* reverse proxy
        v
Express API (Node.js + TypeScript) :4000  [internal only]
        |
        | parameterized SQL
        v
SQLite database file                    [inside API volume]
        |
    Docker volume: sqlite_data
```

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
- No authentication or PII is included; adding real student records would require a significantly different privacy/security design.
- ELA and math chart averages are school-level unweighted means, not enrollment-weighted or student-level statistics.
