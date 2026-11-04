/**
 * The hosted collection flow — `/flow?token=…`. The token is the only
 * credential. Single-screen checklist grouped by person, then shared items;
 * each item is provided by photo, upload, or an instant check (CLEAR /
 * Argyle). The AI first-pass verdict appears on each upload; a returned
 * checklist shows the worker's notes per item. Ported from ht-cre's
 * resident app, generalized to households and providers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type ApplicantView, type VerificationTask } from '../api';
import { I } from '../console/ui';
import { TaskCard } from './TaskCard';

type Phase = 'loading' | 'invalid' | 'checklist' | 'submitted';

function phaseFor(status: ApplicantView['status']): Phase {
  return status === 'submitted' || status === 'under_review' || status === 'verified' ? 'submitted' : 'checklist';
}

async function finalizeWithRetry(path: string, taskId: string, notReady: string): Promise<ApplicantView> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const out = await api<{ session: ApplicantView }>(path, { method: 'POST', body: { task_id: taskId } });
      return out.session;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.code === notReady && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
  }
}

export function FlowApp() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') ?? '';
  const base = `/flow-api/${encodeURIComponent(token)}`;
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<ApplicantView | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setPhase('invalid');
        return;
      }
      try {
        let s = (await api<{ session: ApplicantView }>(base)).session;
        const clearTask = params.get('clear_task');
        if (clearTask && !params.get('clear_cancel')) {
          try {
            s = (await api<{ session: ApplicantView }>(`${base}/clear-finalize`, { method: 'POST', body: { task_id: clearTask } })).session;
            if (!cancelled) setBanner('Identity verified. You can continue below.');
          } catch {
            /* leave unverified */
          }
        }
        const voaTask = params.get('voa_task');
        if (voaTask) {
          try {
            s = await finalizeWithRetry(`${base}/argyle-voa-finalize`, voaTask, 'report_not_ready');
            if (!cancelled) setBanner('Bank account verified. You can continue below.');
          } catch {
            /* leave unverified */
          }
        }
        if (clearTask || voaTask || params.get('clear_cancel')) {
          const url = new URL(window.location.href);
          for (const k of ['clear_task', 'voa_task', 'clear_cancel']) url.searchParams.delete(k);
          window.history.replaceState({}, '', url.toString());
        }
        if (cancelled) return;
        setSession(s);
        setPhase(phaseFor(s.status));
      } catch {
        if (!cancelled) setPhase('invalid');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while uploads have pending AI reviews so the verdict appears in place.
  const pending = session?.tasks.some((t) => t.files.some((f) => f.ocr_pending && !f.ocr)) ?? false;
  const refresh = useCallback(async () => {
    try {
      const s = (await api<{ session: ApplicantView }>(base)).session;
      setSession(s);
      setPhase(phaseFor(s.status));
    } catch {
      /* ignore */
    }
  }, [base]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [pending, refresh]);

  const onSession = (s: ApplicantView) => {
    setSession(s);
    setPhase(phaseFor(s.status));
  };

  if (phase === 'invalid') return <InvalidLink />;
  if (phase === 'loading' || !session) return <div className="flow" aria-busy="true" />;

  return (
    <Shell session={session}>
      {banner && (
        <div className="alert success">
          {banner}{' '}
          <button type="button" className="link-btn" onClick={() => setBanner(null)}>
            Dismiss
          </button>
        </div>
      )}
      {phase === 'checklist' ? <Checklist base={base} session={session} onSession={onSession} onDeadLink={() => setPhase('invalid')} /> : <Submitted session={session} />}
    </Shell>
  );
}

function Shell({ session, children }: { session: ApplicantView; children: React.ReactNode }) {
  const provider = session.kind === 'provider';
  return (
    <div className="flow">
      <header>
        <div className="bar">
          <div className="brandrow">
            <span className="mark">
              <I.Shield />
            </span>
            <span>
              <div className="t1">{provider ? 'Provider enrollment verification' : 'Document verification'}</div>
              <div className="t2">{session.agency_name}</div>
            </span>
          </div>
          <span className="who">{session.subject_name}</span>
        </div>
      </header>
      <main>{children}</main>
      <footer>
        {provider
          ? 'The documents you provide are shared with the Medicaid provider enrollment team and used only to verify your enrollment application.'
          : 'The documents you provide are shared with your caseworker and used only for eligibility verification.'}
      </footer>
    </div>
  );
}

function InvalidLink() {
  return (
    <div className="flow">
      <main>
        <div className="card done-card">
          <div className="big" style={{ background: 'var(--ht-amber-bg)', color: 'var(--ht-amber-text)' }}>
            <I.Warn />
          </div>
          <h1>This link is not valid</h1>
          <p className="muted">It may have expired or already been replaced by a newer one. Check the most recent message you received, or contact the office that sent it.</p>
        </div>
      </main>
    </div>
  );
}

