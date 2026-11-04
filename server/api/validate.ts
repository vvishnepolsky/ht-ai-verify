/**
 * Input validation for case payloads from the console (deny-by-default:
 * unknown kinds and malformed required fields are rejected; strings are
 * trimmed and capped). No external schema library to keep the service
 * dependency-light.
 */
import type { Address, CaseData, Contact, HouseholdCase, ProviderCase, ProviderCredential } from '../domain/case.js';
import { ServiceError } from '../services/verification.service.js';

const bad = (msg: string): never => {
  throw new ServiceError(400, 'invalid_case', msg);
};
const str = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() ? Number(v) || 0 : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const dateStr = (v: unknown): string => {
  const s = str(v, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};

function contact(v: unknown): Contact {
  const o = obj(v);
  return { name: str(o['name']) || bad('contact name required'), phone: str(o['phone'], 40) || null, email: str(o['email'], 120) || null };
}
function address(v: unknown): Address {
  const o = obj(v);
  return { street: str(o['street']), city: str(o['city'], 80), state: str(o['state'], 2).toUpperCase(), zip: str(o['zip'], 10) };
}

function household(o: Record<string, unknown>): HouseholdCase {
  const housing = obj(o['housing']);
  const assets = obj(o['assets']);
  const medical = obj(o['medical']);
  const members = arr(o['members']).map((m) => {
    const mo = obj(m);
    const rel = str(mo['relationship'], 20);
    return {
      name: str(mo['name']) || bad('member name required'),
      dob: dateStr(mo['dob']),
      relationship: (['self', 'spouse', 'partner', 'child', 'parent', 'other'].includes(rel) ? rel : 'other') as HouseholdCase['members'][number]['relationship'],
      employers: arr(mo['employers'])
        .map((e) => ({ name: str(obj(e)['name']), monthly_gross: num(obj(e)['monthly_gross']) }))
        .filter((e) => e.name),
      ...(arr(mo['other_income']).length
        ? { other_income: arr(mo['other_income']).map((x) => ({ source: str(obj(x)['source']), monthly: num(obj(x)['monthly']) })) }
        : {}),
    };
  });
  if (members.length === 0) bad('at least one household member is required');
  const htype = str(housing['type'], 10);
  return {
    kind: 'household',
    case_number: str(o['case_number'], 40) || `HH-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`,
    programs: arr(o['programs']).map((p) => str(p, 20)).filter(Boolean),
    applied_at: dateStr(o['applied_at']) || new Date().toISOString().slice(0, 10),
    primary_contact: contact(o['primary_contact']),
    address: address(o['address']),
    members,
    housing: {
      type: (htype === 'rent' || htype === 'own' ? htype : 'other') as HouseholdCase['housing']['type'],
      monthly_cost: num(housing['monthly_cost']),
      ...(str(housing['landlord']) ? { landlord: str(housing['landlord']) } : {}),
      utilities: arr(housing['utilities']).map((u) => str(u, 30)).filter(Boolean),
    },
    assets: {
      declared_total: num(assets['declared_total']),
      accounts: arr(assets['accounts'])
        .map((a) => ({ institution: str(obj(a)['institution']), type: str(obj(a)['type'], 30) || 'checking' }))
        .filter((a) => a.institution),
    },
    medical: { has_elderly_disabled: medical['has_elderly_disabled'] === true, monthly_expenses: num(medical['monthly_expenses']) },
    ...(str(o['notes'], 2000) ? { notes: str(o['notes'], 2000) } : {}),
  };
}

const CRED_TYPES = new Set(['state_license', 'dea', 'board_certification', 'malpractice', 'facility_license', 'clia']);

function provider(o: Record<string, unknown>): ProviderCase {
  const practice = obj(o['practice']);
  const enrollment = obj(o['enrollment']);
  const npi = str(o['npi'], 10).replace(/\D/g, '');
  if (npi.length !== 10) bad('a 10-digit NPI is required');
  const et = str(o['entity_type'], 20);
  const at = str(enrollment['application_type'], 20);
  const credentials: ProviderCredential[] = arr(o['credentials'])
    .map((c) => {
      const co = obj(c);
      const type = str(co['type'], 30);
      return {
        type: (CRED_TYPES.has(type) ? type : 'state_license') as ProviderCredential['type'],
        label: str(co['label']) || 'Credential',
        number: str(co['number'], 60),
        issuer: str(co['issuer']),
        ...(str(co['state'], 2) ? { state: str(co['state'], 2).toUpperCase() } : {}),
        ...(dateStr(co['issued_on']) ? { issued_on: dateStr(co['issued_on']) } : {}),
        expires_on: dateStr(co['expires_on']),
      };
    })
    .filter((c) => c.number || c.issuer);
  return {
    kind: 'provider',
    case_number: str(o['case_number'], 40) || `PRV-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 90000) + 10000)}`,
    name: str(o['name']) || bad('provider name required'),
    ...(str(o['credential_suffix'], 20) ? { credential_suffix: str(o['credential_suffix'], 20) } : {}),
    npi,
    entity_type: (et === 'organization' ? 'organization' : 'individual') as ProviderCase['entity_type'],
    provider_type: str(o['provider_type']) || 'Provider',
    ...(str(o['taxonomy_code'], 12) ? { taxonomy_code: str(o['taxonomy_code'], 12) } : {}),
    ...(str(o['specialty']) ? { specialty: str(o['specialty']) } : {}),
    practice: { name: str(practice['name']), address: address(practice['address']), phone: str(practice['phone'], 40) || null },
    contact: contact(o['contact']),
    enrollment: {
      application_type: (at === 'revalidation' || at === 'change' ? at : 'new') as ProviderCase['enrollment']['application_type'],
      submitted_at: dateStr(enrollment['submitted_at']) || new Date().toISOString().slice(0, 10),
      ...(str(enrollment['medicaid_id'], 40) ? { medicaid_id: str(enrollment['medicaid_id'], 40) } : {}),
    },
    credentials,
    ...(obj(o['npi_check'])['provider'] === 'nppes' ? { npi_check: o['npi_check'] as ProviderCase['npi_check'] } : {}),
    ...(str(o['notes'], 2000) ? { notes: str(o['notes'], 2000) } : {}),
  };
}

export function validateCaseData(raw: unknown): CaseData {
  const o = obj(raw);
  if (o['kind'] === 'household') return household(o);
  if (o['kind'] === 'provider') return provider(o);
  return bad('kind must be household or provider');
}
