import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, LogIn, MapPinned, ShieldCheck, Sparkles } from 'lucide-react';
import { ApiError, session } from './session';

export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return <span className={className} aria-hidden="true"><span /><span /><span /><span /></span>;
}

/** Email and password login, for the reviewer accounts the project owner hands out */
export function LoginPage({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = !submitting && email.trim() !== '' && password !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await session.logIn(email.trim(), password);
    } catch (e) {
      // The API's own wording, e.g. "Invalid email or password"
      setError(e instanceof ApiError ? e.message : 'Unable to reach SchoolScope. Check your connection and try again.');
      setSubmitting(false);
    }
  }

  return <div className="login-shell">
    <section className="login-brand" aria-label="About SchoolScope">
      <div className="brand"><BrandMark /><div><div className="brand-name">schoolscope<span className="brand-period">.</span></div><div className="brand-subtitle">PERFORMANCE INTELLIGENCE</div></div></div>
      <div className="login-pitch">
        <span className="eyebrow"><span className="eyebrow-line" /> REVIEWER PREVIEW</span>
        <h1>Every NYC school,<br /><em>one clear view.</em></h1>
        <p>Explore school performance trends and see every public school across New York City's 32 community school districts on Apple Maps.</p>
        <ul className="login-points">
          <li><MapPinned size={17} /> Real school locations from NYC Open Data</li>
          <li><Sparkles size={17} /> Interactive dashboard with fictional performance figures</li>
          <li><ShieldCheck size={17} /> Private reviewer accounts</li>
        </ul>
      </div>
      <div className="sidebar-small">React · TypeScript · Node.js · SQLite · MapKit JS</div>
    </section>

    <main className="login-main">
      <form className="login-card" onSubmit={submit} noValidate>
        <BrandMark className="brand-mark login-card-mark" />
        <h2>Log in</h2>
        <p className="login-lede">Use the reviewer account you were given.</p>

        {notice && !error && <div className="login-notice" role="status">{notice}</div>}
        {error && <div className="login-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}

        <label className="login-label" htmlFor="login-email">Email</label>
        <input id="login-email" className="login-input" type="email" autoComplete="username" inputMode="email" autoCapitalize="none" spellCheck={false}
          value={email} onChange={event => setEmail(event.target.value)} autoFocus required maxLength={254} />

        <label className="login-label" htmlFor="login-password">Password</label>
        <div className="login-password">
          <input id="login-password" className="login-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
            value={password} onChange={event => setPassword(event.target.value)} required maxLength={256} />
          <button type="button" className="login-reveal" onClick={() => setShowPassword(shown => !shown)}
            aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <button type="submit" className="login-submit" disabled={!canSubmit}>
          {submitting ? <span className="loading-spinner login-spinner" aria-hidden="true" /> : <LogIn size={17} />}
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
        <p className="login-help">No account? Ask the project owner for reviewer access.</p>
      </form>
      <p className="login-footer">Independent portfolio demonstration · Not affiliated with NYC Public Schools</p>
    </main>
  </div>;
}

/** Shown while the refresh cookie is checked on page load */
export function SessionSplash() {
  return <div className="session-splash" role="status"><BrandMark /><span className="loading-spinner" /> <span className="sr-only">Loading SchoolScope…</span></div>;
}
