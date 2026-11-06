import { useState } from 'react';
import { api, type Config } from '../api';
import { Dialog, go } from './ui';

/** Demo settings — reseed the synthetic cases and see what this deployment has wired up. */
export function DemoSettings({ config }: { config: Config }) {
  const [confirm, setConfirm] = useState<'reseed' | 'append' | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: 'reseed' | 'append') {
    setBusy(true);
    setError(null);
    try {
      const out =
        kind === 'reseed'
          ? await api<{ seeded: number }>('/api/demo/reset', { method: 'POST', body: { confirm: 'RESET' } })
          : await api<{ seeded: number }>('/api/demo/seed', { method: 'POST' });
      setNotice(kind === 'reseed' ? `Everything was cleared and ${out.seeded} demo cases were seeded.` : `${out.seeded} demo cases were added.`);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    ['AI document review', config.integrations.ai],
    ['SMS (household links)', config.integrations.sms],
    ['Email (provider links)', config.integrations.email],
    ['CLEAR identity', config.integrations.clear],
    ['CLEAR coverage discovery (demo overlay)', config.clearDemoCoverage ? config.clearDemoCoverage.summary : 'off'],
    ['Argyle payroll & bank', config.integrations.argyle],
    ['CMS NPI Registry', config.integrations.nppes],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Demo settings</h1>
          <p className="sub">Reset the synthetic data and check what this deployment has connected.</p>
        </div>
      </div>
      {notice && (
        <div className="alert success">
          {notice}{' '}
          <button type="button" className="link-btn" onClick={() => go('#/')}>
            Go to dashboard
          </button>
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      <div className="card">
        <div className="cake">
          <div>
            <h2>Demo data</h2>
            <div className="meta">Seven synthetic cases: three households and four Medicaid providers, including the two live-contact test cases (Vadim Vishnepolsky).</div>
          </div>
        </div>
        <div className="card-body stack">
          <div className="two-col">
            <div className="panel">
              <div className="strong">Reseed everything</div>
              <p className="muted small">Deletes every case, verification request, uploaded file and secure link, then seeds the demo set fresh. Links already texted or emailed stop working.</p>
              <div>
                <button type="button" className="btn danger" disabled={busy} onClick={() => setConfirm('reseed')}>
                  Reseed everything
                </button>
              </div>
            </div>
            <div className="panel">
              <div className="strong">Add the demo cases again</div>
              <p className="muted small">Keeps what is there and adds another copy of the demo set. Useful to get an untouched case without losing one you are mid-way through.</p>
              <div>
                <button type="button" className="btn outline" disabled={busy} onClick={() => setConfirm('append')}>
                  Add demo cases
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card flush">
        <div className="cake">
          <div>
            <h2>Integrations on this deployment</h2>
            <div className="meta">Set in the hosting environment, not here. "simulated" means the step runs a labelled stand-in; "off" means the console shows the link for manual sharing.</div>
          </div>
        </div>
        <table>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td className="muted">{v}</td>
              </tr>
            ))}
            <tr>
              <td>Public URL</td>
              <td className="muted">{config.publicUrl}</td>
            </tr>
            <tr>
              <td>Agency / state</td>
              <td className="muted">
                {config.agencyName} · {config.stateCode}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {confirm && (
        <Dialog
          title={confirm === 'reseed' ? 'Reseed everything?' : 'Add the demo cases again?'}
          description={confirm === 'reseed' ? 'All current cases, uploads and secure links are permanently deleted before the demo set is seeded.' : 'Another copy of the demo set is added. Nothing is deleted.'}
          onClose={() => setConfirm(null)}
          narrow
        >
          <div className="foot">
            <button type="button" className="btn outline" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className={`btn ${confirm === 'reseed' ? 'danger' : 'primary'}`} disabled={busy} onClick={() => void run(confirm)}>
              {busy ? 'Working…' : confirm === 'reseed' ? 'Reseed everything' : 'Add demo cases'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
