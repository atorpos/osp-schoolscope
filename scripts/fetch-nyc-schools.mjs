#!/usr/bin/env node
// Downloads real New York City public school locations and community school district boundaries
// from NYC Open Data, and writes the snapshot that the API loads on startup:
//
//   backend/data/school_locations.json     every DOE district, charter and District 75 school
//   backend/data/school_districts.geojson  the 32 geographic community school districts
//
// Sources (all published on https://opendata.cityofnewyork.us under the NYC Open Data Terms of Use):
//   - Facilities Database, Department of City Planning (ji82-xba5): the current list of schools in
//     the DOE's LCGMS system, with coordinates. It has no DBN.
//   - 2019 - 2020 School Locations, Department of Education (wg9x-4ke6): adds the DBN when the school
//     name matches. Schools that opened later keep `dbn: null` rather than a guessed one.
//   - School Districts, Department of City Planning (8ugf-3d8u): district boundaries.
//
// Usage: node scripts/fetch-nyc-schools.mjs
// Set SOCRATA_APP_TOKEN to an NYC Open Data app token to avoid anonymous-request throttling.

import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const DOMAIN = 'https://data.cityofnewyork.us';
const DATASETS = {
  facilities: { id: 'ji82-xba5', name: 'Facilities Database', publisher: 'NYC Department of City Planning' },
  doeLocations: { id: 'wg9x-4ke6', name: '2019 - 2020 School Locations', publisher: 'NYC Department of Education' },
  districts: { id: '8ugf-3d8u', name: 'School Districts', publisher: 'NYC Department of City Planning' },
};
const OUT_LOCATIONS = new URL('../backend/data/school_locations.json', import.meta.url);
const OUT_DISTRICTS = new URL('../backend/data/school_districts.geojson', import.meta.url);

async function get(path, { attempts = 6 } = {}) {
  const headers = { Accept: 'application/json' };
  if (process.env.SOCRATA_APP_TOKEN) headers['X-App-Token'] = process.env.SOCRATA_APP_TOKEN;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(DOMAIN + path, { headers, signal: AbortSignal.timeout(120_000) });
      if (response.ok) return await response.json();
      // NYC Open Data answers anonymous bursts with 429 / 503 "Service unavailable"
      if (attempt >= attempts || ![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
      }
    } catch (error) {
      if (attempt >= attempts) throw error;
    }
    const wait = attempt * 4000;
    console.warn(`  retrying in ${wait / 1000}s (attempt ${attempt + 1} of ${attempts})`);
    await delay(wait);
  }
}

async function datasetInfo(dataset) {
  const { results } = await get(`/api/catalog/v1?ids=${dataset.id}`);
  const resource = results?.[0]?.resource;
  return {
    ...dataset,
    url: `${DOMAIN}/d/${dataset.id}`,
    dataUpdatedAt: resource?.data_updated_at ?? null,
  };
}

// --- Names -------------------------------------------------------------------------------------

