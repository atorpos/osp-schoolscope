import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BadgeCheck, ExternalLink, Info, MapPin, Navigation, RotateCcw, School2, Search, Users, X } from 'lucide-react';
import { api } from './api';
import {
  appleMapsUrl, createProjection, levelGlyph, multiPolygonPath, projectedBounds, sectorColor, sortLevels,
} from './geo';
import { loadMapKit, onMapKitFailure } from './mapkit-loader';
import { ApiError } from './session';
import type { DistrictCollection, LocationFilters, LocationMetadata, SchoolLocation } from './types';

const EMPTY_FILTERS: LocationFilters = { district: '', borough: '', sector: '', level: '', search: '' };
/** Schools listed beside the map; the rest are on the map */
const LIST_LIMIT = 100;

const errorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

interface MapProps {
  schools: SchoolLocation[];
  boundaries: DistrictCollection | null;
  district: number | null;
  /** Whether any filter is on: the map then fits the matching schools */
  filtered: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onSelectDistrict: (district: number) => void;
}

// --- Apple Maps (MapKit JS) ---------------------------------------------------------------------

/** Maps already destroyed: React runs the map's own cleanup before those of the effects that use it */
const destroyedMaps = new WeakSet<mapkit.Map>();

const nycRegion = () => new mapkit.CoordinateRegion(new mapkit.Coordinate(40.705, -73.95), new mapkit.CoordinateSpan(0.42, 0.5));

function districtStyle(active: boolean): mapkit.Style {
  return new mapkit.Style({
    strokeColor: active ? '#1c577d' : '#5b7c99',
    strokeOpacity: active ? 0.95 : 0.55,
    lineWidth: active ? 2.5 : 1,
    fillColor: active ? '#2965db' : '#7fa7c9',
    fillOpacity: active ? 0.12 : 0.04,
  });
}

