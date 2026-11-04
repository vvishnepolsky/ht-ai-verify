import { useRef, useState } from 'react';
import { api, ApiError, CATEGORY_LABELS, TASK_STATUS_LABELS, taskTone, type ApplicantView, type UploadedFileMeta, type VerificationTask } from '../api';
import { money } from '../format';
import { I, Pill } from '../console/ui';
import { CameraCapture } from './CameraCapture';

declare global {
  interface Window {
    Argyle?: { create: (config: Record<string, unknown>) => { open: () => void } };
  }
}
const ARGYLE_SDK_SRC = 'https://plugin.argyle.com/argyle.web.v5.js';
let argyleSdk: Promise<void> | null = null;
function ensureArgyleSdk(): Promise<void> {
  if (window.Argyle) return Promise.resolve();
  argyleSdk ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ARGYLE_SDK_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('argyle_sdk_load_failed'));
    document.head.appendChild(s);
  });
  return argyleSdk;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      const i = s.indexOf(',');
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function fileHasWarning(f: UploadedFileMeta): boolean {
  return !!f.ocr && f.ocr.verdict === 'review';
}

/** Plain-language copy for the AI warning, most specific issue first. */
function fileWarningText(f: UploadedFileMeta, subject?: string, provider?: boolean): string {
  const o = f.ocr;
  if (o?.name_match === false) return `This document appears to belong to someone else${subject ? ` — it should be ${subject}'s` : ''}. Please upload the right ${provider ? 'provider’s' : 'person’s'} document.`;
  if (o?.is_current === false) return `This document is out of date${o.valid_until ? ` — it ended ${o.valid_until}` : ''}. Please upload the current one.`;
  const d = o?.discrepancies?.[0];
  if (d) return `This shows ${d.field.toLowerCase()} of ${d.found}, but ${d.expected} was reported. Please check you uploaded the right document.`;
  if (o?.matches_request === false) return `This looks like a ${o.document_type_detected}, which may not match what was asked.`;
  if (o?.flags?.includes('authenticity_concern')) return 'This document looks like it may have been altered. Please upload an unedited copy.';
  return 'This may be hard to read — consider retaking it in good lighting.';
}

