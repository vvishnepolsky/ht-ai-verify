/**
 * CMS NPI Registry (NPPES) lookup — https://npiregistry.cms.hhs.gov/api-page
 * Public, no key. GET https://npiregistry.cms.hhs.gov/api/?version=2.1&number=<NPI>
 *
 * Produces the automatic `NpiVerification` for a provider case: found / not
 * found, registry name, entity type, status, primary taxonomy (with the state
 * license NPPES carries for it), plus name / taxonomy / entity-type matches
 * against what the application says.
 */
import { namesMatch, taxonomyMatches } from '../ai/match.js';
import type { NpiVerification } from '../domain/types.js';

const API = 'https://npiregistry.cms.hhs.gov/api/';

export interface NppesResult {
  number: string;
  enumeration_type: 'NPI-1' | 'NPI-2' | string;
  basic: Record<string, unknown>;
  addresses?: Array<Record<string, unknown>>;
  taxonomies?: Array<{ code?: string; desc?: string; primary?: boolean; state?: string | null; license?: string | null }>;
}

/** Luhn check with the 80840 prefix NPPES uses. */
export function isValidNpiFormat(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ('80840' + npi).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, alt = false; i >= 0; i--, alt = !alt) {
    let d = digits[i] as number;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export async function lookupNpi(npi: string): Promise<NppesResult | null> {
  const url = `${API}?version=2.1&number=${encodeURIComponent(npi)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`nppes_http_${res.status}`);
  const data = (await res.json()) as { result_count?: number; results?: NppesResult[]; Errors?: unknown };
  if (data.Errors) throw new Error('nppes_bad_request');
  return data.results?.[0] ?? null;
}

/** Search NPPES by name/state (console "find NPI" helper). */
export async function searchNpi(q: {
  first_name?: string;
  last_name?: string;
  organization_name?: string;
  state?: string;
  limit?: number;
}): Promise<NppesResult[]> {
  const params = new URLSearchParams({ version: '2.1', limit: String(q.limit ?? 10) });
  if (q.first_name) params.set('first_name', q.first_name);
  if (q.last_name) params.set('last_name', q.last_name);
  if (q.organization_name) params.set('organization_name', q.organization_name);
  if (q.state) params.set('state', q.state);
  const res = await fetch(`${API}?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`nppes_http_${res.status}`);
  const data = (await res.json()) as { results?: NppesResult[] };
  return data.results ?? [];
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function registryName(r: NppesResult): string {
  const b = r.basic ?? {};
  if (r.enumeration_type === 'NPI-2') return s(b['organization_name']);
  const parts = [s(b['first_name']), s(b['middle_name']), s(b['last_name'])].filter(Boolean);
  const cred = s(b['credential']);
  const name = parts.map(titleCase).join(' ');
  return cred ? `${name}, ${cred}` : name;
}

function titleCase(w: string): string {
  return w
    .toLowerCase()
    .split(/([ -])/)
    .map((p) => (p === ' ' || p === '-' ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');
}

export function practiceState(r: NppesResult): string {
  const loc = (r.addresses ?? []).find((a) => a['address_purpose'] === 'LOCATION') ?? r.addresses?.[0];
  return s(loc?.['state']);
}

/** A compact, PHI-free summary of a registry record for the console / autofill. */
export function summarizeRecord(r: NppesResult): {
  npi: string;
  name: string;
  entity_type: 'individual' | 'organization';
  status: string;
  credential: string;
  primary_taxonomy: { code: string; desc: string; state: string | null; license: string | null } | null;
  practice: { name: string; street: string; city: string; state: string; zip: string; phone: string } | null;
  enumeration_date: string;
  last_updated: string;
} {
  const tax = (r.taxonomies ?? []).find((t) => t.primary) ?? r.taxonomies?.[0] ?? null;
  const loc = (r.addresses ?? []).find((a) => a['address_purpose'] === 'LOCATION') ?? r.addresses?.[0] ?? null;
  const zip = s(loc?.['postal_code']);
  return {
    npi: r.number,
    name: registryName(r),
    entity_type: r.enumeration_type === 'NPI-2' ? 'organization' : 'individual',
    status: s(r.basic?.['status']) === 'A' ? 'Active' : s(r.basic?.['status']) || 'Unknown',
    credential: s(r.basic?.['credential']),
    primary_taxonomy: tax ? { code: s(tax.code), desc: s(tax.desc), state: tax.state ?? null, license: tax.license ?? null } : null,
    practice: loc
      ? {
          name: r.enumeration_type === 'NPI-2' ? s(r.basic?.['organization_name']) : '',
          street: [s(loc['address_1']), s(loc['address_2'])].filter(Boolean).map(titleCase).join(', '),
          city: titleCase(s(loc['city'])),
          state: s(loc['state']),
          zip: zip.length > 5 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip,
          phone: s(loc['telephone_number']),
        }
      : null,
    enumeration_date: s(r.basic?.['enumeration_date']),
    last_updated: s(r.basic?.['last_updated']),
  };
}

/**
 * Run the registry check for a provider on file and score it. `null` record →
 * `npi_not_found` (the whole verdict). Never throws on scoring; network errors
 * propagate so the caller can tell "not found" from "registry unreachable".
 */
export async function checkNpi(input: {
  npi: string;
  name: string;
  entity_type: 'individual' | 'organization';
  provider_type: string;
  specialty?: string;
}): Promise<NpiVerification> {
  const now = new Date().toISOString();
  if (!isValidNpiFormat(input.npi)) {
    return {
      provider: 'nppes',
      npi: input.npi,
      found: false,
      flags: ['npi_not_found'],
      summary: 'The NPI on the application is not a valid 10-digit NPI (check-digit failure).',
      checked_at: now,
    };
  }
  const rec = await lookupNpi(input.npi);
  if (!rec) {
    return {
      provider: 'nppes',
      npi: input.npi,
      found: false,
      flags: ['npi_not_found'],
      summary: 'No record for this NPI in the CMS NPI Registry. Confirm the number with the provider before enrollment.',
      checked_at: now,
    };
  }
  const sum = summarizeRecord(rec);
  const flags: string[] = [];
  const name_match = await namesMatch(input.name, sum.name);
  if (!name_match) flags.push('name_mismatch');
  if (sum.status !== 'Active') flags.push('inactive');
  if (sum.entity_type !== input.entity_type) flags.push('entity_type_mismatch');
  let taxonomy_match: boolean | undefined;
  if (sum.primary_taxonomy?.desc) {
    taxonomy_match = await taxonomyMatches(input.provider_type, sum.primary_taxonomy.desc, input.specialty);
    if (!taxonomy_match) flags.push('taxonomy_mismatch');
  }
  const summaryParts = [
    `NPPES lists ${sum.name || 'an unnamed record'} (${sum.entity_type}), status ${sum.status}`,
    sum.primary_taxonomy ? `primary taxonomy ${sum.primary_taxonomy.desc}` : '',
    sum.primary_taxonomy?.license ? `license ${sum.primary_taxonomy.license}${sum.primary_taxonomy.state ? ` (${sum.primary_taxonomy.state})` : ''}` : '',
  ].filter(Boolean);
  return {
    provider: 'nppes',
    npi: input.npi,
    found: true,
    registry_name: sum.name,
    entity_type: sum.entity_type,
    status: sum.status,
    ...(sum.primary_taxonomy ? { primary_taxonomy: sum.primary_taxonomy } : {}),
    practice_state: sum.practice?.state ?? '',
    enumeration_date: sum.enumeration_date,
    last_updated: sum.last_updated,
    name_match,
    ...(taxonomy_match !== undefined ? { taxonomy_match } : {}),
    flags,
    summary: `${summaryParts.join(' · ')}.${flags.length === 0 ? ' Matches the application.' : ''}`,
    checked_at: now,
  };
}
