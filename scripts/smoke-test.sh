#!/usr/bin/env sh
# Usage: SMOKE_EMAIL=reviewer@example.com SMOKE_PASSWORD=… ./scripts/smoke-test.sh [http://localhost:3008]
set -eu
BASE="${1:-http://localhost:3008}"
EMAIL="${SMOKE_EMAIL:?Set SMOKE_EMAIL and SMOKE_PASSWORD to a reviewer account}"
PASSWORD="${SMOKE_PASSWORD:?Set SMOKE_EMAIL and SMOKE_PASSWORD to a reviewer account}"

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

printf 'Checking SchoolScope at %s\n' "$BASE"
curl --fail --silent --show-error "$BASE/api/health"
printf '\n'

TOKEN=$(curl --fail --silent --show-error -H 'Content-Type: application/json' \
  --data-binary "{\"email\":\"$(json_escape "$EMAIL")\",\"password\":\"$(json_escape "$PASSWORD")\"}" \
  "$BASE/api/auth/login" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || { echo 'Login failed' >&2; exit 1; }
AUTH="Authorization: Bearer $TOKEN"
printf 'Logged in as %s\n' "$EMAIL"

curl --fail --silent --show-error -H "$AUTH" "$BASE/api/summary?year=2025-26"
printf '\n'
curl --fail --silent --show-error -H "$AUTH" "$BASE/api/schools?year=2025-26&district=2&sort=math_asc" > /dev/null
curl --fail --silent --show-error -H "$AUTH" "$BASE/api/locations?district=2" \
  | sed -n 's/.*"count":\([0-9]*\),"total":\([0-9]*\).*/Real school locations: \1 in district 2, \2 citywide/p'
printf '\n'
curl --fail --silent --show-error -H "$AUTH" "$BASE/api/locations/districts" > /dev/null
printf 'Smoke checks passed.\n'
