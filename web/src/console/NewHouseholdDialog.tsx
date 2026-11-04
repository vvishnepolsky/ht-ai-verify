import { useState } from 'react';
import { api, type CaseRecord, type Config, type HouseholdCase, type HouseholdMember } from '../api';
import { Dialog } from './ui';

const REL: HouseholdMember['relationship'][] = ['self', 'spouse', 'partner', 'child', 'parent', 'other'];

export function NewHouseholdDialog({ config, onClose, onCreated }: { config: Config; onClose: () => void; onCreated: (c: CaseRecord) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<string[]>(['SNAP']);
  const [contact, setContact] = useState({ name: '', phone: '', email: '' });
  const [address, setAddress] = useState({ street: '', city: '', state: config.stateCode, zip: '' });
  const [members, setMembers] = useState<{ name: string; dob: string; relationship: HouseholdMember['relationship']; employer: string; monthly_gross: string }[]>([
    { name: '', dob: '', relationship: 'self', employer: '', monthly_gross: '' },
  ]);
  const [housing, setHousing] = useState({ type: 'rent' as 'rent' | 'own' | 'other', monthly_cost: '', landlord: '', utilities: 'electricity' });
  const [assets, setAssets] = useState({ declared_total: '', institution: '', type: 'checking' });
  const [medical, setMedical] = useState({ has_elderly_disabled: false, monthly_expenses: '' });

  const toggle = (p: string) => setPrograms((ps) => (ps.includes(p) ? ps.filter((x) => x !== p) : [...ps, p]));

  async function submit() {
    setBusy(true);
    setError(null);
    const data: HouseholdCase = {
      kind: 'household',
      case_number: '',
      programs,
      applied_at: new Date().toISOString().slice(0, 10),
      primary_contact: { name: contact.name || members[0]?.name || '', phone: contact.phone || null, email: contact.email || null },
      address,
      members: members
        .filter((m) => m.name.trim())
        .map((m) => ({
          name: m.name.trim(),
          dob: m.dob,
          relationship: m.relationship,
          employers: m.employer.trim() ? [{ name: m.employer.trim(), monthly_gross: Number(m.monthly_gross) || 0 }] : [],
        })),
      housing: {
        type: housing.type,
        monthly_cost: Number(housing.monthly_cost) || 0,
        ...(housing.landlord ? { landlord: housing.landlord } : {}),
        utilities: housing.utilities.split(',').map((u) => u.trim()).filter(Boolean),
      },
      assets: { declared_total: Number(assets.declared_total) || 0, accounts: assets.institution ? [{ institution: assets.institution, type: assets.type }] : [] },
      medical: { has_elderly_disabled: medical.has_elderly_disabled, monthly_expenses: Number(medical.monthly_expenses) || 0 },
    };
    try {
      const out = await api<{ case: CaseRecord }>('/api/cases', { method: 'POST', body: { data } });
      onCreated(out.case);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the case.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="New household case" description="Enter what the application reported. The required verifications are derived from these facts." onClose={onClose}>
      <div className="stack">
        {error && <div className="alert error">{error}</div>}
        <fieldset className="group">
          <legend>Programs</legend>
          <div className="actions">
            {['SNAP', 'Medicaid', 'TANF', 'WIC'].map((p) => (
              <label key={p} className="check">
                <input type="checkbox" checked={programs.includes(p)} onChange={() => toggle(p)} /> {p}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>Household members</legend>
          <div className="rowlist">
            {members.map((m, i) => (
              <div key={i} className="r m">
                <label className="field">
                  Name
                  <input value={m.name} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                </label>
                <label className="field">
                  Date of birth
                  <input type="date" value={m.dob} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, dob: e.target.value } : x)))} />
                </label>
                <label className="field">
                  Relationship
                  <select value={m.relationship} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, relationship: e.target.value as HouseholdMember['relationship'] } : x)))}>
                    {REL.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Employer
                  <input value={m.employer} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, employer: e.target.value } : x)))} />
                </label>
                <label className="field">
                  Gross $/mo
                  <input inputMode="numeric" value={m.monthly_gross} onChange={(e) => setMembers(members.map((x, j) => (j === i ? { ...x, monthly_gross: e.target.value } : x)))} />
                </label>
                <button type="button" className="btn ghost sm" aria-label="Remove member" disabled={members.length === 1} onClick={() => setMembers(members.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <div>
              <button type="button" className="btn outline sm" onClick={() => setMembers([...members, { name: '', dob: '', relationship: 'child', employer: '', monthly_gross: '' }])}>
                Add member
              </button>
            </div>
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>Primary contact</legend>
          <div className="form-grid">
            <label className="field">
              Contact name <span className="hint">(defaults to the first member)</span>
              <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
            </label>
            <label className="field">
              Mobile (SMS link)
              <input inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="(615) 555-0100" />
            </label>
            <label className="field">
              Email
              <input inputMode="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
            </label>
            <label className="field">
              Street
              <input value={address.street} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
            </label>
            <label className="field">
              City
              <input value={address.city} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
            </label>
            <div className="inline-row">
              <label className="field">
                State
                <input value={address.state} maxLength={2} onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })} />
              </label>
              <label className="field">
                ZIP
                <input value={address.zip} onChange={(e) => setAddress({ ...address, zip: e.target.value })} />
              </label>
            </div>
          </div>
        </fieldset>
        <fieldset className="group">
          <legend>Housing, assets & medical</legend>
          <div className="form-grid">
            <label className="field">
              Housing
              <select value={housing.type} onChange={(e) => setHousing({ ...housing, type: e.target.value as 'rent' | 'own' | 'other' })}>
                <option value="rent">Rents</option>
                <option value="own">Owns (mortgage)</option>
                <option value="other">Other / no cost</option>
              </select>
            </label>
            <label className="field">
              Monthly housing cost
              <input inputMode="numeric" value={housing.monthly_cost} onChange={(e) => setHousing({ ...housing, monthly_cost: e.target.value })} />
            </label>
            <label className="field">
              Landlord <span className="hint">(renters)</span>
              <input value={housing.landlord} onChange={(e) => setHousing({ ...housing, landlord: e.target.value })} />
            </label>
            <label className="field">
              Utilities paid <span className="hint">(comma-separated)</span>
              <input value={housing.utilities} onChange={(e) => setHousing({ ...housing, utilities: e.target.value })} />
            </label>
            <label className="field">
              Assets reported ($)
              <input inputMode="numeric" value={assets.declared_total} onChange={(e) => setAssets({ ...assets, declared_total: e.target.value })} />
            </label>
            <label className="field">
              Bank
              <input value={assets.institution} onChange={(e) => setAssets({ ...assets, institution: e.target.value })} placeholder="Institution name" />
            </label>
            <label className="check full">
              <input type="checkbox" checked={medical.has_elderly_disabled} onChange={(e) => setMedical({ ...medical, has_elderly_disabled: e.target.checked })} /> Elderly or disabled member with medical expenses
            </label>
            {medical.has_elderly_disabled && (
              <label className="field">
                Monthly medical expenses ($)
                <input inputMode="numeric" value={medical.monthly_expenses} onChange={(e) => setMedical({ ...medical, monthly_expenses: e.target.value })} />
              </label>
            )}
          </div>
        </fieldset>
        <div className="foot">
          <button type="button" className="btn outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy || !members[0]?.name.trim()} onClick={() => void submit()}>
            Create case
          </button>
        </div>
      </div>
    </Dialog>
  );
}
