/**
 * Case detail hub — household or provider. Tabs: Case data | Verifications |
 * Activity. The Verifications tab shows the derived checklist before a link
 * is sent and the live review afterwards.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  CATEGORY_LABELS,
  METHOD_LABELS,
  REQUEST_STATUS_LABELS,
  requestTone,
  type CaseRecord,
  type Config,
  type Delivery,
  type HouseholdCase,
  type NpiVerification,
  type ProviderCase,
  type VerificationRequest,
  type VerificationTask,
} from '../api';
import { daysUntil, formatDate, formatDateTime, formatPhone, money } from '../format';
import { CopyBox, Dialog, I, Pill, go } from './ui';
import { NpiPanel, ReviewPanel, groupTasks } from './ReviewPanel';
import { ContactDialog } from './ContactDialog';
import { NpiFix } from './NpiFix';

type Tab = 'case' | 'verifications' | 'activity';

interface Loaded {
  case: CaseRecord;
  tasks_preview: VerificationTask[];
  requests: VerificationRequest[];
}

export function CaseDetail({ id, config }: { id: string; config: Config }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [tab, setTab] = useState<Tab>('verifications');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [npiBusy, setNpiBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Loaded>(`/api/cases/${id}`));
      setError(null);
    } catch {
      setError('This case could not be loaded.');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // Light polling while the hosted side is active so uploads + AI verdicts appear without a refresh.
  const active = data?.requests[0];
  const live = active && active.status !== 'verified';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), 6000);
    return () => clearInterval(t);
  }, [live, load]);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const c = data.case;
  const household = c.kind === 'household';
  const request = data.requests.find((r) => r.status !== 'verified') ?? data.requests[0] ?? null;
  const listPath = household ? '#/households' : '#/providers';
  // Once the applicant submits, the link has done its job; a resend would only
  // reopen a checklist that is already under review. Return for corrections
  // mints and sends the new link instead.
  const submitted = request?.status === 'submitted' || request?.status === 'under_review';

  async function send() {
    setSending(true);
    setError(null);
    try {
      const out = await api<{ request: VerificationRequest; delivery: Delivery }>(`/api/cases/${id}/send`, { method: 'POST' });
      setDelivery(out.delivery);
      await load();
      setTab('verifications');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the link.');
    } finally {
      setSending(false);
    }
  }
  async function resend() {
    if (!request) return;
    setSending(true);
    try {
      const out = await api<{ request: VerificationRequest; delivery: Delivery }>(`/api/requests/${request.id}/resend`, { method: 'POST' });
      setDelivery(out.delivery);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the link.');
    } finally {
      setSending(false);
    }
  }
  async function runNpi() {
    setNpiBusy(true);
    try {
      await api(`/api/cases/${id}/npi-check`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? `NPI Registry check failed: ${e.message}` : 'NPI Registry check failed.');
    } finally {
      setNpiBusy(false);
    }
  }

  const contact = household ? (c.data as HouseholdCase).primary_contact : (c.data as ProviderCase).contact;

  return (
    <div className="page">
      <a className="backlink" href={listPath}>
        <I.Back /> {household ? 'Households' : 'Medicaid providers'}
      </a>
      <div className="page-head">
        <div>
          <h1>
            {c.subject_name}
            {request ? <Pill tone={requestTone(request.status)}>{REQUEST_STATUS_LABELS[request.status]}</Pill> : <Pill tone="neutral">Not sent</Pill>}
          </h1>
          <div className="kv">
            <span>{c.data.case_number}</span>
            {household ? (
              <>
                <span>{(c.data as HouseholdCase).programs.join(' · ')}</span>
                <span>Applied {formatDate((c.data as HouseholdCase).applied_at)}</span>
                <span>
                  {(c.data as HouseholdCase).address.city}, {(c.data as HouseholdCase).address.state}
                </span>
              </>
            ) : (
              <>
                <span>
                  NPI <code className="inline">{(c.data as ProviderCase).npi}</code>
                </span>
                <span>{(c.data as ProviderCase).provider_type}</span>
                <span>
                  {(c.data as ProviderCase).enrollment.application_type} · submitted {formatDate((c.data as ProviderCase).enrollment.submitted_at)}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="actions">
          {!request || request.status === 'verified' ? (
            <button type="button" className="btn primary" disabled={sending} onClick={() => void send()}>
              <I.Send /> {sending ? 'Sending…' : household ? 'Text secure link' : 'Email secure link'}
            </button>
          ) : (
            <button
              type="button"
              className="btn outline"
              disabled={sending || submitted}
              title={submitted ? 'The link was used and the submission is in review. Return the request for corrections to send a new link.' : undefined}
              onClick={() => void resend()}
            >
              <I.Send /> {sending ? 'Sending…' : 'Resend link'}
            </button>
          )}
          <button type="button" className="btn outline" onClick={() => setEditingContact(true)}>
            Edit contact
          </button>
          <button type="button" className="btn ghost" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        </div>
      </div>

      {delivery && (
        <div className={`alert ${delivery.sms || delivery.email ? 'success' : 'warning'}`}>
          <div className="stack tight">
            <div>
              {delivery.sms
                ? `Secure link sent by text message to ${formatPhone(contact.phone)}.`
                : delivery.email
                  ? `Secure link emailed to ${contact.email}.`
                  : `${delivery.channel === 'sms' ? 'Text message could not be sent' : 'Email could not be sent'}. ${delivery.error ?? (delivery.channel === 'sms' ? (config.integrations.sms === 'off' ? 'SMS is not configured.' : 'No deliverable phone number.') : config.integrations.email === 'off' ? 'Email delivery is not configured.' : 'No deliverable address.')} Share this secure link with them directly:`}
            </div>
            <CopyBox value={delivery.hosted_url} label={delivery.sms || delivery.email ? 'Same link, for your reference (open it to see what they see)' : undefined} />
            <div>
              <button type="button" className="link-btn" onClick={() => setDelivery(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="tabs" role="tablist">
        {(
          [
            ['verifications', 'Verifications'],
            ['case', household ? 'Case data' : 'Provider record'],
            ['activity', 'Activity'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {label}
            {t === 'activity' && request ? <span className="count">{request.events.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'case' && (household ? <HouseholdData d={c.data as HouseholdCase} /> : <ProviderData d={c.data as ProviderCase} caseId={c.id} requestId={request && request.status !== 'verified' ? request.id : undefined} onRunNpi={() => void runNpi()} onReload={() => load()} npiBusy={npiBusy} />)}

      {tab === 'verifications' &&
        (request ? (
          <ReviewPanel
            request={request}
            onChange={(r) => {
              setData((prev) => (prev ? { ...prev, requests: prev.requests.map((x) => (x.id === r.id ? r : x)) } : prev));
            }}
          />
        ) : (
          <PreviewTasks tasks={data.tasks_preview} kind={c.kind} contact={contact} onSend={() => void send()} sending={sending} />
        ))}

      {tab === 'activity' && (
        <div className="card">
          <div className="cake">
            <h2>Activity</h2>
          </div>
          <div className="card-body">
            {request ? (
              <div className="timeline">
                {[...request.events].reverse().map((e, i) => (
                  <div key={i} className="ev">
                    <span className="at">{formatDateTime(e.at)}</span>
                    <span>
                      <span className="who">{e.actor}</span>
                      {eventLabel(e.type, e.detail, request)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No verification request yet. Case created {formatDateTime(c.created_at)}.</p>
            )}
          </div>
        </div>
      )}

      {editingContact && (
        <ContactDialog
          caseRecord={c}
          onClose={() => setEditingContact(false)}
          onSaved={async () => {
            setEditingContact(false);
            await load();
          }}
        />
      )}
      {confirmDelete && (
        <Dialog title="Delete this case" description="The case, its verification requests and every uploaded file are permanently deleted." onClose={() => setConfirmDelete(false)} narrow>
          <div className="foot">
            <button type="button" className="btn outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await api(`/api/cases/${id}`, { method: 'DELETE' });
                go(listPath);
              }}
            >
              Delete case
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function eventLabel(type: string, detail: string | undefined, r: VerificationRequest): string {
  const task = detail ? r.tasks.find((t) => t.id === detail || detail.startsWith(`${t.id}:`)) : undefined;
  const t = task ? ` — ${task.title}` : '';
  switch (type) {
    case 'created':
      return 'Verification request created from the case data';
    case 'link_sent':
      return `Secure link sent (${detail ?? 'manual'})`;
    case 'link_resent':
      return `Secure link resent (${detail ?? 'manual'})`;
    case 'returned_link_sent':
      return 'New secure link issued for corrections';
    case 'opened':
      return 'Opened the secure link';
    case 'file_uploaded':
      return `Uploaded a document${t}`;
    case 'file_removed':
      return `Removed a document${t}`;
    case 'ai_reviewed':
      return `AI first-pass review ${detail?.endsWith(':pass') ? 'passed' : 'raised flags'}${t}`;
    case 'identity_verified':
      return `Identity verified with CLEAR${t}`;
    case 'income_verified':
      return `Income verified with Argyle${t}`;
    case 'assets_verified':
      return `Bank account verified with Argyle${t}`;
    case 'npi_verified':
      return `NPI checked against the CMS registry${t}`;
    case 'submitted':
      return 'Submitted for review';
    case 'review_started':
      return 'Review started';
    case 'task_approved':
      return `Approved${t}`;
    case 'task_rejected':
      return `Rejected${t}`;
    case 'task_added':
      return `Added a verification item during review${t}`;
    case 'task_evidence_cleared':
      return `Evidence removed, item requested again${t}`;
    case 'returned':
      return 'Returned for corrections';
    case 'verified':
      return 'Marked verified';
    default:
      return type;
  }
}

function PreviewTasks({
  tasks,
  kind,
  contact,
  onSend,
  sending,
}: {
  tasks: VerificationTask[];
  kind: 'household' | 'provider';
  contact: { phone: string | null; email: string | null; name: string };
  onSend: () => void;
  sending: boolean;
}) {
  const groups = groupTasks(tasks, kind);
  const channel = kind === 'household' ? 'text message' : 'email';
  const target = kind === 'household' ? formatPhone(contact.phone) : (contact.email ?? '—');
  return (
    <div className="stack">
      <div className="card">
        <div className="cake">
          <div>
            <h2>Required verifications</h2>
            <div className="meta">
              {tasks.length} item{tasks.length === 1 ? '' : 's'} derived from the case data. Sending creates the secure link and the {channel} to {contact.name} ({target}).
            </div>
          </div>
          <button type="button" className="btn primary sm" disabled={sending} onClick={onSend}>
            <I.Send /> {sending ? 'Sending…' : `Send by ${channel}`}
          </button>
        </div>
        <div className="card-body stack tight">
          {groups.map((g) => (
            <div key={g.key} className="stack tight">
              <div className="subject-head">
                <h3>{g.heading}</h3>
              </div>
              <table className="preview">
                <colgroup>
                  <col style={{ width: '52%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '21%' }} />
                  <col style={{ width: '10%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Ways to provide</th>
                    <th>Required</th>
                  </tr>
                </thead>
                <tbody>
                  {g.tasks.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="name">{t.title}</div>
                        <div className="sub">{t.reason}</div>
                      </td>
                      <td className="muted">{CATEGORY_LABELS[t.category]}</td>
                      <td className="muted">{t.methods.map((m) => METHOD_LABELS[m]).join(' · ')}</td>
                      <td className="muted">{t.required ? 'Yes' : 'Optional'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HouseholdData({ d }: { d: HouseholdCase }) {
  return (
    <div className="stack">
      <div className="two-col">
        <div className="card">
          <div className="cake">
            <h2>Primary contact</h2>
          </div>
          <div className="card-body">
            <dl className="grid">
              <div>
                <dt>Name</dt>
                <dd>{d.primary_contact.name}</dd>
              </div>
              <div>
                <dt>Mobile (SMS)</dt>
                <dd>{formatPhone(d.primary_contact.phone)}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{d.primary_contact.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>
                  {d.address.street}
                  <br />
                  {d.address.city}, {d.address.state} {d.address.zip}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="cake">
            <h2>Housing, assets & medical</h2>
          </div>
          <div className="card-body">
            <dl className="grid">
              <div>
                <dt>Housing</dt>
                <dd>
                  {d.housing.type === 'rent' ? 'Rents' : d.housing.type === 'own' ? 'Owns' : 'Other'} · {money(d.housing.monthly_cost)}/mo
                  {d.housing.landlord ? ` · ${d.housing.landlord}` : ''}
                </dd>
              </div>
              <div>
                <dt>Utilities paid</dt>
                <dd>{d.housing.utilities.length ? d.housing.utilities.join(', ') : 'None'}</dd>
              </div>
              <div>
                <dt>Assets reported</dt>
                <dd>
                  {money(d.assets.declared_total)}
                  {d.assets.accounts.length ? ` · ${d.assets.accounts.map((a) => `${a.institution} (${a.type})`).join(', ')}` : ''}
                </dd>
              </div>
              <div>
                <dt>Medical expenses</dt>
                <dd>{d.medical.has_elderly_disabled ? `${money(d.medical.monthly_expenses)}/mo (elderly/disabled member)` : 'Not applicable'}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
      <div className="card flush">
        <div className="cake">
          <h2>Household members</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Relationship</th>
              <th>Date of birth</th>
              <th>Earned income</th>
              <th>Other income</th>
            </tr>
          </thead>
          <tbody>
            {d.members.map((m, i) => (
              <tr key={i}>
                <td>
                  <div className="name">{m.name}</div>
                </td>
                <td className="muted">{m.relationship}</td>
                <td className="muted">{formatDate(m.dob)}</td>
                <td>{m.employers.length ? m.employers.map((e) => `${e.name} · ${money(e.monthly_gross)}/mo`).join('; ') : <span className="muted">None</span>}</td>
                <td className="muted">{m.other_income?.length ? m.other_income.map((o) => `${o.source} · ${money(o.monthly)}/mo`).join('; ') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.notes && (
        <div className="card">
          <div className="cake">
            <h2>Notes</h2>
          </div>
          <div className="card-body muted">{d.notes}</div>
        </div>
      )}
    </div>
  );
}

function ProviderData({ d, caseId, requestId, onRunNpi, onReload, npiBusy }: { d: ProviderCase; caseId: string; requestId?: string; onRunNpi: () => void; onReload: () => Promise<void>; npiBusy: boolean }) {
  return (
    <div className="stack">
      <div className="two-col">
        <div className="card">
          <div className="cake">
            <h2>Provider</h2>
          </div>
          <div className="card-body">
            <dl className="grid">
              <div>
                <dt>Name</dt>
                <dd>
                  {d.name}
                  {d.credential_suffix ? `, ${d.credential_suffix}` : ''}
                </dd>
              </div>
              <div>
                <dt>NPI</dt>
                <dd>
                  <code className="inline">{d.npi}</code> · {d.entity_type}
                </dd>
              </div>
              <div>
                <dt>Provider type</dt>
                <dd>
                  {d.provider_type}
                  {d.taxonomy_code ? <span className="muted"> ({d.taxonomy_code})</span> : null}
                </dd>
              </div>
              <div>
                <dt>Specialty</dt>
                <dd>{d.specialty ?? '—'}</dd>
              </div>
              <div>
                <dt>Medicaid ID</dt>
                <dd>{d.enrollment.medicaid_id ?? 'Not yet assigned'}</dd>
              </div>
              <div>
                <dt>Application</dt>
                <dd>
                  {d.enrollment.application_type} · {formatDate(d.enrollment.submitted_at)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="cake">
            <h2>Practice & contact</h2>
          </div>
          <div className="card-body">
            <dl className="grid">
              <div>
                <dt>Practice</dt>
                <dd>
                  {d.practice.name || '—'}
                  <br />
                  <span className="muted">
                    {d.practice.address.street}
                    {d.practice.address.street ? ', ' : ''}
                    {d.practice.address.city}, {d.practice.address.state} {d.practice.address.zip}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Practice phone</dt>
                <dd>{formatPhone(d.practice.phone)}</dd>
              </div>
              <div>
                <dt>Credentialing contact</dt>
                <dd>{d.contact.name}</dd>
              </div>
              <div>
                <dt>Email (link goes here)</dt>
                <dd>{d.contact.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{formatPhone(d.contact.phone)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="cake">
          <div>
            <h2>NPI Registry check</h2>
            <div className="meta">Automatic lookup against the CMS National Plan & Provider Enumeration System.</div>
          </div>
          <button type="button" className="btn outline sm" disabled={npiBusy} onClick={onRunNpi}>
            <I.Search /> {npiBusy ? 'Checking…' : d.npi_check ? 'Re-run check' : 'Run check'}
          </button>
        </div>
        <div className="card-body stack tight">
          {d.npi_check ? <NpiPanel v={d.npi_check as NpiVerification} /> : <p className="muted">Not checked yet. The check also runs automatically when the secure link is sent.</p>}
          {d.npi_check && d.npi_check.flags.length > 0 && (
            <div>
              <NpiFix caseId={caseId} requestId={requestId} npi={d.npi} name={d.name} onUpdated={onReload} />
            </div>
          )}
        </div>
      </div>

      <div className="card flush">
        <div className="cake">
          <h2>Credentials & licenses on file</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Credential</th>
              <th>Number</th>
              <th>Issuer</th>
              <th>Expires</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {d.credentials.map((cr, i) => {
              const days = daysUntil(cr.expires_on);
              return (
                <tr key={i}>
                  <td>
                    <div className="name">{cr.label}</div>
                    <div className="sub">{cr.type.replace(/_/g, ' ')}</div>
                  </td>
                  <td>
                    <code className="inline">{cr.number}</code>
                  </td>
                  <td className="muted">
                    {cr.issuer}
                    {cr.state ? ` (${cr.state})` : ''}
                  </td>
                  <td className="muted">{formatDate(cr.expires_on)}</td>
                  <td>{days < 0 ? <Pill tone="danger">Expired</Pill> : days < 90 ? <Pill tone="warning">Expires in {days} days</Pill> : <Pill tone="success">Current</Pill>}</td>
                </tr>
              );
            })}
            {d.credentials.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No credentials on file.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {d.notes && (
        <div className="card">
          <div className="cake">
            <h2>Notes</h2>
          </div>
          <div className="card-body muted">{d.notes}</div>
        </div>
      )}
    </div>
  );
}
