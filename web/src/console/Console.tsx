import { useCallback, useEffect, useState } from 'react';
import { api, getAdminKey, setAdminKey, type Config } from '../api';
import { Glyph, I, go, useHashRoute } from './ui';
import { Dashboard } from './Dashboard';
import { CaseList } from './CaseList';
import { CaseDetail } from './CaseDetail';
import { DemoSettings } from './DemoSettings';

export function Console() {
  const [config, setConfig] = useState<Config | null>(null);
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hash = useHashRoute();

  const checkAuth = useCallback(async () => {
    try {
      await api('/api/stats');
      setAuthed(true);
      setError(null);
    } catch {
      setAuthed(false);
      setError(getAdminKey() ? 'That password was not accepted.' : null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const cfg = await api<Config>('/api/config');
      setConfig(cfg);
      if (!cfg.authRequired) setAuthed(true);
      else await checkAuth();
    })();
  }, [checkAuth]);

  if (!config) return <div className="auth muted">Loading…</div>;
  if (!authed) {
    return (
      <Login
        config={config}
        error={error}
        onSubmit={async (pw) => {
          setAdminKey(pw);
          await checkAuth();
        }}
      />
    );
  }

  const detail = /^#\/(households|providers)\/([0-9a-f-]{36})$/i.exec(hash);
  const section = hash.startsWith('#/households') ? 'households' : hash.startsWith('#/providers') ? 'providers' : hash.startsWith('#/demo') ? 'demo' : 'dashboard';

  return (
    <div className="shell">
      <header className="cmdbar">
        <a className="brand" href="#/">
          <Glyph />
          <span className="brand-name">{config.agencyName}</span>
          <span className="brand-role">AI Verify · Worker console</span>
        </a>
        <div className="right">
          <span className="who">Eligibility & enrollment</span>
          {config.authRequired && (
            <button
              type="button"
              className="btn-ink"
              onClick={() => {
                setAdminKey('');
                setAuthed(false);
              }}
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <div className="body">
        <aside className="sidebar" aria-label="Main navigation">
          <nav>
            <a className={`nav-link${section === 'dashboard' ? ' active' : ''}`} href="#/">
              <I.Grid /> Dashboard
            </a>
            <div className="nav-group">Verifications</div>
            <a className={`nav-link${section === 'households' ? ' active' : ''}`} href="#/households">
              <I.Users /> Households
            </a>
            <a className={`nav-link${section === 'providers' ? ' active' : ''}`} href="#/providers">
              <I.Stetho /> Medicaid providers
            </a>
            <div className="nav-group">Settings</div>
            <a className={`nav-link${section === 'demo' ? ' active' : ''}`} href="#/demo">
              <I.Docs /> Demo settings
            </a>
          </nav>
        </aside>
        <main className="content">
          {detail ? (
            <CaseDetail id={detail[2] as string} config={config} />
          ) : section === 'households' ? (
            <CaseList key="household" kind="household" config={config} />
          ) : section === 'providers' ? (
            <CaseList key="provider" kind="provider" config={config} />
          ) : section === 'demo' ? (
            <DemoSettings config={config} />
          ) : (
            <Dashboard config={config} />
          )}
        </main>
      </div>
    </div>
  );
}

function Login({ config, error, onSubmit }: { config: Config; error: string | null; onSubmit: (pw: string) => Promise<void> }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-hero">
          <Glyph />
          <div>
            <div className="title">AI Verify</div>
            <div className="tagline">{config.agencyName} verification console</div>
          </div>
        </div>
        <div className="auth-form">
          <div className="intro">
            <h1>Worker sign in</h1>
            <p>Enter the console password to continue.</p>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              await onSubmit(pw);
              setBusy(false);
            }}
          >
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            <label className="field">
              Password
              <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </label>
            <button className="btn primary block" disabled={busy || !pw}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
