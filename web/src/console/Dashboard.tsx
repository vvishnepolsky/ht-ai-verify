import { useEffect, useState } from 'react';
import { api, REQUEST_STATUS_LABELS, requestTone, type Config, type RequestStatus, type RequestSummary } from '../api';
import { formatRelativeTime } from '../format';
import { Pill, go } from './ui';

interface Stats {
  households: number;
  providers: number;
  awaiting_review: number;
  verified: number;
  queue: (RequestSummary & { case_id: string; kind: 'household' | 'provider'; subject_name: string })[];
}

export function Dashboard({ config }: { config: Config }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Stats>('/api/stats')
      .then(setStats)
      .catch(() => setError('Failed to load statistics. Refresh or contact support.'));
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My work</h1>
          <p className="sub">Verification requests for {config.agencyName} households and Medicaid providers.</p>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="stats">
        <Stat label="Households" value={stats?.households} />
        <Stat label="Providers" value={stats?.providers} />
        <Stat label="Awaiting review" value={stats?.awaiting_review} />
        <Stat label="Verified" value={stats?.verified} />
      </div>
      <div className="card flush">
        <div className="cake">
          <h2>Verifications awaiting review</h2>
        </div>
        <div className="table-wrap">
          <table aria-label="Verifications awaiting review">
            <thead>
              <tr>
                <th scope="col">Subject</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Progress</th>
                <th scope="col">AI flags</th>
                <th scope="col">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {(stats?.queue ?? []).map((r) => (
                <tr
                  key={r.id}
                  className="row"
                  tabIndex={0}
                  onClick={() => go(`#/${r.kind === 'household' ? 'households' : 'providers'}/${r.case_id}`)}
                  onKeyDown={(e) => e.key === 'Enter' && go(`#/${r.kind === 'household' ? 'households' : 'providers'}/${r.case_id}`)}
                >
                  <td>
                    <div className="name">{r.subject_name}</div>
                  </td>
                  <td className="muted">{r.kind === 'household' ? 'Household' : 'Provider'}</td>
                  <td>
                    <Pill tone={requestTone(r.status as RequestStatus)}>{REQUEST_STATUS_LABELS[r.status as RequestStatus]}</Pill>
                  </td>
                  <td className="muted num">
                    {r.approved_count}/{r.task_count} approved
                  </td>
                  <td>{r.flagged_count > 0 ? <Pill tone="warning">{r.flagged_count} flagged</Pill> : <span className="muted">—</span>}</td>
                  <td className="muted">{formatRelativeTime(r.submitted_at)}</td>
                </tr>
              ))}
              {stats && stats.queue.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    Nothing awaiting review — all caught up.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value ?? '—'}</div>
    </div>
  );
}