export function TaskCard({
  base,
  task,
  session,
  onSession,
  onError,
  highlighted,
}: {
  base: string;
  task: VerificationTask;
  session: ApplicantView;
  onSession: (s: ApplicantView) => void;
  onError: (err?: unknown) => void;
  highlighted: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [waiting, setWaiting] = useState<'clear' | 'voa' | 'income' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabRef = useRef<Window | null>(null);
  const pollRef = useRef<number | null>(null);
  const provider = session.kind === 'provider';

  const locked = task.status === 'approved';
  const canClear = task.methods.includes('clear') && session.integrations.clear !== 'off';
  const canArgyleIncome = task.category === 'income' && task.methods.includes('argyle') && session.integrations.argyle !== 'off';
  const canArgyleAssets = task.category === 'assets' && task.methods.includes('argyle') && session.integrations.argyle !== 'off';
  const fulfilled = !locked && (task.status === 'provided' || task.files.length > 0 || !!task.identity_verification || !!task.income_verification || !!task.assets_verification);

  async function post<T = { session: ApplicantView }>(path: string, body: Record<string, unknown>): Promise<T> {
    return api<T>(`${base}/${path}`, { method: 'POST', body });
  }

  async function upload(file: File, source: 'camera' | 'upload') {
    setBusy(true);
    setShowOptions(false);
    try {
      const data_base64 = await fileToBase64(file);
      const out = await post('attach-file', { task_id: task.id, mime: file.type || 'application/octet-stream', filename: file.name, source, data_base64 });
      onSession(out.session);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const f of Array.from(files)) await upload(f, 'upload');
  }

  function stopPoll() {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
    setWaiting(null);
  }
  /** Watch the hosted tab: when it closes, re-read the session (the return tab finalized). */
  function watchTab(kind: 'clear' | 'voa', tab: Window | null) {
    setWaiting(kind);
    tabRef.current = tab;
    const started = Date.now();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = (await api<{ session: ApplicantView }>(base)).session;
        const t = s.tasks.find((x) => x.id === task.id);
        if (t && (t.identity_verification || t.assets_verification)) {
          onSession(s);
          stopPoll();
          return;
        }
      } catch {
        /* keep waiting */
      }
      if ((tab && tab.closed) || Date.now() - started > 10 * 60_000) stopPoll();
    }, 2500);
  }

  async function startClear() {
    setBusy(true);
    setShowOptions(false);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const ret = new URL(window.location.href);
      ret.searchParams.set('clear_task', task.id);
      const out = await post<{ hosted_url: string }>('clear-link', { task_id: task.id, return_url: ret.toString() });
      if (tab) {
        tab.location.href = out.hosted_url;
        watchTab('clear', tab);
      } else window.location.assign(out.hosted_url);
    } catch (err) {
      tab?.close();
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  async function startVoa() {
    setBusy(true);
    setShowOptions(false);
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const ret = new URL(window.location.href);
      ret.searchParams.set('voa_task', task.id);
      const out = await post<{ link: string }>('argyle-voa-link', { task_id: task.id, return_url: ret.toString() });
      if (tab) {
        tab.location.href = out.link;
        watchTab('voa', tab);
      } else window.location.assign(out.link);
    } catch (err) {
      tab?.close();
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  async function finalizeIncome() {
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        return (await post('argyle-finalize', { task_id: task.id })).session;
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        throw err;
      }
    }
  }
  async function startArgyleIncome() {
    setBusy(true);
    setShowOptions(false);
    try {
      const link = await post<{ user_token: string; mode: string }>('argyle-link', { task_id: task.id });
      if (link.mode === 'simulated') {
        // No SDK without credentials — the server records a labelled simulation.
        setWaiting('income');
        onSession(await finalizeIncome());
        setWaiting(null);
        return;
      }
      await ensureArgyleSdk();
      if (!window.Argyle) throw new Error('argyle_unavailable');
      let connected = false;
      const argyle = window.Argyle.create({
        userToken: link.user_token,
        sandbox: link.mode === 'sandbox',
        onAccountConnected: () => {
          connected = true;
          setWaiting('income');
          void finalizeIncome()
            .then(onSession)
            .catch((err: unknown) => onError(err))
            .finally(() => {
              setWaiting(null);
              setBusy(false);
            });
        },
        onClose: () => {
          if (!connected) setBusy(false);
        },
        onError: () => {
          onError(new Error('argyle_link_error'));
          setBusy(false);
        },
      });
      argyle.open();
      return;
    } catch (err) {
      onError(err);
    }
    setBusy(false);
  }

  async function reset() {
    setBusy(true);
    try {
      onSession((await post('reset-task', { task_id: task.id })).session);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  async function remove(fileId: string) {
    setBusy(true);
    try {
      onSession((await post('remove-file', { task_id: task.id, file_id: fileId })).session);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  const provideLabel = task.status === 'rejected' ? 'Provide again' : 'Provide this document';

  return (
    <div id={`task-${task.id}`} className={`task${highlighted ? ' highlight' : ''}`}>
      <div className="cake">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div>
            <span className="title">{task.title}</span>
            {!task.required && <span className="req">Optional</span>}
          </div>
          <div className="meta">{CATEGORY_LABELS[task.category]}</div>
        </div>
        <Pill tone={taskTone(task.status)}>{TASK_STATUS_LABELS[task.status]}</Pill>
      </div>
      <div className="task-body">
        <p className="reason">{task.reason}</p>
        {task.status === 'rejected' && task.reviewer_note && (
          <div className="alert warning small">
            <b>{provider ? 'The enrollment team asked:' : 'Your caseworker asked:'}</b> {task.reviewer_note}
          </div>
        )}

        {task.identity_verification && (
          <Banner
            title={`Identity verified with CLEAR${task.identity_verification.mode === 'simulated' ? ' (simulated)' : ''}`}
            detail={`${task.identity_verification.full_name} · ${task.identity_verification.document_type}`}
            warn={task.identity_verification.name_match === false ? `The verified name (${task.identity_verification.full_name}) may not match ${task.subject ?? 'the requested person'}.` : null}
          />
        )}
        {task.income_verification && (
          <Banner
            title={`Income verified with Argyle${task.income_verification.mode === 'simulated' ? ' (simulated)' : ''}`}
            detail={`${task.income_verification.employer}${task.income_verification.monthly_gross_income ? ` · ${money(task.income_verification.monthly_gross_income)}/mo gross` : ''}`}
            warn={task.income_verification.employer_match === false ? `The employer we found (${task.income_verification.employer}) may not match the one on your application${task.expected_employers?.length ? ` (${task.expected_employers.join(', ')})` : ''}.` : null}
          />
        )}
        {task.assets_verification && (
          <Banner
            title={`Bank account verified with Argyle${task.assets_verification.mode === 'simulated' ? ' (simulated)' : ''}`}
            detail={`${task.assets_verification.accounts.map((a) => a.institution).join(', ') || 'Connected bank'} · balance as of ${task.assets_verification.balance_as_of}`}
          />
        )}
        {waiting === 'income' && !task.income_verification && (
          <div className="pending" role="status" aria-live="polite">
            <span className="spinner" aria-hidden /> Verifying your income — this can take a minute…
          </div>
        )}
        {(waiting === 'clear' || waiting === 'voa') && (
          <div className="pending" role="status" aria-live="polite">
            <span className="spinner" aria-hidden />
            <span>
              Finish the {waiting === 'clear' ? 'CLEAR identity check' : 'bank connection'} in the new tab — this page updates automatically.{' '}
              <button type="button" className="link-btn" onClick={stopPoll}>
                I didn’t finish — go back
              </button>
            </span>
          </div>
        )}

        {fulfilled && (
          <div>
            <button type="button" className="link-btn" disabled={busy} onClick={() => void reset()}>
              Remove and use a different method
            </button>
          </div>
        )}

        {task.files.length > 0 && (
          <div className="stack tight" style={{ gap: 6 }}>
            {task.files.map((f) => (
              <div key={f.file_id} className="file-li">
                <div className="top">
                  <div className="l">
                    <span className="thumb" aria-hidden>
                      {f.mime.startsWith('image/') ? <img src={`${base}/file/${f.file_id}`} alt="" /> : <I.File />}
                    </span>
                    <span>{f.filename ?? f.mime}</span>
                  </div>
                  {!locked && (
                    <button type="button" className="btn ghost sm" disabled={busy} onClick={() => void remove(f.file_id)} aria-label={`Remove ${f.filename ?? 'file'}`}>
                      <I.Trash />
                    </button>
                  )}
                </div>
                {f.ocr ? (
                  fileHasWarning(f) ? (
                    <div className="flag">
                      <I.Warn /> {fileWarningText(f, task.subject, provider)}
                    </div>
                  ) : (
                    <div className="flag ok">
                      <I.Check /> Looks good — detected {f.ocr.document_type_detected}.
                    </div>
                  )
                ) : f.ocr_pending ? (
                  <div className="pending">
                    <span className="spinner" aria-hidden /> Checking this document…
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {!locked && !waiting && (
          <div className="stack tight">
            <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="sr-only" aria-label="Upload documents" onChange={(e) => void handleFiles(e.target.files)} />
            {!showOptions ? (
              <button type="button" className={`btn ${task.status === 'needed' ? 'tint' : 'outline'} block`} disabled={busy} onClick={() => setShowOptions(true)}>
                {busy ? 'Working…' : task.files.length > 0 ? 'Add another' : provideLabel}
              </button>
            ) : (
              <div className="options">
                <button type="button" className="opt" disabled={busy} onClick={() => setShowCamera(true)}>
                  <I.Camera /> Take a photo
                </button>
                <button type="button" className="opt" disabled={busy} onClick={() => fileRef.current?.click()}>
                  <I.Upload /> Upload a file
                </button>
                {canClear && (
                  <button type="button" className="opt clear" disabled={busy} onClick={() => void startClear()}>
                    <I.Shield /> Verify my ID instantly with <span className="brandword">CLEAR</span>
                  </button>
                )}
                {canArgyleIncome && (
                  <button type="button" className="opt argyle" disabled={busy} onClick={() => void startArgyleIncome()}>
                    <I.Wallet /> Connect payroll with <span className="brandword">Argyle</span>
                  </button>
                )}
                {canArgyleAssets && (
                  <button type="button" className="opt argyle" disabled={busy} onClick={() => void startVoa()}>
                    <I.Bank /> Verify my bank account with <span className="brandword">Argyle</span>
                  </button>
                )}
                <button type="button" className="link-btn" onClick={() => setShowOptions(false)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      {showCamera && (
        <CameraCapture
          onCapture={(file) => {
            setShowCamera(false);
            void upload(file, 'camera');
          }}
          onClose={() => setShowCamera(false)}
          onUnavailable={() => {
            setShowCamera(false);
            fileRef.current?.click();
          }}
        />
      )}
    </div>
  );
}

function Banner({ title, detail, warn }: { title: string; detail: string; warn?: string | null }) {
  return (
    <div className="verified-banner">
      <I.Shield />
      <div>
        <div className="t">{title}</div>
        <div className="d">{detail}</div>
        {warn && (
          <div className="w">
            <I.Warn /> {warn}
          </div>
        )}
      </div>
    </div>
  );
}
