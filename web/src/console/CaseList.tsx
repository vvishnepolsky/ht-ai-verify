import { useEffect, useState } from 'react';
import { api, REQUEST_STATUS_LABELS, requestTone, type CaseKind, type CaseRecord, type Config, type HouseholdCase, type ProviderCase } from '../api';
import { formatDate, formatRelativeTime } from '../format';
import { Pill, go } from './ui';
import { NewHouseholdDialog } from './NewHouseholdDialog';
import { NewProviderDialog } from './NewProviderDialog';

type Filter = 'all' | 'not_sent' | 'open' | 'review' | 'verified';

export function CaseList({ kind, config }: { kind: CaseKind; config: Config }) {
  const [cases, setCases] = useState<CaseRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const household = kind === 'household';

  const load = () => api<{ cases: CaseRecord[] }>(`/api/cases?kind=${kind}`).then((r) => setCases(r.cases));
  useEffect(() => {
    // Drop the previous kind's rows before loading: rendering household rows
    // through the provider branch (or vice versa) for a frame throws.
    setCases(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const filtered = (cases ?? []).filter((c) => {
    const s = c.request?.status;
    switch (filter) {
      case 'not_sent':
        return !s;
      case 'open':
        return s === 'sent' || s === 'in_progress' || s === 'returned';
      case 'review':
        return s === 'submitted' || s === 'under_review';
      case 'verified':
        return s === 'verified';
      default:
        return true;
    }
  });
  const count = (f: Filter) =>
    (cases ?? []).filter((c) => {
      const s = c.request?.status;
      return f === 'all' || (f === 'not_sent' && !s) || (f === 'open' && (s === 'sent' || s === 'in_progress' || s === 'returned')) || (f === 'review' && (s === 'submitted' || s === 'under_review')) || (f === 'verified' && s === 'verified');
    }).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{household ? 'Households' : 'Medicaid providers'}</h1>
          <p className="sub">
            {household
              ? 'Applications that need identity, income, asset and housing verifications. Links go out by text message.'
              : 'Enrollment and credentialing applications that need identity, license and credential verifications. Links go out by email.'}
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setCreating(true)}>
            {household ? 'New household case' : 'New provider'}
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(
          [
            ['all', 'All'],
            ['not_sent', 'Not yet sent'],
            ['open', 'Waiting on them'],
            ['review', 'Ready to review'],
            ['verified', 'Verified'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {label} <span className="count">{count(f)}</span>
          </button>
        ))}
      </div>

      <div className="card flush">
        <div className="table-wrap">
          <table aria-label={household ? 'Households' : 'Providers'}>
            <thead>
              <tr>
                <th scope="col">{household ? 'Household' : 'Provider'}</th>
                <th scope="col">{household ? 'Programs' : 'NPI'}</th>
                <th scope="col">{household ? 'Members' : 'Type'}</th>
                <th scope="col">Verification</th>
                <th scope="col">Progress</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const d = c.data;
                const path = `#/${household ? 'households' : 'providers'}/${c.id}`;
                return (
                  <tr key={c.id} className="row" tabIndex={0} onClick={() => go(path)} onKeyDown={(e) => e.key === 'Enter' && go(path)}>
                    <td>
                      <div className="name">{c.subject_name}</div>
                      <div className="sub">
                        {d.case_number} · {household ? `applied ${formatDate((d as HouseholdCase).applied_at)}` : `${(d as ProviderCase).enrollment.application_type} · ${formatDate((d as ProviderCase).enrollment.submitted_at)}`}
                      </div>
                    </td>
                    <td className="muted">{household ? (d as HouseholdCase).programs.join(', ') : <code className="inline">{(d as ProviderCase).npi}</code>}</td>
                    <td className="muted">{household ? `${(d as HouseholdCase).members.length} · ${(d as HouseholdCase).address.city}, ${(d as HouseholdCase).address.state}` : (d as ProviderCase).provider_type}</td>
                    <td>{c.request ? <Pill tone={requestTone(c.request.status)}>{REQUEST_STATUS_LABELS[c.request.status]}</Pill> : <Pill tone="neutral">Not sent</Pill>}</td>
                    <td className="muted num">
                      {c.request ? (
                        <>
                          {c.request.provided_count}/{c.request.task_count} provided
                          {c.request.flagged_count > 0 && (
                            <>
                              {' '}
                              · <span style={{ color: 'var(--ht-amber-text)' }}>{c.request.flagged_count} flagged</span>
                            </>
                          )}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="muted">{formatRelativeTime(c.request?.updated_at ?? c.updated_at)}</td>
                  </tr>
                );
              })}
              {cases && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty">
                    No {household ? 'households' : 'providers'} here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {creating && household && (
        <NewHouseholdDialog
          config={config}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            go(`#/households/${c.id}`);
          }}
        />
      )}
      {creating && !household && (
        <NewProviderDialog
          config={config}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            go(`#/providers/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
