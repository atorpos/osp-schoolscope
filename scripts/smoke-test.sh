#!/usr/bin/env sh
set -eu
BASE="${1:-http://localhost:3008}"
printf 'Checking SchoolScope at %s\n' "$BASE"
curl --fail --silent --show-error "$BASE/api/health"
printf '\n'
curl --fail --silent --show-error "$BASE/api/summary?year=2025-26"
printf '\n'
curl --fail --silent --show-error "$BASE/api/schools?year=2025-26&district=2&sort=math_asc" > /dev/null
printf 'Smoke checks passed.\n'
