# Five-minute interview demo script

## 0:00 – 0:45 | Overview

> “I built SchoolScope as an independent school-performance data dashboard. The frontend is React and TypeScript, the API uses Node.js/Express, and the data are stored in SQLite. The entire stack starts through Docker Compose. The dataset is fully fictional and uses 30 school-year records.”

Open `http://localhost:3008` and log in with your reviewer account. Point to the “Demo environment” label and the academic year selector.

> “Reviewers get their own accounts. Login works like our VgemsAI app: a short-lived access token in memory and a rotating refresh token in an httpOnly cookie. That's why a reload keeps you signed in, and why a copied refresh token stops working.”

## 0:45 – 1:30 | Work with filters

- Change academic year from **2025–26** to **2024–25**. The KPI numbers and table should change.
- Filter by a district and optionally a borough; type part of a school name or a DBN.
- Show both mathematics sorting directions. Explain that null values always appear last.

> “The database handles filtering and sorting; the UI sends typed query parameters to a small validated API.”

## 1:30 – 2:30 | Explain statistics

- Show average math, ELA, and attendance KPIs.
- Point out **Beacon Elementary** has a **0 ELA** score in 2025–26 and **Bayfront Academy** has **0 math**. Zero is still valid in the average.
- Highlight **Summit School**'s missing math score, **Élan STEM School**'s missing ELA score, and **Williamsburg Academy**'s missing attendance value.
- Explain that a simple, **unweighted mean** is used for reporting schools and that missing values are excluded.

## School map (real data, about a minute)

- Scroll to **School map**, or use the sidebar. All 1,869 NYC public schools appear on Apple Maps, clustered over the 32 district outlines.
- Click a district (or pick one) to zoom in, filter by **Charter** or **High school**, and search for “Stuyvesant” or a DBN such as `02M475`.
- Open a school for its address, capacity and an **Open in Apple Maps** link.

> “These locations are real NYC Open Data: the City Planning Facilities Database plus DOE DBNs where the names match. The performance scores stay fictional. The MapKit key stays on the server, which signs short-lived tokens for the browser.”

## 2:30 – 3:30 | Dashboard interactions

- Open a school detail drawer and compare available reporting years.
- Export current filtered schools as a CSV file.
- Show how the chart and district snapshot respond to filters.
- Resize browser to a narrow viewport (375 px) to demonstrate responsive behavior.

## 3:30 – 4:30 | Architecture

Open `docs/ARCHITECTURE.md`.

> “Nginx serves the React build and reverse-proxies requests to Express. The SQLite file is stored in a persistent Docker volume, and the frontend waits for the API health check. Seed data are loaded transactionally and won't duplicate on restart.”

Show `docker compose ps` and `curl http://localhost:3008/api/health`.

## 4:30 – 5:00 | Engineering quality

> “I used TypeScript at the frontend and backend boundaries, parameterized SQL for user-controlled queries, explicit empty/loading/error states, unit tests for null-aware calculations, and a focused REST contract.”

## Questions interviewers may ask

**Why SQLite?** This small demonstration benefits from SQL relationships and constraints without running a separate database service. A larger deployment with multiple writers could use managed PostgreSQL.

**Why not calculate averages only on the frontend?** Server-side aggregations use the same filter logic as the records, avoid transferring every record for large datasets, and centralize important rules. The client computes only the district snapshot over the currently fetched small result set.

**Why a REST API?** It cleanly separates the UI from data access and can support multiple clients or a later reporting service.

**How do you ensure accessibility?** Labels, native selects, clear error messages, keyboard-operable row actions, descriptive table headers, focus visibility, and adequate mobile layouts. A production build should additionally undergo screen-reader testing and a WCAG audit.

**How would you scale it?** Add cursor pagination, indexes from real query plans, caching for high-volume read summaries, observability, and managed Postgres. The sample does not need Kubernetes, Redis, or microservices.

**Why not keep the token in localStorage?** Any script injected into the page could read it and use it for 30 days. Here the long-lived refresh token is in an httpOnly, SameSite=Strict cookie scoped to `/api/auth`. The access token is in memory and expires within an hour.

**What if the Apple Maps key is wrong or missing?** The API answers 503, or MapKit reports “Unauthorized”, and the section draws the same data as an SVG map with a notice. The rest of the dashboard is unaffected.

**Does this project represent an actual NYCPS system?** No. It is an independently built portfolio demonstration with fictional performance records and public NYC Open Data school locations, not affiliated with NYCPS.
