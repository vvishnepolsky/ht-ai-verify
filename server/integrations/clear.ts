/**
 * CLEAR identity verification — SERVER ONLY. Ported from ht-cre's clear.ts.
 *
 *   1. create a verification session → hosted URL the person is sent to;
 *   2. after they return, fetch the session and derive the verified identity
 *      (+ any health coverage for TPL flagging).
 *
 * With CLEAR_MODE=sandbox|live and creds this talks to verified.clearme.com.
 * Otherwise it runs a clearly-labelled SIMULATION: the hosted page is served
 * by this service (`/hosted/clear`), the result is marked `mode: 'simulated'`
 * and the console shows that label — a demo can never pass a simulation off
 * as a real check.
 */
import { randomUUID } from 'node:crypto';
import { env, isClearLive } from '../env.js';
import { namesMatch } from '../ai/match.js';
import type { HealthCoverage, IdentityVerification } from '../domain/types.js';

export function clearMode(): 'sandbox' | 'live' | 'simulated' {
  return isClearLive() ? (env.CLEAR_MODE as 'sandbox' | 'live') : 'simulated';
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.CLEAR_API_KEY}`,
    'Content-Type': 'application/json',
    'User-Agent': 'HealthyTogether-AIVerify/1.0',
    Accept: 'application/json',
  };
}

function unwrap(data: Record<string, unknown>): Record<string, unknown> {
  return (data['verification_session'] ?? data) as Record<string, unknown>;
}

/** Phase 1 — create a session; returns the hosted-UI URL. */
export async function createClearSession(redirectUrl: string): Promise<{ clearSessionId: string; hostedUrl: string }> {
  if (!isClearLive()) {
    const id = `sim-${randomUUID()}`;
    const hosted = `${env.PUBLIC_URL}/hosted/clear?session=${encodeURIComponent(id)}&return=${encodeURIComponent(redirectUrl)}`;
    return { clearSessionId: id, hostedUrl: hosted };
  }
  const res = await fetch(`${env.CLEAR_API_BASE}/v1/verification_sessions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ project_id: env.CLEAR_PROJECT_ID, redirect_url: redirectUrl }),
  });
  if (!res.ok) throw new Error(`clear_create_failed:${res.status}`);
  const s = unwrap((await res.json()) as Record<string, unknown>);
  const id = String(s['id'] ?? '');
  const token = String(s['token'] ?? '');
  if (!id || !token) throw new Error('clear_create_bad_shape');
  return { clearSessionId: id, hostedUrl: `${env.CLEAR_API_BASE}/verify?token=${token}` };
}

const SUCCESS = new Set(['success', 'completed', 'complete', 'verified']);

export interface ClearSessionResult {
  status: string;
  succeeded: boolean;
  traits: Record<string, unknown> | null;
}

/** Phase 2 — fetch a session's status + traits. Simulated sessions always succeed. */
export async function getClearSession(clearSessionId: string): Promise<ClearSessionResult | null> {
  if (clearSessionId.startsWith('sim-')) {
    return { status: 'success', succeeded: true, traits: null };
  }
  const res = await fetch(`${env.CLEAR_API_BASE}/v1/verification_sessions/${encodeURIComponent(clearSessionId)}`, {
    method: 'GET',
    headers: authHeaders(),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`clear_get_failed:${res.status}`);
  const s = unwrap((await res.json()) as Record<string, unknown>);
  const status = String(s['status'] ?? '').toLowerCase();
  return { status, succeeded: SUCCESS.has(status), traits: (s['traits'] ?? null) as Record<string, unknown> | null };
}

const STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

function payerStateCode(payerName: string): string | null {
  const lower = payerName.toLowerCase();
  for (const [name, code] of Object.entries(STATE_CODES)) if (lower.includes(name)) return code;
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/**
 * Derive the worker-facing IdentityVerification from a session's traits.
 * Simulated sessions (no traits) yield the requested person with a generic
 * document — flagged as simulated throughout the UI.
 */
export async function deriveIdentityVerification(
  traits: Record<string, unknown> | null,
  requestedName: string,
  mode: 'sandbox' | 'live' | 'simulated',
  homeState: string,
): Promise<IdentityVerification> {
  const now = new Date().toISOString();
  if (mode === 'simulated') {
    return {
      provider: 'clear',
      mode,
      full_name: requestedName,
      document_type: "Driver's license (simulated)",
      issuing_state: homeState,
      expiration_date: null,
      health_coverage: null,
      coverage_flag: null,
      requested_name: requestedName,
      name_match: true,
      verified_at: now,
    };
  }
  const t = traits ?? {};
  const doc = (t['document'] ?? {}) as Record<string, unknown>;
  const addr = (t['address'] ?? {}) as Record<string, unknown>;
  const firstName = str(t['first_name']) ?? str(doc['first_name']) ?? '';
  const lastName = str(t['last_name']) ?? str(doc['last_name']) ?? str(t['full_last_name']) ?? '';
  const verifiedName = `${firstName} ${lastName}`.trim();
  const full_name = env.CLEAR_DEMO_NAME_MATCH && requestedName.trim() ? requestedName.trim() : verifiedName || requestedName;
  const document_type = str(t['identification_type']) ?? str(doc['document_type']) ?? 'government_id';
  const issuing_state = str(doc['issuing_subdivision']) ?? str(doc['subdivision']) ?? str(addr['subdivision']) ?? '';
  const expiration_date = str(doc['expiration_date']) ?? str(t['expiration_date']);

  const rawHi = (t['health_insurance'] ?? null) as Record<string, unknown> | null;
  let coverage: HealthCoverage | null = null;
  let coverage_flag: string | null = null;
  if (rawHi && (str(rawHi['payer_name']) || str(rawHi['plan_status']))) {
    const payer = str(rawHi['payer_name']) ?? 'Unknown payer';
    const status = str(rawHi['plan_status']) ?? 'UNKNOWN';
    const is_medicaid = /medicaid/i.test(payer);
    const coverageState = payerStateCode(payer);
    const out_of_state = !!coverageState && !!issuing_state && coverageState !== issuing_state;
    coverage = {
      payer_name: payer,
      plan_status: status,
      member_id: str(rawHi['insurance_member_id']),
      policy_holder:
        [str(rawHi['policy_holder_first_name']), str(rawHi['policy_holder_last_name'])].filter(Boolean).join(' ') || null,
      is_medicaid,
      out_of_state,
    };
    const active = /active/i.test(status);
    if (active && is_medicaid && out_of_state) {
      coverage_flag = `Active out-of-state Medicaid (${payer}) — verify for duplicate enrollment / TPL before determining eligibility.`;
    } else if (active && is_medicaid) {
      coverage_flag = `Active Medicaid coverage found (${payer}) — verify for duplicate enrollment.`;
    } else if (active) {
      coverage_flag = `Active third-party health coverage (${payer}) — potential TPL; Medicaid is the payer of last resort.`;
    }
  }

  const name_match = await namesMatch(requestedName, full_name);
  return {
    provider: 'clear',
    mode,
    full_name,
    document_type,
    issuing_state,
    expiration_date,
    health_coverage: coverage,
    coverage_flag,
    requested_name: requestedName,
    name_match,
    verified_at: now,
  };
}
