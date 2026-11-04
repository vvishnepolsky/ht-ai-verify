/**
 * Worker review surface — the generalized port of ht-cre's ChecklistReview.
 * Tasks grouped by subject (household member / provider, then a shared
 * Household section). Per task: uploaded files with the AI first-pass
 * verdict, flags, extracted fields and the declared facts they were checked
 * against; CLEAR / Argyle / NPPES results; approve / reject / clear evidence;
 * request-level start review / return / mark verified.
 */
import { useState, type ReactNode } from 'react';
import {
  api,
  CATEGORY_LABELS,
  fileFlagText,
  METHOD_LABELS,
  REQUEST_STATUS_LABELS,
  requestTone,
  TASK_STATUS_LABELS,
  taskTone,
  type Delivery,
  type UploadedFileMeta,
  type VerificationRequest,
  type VerificationTask,
} from '../api';
import { formatDate, formatDateTime, initials, money } from '../format';
import { Chip, CopyBox, Dialog, I, ModeTag, Pill } from './ui';

const ACTION_ERROR = 'That action could not be completed. Refresh and try again.';

interface Group {
  key: string;
  heading: string;
  subtitle?: string;
  tasks: VerificationTask[];
}

export function groupTasks(tasks: VerificationTask[], kind: 'household' | 'provider'): Group[] {
  const bySubject = new Map<string, VerificationTask[]>();
  const shared: VerificationTask[] = [];
  for (const t of tasks) {
    if (t.subject) bySubject.set(t.subject, [...(bySubject.get(t.subject) ?? []), t]);
    else shared.push(t);
  }
  const groups: Group[] = [...bySubject.entries()].map(([name, ts]) => ({ key: name, heading: name, tasks: ts }));
  if (shared.length > 0) groups.push({ key: '__shared', heading: kind === 'household' ? 'Household' : 'Practice', subtitle: 'Shared items', tasks: shared });
  return groups;
}

