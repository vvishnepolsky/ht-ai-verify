/**
 * "Add a verification" — the worker asks for something the case data did not
 * derive (proof of residency after an out-of-state Medicaid finding, a
 * citizenship document, an extra license …). Presets fill the form; every
 * field stays editable. The item is added as Needed; before submission it
 * simply appears on the hosted checklist, after submission the worker sends
 * it back with Return for corrections.
 */
import { useMemo, useState } from 'react';
import {
  allowedMethodsFor,
  CATEGORY_LABELS,
  HOUSEHOLD_PRESETS,
  METHOD_LABELS,
  PROVIDER_PRESETS,
  type AddTaskPreset,
  type NewTaskDraft,
  type TaskCategory,
  type TaskMethod,
  type VerificationRequest,
} from '../api';
import { Dialog } from './ui';

const HOUSEHOLD_CATEGORIES: TaskCategory[] = ['identity', 'income', 'assets', 'residency_housing', 'expenses_deductions', 'medical_bills', 'insurance'];
const PROVIDER_CATEGORIES: TaskCategory[] = ['identity', 'license', 'credential', 'insurance'];

export function AddTaskDialog({
  request,
  initialPreset,
  onClose,
  onSubmit,
}: {
  request: VerificationRequest;
  /** Preset key to start from (e.g. 'residency' from the coverage finding). */
  initialPreset?: string;
  onClose: () => void;
  onSubmit: (draft: NewTaskDraft) => Promise<void>;
}) {
  const household = request.kind === 'household';
  const presets = household ? HOUSEHOLD_PRESETS : PROVIDER_PRESETS;
  const categories = household ? HOUSEHOLD_CATEGORIES : PROVIDER_CATEGORIES;
  const subjects = useMemo(() => [...new Set(request.tasks.map((t) => t.subject).filter((s): s is string => !!s))], [request.tasks]);
  const start = presets.find((p) => p.key === initialPreset);

  const [preset, setPreset] = useState<string>(start?.key ?? '');
  const [category, setCategory] = useState<TaskCategory>(start?.category ?? categories[0]!);
  const [title, setTitle] = useState(start?.title ?? '');
  const [reason, setReason] = useState(start?.reason ?? '');
  const [subject, setSubject] = useState<string>(subjects.length === 1 ? subjects[0]! : household ? '' : (subjects[0] ?? ''));
  const [required, setRequired] = useState(true);
  const [methods, setMethods] = useState<TaskMethod[]>(allowedMethodsFor(start?.category ?? categories[0]!));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(p: AddTaskPreset | null) {
    setPreset(p?.key ?? '');
    if (!p) return;
    setCategory(p.category);
    setTitle(p.title);
    setReason(p.reason);
    setMethods(allowedMethodsFor(p.category));
  }
  function changeCategory(c: TaskCategory) {
    setCategory(c);
    setMethods(allowedMethodsFor(c));
    setPreset('');
  }
  const optionalMethods = allowedMethodsFor(category).filter((m) => m !== 'upload');
  const valid = title.trim().length > 0 && reason.trim().length > 0;

  return (
    <Dialog
      title="Add a verification"
      description={`Ask the ${household ? 'household' : 'provider'} for something else. It is added as Needed; use Return for corrections to send it to them with a new secure link.`}
      onClose={onClose}
    >
      <div className="stack">
        <div className="stack tight">
          <div className="hint">Start from a common request, or write your own:</div>
          <div className="actions" style={{ flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button key={p.key} type="button" className={`btn sm ${preset === p.key ? 'tint' : 'outline'}`} aria-pressed={preset === p.key} onClick={() => applyPreset(p)}>
                {p.label}
              </button>
            ))}
            <button type="button" className={`btn sm ${preset === '' ? 'tint' : 'outline'}`} aria-pressed={preset === ''} onClick={() => applyPreset(null)}>
              Custom
            </button>
          </div>
        </div>
        <div className="grid2">
          <label className="field">
            Type
            <select value={category} onChange={(e) => changeCategory(e.target.value as TaskCategory)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            For
            <select value={subject} onChange={(e) => setSubject(e.target.value)}>
              {household && <option value="">The household (shared item)</option>}
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {!household && subjects.length === 0 && <option value="">The practice</option>}
            </select>
          </label>
        </div>
        <label className="field">
          What to provide
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Proof of where you live" />
        </label>
        <label className="field">
          Why, and what counts
          <span className="hint">Shown to them on the checklist. Plain language; say what documents are acceptable.</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. We need a document dated in the last 60 days that shows your name and current address…" />
        </label>
        <div className="actions" style={{ flexWrap: 'wrap', gap: 16 }}>
          <label className="check">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required before they can submit
          </label>
          {optionalMethods.map((m) => (
            <label key={m} className="check">
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={(e) => setMethods(e.target.checked ? [...new Set([...methods, m])] : methods.filter((x) => x !== m))}
              />{' '}
              Also allow {METHOD_LABELS[m]}
            </label>
          ))}
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="foot">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !valid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onSubmit({ category, title: title.trim(), reason: reason.trim(), subject: subject || undefined, required, methods });
              } catch (e) {
                setError(e instanceof Error && e.message ? e.message : 'The item could not be added.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Add item
          </button>
        </div>
      </div>
    </Dialog>
  );
}