/** Clustered pins for every school, over the 32 district outlines; tapping a district filters to it */
function AppleSchoolMap({ schools, boundaries, district, filtered, selectedId, onSelect, onSelectDistrict, onFailure }: MapProps & { onFailure: (message: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<mapkit.Map | null>(null);
  const annotations = useRef(new Map<string, mapkit.MarkerAnnotation>());
  const overlays = useRef<mapkit.PolygonOverlay[]>([]);
  const callbacks = useRef({ onSelect, onSelectDistrict, onFailure });
  callbacks.current = { onSelect, onSelectDistrict, onFailure };

  useEffect(() => {
    if (!container.current) return;
    const created = new mapkit.Map(container.current, {
      region: nycRegion(),
      isRotationEnabled: false,
      showsCompass: mapkit.FeatureVisibility.Hidden,
      showsMapTypeControl: true,
      showsZoomControl: true,
      // Apple's own points of interest would compete with the school pins
      pointOfInterestFilter: (mapkit.PointOfInterestFilter as unknown as { excludingAllCategories: mapkit.PointOfInterestFilter }).excludingAllCategories,
      padding: new mapkit.Padding(12, 12, 12, 12),
    });
    created.annotationForCluster = (cluster: mapkit.Annotation) => {
      const marker = cluster as mapkit.MarkerAnnotation;
      marker.color = '#173d5e';
      marker.title = `${cluster.memberAnnotations.length} schools`;
      marker.subtitle = 'Zoom in to see each school';
      return marker;
    };
    created.addEventListener('select', event => {
      const id = (event.annotation?.data as { id?: string } | undefined)?.id;
      if (id) return callbacks.current.onSelect(id);
      if (event.annotation?.memberAnnotations?.length) {
        // A cluster: zoom in to its schools
        created.showItems(event.annotation.memberAnnotations, { animate: true, padding: new mapkit.Padding(60, 60, 60, 60) });
        return;
      }
      const tapped = (event.overlay?.data as { district?: number } | undefined)?.district;
      if (tapped) {
        created.selectedOverlay = null;
        callbacks.current.onSelectDistrict(tapped);
      }
    });
    created.addEventListener('deselect', event => {
      if ((event.annotation?.data as { id?: string } | undefined)?.id) callbacks.current.onSelect(null);
    });
    const stopListening = onMapKitFailure(message => callbacks.current.onFailure(message));
    setMap(created);
    return () => {
      stopListening();
      annotations.current.clear();
      overlays.current = [];
      destroyedMaps.add(created);
      created.destroy();
    };
  }, []);

  // District outlines
  useEffect(() => {
    if (!map || !boundaries) return;
    const created = boundaries.features.flatMap(feature => feature.geometry.coordinates.map(polygon => new mapkit.PolygonOverlay(
      polygon.map(ring => ring.map(([lng, lat]) => new mapkit.Coordinate(lat, lng))),
      { data: { district: feature.properties.district }, style: districtStyle(false) },
    )));
    map.addOverlays(created);
    overlays.current = created;
    return () => {
      if (destroyedMaps.has(map)) return;
      map.removeOverlays(created);
      overlays.current = [];
    };
  }, [map, boundaries]);

  // Pins: only the ones that changed are added or removed
  useEffect(() => {
    if (!map) return;
    const current = annotations.current;
    const wanted = new Set(schools.map(school => school.id));
    const removed: mapkit.MarkerAnnotation[] = [];
    for (const [id, annotation] of current) if (!wanted.has(id)) { removed.push(annotation); current.delete(id); }
    const added = schools.filter(school => !current.has(school.id)).map(school => {
      const annotation = new mapkit.MarkerAnnotation(new mapkit.Coordinate(school.latitude, school.longitude), {
        title: school.name,
        subtitle: `${school.level} · District ${school.district}${school.dbn ? ` · ${school.dbn}` : ''}`,
        color: sectorColor(school.sector),
        glyphText: levelGlyph(school.level),
        clusteringIdentifier: 'schools',
        data: { id: school.id },
      });
      current.set(school.id, annotation);
      return annotation;
    });
    if (removed.length) map.removeAnnotations(removed);
    if (added.length) map.addAnnotations(added);
  }, [map, schools]);

  // Highlight the chosen district, and fit the map to the district or the matching schools
  useEffect(() => {
    if (!map) return;
    const focus: mapkit.PolygonOverlay[] = [];
    for (const overlay of overlays.current) {
      const active = (overlay.data as { district: number }).district === district;
      overlay.style = districtStyle(active);
      if (active) focus.push(overlay);
    }
    const padding = new mapkit.Padding(40, 40, 40, 40);
    const matching = schools
      .map(school => annotations.current.get(school.id))
      .filter((annotation): annotation is mapkit.MarkerAnnotation => annotation !== undefined);
    if (focus.length) map.showItems(focus, { animate: true, padding });
    else if (filtered && matching.length) map.showItems(matching, { animate: true, padding, minimumSpan: new mapkit.CoordinateSpan(0.02, 0.02) });
    else map.setRegionAnimated(nycRegion(), true);
  }, [map, district, schools, boundaries, filtered]);

  // A school chosen in the list: zoom to it and open its callout
  useEffect(() => {
    if (!map) return;
    const annotation = selectedId ? annotations.current.get(selectedId) : undefined;
    if (annotation && !annotation.selected) {
      map.setRegionAnimated(new mapkit.CoordinateRegion(annotation.coordinate, new mapkit.CoordinateSpan(0.012, 0.014)), true);
      annotation.selected = true;
    } else if (!annotation && map.selectedAnnotation) {
      map.selectedAnnotation.selected = false;
    }
  }, [map, selectedId, schools]);

  return <div ref={container} className="map-canvas" aria-label="Apple Maps view of NYC schools" />;
}

/** Keeps an Apple Maps failure from taking down the dashboard: the section switches to the simplified map */
class MapErrorBoundary extends Component<{ onError: (message: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Apple Maps failed:', error);
    this.props.onError('Apple Maps stopped working');
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// --- Simplified map (no MapKit key) -------------------------------------------------------------

/** The same data drawn as SVG: district outlines and one dot per school */
function SchematicSchoolMap({ schools, boundaries, district, selectedId, onSelect, onSelectDistrict }: MapProps) {
  const projection = useMemo(() => (boundaries ? createProjection(boundaries.features) : null), [boundaries]);
  const paths = useMemo(() => (projection && boundaries
    ? boundaries.features.map(feature => ({ feature, d: multiPolygonPath(feature.geometry.coordinates, projection.project) }))
    : []), [projection, boundaries]);
  if (!projection || !boundaries) return <div className="map-placeholder" role="status">Loading map…</div>;

  const focus = district ? boundaries.features.filter(feature => feature.properties.district === district) : [];
  const box = focus.length ? projectedBounds(focus.map(feature => feature.geometry.coordinates), projection.project) : null;
  const viewBox = box
    ? (() => {
      const margin = Math.max(box[2], box[3]) * 0.12 + 10;
      return [box[0] - margin, box[1] - margin, box[2] + 2 * margin, box[3] + 2 * margin];
    })()
    : [0, 0, projection.width, projection.height];
  // Keep dots the same size on screen when zoomed in
  const zoom = projection.width / viewBox[2];
  const radius = Math.max(2.2, 3.4 / Math.sqrt(zoom)) / Math.sqrt(zoom);

  return <svg className="schematic-map" viewBox={viewBox.map(value => value.toFixed(1)).join(' ')} preserveAspectRatio="xMidYMid meet"
    role="img" aria-label={`Map of New York City's community school districts with ${schools.length} schools`}>
    <g className="schematic-districts">
      {paths.map(({ feature, d }) => <path key={feature.properties.district} d={d} fillRule="evenodd"
        className={feature.properties.district === district ? 'active' : undefined} strokeWidth={1.1 / zoom}
        onClick={() => onSelectDistrict(feature.properties.district)}>
        <title>{`District ${feature.properties.district} · ${feature.properties.borough ?? ''}`}</title>
      </path>)}
    </g>
    <g className="schematic-schools">
      {schools.map(school => {
        const [x, y] = projection.project([school.longitude, school.latitude]);
        const selected = school.id === selectedId;
        return <circle key={school.id} cx={x} cy={y} r={selected ? radius * 2.6 : radius} fill={sectorColor(school.sector)}
          className={selected ? 'selected' : undefined} strokeWidth={(selected ? 2 : 0.6) / zoom} onClick={() => onSelect(school.id)}>
          <title>{`${school.name} · ${school.level}`}</title>
        </circle>;
      })}
    </g>
    <g className="schematic-labels" aria-hidden="true">
      {boundaries.features.map(feature => {
        if (!feature.properties.label) return null;
        const [x, y] = projection.project(feature.properties.label);
        return <text key={feature.properties.district} x={x} y={y} fontSize={13 / zoom} textAnchor="middle" dominantBaseline="central">
          {feature.properties.district}
        </text>;
      })}
    </g>
  </svg>;
}

// --- Section ------------------------------------------------------------------------------------

function SchoolLocationCard({ school, onClose }: { school: SchoolLocation; onClose: () => void }) {
  return <div className="map-card">
    <div className="map-card-top">
      <span className="map-card-icon" style={{ color: sectorColor(school.sector) }}><School2 size={22} /></span>
      <button className="icon-button" aria-label="Close school details" onClick={onClose}><X size={18} /></button>
    </div>
    <h3>{school.name}</h3>
    <div className="drawer-code">{school.dbn ?? 'DBN not listed'}</div>
    <div className="detail-chips">
      <span><MapPin size={13} />{school.borough}</span>
      <span>District {school.district}</span>
      <span>{school.level}</span>
      <span><i className="legend-dot" style={{ background: sectorColor(school.sector) }} />{school.sector}</span>
    </div>
    <dl className="map-card-facts">
      <div><dt>Address</dt><dd>{school.address ?? 'Not listed'}{school.zip ? `, NY ${school.zip}` : ''}</dd></div>
      <div><dt><Users size={13} /> Capacity</dt><dd>{school.capacity ? `${school.capacity.toLocaleString()} seats` : 'Not listed'}</dd></div>
      <div><dt>Coordinates</dt><dd>{school.latitude.toFixed(5)}, {school.longitude.toFixed(5)}</dd></div>
    </dl>
    <a className="map-card-link" href={appleMapsUrl(school.name, school.latitude, school.longitude)} target="_blank" rel="noopener noreferrer">
      <Navigation size={15} /> Open in Apple Maps <ExternalLink size={13} />
    </a>
  </div>;
}

export function SchoolMapSection() {
  const [metadata, setMetadata] = useState<LocationMetadata | null>(null);
  const [boundaries, setBoundaries] = useState<DistrictCollection | null>(null);
  const [filters, setFilters] = useState<LocationFilters>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [schools, setSchools] = useState<SchoolLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapMode, setMapMode] = useState<{ kind: 'loading' | 'apple' | 'schematic'; notice?: string }>({ kind: 'loading' });

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(prev => (prev.search === searchInput ? prev : { ...prev, search: searchInput })), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([api.locationMetadata(controller.signal), api.districtBoundaries(controller.signal)])
      .then(([meta, geo]) => { setMetadata(meta); setBoundaries(geo); })
      .catch((e: unknown) => { if (!controller.signal.aborted) setError(errorMessage(e, 'Unable to load the map data')); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.locations(filters, controller.signal)
      .then(result => { if (!controller.signal.aborted) setSchools(result.schools); })
      .catch((e: unknown) => { if (!controller.signal.aborted) { setSchools([]); setError(errorMessage(e, 'Unable to load schools')); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, refreshKey]);

  // Apple Maps when the server has a MapKit key, otherwise the simplified map
  useEffect(() => {
    let cancelled = false;
    loadMapKit()
      .then(() => { if (!cancelled) setMapMode({ kind: 'apple' }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        const notice = e instanceof ApiError && e.status === 503
          ? 'Apple Maps isn’t set up on this server yet, so this is a simplified map of the same schools.'
          : `${errorMessage(e, 'Apple Maps is unavailable')}. Showing a simplified map of the same schools.`;
        setMapMode({ kind: 'schematic', notice });
      });
    return () => { cancelled = true; };
  }, []);

  // A school filtered out of the results is no longer selected
  useEffect(() => {
    if (selectedId && !loading && !schools.some(school => school.id === selectedId)) setSelectedId(null);
  }, [schools, selectedId, loading]);

  const district = filters.district ? Number(filters.district) : null;
  const selected = schools.find(school => school.id === selectedId) ?? null;
  const districtOptions = (metadata?.districts ?? []).filter(option => !filters.borough || option.borough === filters.borough);
  const sectorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const school of schools) counts.set(school.sector, (counts.get(school.sector) ?? 0) + 1);
    return counts;
  }, [schools]);
  const isFiltered = Boolean(filters.district || filters.borough || filters.sector || filters.level || filters.search);
  const facilities = metadata?.source.datasets?.find(dataset => dataset.id === 'ji82-xba5');

  function setField<K extends keyof LocationFilters>(key: K, value: LocationFilters[K]) {
    setFilters(prev => {
      const next = { ...prev, [key]: value };
      // A district in another borough would match nothing
      if (key === 'borough' && value && prev.district) {
        const chosen = metadata?.districts.find(option => option.district === Number(prev.district));
        if (chosen && chosen.borough !== value) next.district = '';
      }
      return next;
    });
  }
  function selectDistrict(value: number) {
    setFilters(prev => {
      const chosen = metadata?.districts.find(option => option.district === value);
      const toggledOff = prev.district === String(value);
      return { ...prev, district: toggledOff ? '' : String(value), borough: chosen && prev.borough && chosen.borough !== prev.borough ? '' : prev.borough };
    });
  }
  function fallBack(message: string) {
    setMapMode({ kind: 'schematic', notice: `${message}. Showing a simplified map of the same schools.` });
  }
  function reset() {
    setSearchInput('');
    setFilters(EMPTY_FILTERS);
    setSelectedId(null);
  }

  const mapProps: MapProps = { schools, boundaries, district, filtered: isFiltered, selectedId, onSelect: setSelectedId, onSelectDistrict: selectDistrict };

  return <section id="school-map" className="map-section panel">
    <div className="directory-header">
      <div><h2>School map</h2><p>Every NYC public school across the 32 community school districts</p></div>
      <span className="real-data-badge"><BadgeCheck size={15} /> Real locations · NYC Open Data</span>
    </div>

    <div className="filter-panel">
      <div className="search-field"><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="map-search">Search schools by name, DBN or address</label>
        <input id="map-search" type="search" placeholder="Search name, DBN or address..." value={searchInput} onChange={e => setSearchInput(e.target.value)} maxLength={120} /></div>
      <div className="filter-input"><label htmlFor="map-district">District</label>
        <select id="map-district" value={filters.district} onChange={e => setField('district', e.target.value)}>
          <option value="">All 32 districts</option>
          {districtOptions.map(option => <option key={option.district} value={option.district}>District {option.district} · {option.borough}</option>)}
        </select></div>
      <div className="filter-input"><label htmlFor="map-borough">Borough</label>
        <select id="map-borough" value={filters.borough} onChange={e => setField('borough', e.target.value)}>
          <option value="">All boroughs</option>
          {(metadata?.boroughs ?? []).map(borough => <option key={borough} value={borough}>{borough}</option>)}
        </select></div>
      <div className="filter-input"><label htmlFor="map-sector">School type</label>
        <select id="map-sector" value={filters.sector} onChange={e => setField('sector', e.target.value)}>
          <option value="">All types</option>
          {(metadata?.sectors ?? []).map(sector => <option key={sector.name} value={sector.name}>{sector.name}</option>)}
        </select></div>
      <div className="filter-input"><label htmlFor="map-level">Grade level</label>
        <select id="map-level" value={filters.level} onChange={e => setField('level', e.target.value)}>
          <option value="">All levels</option>
          {sortLevels(metadata?.levels ?? []).map(level => <option key={level} value={level}>{level}</option>)}
        </select></div>
      <button className="reset-button" title="Reset map filters" disabled={!isFiltered && !searchInput} onClick={reset}><RotateCcw size={17} /><span>Reset</span></button>
    </div>

    <div className="table-meta">
      <div><span className="table-count">{loading ? '—' : schools.length.toLocaleString()}</span> of {metadata?.total.toLocaleString() ?? '—'} schools shown
        {district && <span className="table-year"> · District {district}</span>}</div>
      <div className="map-legend" aria-label="Legend">
        {(metadata?.sectors ?? []).map(sector => <span key={sector.name}><i className="legend-dot" style={{ background: sectorColor(sector.name) }} />
          {sector.name} <small>{(sectorCounts.get(sector.name) ?? 0).toLocaleString()}</small></span>)}
      </div>
    </div>

    {error && <div className="error-banner map-error" role="alert"><Info size={18} /><div><strong>Unable to load the map</strong><span>{error}</span></div>
      <button onClick={() => setRefreshKey(key => key + 1)}>Try again</button></div>}

    <div className="map-layout">
      <div className="map-stage">
        {mapMode.kind === 'apple'
          ? <MapErrorBoundary onError={fallBack}><AppleSchoolMap {...mapProps} onFailure={fallBack} /></MapErrorBoundary>
          : mapMode.kind === 'schematic' ? <SchematicSchoolMap {...mapProps} /> : <div className="map-placeholder" role="status">Loading map…</div>}
        {loading && mapMode.kind !== 'loading' && <span className="map-updating" role="status"><span className="loading-spinner" /> Updating</span>}
      </div>
      <aside className="map-details" aria-label="Schools on the map">
        {selected ? <SchoolLocationCard school={selected} onClose={() => setSelectedId(null)} /> : <>
          <div className="map-list-head"><strong>{district ? `District ${district}` : 'Matching schools'}</strong>
            <span>{schools.length > LIST_LIMIT ? `First ${LIST_LIMIT} · narrow the filters to see others` : 'Select a school to see details'}</span></div>
          <ul className="map-list">
            {schools.slice(0, LIST_LIMIT).map(school => <li key={school.id}>
              <button onClick={() => setSelectedId(school.id)}>
                <i className="legend-dot" style={{ background: sectorColor(school.sector) }} />
                <span><strong>{school.name}</strong><small>{school.level} · District {school.district}{school.dbn ? ` · ${school.dbn}` : ''}</small></span>
              </button>
            </li>)}
          </ul>
          {!loading && !error && schools.length === 0 && <div className="table-state empty-state"><Search size={22} /><strong>No matching schools</strong>
            <button onClick={reset}>Clear filters</button></div>}
        </>}
      </aside>
    </div>

    {mapMode.notice && <div className="map-notice" role="note"><Info size={15} /> {mapMode.notice}</div>}
    <div className="table-footer map-source">
      <div><Info size={15} /> Locations: <a href={facilities?.url ?? 'https://data.cityofnewyork.us/d/ji82-xba5'} target="_blank" rel="noopener noreferrer">NYC Facilities Database</a>
        {facilities?.dataUpdatedAt ? ` (updated ${new Date(facilities.dataUpdatedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })})` : ''}
        {' '}· District boundaries: NYC Department of City Planning · DBNs: DOE 2019–20 school locations</div>
      <span>{metadata ? `${metadata.withDbn.toLocaleString()} of ${metadata.total.toLocaleString()} with a DBN` : ''}</span>
    </div>
  </section>;
}