export function ReviewPanel({
  request,
  onChange,
}: {
  request: VerificationRequest;
  onChange: (r: VerificationRequest, delivery?: Delivery) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<VerificationTask | null>(null);
  const [clearTarget, setClearTarget] = useState<VerificationTask | null>(null);
  const [notice, setNotice] = useState<Delivery | null>(null);

  async function review(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ request: VerificationRequest; delivery?: Delivery }>(`/api/requests/${request.id}/review`, { method: 'POST', body });
      onChange(out.request, out.delivery);
      if (out.delivery) setNotice(out.delivery);
    } catch (e) {
      setError(e instanceof Error && e.message ? humanize(e.message) : ACTION_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const s = request.status;
  const canStart = s === 'submitted';
  const reviewing = s === 'under_review';
  const anyRejected = request.tasks.some((t) => t.status === 'rejected');
  const cleared = request.tasks.some((t) => t.status === 'needed' && request.events.some((e) => e.type === 'task_evidence_cleared' && e.detail === t.id));
  const allApproved = request.tasks.every((t) => !t.required || t.status === 'approved');
  const groups = groupTasks(request.tasks, request.kind);
  const flagged = request.tasks.reduce((n, t) => n + t.files.filter((f) => f.ocr?.verdict === 'review').length + (t.npi_verification && t.npi_verification.flags.length > 0 ? 1 : 0), 0);

  return (
    <div className="stack">
      <div className="card">
        <div className="cake">
          <div>
            <h2>Verification review</h2>
            <div className="meta">
              {request.tasks.filter((t) => t.status === 'approved').length}/{request.tasks.length} approved ·{' '}
              {request.tasks.filter((t) => t.status === 'provided' || t.status === 'approved').length} provided
              {flagged > 0 && <> · <span style={{ color: 'var(--ht-amber-text)' }}>{flagged} AI flag{flagged === 1 ? '' : 's'}</span></>}
              {request.submitted_at && <> · submitted {formatDateTime(request.submitted_at)}</>}
            </div>
          </div>
          <div className="actions">
            <Pill tone={requestTone(s)}>{REQUEST_STATUS_LABELS[s]}</Pill>
            {canStart && (
              <button type="button" className="btn primary sm" disabled={busy} onClick={() => void review({ action: 'start_review' })}>
                Start review
              </button>
            )}
            {reviewing && (
              <>
                <button type="button" className="btn outline sm" disabled={busy || (!anyRejected && !cleared)} title={!anyRejected && !cleared ? 'Reject at least one item with a note first' : undefined} onClick={() => void review({ action: 'return' })}>
                  <I.Send /> Return for corrections
                </button>
                <button type="button" className="btn primary sm" disabled={busy || anyRejected || !allApproved} title={!allApproved ? 'Approve every required item first' : undefined} onClick={() => void review({ action: 'verify' })}>
                  <I.Check /> Mark verified
                </button>
              </>
            )}
          </div>
        </div>
        {(s === 'sent' || s === 'in_progress') && (
          <div className="card-body muted small">
            Waiting on the {request.kind === 'household' ? 'household' : 'provider'} — items appear here as they are provided; review opens once they submit.
          </div>
        )}
        {s === 'returned' && <div className="card-body muted small">Returned for corrections. A new secure link was sent; the rejected items show the notes they will see.</div>}
        {s === 'verified' && <div className="card-body muted small">Verified {formatDateTime(request.verified_at)}. This request is closed.</div>}
      </div>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert info">
          <div className="stack tight">
            <div>
              {notice.sms || notice.email
                ? `Returned — a new secure link was sent by ${notice.sms ? 'text message' : 'email'}.`
                : `Returned. ${notice.channel === 'sms' ? 'No text message' : 'No email'} could be delivered, so share this new link with them directly:`}
            </div>
            {!notice.sms && !notice.email && <CopyBox value={notice.hosted_url} />}
            <div>
              <button type="button" className="link-btn" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="stack tight" aria-label={g.heading}>
          <div className="subject-head">
            <span className="avatar" aria-hidden>
              {g.key === '__shared' ? <I.Home /> : initials(g.heading)}
            </span>
            <h3>{g.heading}</h3>
            <span className="n">
              {g.tasks.length} item{g.tasks.length === 1 ? '' : 's'}
            </span>
          </div>
          {g.tasks.map((t) => (
            <TaskReviewCard
              key={t.id}
              request={request}
              task={t}
              canReview={reviewing}
              busy={busy}
              onApprove={() => void review({ action: 'approve_task', task_id: t.id })}
              onReject={() => setRejectTarget(t)}
              onClear={() => setClearTarget(t)}
              onRecheckNpi={async () => {
                setBusy(true);
                try {
                  const out = await api<{ request: VerificationRequest }>(`/api/requests/${request.id}/npi-recheck`, { method: 'POST' });
                  onChange(out.request);
                } catch {
                  setError('The registry check could not be re-run.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          ))}
        </section>
      ))}

      {rejectTarget && (
        <RejectDialog
          task={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSubmit={async (reason) => {
            await review({ action: 'reject_task', task_id: rejectTarget.id, reason });
            setRejectTarget(null);
          }}
        />
      )}
      {clearTarget && (
        <Dialog title="Remove evidence and request again" description="The submitted files or verification result are deleted and the item goes back to Needed. Use Return for corrections afterwards to send a new link." onClose={() => setClearTarget(null)} narrow>
          <p className="muted">{clearTarget.title}</p>
          <div className="foot">
            <button type="button" className="btn outline" onClick={() => setClearTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={async () => {
                await review({ action: 'clear_task_evidence', task_id: clearTarget.id });
                setClearTarget(null);
              }}
            >
              Remove &amp; request again
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function humanize(code: string): string {
  const map: Record<string, string> = {
    invalid_status: 'That action is not available in the current status.',
    no_rejected_tasks: 'Reject at least one item (with a note) before returning.',
    missing_reviewer_note: 'Every rejected item needs a note for the applicant.',
    has_rejected_tasks: 'Resolve the rejected items before marking verified.',
    incomplete_review: 'Approve every required item before marking verified.',
    reason_required: 'A reason is required.',
    locked: 'Approved items are settled and cannot be changed.',
  };
  return map[code] ?? code ?? ACTION_ERROR;
}

function hasEvidence(t: VerificationTask): boolean {
  return t.files.length > 0 || !!t.identity_verification || !!t.income_verification || !!t.assets_verification || !!t.npi_verification;
}

function TaskReviewCard({
  request,
  task,
  canReview,
  busy,
  onApprove,
  onReject,
  onClear,
  onRecheckNpi,
}: {
  request: VerificationRequest;
  task: VerificationTask;
  canReview: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
  onRecheckNpi: () => void;
}) {
  const isNpi = task.category === 'npi';
  const reviewable = canReview && task.status === 'provided';
  const clearable = !isNpi && (canReview || request.status === 'returned') && task.status !== 'needed' && task.status !== 'approved' && hasEvidence(task);
  return (
    <div className="task">
      <div className="cake">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>
            <span className="title">{task.title}</span>
            {task.required ? <span className="req">Required</span> : <span className="req">Optional</span>}
          </div>
          <div className="meta">
            {CATEGORY_LABELS[task.category]} · {METHOD_LABELS[task.method]}
          </div>
        </div>
        <Pill tone={taskTone(task.status)}>{TASK_STATUS_LABELS[task.status]}</Pill>
      </div>
      <div className="task-body">
        <p className="reason">{task.reason}</p>
        {task.declared && task.declared.length > 0 && (
          <div className="declared" aria-label="Facts from the application">
            {task.declared.map((d, i) => (
              <span key={i}>
                {d.label}: <b>{d.value}</b>
              </span>
            ))}
          </div>
        )}
        {task.files.length > 0 && <FileList request={request} task={task} />}
        {task.identity_verification && <IdentityPanel v={task.identity_verification} />}
        {task.income_verification && <IncomePanel v={task.income_verification} />}
        {task.assets_verification && <AssetsPanel v={task.assets_verification} />}
        {task.npi_verification && <NpiPanel v={task.npi_verification} />}
        {task.status === 'rejected' && task.reviewer_note && (
          <p className="small" style={{ color: 'var(--ht-red-text)' }}>
            Returned: {task.reviewer_note}
          </p>
        )}
        {(reviewable || clearable || (isNpi && request.status !== 'verified')) && (
          <div className="review-actions">
            {reviewable && (
              <>
                <button type="button" className="btn primary sm" disabled={busy} onClick={onApprove} title={isNpi && (task.npi_verification?.flags.length ?? 0) > 0 ? 'Approve only after confirming the NPI with the provider' : undefined}>
                  <I.Check /> {isNpi && (task.npi_verification?.flags.length ?? 0) > 0 ? 'Approve anyway' : 'Approve'}
                </button>
                {!isNpi && (
                  <button type="button" className="btn outline sm" disabled={busy} onClick={onReject}>
                    Reject
                  </button>
                )}
              </>
            )}
            {isNpi && task.status !== 'approved' && (
              <button type="button" className="btn outline sm" disabled={busy} onClick={onRecheckNpi}>
                Re-run registry check
              </button>
            )}
            {clearable && (
              <button type="button" className="btn danger sm" disabled={busy} onClick={onClear}>
                Remove &amp; request again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PanelHead({ icon, label, right }: { icon: ReactNode; label: string; right?: ReactNode }) {
  return (
    <div className="panel-head">
      <span className="tile">{icon}</span>
      <span className="label">{label}</span>
      <span style={{ marginLeft: 'auto' }}>{right}</span>
    </div>
  );
}

export function AiVerdict({ f, subject }: { f: UploadedFileMeta; subject?: string }) {
  if (f.ocr_pending && !f.ocr) {
    return (
      <div className="pending">
        <span className="spinner" aria-hidden /> AI review running…
      </div>
    );
  }
  if (!f.ocr) return <span className="muted small">No AI review (analysis unavailable for this file).</span>;
  const o = f.ocr;
  return (
    <div className="stack tight" style={{ gap: 4 }}>
      <div className="file-name">
        {o.verdict === 'pass' ? (
          <Chip tone="success">
            <I.Check /> AI: looks good
          </Chip>
        ) : (
          <Chip tone="warning">
            <I.Warn /> AI: needs a look
          </Chip>
        )}
        <Chip tone={o.confidence === 'high' ? 'neutral' : 'warning'}>{o.confidence === 'high' ? 'Legible' : 'Hard to read'}</Chip>
        <span className="muted small">
          {o.document_type_detected}
          {o.holder_name ? ` · ${o.holder_name}` : ''}
          {o.valid_until ? ` · valid until ${o.valid_until}` : o.document_date ? ` · dated ${o.document_date}` : ''}
        </span>
      </div>
      {o.summary && <p className="small muted">{o.summary}</p>}
      {(o.flags ?? []).map((flag) => (
        <div key={flag} className="flag">
          <I.Warn /> {fileFlagText(flag, f, subject)}
        </div>
      ))}
      {o.extracted.length > 0 && (
        <dl className="mini">
          {o.extracted.map((x, i) => (
            <div key={i}>
              <dt>{x.label}</dt>
              <dd>{x.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function FileList({ request, task }: { request: VerificationRequest; task: VerificationTask }) {
  const [view, setView] = useState<UploadedFileMeta | null>(null);
  return (
    <div className="panel">
      <PanelHead icon={<I.File />} label="Uploaded document" />
      {task.files.map((f) => {
        const url = `/api/requests/${request.id}/file/${f.file_id}`;
        return (
          <div key={f.file_id} className="file-row">
            <button type="button" className="thumb" onClick={() => setView(f)} aria-label={`View ${f.filename ?? 'document'}`}>
              {f.mime.startsWith('image/') ? <img src={url} alt="" /> : <I.File />}
            </button>
            <div className="file-main">
              <div className="file-name">
                <span className="fn">{f.filename ?? f.mime}</span>
                <span className="muted small">
                  {Math.round(f.size_bytes / 1024)} KB · {f.source === 'camera' ? 'camera' : 'upload'} · {formatDateTime(f.captured_at)}
                </span>
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setView(f)}>
                  <I.Eye /> View
                </button>
              </div>
              <AiVerdict f={f} subject={task.subject} />
            </div>
          </div>
        );
      })}
      {view && (
        <Dialog title={view.filename ?? 'Document'} onClose={() => setView(null)}>
          {view.mime.startsWith('image/') ? (
            <img src={`/api/requests/${request.id}/file/${view.file_id}`} alt={view.filename ?? 'Uploaded document'} style={{ maxWidth: '100%', borderRadius: 6 }} />
          ) : (
            <iframe title={view.filename ?? 'Document'} src={`/api/requests/${request.id}/file/${view.file_id}`} style={{ width: '100%', height: '70vh', border: '1px solid var(--ht-hairline)', borderRadius: 6 }} />
          )}
          <div className="foot">
            <a className="btn outline" href={`/api/requests/${request.id}/file/${view.file_id}`} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
            <button type="button" className="btn primary" onClick={() => setView(null)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function IdentityPanel({ v }: { v: NonNullable<VerificationTask['identity_verification']> }) {
  return (
    <div className="panel">
      <PanelHead icon={<I.Id />} label="CLEAR identity" right={<ModeTag mode={v.mode} />} />
      <dl className="grid">
        <div>
          <dt>Verified name</dt>
          <dd>{v.full_name}</dd>
        </div>
        <div>
          <dt>Document</dt>
          <dd>{v.document_type}</dd>
        </div>
        <div>
          <dt>Issuing state</dt>
          <dd>{v.issuing_state || '—'}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{v.expiration_date ?? '—'}</dd>
        </div>
      </dl>
      {v.name_match === false ? (
        <div className="flag">
          <I.Warn /> Verified name may not match {v.requested_name ?? 'the requested person'}.
        </div>
      ) : (
        <div className="flag ok">
          <I.Check /> Name matches the requested person.
        </div>
      )}
      {v.coverage_flag && (
        <div className="alert warning small">
          <b>Health coverage check:</b> {v.coverage_flag}
        </div>
      )}
      {v.mode === 'simulated' && <p className="small muted">Simulated result — CLEAR is not configured on this deployment.</p>}
    </div>
  );
}

function IncomePanel({ v }: { v: NonNullable<VerificationTask['income_verification']> }) {
  return (
    <div className="panel">
      <PanelHead icon={<I.Wallet />} label="Argyle payroll income" right={<ModeTag mode={v.mode} />} />
      <dl className="grid">
        <div>
          <dt>Employer</dt>
          <dd>{v.employer}</dd>
        </div>
        <div>
          <dt>Gross / month</dt>
          <dd>{money(v.monthly_gross_income)}</dd>
        </div>
        <div>
          <dt>Net / month</dt>
          <dd>{money(v.monthly_net_income)}</dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>{formatDateTime(v.verified_at)}</dd>
        </div>
      </dl>
      {v.employer_match === false ? (
        <div className="flag">
          <I.Warn /> Employer differs from the application ({(v.expected_employers ?? []).join(', ')}).
        </div>
      ) : (
        <div className="flag ok">
          <I.Check /> Employer matches the application.
        </div>
      )}
      {v.mode === 'simulated' && <p className="small muted">Simulated result — Argyle is not configured on this deployment.</p>}
    </div>
  );
}

function AssetsPanel({ v }: { v: NonNullable<VerificationTask['assets_verification']> }) {
  return (
    <div className="panel">
      <PanelHead icon={<I.Bank />} label="Argyle bank verification (VOA)" right={<ModeTag mode={v.mode} />} />
      <dl className="grid">
        <div>
          <dt>Current balance</dt>
          <dd>{money(v.total_current_balance, 2)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{money(v.total_available_balance, 2)}</dd>
        </div>
        <div>
          <dt>As of</dt>
          <dd>{formatDate(v.balance_as_of)}</dd>
        </div>
        <div>
          <dt>Report</dt>
          <dd>
            <code className="inline">{v.report_id}</code>
          </dd>
        </div>
      </dl>
      {v.accounts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Institution</th>
              <th>Account</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            {v.accounts.map((a, i) => (
              <tr key={i}>
                <td>{a.institution}</td>
                <td className="muted">
                  {a.account_type}
                  {a.account_last4 ? ` ····${a.account_last4}` : ''}
                </td>
                <td className="num">{money(a.current_balance, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {v.mode === 'simulated' && <p className="small muted">Simulated result — Argyle is not configured on this deployment.</p>}
    </div>
  );
}

export function NpiPanel({ v }: { v: NonNullable<VerificationTask['npi_verification']> }) {
  return (
    <div className="panel">
      <PanelHead icon={<I.Registry />} label="CMS NPI Registry (NPPES)" right={<span className="muted small">checked {formatDateTime(v.checked_at)}</span>} />
      {v.found ? (
        <dl className="grid">
          <div>
            <dt>Registry name</dt>
            <dd>{v.registry_name}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{v.status}</dd>
          </div>
          <div>
            <dt>Entity</dt>
            <dd>{v.entity_type}</dd>
          </div>
          <div>
            <dt>Primary taxonomy</dt>
            <dd>
              {v.primary_taxonomy?.desc ?? '—'}
              {v.primary_taxonomy?.code ? <span className="muted"> ({v.primary_taxonomy.code})</span> : null}
            </dd>
          </div>
          <div>
            <dt>License on NPPES</dt>
            <dd>{v.primary_taxonomy?.license ? `${v.primary_taxonomy.license}${v.primary_taxonomy.state ? ` (${v.primary_taxonomy.state})` : ''}` : '—'}</dd>
          </div>
          <div>
            <dt>Practice state</dt>
            <dd>{v.practice_state || '—'}</dd>
          </div>
        </dl>
      ) : null}
      <p className="small muted">{v.summary}</p>
      {v.flags.length === 0 ? (
        <div className="flag ok">
          <I.Check /> Registry record matches the application.
        </div>
      ) : (
        v.flags.map((f) => (
          <div key={f} className="flag">
            <I.Warn /> {npiFlagText(f)}
          </div>
        ))
      )}
    </div>
  );
}

function npiFlagText(f: string): string {
  switch (f) {
    case 'npi_not_found':
      return 'No NPPES record for this NPI — confirm the number with the provider.';
    case 'name_mismatch':
      return 'The registry name differs from the name on the application.';
    case 'inactive':
      return 'The NPI is deactivated in NPPES.';
    case 'taxonomy_mismatch':
      return 'The registry taxonomy differs from the provider type on the application.';
    case 'entity_type_mismatch':
      return 'Individual/organization entity type differs from the application.';
    default:
      return f;
  }
}

function RejectDialog({ task, onClose, onSubmit }: { task: VerificationTask; onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const suggestions = (task.files.flatMap((f) => f.ocr?.flags ?? []).length > 0
    ? task.files.flatMap((f) => (f.ocr?.flags ?? []).map((fl) => fileFlagText(fl, f, task.subject)))
    : []
  ).slice(0, 3);
  return (
    <Dialog title="Reject this item" description={`${task.title}. The note is shown to the ${'applicant'} on the returned checklist.`} onClose={onClose} narrow>
      <div className="stack">
        {suggestions.length > 0 && (
          <div className="stack tight">
            <div className="hint">Suggested from the AI review:</div>
            {suggestions.map((s, i) => (
              <button key={i} type="button" className="btn outline sm" style={{ justifyContent: 'flex-start', height: 'auto', padding: '6px 10px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => setReason(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <label className="field">
          What needs to change?
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The lease you sent ended in 2024 — please upload your current lease." autoFocus />
        </label>
        <div className="foot">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || reason.trim().length === 0}
            onClick={async () => {
              setBusy(true);
              await onSubmit(reason.trim());
              setBusy(false);
            }}
          >
            Reject item
          </button>
        </div>
      </div>
    </Dialog>
  );
}
