import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, ArrowRight, ArrowUpRight, BarChart3, BookOpen,
  CheckCircle2, ChevronRight, Download, GraduationCap,
  Info, LayoutDashboard, MapPin, Menu, RotateCcw, School2, Search,
  Users, X,
} from 'lucide-react';
import { api } from './api';
import { downloadCSV, formatPercent, mean, scoreTone } from './utils';
import type { Filters, Metadata, SchoolRecord, Summary, Trend } from './types';

const INITIAL_FILTERS: Filters = {
  year: '2025-26', district: '', borough: '', search: '', sort: 'math_desc',
};

function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>;
}

function Sidebar({ mobileOpen, onClose }: { mobileOpen: boolean; onClose: () => void }) {
  return <>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={onClose} />}
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><BrandMark /><div><div className="brand-name">schoolscope<span className="brand-period">.</span></div><div className="brand-subtitle">PERFORMANCE INTELLIGENCE</div></div></div>
      <div className="sidebar-section-title">WORKSPACE</div>
      <nav className="nav-list" aria-label="Main navigation">
        <a className="nav-item active" href="#overview" onClick={onClose}><LayoutDashboard size={18} />Overview<span className="nav-indicator" /></a>
        <a className="nav-item" href="#school-directory" onClick={onClose}><School2 size={18} />School directory</a>
        <a className="nav-item" href="#insights" onClick={onClose}><BarChart3 size={18} />Performance insights</a>
      </nav>
      <div className="sidebar-section-title sidebar-section-secondary">ABOUT THIS DEMO</div>
      <div className="sidebar-explainer"><GraduationCap size={18} /><div><strong>Portfolio project</strong><span>Designed for an education-data web developer assessment.</span></div></div>
      <div className="sidebar-bottom">
        <div className="environment"><span className="environment-dot" /><div><strong>Demo environment</strong><span>Fictional data only</span></div></div>
        <div className="sidebar-small">React · TypeScript · Node.js<br />PostgreSQL · Docker</div>
      </div>
    </aside>
  </>;
}

function MetricCard({ title, value, caption, icon: Icon, color }: {
  title: string; value: string; caption: string; icon: typeof School2; color: 'blue' | 'teal' | 'violet' | 'orange';
}) {
  return <article className="metric-card">
    <div className="metric-top"><span className="metric-label">{title}</span><span className={`metric-icon ${color}`}><Icon size={19} strokeWidth={1.9}/></span></div>
    <div className="metric-value">{value}</div>
    <div className="metric-caption">{caption}</div>
  </article>;
}

function TrendChart({ trends }: { trends: Trend[] }) {
  const metrics = [
    { key: 'avg_math' as const, label: 'Mathematics', color: '#2563eb' },
    { key: 'avg_ela' as const, label: 'English Language Arts', color: '#16a085' },
  ];
  const x = (index: number) => trends.length <= 1 ? 286 : 88 + index * 395 / (trends.length - 1);
  const y = (value: number) => 182 - value * 1.45;
  const labelFor = (trend: Trend) => trend.school_year;
  return <>
    <div className="chart-legend"><span><i className="legend-dot blue-dot" />Math proficiency</span><span><i className="legend-dot teal-dot" />ELA proficiency</span></div>
    <div className="trend-graph">
      {trends.length === 0 ? <div className="chart-no-data">No trend data for these filters.</div> : <svg role="img" aria-label="Chart showing math and ELA average proficiency for school years" viewBox="0 0 570 224" preserveAspectRatio="xMidYMid meet">
        {[0, 25, 50, 75, 100].map(tick => <g key={tick}><line x1="68" x2="525" y1={y(tick)} y2={y(tick)} stroke="#e9edf4" strokeDasharray="4 5"/><text x="51" y={y(tick) + 4} textAnchor="end" fill="#8b96a9" fontSize="12">{tick}%</text></g>)}
        {trends.map((trend, index) => <text key={trend.school_year} x={x(index)} y="211" textAnchor="middle" fill="#7b8798" fontSize="12">{labelFor(trend)}</text>)}
        {metrics.map(metric => {
          const points = trends.map((trend, index) => ({ x: x(index), v: trend[metric.key] })).filter((p): p is { x: number; v: number } => p.v !== null);
          return <g key={metric.key}>
            {points.length > 1 && <polyline points={points.map(p => `${p.x},${y(p.v)}`).join(' ')} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
            {points.map((point, index) => <g key={index}><circle cx={point.x} cy={y(point.v)} r="6" fill="white" stroke={metric.color} strokeWidth="3"/><text x={point.x} y={y(point.v) - (metric.key === 'avg_math' ? 16 : -27)} textAnchor="middle" fontSize="12" fontWeight="700" fill={metric.color}>{point.v.toFixed(1)}%</text></g>)}
          </g>;
        })}
      </svg>}
    </div>
    <div className="chart-note"><Info size={14} /> Yearly averages across matching schools; not a matched-cohort growth measure.</div>
  </>;
}

function DistrictSnapshot({ schools }: { schools: SchoolRecord[] }) {
  const districts = useMemo(() => {
    const byDistrict = new Map<number, SchoolRecord[]>();
    for (const school of schools) byDistrict.set(school.district, [...(byDistrict.get(school.district) || []), school]);
    return [...byDistrict].map(([district, rows]) => ({ district, count: rows.length, score: mean(rows.map(r => r.math_pct)) }))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 5);
  }, [schools]);
  return <div className="district-list">
    {districts.length ? districts.map(item => <div className="district-line" key={item.district}>
      <div className="district-line-head"><span>District {item.district.toString().padStart(2, '0')} <small>· {item.count} {item.count === 1 ? 'school' : 'schools'}</small></span><strong>{formatPercent(item.score)}</strong></div>
      <div className="progress-track"><div className="progress-fill" style={{ width: `${item.score ?? 0}%` }} /></div>
    </div>) : <div className="chart-no-data">No districts to display.</div>}
    <p className="district-caption">Top 5 districts by visible math average</p>
  </div>;
}

