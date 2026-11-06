/**
 * CLEAR identity verification — SERVER ONLY. Ported from ht-cre's clear.ts.
 *
 *   1. create a verification session → hosted URL the person is sent to;
 *   2. after they return, fetch the session and derive the verified identity
 *      plus any health coverage CLEAR discovered (duplicate-enrollment / TPL
 *      flagging for the worker).
 *
 * Coverage discovery: CLEAR's sandbox never returns `traits.health_insurance`,
 * so — exactly like the State-X and Georgia CLEAR demos' DEMO_COVERAGE_SCENARIO
 * — `CLEAR_DEMO_COVERAGE` overlays a deterministic coverage record on
 * household identity checks (default: active New York Medicaid). The record
 * is marked `source: 'demo'` and the worker sees that label.
 *
 * With CLEAR_MODE=sandbox|live and creds this talks to verified.clearme.com.
 * Otherwise it runs a clearly-labelled SIMULATION: the hosted page is served
 * by this service (`/hosted/clear`), the result is marked `mode: 'simulated'`
 * and the console shows that label — a demo can never pass a simulation off
 * as a real check.
 */
import { randomUUID } from 'node:crypto';
import { env, isClearDemoCoverageOn, isClearLive } from '../env.js';
import { namesMatch } from '../ai/match.js';
import type { CoverageFinding, HealthCoverage, IdentityVerification } from '../domain/types.js';

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

const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

export function stateName(code: string | null | undefined): string | null {
  if (!code) return null;
  return STATE_NAMES[code.toUpperCase()] ?? code;
}

/** Known Medicaid payer ids (CLEAR payer_id → state), as in the State-X demo's PAYER_STATE table. */
const MEDICAID_PAYER_STATE: Record<string, string> = { SCMCD: 'SC', ILMCD: 'IL', NYMCD: 'NY', GAMCD: 'GA', TNMCD: 'TN' };