/** For comparing names from both sources: "P.S. 001 The Bergen" and "P.S. 001 THE BERGEN" are equal */
export function normalizeName(name) {
  return name.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' AND ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

const UPPER_WORDS = new Set([
  'NYC', 'NY', 'KIPP', 'STEM', 'STEAM', 'CUNY', 'SUNY', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI',
  'PS', 'IS', 'MS', 'JHS', 'HS', 'UA', 'CTE', 'YABC', 'ACE', 'AECI', 'ELL', 'ESL', 'LGBT', 'DREAM', 'NEST',
  'MLK', 'IHS', 'PAVE', 'HBCU', 'NYCDOE', 'CSD',
]);
const SMALL_WORDS = new Set(['A', 'AN', 'AND', 'AT', 'BY', 'FOR', 'IN', 'OF', 'ON', 'OR', 'THE', 'TO', 'WITH', 'DE', 'LA', 'DEL', 'Y']);

function capitalize(part) {
  if (!part) return part;
  if (/^MC[A-Z]{2,}$/.test(part)) return 'Mc' + part[2] + part.slice(3).toLowerCase();
  if (/^O'[A-Z]+$/.test(part)) return "O'" + part[2] + part.slice(3).toLowerCase();
  if (/^\d+(ST|ND|RD|TH)$/.test(part)) return part.toLowerCase();
  return part[0] + part.slice(1).toLowerCase();
}

/** "URBAN ASSEMBLY SCHOOL FOR LAW AND JUSTICE, THE" -> "Urban Assembly School for Law and Justice, The" */
export function titleCase(text) {
  const words = text.trim().replace(/\s+/g, ' ').split(' ');
  return words.map((word, index) => {
    const bare = word.replace(/[^A-Z0-9.'-]/gi, '').toUpperCase();
    const previous = words[index - 1] ?? '';
    // A small word after a comma, colon or school number starts a name of its own: "P.S. 166 The Richard..."
    const startsPhrase = index === 0 || /[,:(\-–]$/.test(previous) || /^(\d+|([A-Z]\.){1,4})$/i.test(previous);
    if (/^([A-Z]\.){1,4}[A-Z]?\.?\d*$/.test(bare) || UPPER_WORDS.has(bare)) return word.toUpperCase();
    if (!startsPhrase && SMALL_WORDS.has(bare)) return word.toLowerCase();
    // Keep punctuation around the word (commas, parentheses) and capitalize hyphenated parts
    return word.toUpperCase().replace(/[A-Z0-9']+/g, capitalize);
  }).join(' ');
}

// --- Geometry ----------------------------------------------------------------------------------

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a [lng, lat] point lies in a GeoJSON MultiPolygon (outer rings minus holes) */
export function pointInMultiPolygon(point, multiPolygon) {
  return multiPolygon.some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some(hole => pointInRing(point, hole)));
}

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** Douglas-Peucker line simplification (iterative, so long rings don't overflow the stack) */
function simplifyLine(points, tolerance) {
  if (points.length <= 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) { maxDistance = distance; index = i; }
    }
    if (maxDistance > tolerance && index !== -1) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

function simplifyMultiPolygon(multiPolygon, tolerance) {
  return multiPolygon.map(polygon => polygon
    .map(ring => {
      // Simplify the ring as an open line, then close it again
      const line = simplifyLine(ring.slice(0, -1), tolerance).map(([x, y]) => [round(x, 5), round(y, 5)]);
      return line.length >= 3 ? [...line, line[0]] : null;
    })
    .filter(Boolean))
    // Drop polygons whose outer ring collapsed (slivers of a few metres)
    .filter(polygon => polygon.length && polygon[0].length >= 4);
}

// --- Schools -----------------------------------------------------------------------------------

const LEVELS = [
  [/^ELEMENTARY/, 'Elementary'],
  [/^JUNIOR HIGH|MIDDLE/, 'Middle'],
  [/^HIGH SCHOOL/, 'High school'],
  [/^K-8/, 'K-8'],
  [/^SECONDARY/, 'Secondary (6-12)'],
  [/^K-12/, 'K-12'],
  [/^UNGRADED/, 'Ungraded'],
];

function levelOf(factype) {
  return LEVELS.find(([pattern]) => pattern.test(factype))?.[1] ?? 'Other';
}

function sectorOf(row) {
  if (row.facsubgrp === 'CHARTER K-12 SCHOOLS' || /CHARTER/.test(row.factype)) return 'Charter';
  if (/SPECIAL EDUCATION/.test(row.factype)) return 'District 75 (special education)';
  return 'District';
}

const BOROUGH_LETTER = { 1: 'M', 2: 'X', 3: 'K', 4: 'Q', 5: 'R' };
/** The DOE source cuts names at 50 characters */
const DOE_NAME_LIMIT = 50;

/**
 * Finds the DBN for a Facilities Database school: the names must agree (or the DOE's truncated name
 * must begin the full one), and the school must be on the same tax lot, or be the only match in its
 * borough. A building can hold several schools, so a lot alone is not enough.
 */
function matchDbn(row, doeByName, doeTruncated) {
  const name = normalizeName(row.facname);
  const candidates = [
    ...(doeByName.get(name) ?? []),
    ...doeTruncated.filter(doe => name.startsWith(doe.normalized + ' ') || name === doe.normalized),
  ];
  if (!candidates.length) return null;
  const bbl = String(row.bbl ?? '').replace(/\.0$/, '');
  const sameLot = candidates.find(doe => doe.borough_block_lot === bbl);
  if (sameLot) return sameLot;
  const sameBorough = [...new Set(candidates.filter(doe => doe.system_code?.[2] === BOROUGH_LETTER[row.borocode]))];
  return sameBorough.length === 1 ? sameBorough[0] : null;
}

async function main() {
  console.info('Fetching dataset details…');
  const sources = [];
  for (const dataset of Object.values(DATASETS)) sources.push(await datasetInfo(dataset));

  console.info('Fetching school district boundaries…');
  const districtsRaw = await get(`/resource/${DATASETS.districts.id}.geojson?$limit=100`);

  console.info('Fetching schools from the Facilities Database…');
  const facilities = await get(`/resource/${DATASETS.facilities.id}.json?$where=${encodeURIComponent(
    "datasource='doe_lcgms' AND facgroup='SCHOOLS (K-12)'",
  )}&$limit=10000`);

  console.info('Fetching DOE school locations for DBNs…');
  const doe = (await get(`/resource/${DATASETS.doeLocations.id}.json?$where=${encodeURIComponent(
    "status_descriptions='Open'",
  )}&$limit=10000`)).map(row => ({ ...row, normalized: normalizeName(row.location_name) }));

  // One feature per district: District 10 is published as two (the Bronx, and Marble Hill)
  const polygonsByDistrict = new Map();
  for (const feature of districtsRaw.features) {
    const district = Number(feature.properties.schooldist);
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    polygonsByDistrict.set(district, [...(polygonsByDistrict.get(district) ?? []), ...polygons]);
  }
  const districts = [...polygonsByDistrict]
    .map(([district, coordinates]) => ({ district, coordinates }))
    .sort((a, b) => a.district - b.district);
  const districtAt = point => districts.find(d => pointInMultiPolygon(point, d.coordinates))?.district ?? null;

  const doeByName = new Map();
  for (const row of doe) doeByName.set(row.normalized, [...(doeByName.get(row.normalized) ?? []), row]);
  const doeTruncated = doe.filter(row => row.location_name.length >= DOE_NAME_LIMIT);

  const schools = [];
  let withoutDistrict = 0;
  let disagreeingDistrict = 0;
  for (const row of facilities) {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const point = [longitude, latitude];
    const listed = Number(row.schooldist);
    const located = districtAt(point);
    if (Number.isInteger(listed) && listed >= 1 && listed <= 32 && located !== null && listed !== located) disagreeingDistrict++;
    const district = Number.isInteger(listed) && listed >= 1 && listed <= 32 ? listed : located;
    if (district === null) { withoutDistrict++; continue; }

    const match = matchDbn(row, doeByName, doeTruncated);
    const capacity = Number(row.capacity);
    schools.push({
      id: row.uid,
      dbn: match?.system_code ?? null,
      // The DOE's own spelling when it isn't truncated, otherwise the full name, title-cased
      name: match && match.location_name.length < DOE_NAME_LIMIT ? match.location_name.trim() : titleCase(row.facname),
      level: levelOf(row.factype),
      sector: sectorOf(row),
      address: row.address ? titleCase(row.address) : null,
      zip: row.zipcode ?? null,
      borough: titleCase(row.boro),
      district,
      latitude: round(latitude, 6),
      longitude: round(longitude, 6),
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : null,
    });
  }
  schools.sort((a, b) => a.district - b.district || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  // District features: simplified outlines, their borough, and a label point among their schools
  const features = districts.map(({ district, coordinates }) => {
    const inDistrict = schools.filter(school => school.district === district);
    const boroughCounts = new Map();
    for (const school of inDistrict) boroughCounts.set(school.borough, (boroughCounts.get(school.borough) ?? 0) + 1);
    const borough = [...boroughCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
    return {
      type: 'Feature',
      properties: {
        district,
        borough,
        schools: inDistrict.length,
        label: inDistrict.length ? [round(median(inDistrict.map(s => s.longitude)), 5), round(median(inDistrict.map(s => s.latitude)), 5)] : null,
      },
      geometry: { type: 'MultiPolygon', coordinates: simplifyMultiPolygon(coordinates, 0.0001) },
    };
  });

  const retrievedAt = new Date().toISOString();
  const source = {
    retrievedAt,
    license: 'NYC Open Data Terms of Use (https://opendata.cityofnewyork.us/overview/#termsofuse)',
    datasets: sources,
    notes: 'Locations and names come from the Facilities Database (DOE LCGMS). DBNs come from the DOE 2019-20 '
      + 'location file where the school name matches; schools without a confident match have dbn = null.',
  };
  await writeFile(OUT_LOCATIONS, JSON.stringify({ source, count: schools.length, schools }, null, 1) + '\n');
  await writeFile(OUT_DISTRICTS, JSON.stringify({ type: 'FeatureCollection', source, features }) + '\n');

  const bySector = Object.groupBy(schools, school => school.sector);
  console.info(`Wrote ${schools.length} schools (${schools.filter(s => s.dbn).length} with a DBN) and ${features.length} districts.`);
  console.info(`  ${Object.entries(bySector).map(([sector, rows]) => `${sector}: ${rows.length}`).join(', ')}`);
  if (withoutDistrict) console.info(`  Skipped ${withoutDistrict} schools outside every district boundary.`);
  if (disagreeingDistrict) console.info(`  ${disagreeingDistrict} schools list a district other than the boundary they sit in; kept the listed one.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
