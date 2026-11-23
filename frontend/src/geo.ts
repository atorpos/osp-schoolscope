import type { DistrictFeature, Position } from './types';

/** One colour per school type, used for map pins, dots and the legend */
const SECTOR_COLORS: Record<string, string> = {
  District: '#2965db',
  Charter: '#13977d',
  'District 75 (special education)': '#8666c8',
};
export const sectorColor = (sector: string): string => SECTOR_COLORS[sector] ?? '#d9822b';

/** Short text inside an Apple Maps marker */
const LEVEL_GLYPHS: Record<string, string> = {
  Elementary: 'E', Middle: 'M', 'High school': 'H', 'K-8': 'K8', 'Secondary (6-12)': 'S', 'K-12': 'K12', Ungraded: 'U',
};
export const levelGlyph = (level: string): string => LEVEL_GLYPHS[level] ?? '';

/** Youngest grades first */
const LEVEL_ORDER = ['Elementary', 'K-8', 'Middle', 'Secondary (6-12)', 'High school', 'K-12', 'Ungraded'];
export const sortLevels = (levels: string[]): string[] =>
  [...levels].sort((a, b) => (LEVEL_ORDER.indexOf(a) + 1 || 99) - (LEVEL_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));

export interface Projection {
  width: number;
  height: number;
  /** [longitude, latitude] to SVG [x, y] */
  project: (position: Position) => [number, number];
}

/**
 * A plain equirectangular projection fitted to the districts, with longitude scaled by the cosine of the middle
 * latitude so the city isn't stretched. Accurate enough for a city-sized map without a map library.
 */
export function createProjection(features: DistrictFeature[], width = 1000, padding = 16): Projection {
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const feature of features) {
    for (const polygon of feature.geometry.coordinates) for (const ring of polygon) for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng); maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
  }
  if (!Number.isFinite(minLng)) return { width, height: width, project: () => [width / 2, width / 2] };
  const xScale = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const scale = (width - 2 * padding) / ((maxLng - minLng) * xScale);
  const height = (maxLat - minLat) * scale + 2 * padding;
  return {
    width,
    height,
    project: ([lng, lat]) => [padding + (lng - minLng) * xScale * scale, padding + (maxLat - lat) * scale],
  };
}

/** An SVG path for a GeoJSON MultiPolygon; holes are drawn with the even-odd fill rule */
export function multiPolygonPath(coordinates: Position[][][], project: Projection['project']): string {
  return coordinates.map(polygon => polygon.map(ring => ring.map((position, index) => {
    const [x, y] = project(position);
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('') + 'Z').join('')).join('');
}

/** The projected bounding box of some MultiPolygons, as [x, y, width, height] */
export function projectedBounds(coordinates: Position[][][][], project: Projection['project']): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const multiPolygon of coordinates) for (const polygon of multiPolygon) for (const ring of polygon) for (const position of ring) {
    const [x, y] = project(position);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX - minX, maxY - minY] : null;
}

/** A link that opens the school in Apple Maps (or the browser's map site) */
export function appleMapsUrl(name: string, latitude: number, longitude: number): string {
  const params = new URLSearchParams({ q: name, ll: `${latitude},${longitude}` });
  return `https://maps.apple.com/?${params}`;
}