/** Resolve the state a payer belongs to: known payer id, then a state name in the payer name. */
function payerStateCode(payerId: string | null, payerName: string): string | null {
  if (payerId && MEDICAID_PAYER_STATE[payerId.toUpperCase()]) return MEDICAID_PAYER_STATE[payerId.toUpperCase()]!;
  const lower = payerName.toLowerCase();
  for (const [code, name] of Object.entries(STATE_NAMES)) if (lower.includes(name.toLowerCase())) return code;
  return null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' && v !== 'REDACTED' ? v.trim() : null);

/**
 * Build the coverage record + worker flag from a health_insurance payload.
 * `homeState` is the agency's state: Medicaid from any other state is a
 * duplicate-enrollment finding; in-state Medicaid is a duplicate-enrollment
 * check; any other active plan is third-party liability.
 */
export function classifyCoverage(
  hi: Record<string, unknown> | null,
  homeState: string,
  source: 'clear' | 'demo',
): { coverage: HealthCoverage | null; flag: string | null; finding: CoverageFinding } {
  if (!hi) return { coverage: null, flag: null, finding: null };
  const payer = str(hi['payer_name']);
  const status = str(hi['plan_status']);
  if (!payer && !status) return { coverage: null, flag: null, finding: null };
  const payer_name = payer ?? 'Unknown payer';
  const payer_id = str(hi['payer_id']);
  const plan_status = (status ?? 'UNKNOWN').toUpperCase();
  const explicitType = str(hi['coverage_type']);
  const is_medicaid = explicitType === 'medicaid' || (!!payer_id && !!MEDICAID_PAYER_STATE[payer_id.toUpperCase()]) || /medicaid/i.test(payer_name);
  const coverage_state = is_medicaid ? payerStateCode(payer_id, payer_name) : null;
  const is_active = /active/i.test(plan_status);
  const out_of_state = is_medicaid && !!coverage_state && coverage_state !== homeState.toUpperCase();
  const coverage: HealthCoverage = {
    payer_id,
    payer_name,
    plan_status,
    member_id: str(hi['insurance_member_id']) ?? str(hi['member_id']),
    group_id: str(hi['group_id']),
    policy_holder: [str(hi['policy_holder_first_name']), str(hi['policy_holder_last_name'])].filter(Boolean).join(' ') || null,
    policy_holder_relationship: str(hi['policy_holder_relationship']),
    coverage_start_date: str(hi['coverage_start_date']) ?? str(hi['effective_date']),
    coverage_type: explicitType ?? (is_medicaid ? 'medicaid' : null),
    coverage_state,
    coverage_state_name: stateName(coverage_state),
    is_medicaid,
    is_active,
    out_of_state,
    source,
  };
  const home = stateName(homeState) ?? homeState;
  let flag: string | null = null;
  let finding: CoverageFinding = null;
  if (!is_active) {
    finding = 'inactive';
    flag = `${payer_name} coverage is ${plan_status.toLowerCase()} — no action unless the application claims it is current.`;
  } else if (is_medicaid && out_of_state) {
    finding = 'oos_medicaid';
    const other = coverage.coverage_state_name ?? 'another state';
    flag = `Active Medicaid in ${other} (${payer_name}) — possible duplicate enrollment. Confirm the household lives in ${home} (for example, proof of residency) or that the ${other} coverage has ended before determining eligibility.`;
  } else if (is_medicaid) {
    finding = 'in_state_medicaid';
    flag = `Active ${home} Medicaid already on file (${payer_name}) — check for an existing case before opening a new one.`;
  } else {
    finding = 'third_party';
    flag = `Active third-party coverage (${payer_name}${coverage.policy_holder ? `, policy holder ${coverage.policy_holder}` : ''}) — record it for third-party liability; Medicaid is the payer of last resort.`;
  }
  return { coverage, flag, finding };
}

/**
 * The CLEAR_DEMO_COVERAGE overlay, shaped like CLEAR's `traits.health_insurance`
 * so classifyCoverage treats it exactly like a real payload.
 */
export function demoCoveragePayload(personName: string): Record<string, unknown> | null {
  if (!isClearDemoCoverageOn()) return null;
  const [first, ...rest] = personName.trim().split(/\s+/);
  if (env.CLEAR_DEMO_COVERAGE === 'employer_plan') {
    return {
      payer_id: 'AETNA',
      payer_name: 'Aetna',
      plan_status: 'ACTIVE',
      group_id: 'G123456789',
      insurance_member_id: 'W123456789',
      policy_holder_first_name: 'Jane',
      policy_holder_last_name: rest.join(' ') || 'Doe',
      policy_holder_relationship: 'spouse',
      coverage_start_date: '2026-01-01',
      coverage_type: 'employer',
    };
  }
  const st = env.CLEAR_DEMO_COVERAGE_STATE;
  return {
    payer_id: `${st}MCD`,
    payer_name: `${stateName(st) ?? st} Medicaid`,
    plan_status: env.CLEAR_DEMO_COVERAGE_STATUS,
    insurance_member_id: env.CLEAR_DEMO_COVERAGE_MEMBER_ID,
    policy_holder_first_name: first ?? null,
    policy_holder_last_name: rest.join(' ') || null,
    coverage_start_date: env.CLEAR_DEMO_COVERAGE_START,
    coverage_type: 'medicaid',
  };
}

/** What the demo overlay would report — for /api/config and the Demo settings page. */
export function describeDemoCoverage(homeState: string): { scenario: string; summary: string } | null {
  const payload = demoCoveragePayload('Demo Person');
  if (!payload) return null;
  const { coverage } = classifyCoverage(payload, homeState, 'demo');
  if (!coverage) return null;
  const where = coverage.is_medicaid ? (coverage.out_of_state ? ` — out of state for ${stateName(homeState) ?? homeState}` : ' — in state') : '';
  return {
    scenario: env.CLEAR_DEMO_COVERAGE,
    summary: `${coverage.plan_status === 'ACTIVE' ? 'Active' : coverage.plan_status} ${coverage.payer_name}${where}`,
  };
}

/**
 * Derive the worker-facing IdentityVerification from a session's traits.
 * Simulated sessions (no traits) yield the requested person with a generic
 * document — flagged as simulated throughout the UI. `withCoverage` applies
 * the demo coverage overlay (households only; providers verify identity only).
 */
export async function deriveIdentityVerification(
  traits: Record<string, unknown> | null,
  requestedName: string,
  mode: 'sandbox' | 'live' | 'simulated',
  homeState: string,
  withCoverage = true,
): Promise<IdentityVerification> {
  const now = new Date().toISOString();
  const t = traits ?? {};
  const doc = (t['document'] ?? {}) as Record<string, unknown>;
  const addr = (t['address'] ?? {}) as Record<string, unknown>;

  let full_name: string;
  let document_type: string;
  let issuing_state: string;
  let expiration_date: string | null;
  let name_match: boolean;
  if (mode === 'simulated') {
    full_name = requestedName;
    document_type = "Driver's license (simulated)";
    issuing_state = homeState;
    expiration_date = null;
    name_match = true;
  } else {
    const firstName = str(t['first_name']) ?? str(doc['first_name']) ?? '';
    const lastName = str(t['last_name']) ?? str(doc['last_name']) ?? str(t['full_last_name']) ?? '';
    const verifiedName = `${firstName} ${lastName}`.trim();
    full_name = env.CLEAR_DEMO_NAME_MATCH && requestedName.trim() ? requestedName.trim() : verifiedName || requestedName;
    document_type = str(t['identification_type']) ?? str(doc['document_type']) ?? 'government_id';
    issuing_state = str(doc['issuing_subdivision']) ?? str(doc['subdivision']) ?? str(addr['subdivision']) ?? '';
    expiration_date = str(doc['expiration_date']) ?? str(t['expiration_date']);
    name_match = await namesMatch(requestedName, full_name);
  }

  // Real coverage from CLEAR wins; the demo overlay only fills in when CLEAR returned none.
  const rawHi = (t['health_insurance'] ?? null) as Record<string, unknown> | null;
  let classified = classifyCoverage(rawHi, homeState, 'clear');
  if (!classified.coverage && withCoverage) classified = classifyCoverage(demoCoveragePayload(full_name), homeState, 'demo');

  return {
    provider: 'clear',
    mode,
    full_name,
    document_type,
    issuing_state,
    expiration_date,
    health_coverage: classified.coverage,
    coverage_flag: classified.flag,
    coverage_finding: classified.finding,
    requested_name: requestedName,
    name_match,
    verified_at: now,
  };
}