function groupTasks(tasks: VerificationTask[], kind: 'household' | 'provider'): { key: string; heading: string; tasks: VerificationTask[] }[] {
  const by = new Map<string, VerificationTask[]>();
  const shared: VerificationTask[] = [];
  for (const t of tasks) {
    if (t.category === 'npi') continue; // system item; nothing for the provider to do
    if (t.subject) by.set(t.subject, [...(by.get(t.subject) ?? []), t]);
    else shared.push(t);
  }
  const groups = [...by.entries()].map(([k, ts]) => ({ key: k, heading: k, tasks: ts }));
  if (shared.length) groups.push({ key: '__shared', heading: kind === 'household' ? 'Household' : 'Practice', tasks: shared });
  return groups;
}

function Checklist({ base, session, onSession, onDeadLink }: { base: string; session: ApplicantView; onSession: (s: ApplicantView) => void; onDeadLink: () => void }) {
  const [error, setError] = useState<string | null>(null);
  // A 404 mid-session means this link was replaced or expired (a newer one
  // was sent, or the case was reset) — show the invalid-link screen, not a
  // generic retry message the person can never get past.
  const onActionError = (err?: unknown) => {
    if (err instanceof ApiError && err.status === 404) onDeadLink();
    else setError('Something went wrong. Please try again.');
  };
  const [submitting, setSubmitting] = useState(false);
  const [warn, setWarn] = useState(false);
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const timer = useRef<number | null>(null);

  const visible = session.tasks.filter((t) => t.category !== 'npi');
  const required = visible.filter((t) => t.required);
  const done = required.filter((t) => t.status === 'provided' || t.status === 'approved').length;
  const allDone = required.length > 0 && done === required.length;
  const returned = session.status === 'returned';
  const provider = session.kind === 'provider';
  const flagged = visible.filter(
    (t) =>
      t.status !== 'approved' &&
      (t.files.some((f) => f.ocr?.verdict === 'review') || t.identity_verification?.name_match === false || t.income_verification?.employer_match === false),
  );
  const groups = groupTasks(session.tasks, session.kind);

  async function submit() {
    setWarn(false);
    setSubmitting(true);
    setError(null);
    try {
      onSession((await api<{ session: ApplicantView }>(`${base}/submit`, { method: 'POST' })).session);
    } catch (err) {
      onActionError(err);
    } finally {
      setSubmitting(false);
    }
  }
  function onSubmitClick() {
    if (flagged.length > 0) {
      setWarn(true);
      return;
    }
    void submit();
  }
  function reviewFlagged() {
    setWarn(false);
    setHighlight(new Set(flagged.map((t) => t.id)));
    document.getElementById(`task-${flagged[0]?.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHighlight(new Set()), 4000);
  }

  return (
    <>
      <div className="stack tight">
        <h1>{provider ? 'Your credentials' : 'Your documents'}</h1>
        <p className="muted">
          {returned
            ? `The ${provider ? 'enrollment team' : 'caseworker'} asked for a few changes. Update the items marked “Needs attention” and resubmit.`
            : provider
              ? 'For each item, upload a current copy or take a photo. Your identity can be verified instantly.'
              : 'For each item, take a photo or upload a file. Identity, income and bank accounts can be verified instantly.'}
        </p>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={done}>
          <div style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} />
        </div>
        <p className="strong small">
          {done} of {required.length} required items ready
        </p>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {groups.map((g) => (
        <section key={g.key} className="stack tight" aria-label={g.heading}>
          {groups.length > 1 && (
            <div className="subject-head">
              <h3>{g.heading}</h3>
            </div>
          )}
          {g.tasks.map((t) => (
            <TaskCard key={t.id} base={base} task={t} session={session} onSession={onSession} onError={onActionError} highlighted={highlight.has(t.id)} />
          ))}
        </section>
      ))}
      {warn ? (
        <div className="alert warning">
          <div className="stack tight">
            <div className="strong">Some items may need another look before you submit.</div>
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {flagged.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
            <div className="actions">
              <button type="button" className="btn primary sm" onClick={reviewFlagged}>
                Review my documents
              </button>
              <button type="button" className="btn outline sm" disabled={submitting} onClick={() => void submit()}>
                Submit anyway
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="submit-bar">
          {!allDone && <span className="muted small">Provide all required items to submit.</span>}
          <button type="button" className="btn primary lg" disabled={!allDone || submitting} onClick={onSubmitClick}>
            {submitting ? 'Submitting…' : returned ? 'Resubmit for review' : 'Submit for review'}
          </button>
        </div>
      )}
    </>
  );
}

function Submitted({ session }: { session: ApplicantView }) {
  const verified = session.status === 'verified';
  return (
    <div className="card done-card">
      <div className="big">
        <I.Check />
      </div>
      <h1>{verified ? 'All verified' : 'Submitted for review'}</h1>
      <p className="muted">
        {verified
          ? 'Everything you provided has been reviewed and accepted. Nothing more is needed.'
          : session.kind === 'provider'
            ? 'The enrollment team will review your documents. If anything needs a correction, you will get a new link by email.'
            : 'Your caseworker will review your documents. If anything needs a correction, you will get a new link by text message.'}
      </p>
    </div>
  );
}
