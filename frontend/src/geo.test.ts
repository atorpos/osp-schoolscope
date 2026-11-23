import { describe, expect, it } from 'vitest';
import { appleMapsUrl, createProjection, levelGlyph, multiPolygonPath, projectedBounds, sectorColor, sortLevels } from './geo';
import { initials } from './utils';
import type { DistrictFeature, Position } from './types';

const square = (district: number, [x, y]: Position, size: number): DistrictFeature => ({
  type: 'Feature',
  properties: { district, borough: 'Manhattan', schools: 1, label: [x + size / 2, y + size / 2] },
  geometry: { type: 'MultiPolygon', coordinates: [[[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]]] },
});

describe('map helpers', () => {
  it('fits the districts into the width, north up, without stretching east-west', () => {
    const features = [square(1, [-74, 40.6], 0.1), square(2, [-73.9, 40.7], 0.1)];
    const { width, height, project } = createProjection(features, 1000, 0);
    expect(width).toBe(1000);
    const [left, top] = project([-74, 40.8]);
    expect(left).toBeCloseTo(0);
    expect(top).toBeCloseTo(0);
    const [right, bottom] = project([-73.8, 40.6]);
    expect(right).toBeCloseTo(1000);
    expect(bottom).toBeCloseTo(height);
    // 0.2° of longitude is shorter than 0.2° of latitude at 40.7°N
    expect(height / width).toBeCloseTo(1 / Math.cos(40.7 * Math.PI / 180), 3);
  });

  it('draws closed SVG paths and measures projected bounds', () => {
    const feature = square(3, [0, 0], 1);
    const project = ([x, y]: Position): [number, number] => [x * 10, y * 10];
    expect(multiPolygonPath(feature.geometry.coordinates, project)).toBe('M0.0,0.0L10.0,0.0L10.0,10.0L0.0,10.0L0.0,0.0Z');
    expect(projectedBounds([feature.geometry.coordinates], project)).toEqual([0, 0, 10, 10]);
    expect(projectedBounds([], project)).toBeNull();
  });

  it('labels and orders school types', () => {
    expect(sectorColor('Charter')).not.toBe(sectorColor('District'));
    expect(sectorColor('Something new')).toMatch(/^#/);
    expect(levelGlyph('High school')).toBe('H');
    expect(sortLevels(['High school', 'Ungraded', 'Elementary', 'Middle'])).toEqual(['Elementary', 'Middle', 'High school', 'Ungraded']);
    expect(appleMapsUrl('P.S. 1 & Co', 40.7, -74)).toBe('https://maps.apple.com/?q=P.S.+1+%26+Co&ll=40.7%2C-74');
  });

  it('makes avatar initials', () => {
    expect(initials('App Reviewer')).toBe('AR');
    expect(initials('  Oskar  ')).toBe('O');
    expect(initials('Mary Ann de la Cruz')).toBe('MC');
    expect(initials('')).toBe('?');
  });
});