function ScoreCell({ value }: { value: number | null }) {
  const tone = scoreTone(value);
  return <div className="score-cell"><span className={`score-pill ${tone}`}>{formatPercent(value)}</span><div className="score-mini-track"><span className={tone} style={{ width: `${value ?? 0}%` }} /></div></div>;
}

function StatLine({ label, current, previous }: { label: string; current: number | null; previous: number | null }) {
  const delta = current !== null && previous !== null ? current - previous : null;
  return <div className="detail-stat"><div><span>{label}</span><strong>{formatPercent(current)}</strong></div><div className="detail-stat-bottom"><span className="detail-meter"><span style={{width:`${current ?? 0}%`}} /></span><span className={delta === null ? 'muted' : delta >= 0 ? 'delta-positive' : 'delta-negative'}>{delta === null ? 'No comparison' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp vs prior year`}</span></div></div>;
}

function SchoolDetail({ dbn, onClose }: { dbn: string; onClose: () => void }) {
  const [history, setHistory] = useState<SchoolRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.history(dbn, controller.signal).then(data => setHistory(data.history)).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Cannot load school'); });
    closeRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => { controller.abort(); document.removeEventListener('keydown', handleEscape); document.body.style.overflow = ''; };
  }, [dbn, onClose]);
  const latest = history[0];
  const prior = history[1];
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="School performance details" className="detail-drawer">
      <div className="drawer-top"><div className="drawer-eyebrow">SCHOOL PROFILE</div><button ref={closeRef} className="icon-button" aria-label="Close school details" onClick={onClose}><X size={20}/></button></div>
      {error ? <div role="alert" className="error-box">{error}</div> : !latest ? <div className="drawer-loading" role="status">Loading school record…</div> : <>
        <div className="drawer-school-icon"><School2 size={28}/></div>
        <h2>{latest.school_name}</h2><div className="drawer-code">{latest.dbn}</div>
        <div className="detail-chips"><span><MapPin size={14}/>{latest.borough}</span><span>District {latest.district}</span><span>{history.length} reporting {history.length === 1 ? 'year' : 'years'}</span></div>
        <div className="detail-enrollment"><div><span>Enrollment · {latest.school_year}</span><strong>{latest.enrollment?.toLocaleString() ?? 'N/A'}</strong></div><Users size={24}/></div>
        <h3 className="detail-subhead">Academic performance</h3>
        <StatLine label="Mathematics proficiency" current={latest.math_pct} previous={prior?.math_pct ?? null} />
        <StatLine label="English Language Arts" current={latest.ela_pct} previous={prior?.ela_pct ?? null} />
        <StatLine label="Student attendance" current={latest.attendance_pct} previous={prior?.attendance_pct ?? null} />
        <h3 className="detail-subhead">Available reporting years</h3>
        <div className="history-years">{history.map(item => <div key={item.school_year}><span>{item.school_year}</span><span>{formatPercent(item.math_pct)} math</span></div>)}</div>
        <p className="drawer-disclaimer"><Info size={15}/> All schools, codes, and results in this portfolio project are fictional.</p>
      </>}
    </section>
  </div>;
}

function App() {
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [schools, setSchools] = useState<SchoolRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedDbn, setSelectedDbn] = useState<string | null>(null);
  const closeDetail = useCallback(() => setSelectedDbn(null), []);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => { const timer = window.setTimeout(() => setFilters(prev => prev.search === searchInput ? prev : { ...prev, search: searchInput }), 250); return () => clearTimeout(timer); }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    api.metadata(filters.year, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setMetadata(data); setMetadataError(false);
      setFilters(prev => {
        if (prev.year !== filters.year) return prev;
        const district = prev.district && !data.districts.includes(Number(prev.district)) ? '' : prev.district;
        const borough = prev.borough && !data.boroughs.includes(prev.borough) ? '' : prev.borough;
        return district === prev.district && borough === prev.borough ? prev : { ...prev, district, borough };
      });
    }).catch(() => { if (!controller.signal.aborted) setMetadataError(true); });
    return () => controller.abort();
  }, [filters.year, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    Promise.all([api.schools(filters, controller.signal), api.summary(filters, controller.signal), api.trends(filters, controller.signal)])
      .then(([schoolResult, summaryResult, trendResult]) => {
        if (controller.signal.aborted) return;
        setSchools(schoolResult.schools); setSummary(summaryResult); setTrends(trendResult.years);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setSchools([]); setSummary(null); setTrends([]);
        setError(e instanceof Error ? e.message : 'Unable to load school performance data');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, refreshKey]);

  function setField<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters(prev => ({ ...prev, [key]: value }));
  }
  function resetFilters() { setSearchInput(''); setFilters(prev => ({ ...INITIAL_FILTERS, year: prev.year })); }
  const isFiltered = Boolean(filters.district || filters.borough || filters.search || filters.sort !== 'math_desc');
  const loaded = !loading && !error;

  return <div className="app-shell" id="overview">
    <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
    <main className="main-content">
      <div className="topbar"><div className="breadcrumb"><button className="menu-toggle" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Menu size={22}/></button><span>Workspace</span><ChevronRight size={14}/><strong>Overview</strong></div><div className="topbar-right"><span className="demo-badge"><span /> DEMO ENVIRONMENT</span><span className="avatar">WD</span></div></div>
      <div className="content-wrap">
        <section className="hero">
          <div className="hero-topline"><span className="eyebrow"><span className="eyebrow-line" /> SCHOOL PERFORMANCE / ANALYTICS</span><span className="hero-pill"><CheckCircle2 size={14}/> Practice project</span></div>
          <div className="hero-layout"><div><h1>Make every school<br/><em>data point count.</em></h1><p>Explore school performance, spot trends, and turn reporting into actionable insights — all in one clear view.</p></div><div className="year-picker"><label htmlFor="year-select">ACADEMIC YEAR</label><div className="select-shell"><select id="year-select" value={filters.year} onChange={event => setField('year', event.target.value)}>{(metadata?.years ?? ['2025-26','2024-25']).map(year => <option key={year} value={year}>{year}</option>)}</select></div><span>School year reporting</span></div></div>
        </section>

        <section className="section-metrics" aria-label="Key performance indicators">
          <div className="section-heading"><div><h2>At a glance</h2><p>Metrics for the selected year and active filters</p></div><span className="live-indicator"><span />{loading ? 'Updating' : error ? 'Connection unavailable' : 'Live from PostgreSQL'}</span></div>
          <div className="metric-grid">
            <MetricCard title="Schools reporting" value={loaded ? (summary?.school_count ?? 0).toLocaleString() : '—'} caption={loaded ? `${summary?.enrolled_students.toLocaleString() ?? '0'} enrolled students` : 'Waiting for data'} icon={School2} color="blue"/>
            <MetricCard title="Avg. mathematics" value={loaded ? formatPercent(summary?.avg_math) : '—'} caption={loaded ? `${summary?.math_reporting ?? 0} schools with math scores` : 'Waiting for data'} icon={BarChart3} color="teal"/>
            <MetricCard title="Avg. ELA proficiency" value={loaded ? formatPercent(summary?.avg_ela) : '—'} caption={loaded ? `${summary?.ela_reporting ?? 0} schools with ELA scores` : 'Waiting for data'} icon={BookOpen} color="violet"/>
            <MetricCard title="Avg. attendance" value={loaded ? formatPercent(summary?.avg_attendance) : '—'} caption={loaded ? `${summary?.attendance_reporting ?? 0} schools with attendance` : 'Waiting for data'} icon={Users} color="orange"/>
          </div>
        </section>

        {error && <div className="error-banner" role="alert"><AlertCircle size={19}/><div><strong>Unable to load school data</strong><span>{error}. Please check that the API and database are running.</span></div><button onClick={() => setRefreshKey(key => key + 1)}>Try again <ArrowRight size={15}/></button></div>}
        {metadataError && !error && <p className="metadata-warning" role="status">Some filter options could not be refreshed. Existing data may still be available.</p>}

        <section id="insights" className="insights-section">
          <div className="section-heading"><div><h2>Performance insights</h2><p>Compare outcomes across reporting periods</p></div><div className="insight-stamp"><Activity size={15}/> Data overview</div></div>
          <div className="insights-grid">
            <article className="panel trend-panel"><div className="panel-header"><div><h3>Academic performance trend</h3><p>Average proficiency by academic year</p></div><span className="panel-symbol"><BarChart3 size={18}/></span></div>{loading ? <div className="panel-loading" role="status">Loading chart…</div> : error ? <div className="panel-loading">Data unavailable</div> : <TrendChart trends={trends}/>}</article>
            <article className="panel districts-panel"><div className="panel-header"><div><h3>District snapshot</h3><p>Mathematics proficiency · {filters.year}</p></div><span className="panel-symbol"><MapPin size={17}/></span></div>{loading ? <div className="panel-loading" role="status">Loading chart…</div> : <DistrictSnapshot schools={schools}/>}</article>
          </div>
        </section>

        <section id="school-directory" className="directory-section panel">
          <div className="directory-header"><div><h2>School directory</h2><p>Search, compare, and explore individual schools</p></div><button type="button" className="export-button" disabled={!loaded || schools.length === 0} onClick={() => downloadCSV(schools, filters.year)}><Download size={17}/> Export CSV</button></div>
          <div className="filter-panel">
            <div className="search-field"><Search size={19} aria-hidden="true"/><label className="sr-only" htmlFor="school-search">Search by school name or DBN</label><input id="school-search" type="search" placeholder="Search school name or DBN..." value={searchInput} onChange={e => setSearchInput(e.target.value)} maxLength={120}/></div>
            <div className="filter-input"><label htmlFor="district-filter">District</label><select id="district-filter" value={filters.district} onChange={e => setField('district', e.target.value)}><option value="">All districts</option>{(metadata?.districts ?? []).map(d => <option key={d} value={d}>District {d}</option>)}</select></div>
            <div className="filter-input"><label htmlFor="borough-filter">Borough</label><select id="borough-filter" value={filters.borough} onChange={e => setField('borough', e.target.value)}><option value="">All boroughs</option>{(metadata?.boroughs ?? []).map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div className="filter-input sort-filter"><label htmlFor="sort-filter">Sort by</label><select id="sort-filter" value={filters.sort} onChange={e => setField('sort', e.target.value as Filters['sort'])}><option value="math_desc">Math: highest first</option><option value="math_asc">Math: lowest first</option><option value="name_asc">Name: A to Z</option><option value="name_desc">Name: Z to A</option></select></div>
            <button className="reset-button" title="Reset all filters" disabled={!isFiltered && !searchInput} onClick={resetFilters}><RotateCcw size={17}/><span>Reset</span></button>
          </div>
          <div className="table-meta"><div><span className="table-count">{loaded ? schools.length : '—'}</span> {schools.length === 1 ? 'school' : 'schools'} shown <span className="table-year">· {filters.year}</span></div><div><span className="table-key-dot"/> Proficiency and attendance percentages</div></div>
          <div className="table-scroll"><table className="school-table"><thead><tr><th scope="col">School</th><th scope="col">District</th><th scope="col">Enrollment</th><th scope="col">Mathematics</th><th scope="col">ELA</th><th scope="col">Attendance</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>
            {!loading && !error && schools.map(row => <tr key={`${row.dbn}-${row.school_year}`}><td><button className="school-link" onClick={() => setSelectedDbn(row.dbn)}>{row.school_name}</button><span className="dbn-code">{row.dbn} · {row.borough}</span></td><td><span className="district-tag">D{row.district.toString().padStart(2,'0')}</span></td><td>{row.enrollment?.toLocaleString() ?? 'N/A'}</td><td><ScoreCell value={row.math_pct}/></td><td><ScoreCell value={row.ela_pct}/></td><td><span className="attendance-value">{formatPercent(row.attendance_pct)}</span></td><td><button className="row-detail" aria-label={`View ${row.school_name} details`} onClick={() => setSelectedDbn(row.dbn)}><ArrowUpRight size={18}/></button></td></tr>)}
          </tbody></table>
            {loading && <div className="table-state" role="status"><span className="loading-spinner"/> Fetching school performance data…</div>}
            {!loading && !error && schools.length === 0 && <div className="table-state empty-state"><Search size={25}/><strong>No matching schools</strong><span>Try changing the search or clearing your filters.</span><button onClick={resetFilters}>Clear filters</button></div>}
            {!loading && error && <div className="table-state">School data is temporarily unavailable.</div>}
          </div>
          <div className="table-footer"><div><Info size={15}/> Missing values display as N/A. Zero is a valid score.</div><span>Showing {loaded ? schools.length : 0} records</span></div>
        </section>

        <footer className="page-footer"><div><BrandMark/><span>SchoolScope · Independent educational portfolio demonstration</span></div><span>Fictional school data · Not affiliated with NYC Public Schools</span></footer>
      </div>
    </main>
    {selectedDbn && <SchoolDetail dbn={selectedDbn} onClose={closeDetail}/>}
  </div>;
}

export default App;
