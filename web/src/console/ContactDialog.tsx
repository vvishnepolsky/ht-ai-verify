import { useState } from 'react';
import { api, type CaseRecord, type HouseholdCase, type ProviderCase } from '../api';
import { Dialog } from './ui';

/** Edit the contact the secure link is delivered to (phone for SMS, email for providers). */
export function ContactDialog({ caseRecord, onClose, onSaved }: { caseRecord: CaseRecord; onClose: () => void; onSaved: () => Promise<void> }) {
  const household = caseRecord.kind === 'household';
  const c = household ? (caseRecord.data as HouseholdCase).primary_contact : (caseRecord.data as ProviderCase).contact;
  const [name, setName] = useState(c.name);
  const [phone, setPhone] = useState(c.phone ?? '');
  const [email, setEmail] = useState(c.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = structuredClone(caseRecord.data);
      const contact = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null };
      if (next.kind === 'household') next.primary_contact = contact;
      else next.contact = contact;
      await api(`/api/cases/${caseRecord.id}`, { method: 'PUT', body: { data: next } });
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Edit contact" description={household ? 'The secure link is texted to the mobile number. Email is the fallback.' : 'The secure link is emailed to the credentialing contact.'} onClose={onClose} narrow>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <label className="field">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Mobile number {household && <span className="hint">(use your own number to receive the demo text)</span>}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(615) 555-0100" inputMode="tel" />
        </label>
        <label className="field">
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" inputMode="email" />
        </label>
        <div className="foot">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </Dialog>
  );
}
