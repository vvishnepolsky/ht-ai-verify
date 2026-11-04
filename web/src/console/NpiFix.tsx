import { useState } from 'react';
import { api, type CaseRecord, type ProviderCase, type VerificationRequest } from '../api';
import { I } from './ui';

/**
 * Inline "fix the NPI and re-check" control for a provider whose registry
 * check failed (usually a typo on the application). Saves the corrected NPI
 * (and optionally the name) on the case, then re-runs the NPPES check —
 * against the open verification request when there is one, so the NPI item
 * in the review refreshes too.
 */
export function NpiFix({
  caseId,
  requestId,
  npi,
  name,
  onUpdated,
}: {
  caseId: string;
  requestId?: string;
  npi: string;
  name: string;
  onUpdated: (request?: VerificationRequest) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(npi);
  const [nameValue, setNameValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 10) {
      setError('An NPI is exactly 10 digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { case: c } = await api<{ case: CaseRecord }>(`/api/cases/${caseId}`);
      const data = structuredClone(c.data) as ProviderCase;
      data.npi = digits;
      if (nameValue.trim()) data.name = nameValue.trim();
      await api(`/api/cases/${caseId}`, { method: 'PUT', body: { data } });
      if (requestId) {
        const out = await api<{ request: VerificationRequest }>(`/api/requests/${requestId}/npi-recheck`, { method: 'POST' });
        await onUpdated(out.request);
      } else {
        await api(`/api/cases/${caseId}/npi-check`, { method: 'POST' });
        await onUpdated();
      }
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the NPI.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn outline sm" onClick={() => setOpen(true)}>
        <I.Search /> Fix NPI and re-check
      </button>
    );
  }
  return (
    <div className="panel" style={{ background: 'var(--ht-grey-1)' }}>
      <div className="strong small">Correct the application and re-run the registry check</div>
      {error && (
        <div className="alert error small" role="alert">
          {error}
        </div>
      )}
      <div className="form-grid">
        <label className="field">
          NPI
          <input inputMode="numeric" maxLength={10} value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} autoFocus />
        </label>
        <label className="field">
          Name on application <span className="hint">(as it should match the registry)</span>
          <input value={nameValue} onChange={(e) => setNameValue(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void save()}>
          {busy ? 'Checking…' : 'Save and re-check'}
        </button>
        <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
