import { useState } from 'react';
import { api, type CaseRecord, type Config, type CredentialType, type NppesSummary, type ProviderCase } from '../api';
import { Dialog, I } from './ui';

const CRED: { value: CredentialType; label: string }[] = [
  { value: 'state_license', label: 'State license' },
  { value: 'dea', label: 'DEA registration' },
  { value: 'board_certification', label: 'Board certification' },
  { value: 'malpractice', label: 'Liability insurance' },
  { value: 'facility_license', label: 'Facility license' },
  { value: 'clia', label: 'CLIA certificate' },
];

interface CredRow {
  type: CredentialType;
  label: string;
  number: string;
  issuer: string;
  state: string;
  expires_on: string;
}

export function NewProviderDialog({ config, onClose, onCreated }: { config: Config; onClose: () => void; onCreated: (c: CaseRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [npi, setNpi] = useState('');
  const [lookup, setLookup] = useState<{ state: 'idle' | 'busy' | 'found' | 'missing'; record?: NppesSummary }>({ state: 'idle' });
  const [p, setP] = useState({
    name: '',
    credential_suffix: '',
    entity_type: 'individual' as 'individual' | 'organization',
    provider_type: '',
    taxonomy_code: '',
    specialty: '',
    practice_name: '',
    street: '',
    city: '',
    state: config.stateCode,
    zip: '',
    practice_phone: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    application_type: 'new' as 'new' | 'revalidation' | 'change',
    medicaid_id: '',
  });
  const [creds, setCreds] = useState<CredRow[]>([{ type: 'state_license', label: `${config.stateCode} license`, number: '', issuer: '', state: config.stateCode, expires_on: '' }]);

  async function runLookup() {
    const digits = npi.replace(/\D/g, '');
    if (digits.length !== 10) return;
    setLookup({ state: 'busy' });
    try {
      const out = await api<{ found: boolean; record?: NppesSummary }>(`/api/npi/${digits}`);
      if (out.found && out.record) {
        const r = out.record;
        setLookup({ state: 'found', record: r });
        const [first, ...rest] = r.name.split(',');
        setP((prev) => ({
          ...prev,
          name: first?.trim() ?? r.name,
          credential_suffix: rest.join(',').trim() || r.credential,
          entity_type: r.entity_type,
          provider_type: r.primary_taxonomy?.desc ?? prev.provider_type,
          taxonomy_code: r.primary_taxonomy?.code ?? '',
          practice_name: r.practice?.name ?? prev.practice_name,
          street: r.practice?.street ?? prev.street,
          city: r.practice?.city ?? prev.city,
          state: r.practice?.state ?? prev.state,
          zip: r.practice?.zip ?? prev.zip,
          practice_phone: r.practice?.phone ?? prev.practice_phone,
        }));
        if (r.primary_taxonomy?.license) {
          setCreds((cs) => cs.map((c, i) => (i === 0 ? { ...c, number: r.primary_taxonomy?.license ?? c.number, state: r.primary_taxonomy?.state ?? c.state } : c)));
        }
      } else setLookup({ state: 'missing' });
    } catch {
      setLookup({ state: 'missing' });
    }
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const data: ProviderCase = {
      kind: 'provider',
      case_number: '',
      name: p.name.trim(),
      ...(p.credential_suffix ? { credential_suffix: p.credential_suffix } : {}),
      npi: npi.replace(/\D/g, ''),
      entity_type: p.entity_type,
      provider_type: p.provider_type,
      ...(p.taxonomy_code ? { taxonomy_code: p.taxonomy_code } : {}),
      ...(p.specialty ? { specialty: p.specialty } : {}),
      practice: { name: p.practice_name, address: { street: p.street, city: p.city, state: p.state, zip: p.zip }, phone: p.practice_phone || null },
      contact: { name: p.contact_name || p.name, email: p.contact_email || null, phone: p.contact_phone || null },
      enrollment: { application_type: p.application_type, submitted_at: new Date().toISOString().slice(0, 10), ...(p.medicaid_id ? { medicaid_id: p.medicaid_id } : {}) },
      credentials: creds
        .filter((c) => c.number || c.issuer)
        .map((c) => ({ type: c.type, label: c.label || CRED.find((x) => x.value === c.type)?.label || 'Credential', number: c.number, issuer: c.issuer, ...(c.state ? { state: c.state } : {}), expires_on: c.expires_on })),
    };
    try {
      const out = await api<{ case: CaseRecord }>('/api/cases', { method: 'POST', body: { data } });
      onCreated(out.case);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the provider.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="New Medicaid provider" description="Start from the NPI — the CMS registry fills in the name, taxonomy and practice location when the NPI is on file." onClose={onClose}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <div className="inline-row">
          <label className="field">
            NPI
            <input inputMode="numeric" maxLength={10} value={npi} onChange={(e) => setNpi(e.target.value.replace(/\D/g, ''))} placeholder="10 digits" />
          </label>
          <button type="button" className="btn outline" disabled={npi.length !== 10 || lookup.state === 'busy'} onClick={() => void runLookup()}>
            <I.Search /> {lookup.state === 'busy' ? 'Looking up…' : 'Look up in NPI Registry'}
          </button>
        </div>
        {lookup.state === 'found' && lookup.record && (
          <div className="alert success small">
            NPPES: <b>{lookup.record.name}</b> · {lookup.record.entity_type} · {lookup.record.status}
            {lookup.record.primary_taxonomy ? ` · ${lookup.record.primary_taxonomy.desc}` : ''} — fields below were filled from the registry.
          </div>
        )}
        {lookup.state === 'missing' && <div className="alert warning small">No active NPPES record for that NPI (or the check digit is wrong). You can still create the case — the registry check will flag it.</div>}

        <fieldset className="group">
          <legend>Provider</legend>
          <div className="form-grid">
            <label className="field">
              Name
              <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
            </label>
            <div className="inline-row">
              <label className="field">
                Credential (MD, NP…)
                <input value={p.credential_suffix} onChange={(e) => setP({ ...p, credential_suffix: e.target.value })} />
              </label>
              <label className="field">
                Entity
                <select value={p.entity_type} onChange={(e) => setP({ ...p, entity_type: e.target.value as 'individual' | 'organization' })}>
                  <option value="individual">Individual</option>
                  <option value="organization">Organization</option>
                </select>
              </label>
            </div>
            <label className="field">
              Provider type
              <input value={p.provider_type} onChange={(e) => setP({ ...p, provider_type: e.target.value })} placeholder="Physician — Internal Medicine" />
            </label>
            <div className="inline-row">
              <label className="field">
                Taxonomy code
                <input value={p.taxonomy_code} onChange={(e) => setP({ ...p, taxonomy_code: e.target.value })} />
              </label>
              <label className="field">
                Specialty
                <input value={p.specialty} onChange={(e) => setP({ ...p, specialty: e.target.value })} />
              </label>
            </div>
            <label className="field">
              Application
              <select value={p.application_type} onChange={(e) => setP({ ...p, application_type: e.target.value as 'new' | 'revalidation' | 'change' })}>
                <option value="new">New enrollment</option>
                <option value="revalidation">Revalidation</option>
                <option value="change">Change of information</option>
              </select>
            </label>
            <label className="field">
              Medicaid ID <span className="hint">(if assigned)</span>
              <input value={p.medicaid_id} onChange={(e) => setP({ ...p, medicaid_id: e.target.value })} />
            </label>
          </div>
        </fieldset>

        <fieldset className="group">
          <legend>Practice & credentialing contact</legend>
          <div className="form-grid">
            <label className="field">
              Practice name
              <input value={p.practice_name} onChange={(e) => setP({ ...p, practice_name: e.target.value })} />
            </label>
            <label className="field">
              Practice phone
              <input value={p.practice_phone} onChange={(e) => setP({ ...p, practice_phone: e.target.value })} />
            </label>
            <label className="field">
              Street
              <input value={p.street} onChange={(e) => setP({ ...p, street: e.target.value })} />
            </label>
            <div className="inline-row">
              <label className="field">
                City
                <input value={p.city} onChange={(e) => setP({ ...p, city: e.target.value })} />
              </label>
              <label className="field">
                State
                <input value={p.state} maxLength={2} onChange={(e) => setP({ ...p, state: e.target.value.toUpperCase() })} />
              </label>
              <label className="field">
                ZIP
                <input value={p.zip} onChange={(e) => setP({ ...p, zip: e.target.value })} />
              </label>
            </div>
            <label className="field">
              Contact name <span className="hint">(defaults to the provider)</span>
              <input value={p.contact_name} onChange={(e) => setP({ ...p, contact_name: e.target.value })} />
            </label>
            <label className="field">
              Contact email (secure link goes here)
              <input inputMode="email" value={p.contact_email} onChange={(e) => setP({ ...p, contact_email: e.target.value })} />
            </label>
            <label className="field">
              Contact phone
              <input inputMode="tel" value={p.contact_phone} onChange={(e) => setP({ ...p, contact_phone: e.target.value })} />
            </label>
          </div>
        </fieldset>

        <fieldset className="group">
          <legend>Credentials & licenses on the application</legend>
          <div className="rowlist">
            {creds.map((c, i) => (
              <div key={i} className="r c">
                <label className="field">
                  Type
                  <select value={c.type} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, type: e.target.value as CredentialType, label: CRED.find((k) => k.value === e.target.value)?.label ?? x.label } : x)))}>
                    {CRED.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Label
                  <input value={c.label} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                </label>
                <label className="field">
                  Number
                  <input value={c.number} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                </label>
                <label className="field">
                  Issuer
                  <input value={c.issuer} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, issuer: e.target.value } : x)))} />
                </label>
                <label className="field">
                  State
                  <input value={c.state} maxLength={2} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, state: e.target.value.toUpperCase() } : x)))} />
                </label>
                <label className="field">
                  Expires
                  <input type="date" value={c.expires_on} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, expires_on: e.target.value } : x)))} />
                </label>
                <button type="button" className="btn ghost sm" aria-label="Remove credential" onClick={() => setCreds(creds.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn outline sm" onClick={() => setCreds([...creds, { type: 'malpractice', label: 'Professional liability insurance', number: '', issuer: '', state: '', expires_on: '' }])}>
                Add credential
              </button>
            </div>
          </div>
        </fieldset>

        <div className="foot">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || npi.length !== 10 || !p.name.trim()} onClick={() => void submit()}>
            Create provider
          </button>
        </div>
      </div>
    </Dialog>
  );
}
