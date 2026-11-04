/**
 * Argyle — SERVER ONLY. Ported from ht-cre's argyle.ts + argyle-voa.ts.
 *
 *   Income: create a user + Link user_token (the browser opens Argyle Link
 *   with it); after a payroll account connects, pull paystubs and derive a
 *   frequency-agnostic gross/net monthly figure.
 *   Assets: order a VOA verification for the user and mint a hosted session
 *   link (the bank-connect UI); once the report completes, reduce it to
 *   balances + institution summaries (never transactions or full numbers).
 *
 * Without creds every surface runs a labelled SIMULATION (served from
 * `/hosted/argyle`), marked `mode: 'simulated'` on the result.
 */
import { randomUUID } from 'node:crypto';
import { env, isArgyleLive } from '../env.js';
import { employerMatches } from '../ai/match.js';
import type { AssetsVerification, AssetsVerificationAccount, IncomeVerification } from '../domain/types.js';

export function argyleMode(): 'sandbox' | 'live' | 'simulated' {
  if (!isArgyleLive()) return 'simulated';
  return env.ARGYLE_API_BASE.includes('sandbox') ? 'sandbox' : 'live';
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${env.ARGYLE_API_KEY_ID}:${env.ARGYLE_API_KEY_SECRET}`).toString('base64');
}

async function argyleGet(path: string): Promise<unknown> {
  const res = await fetch(`${env.ARGYLE_API_BASE}${path}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`argyle_get_failed:${res.status}`);
  return res.json();
}
async function argylePost(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${env.ARGYLE_API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`argyle_post_failed:${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

/** Creates an Argyle user and returns its id + a Link user_token. */
export async function createArgyleUser(): Promise<{ id: string; user_token: string }> {
  if (!isArgyleLive()) return { id: `sim-${randomUUID()}`, user_token: 'simulated' };
  const data = await argylePost('/users', { external_id: `aiv-${randomUUID()}` });
  if (typeof data['id'] !== 'string' || typeof data['user_token'] !== 'string') throw new Error('argyle_create_user_bad_shape');
  return { id: data['id'], user_token: data['user_token'] };
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function daysBetween(start: unknown, end: unknown): number | null {
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;
  return (e - s) / 86_400_000;
}
const AVG_DAYS_PER_MONTH = 30.44;

interface PaystubLike {
  gross_pay?: unknown;
  net_pay?: unknown;
  currency?: unknown;
  employer?: unknown;
  paystub_period?: { start_date?: unknown; end_date?: unknown } | null;
  pay_period_start_date?: unknown;
  pay_period_end_date?: unknown;
}

/** Derive gross + net monthly income from recent paystubs (null until data lands). */
export async function fetchIncomeVerification(userId: string, expectedEmployers: string[]): Promise<IncomeVerification | null> {
  const now = new Date().toISOString();
  if (userId.startsWith('sim-')) {
    const employer = expectedEmployers[0] ?? 'Connected employer';
    const v: IncomeVerification = {
      provider: 'argyle',
      mode: 'simulated',
      employer,
      monthly_gross_income: 0,
      monthly_net_income: 0,
      currency: 'USD',
      expected_employers: expectedEmployers,
      employer_match: true,
      verified_at: now,
    };
    return v;
  }
  let employer = '';
  let currency = 'USD';
  try {
    const emp = (await argyleGet(`/employments?user=${encodeURIComponent(userId)}&limit=10`)) as {
      results?: Array<{ employer?: unknown; base_pay?: { currency?: unknown } | null }>;
    };
    const first = emp.results?.find((e) => typeof e.employer === 'string' && e.employer);
    if (first && typeof first.employer === 'string') employer = first.employer;
    const cur = emp.results?.find((e) => e.base_pay && typeof e.base_pay.currency === 'string');
    if (cur?.base_pay && typeof cur.base_pay.currency === 'string') currency = cur.base_pay.currency;
  } catch {
    /* employer can still come from paystubs */
  }
  let paystubs: PaystubLike[] = [];
  try {
    const ps = (await argyleGet(`/paystubs?user=${encodeURIComponent(userId)}&limit=12`)) as { results?: PaystubLike[] };
    if (Array.isArray(ps.results)) paystubs = ps.results;
  } catch {
    return null;
  }
  const grossMonthly: number[] = [];
  const netMonthly: number[] = [];
  for (const p of paystubs) {
    const gross = num(p.gross_pay);
    const net = num(p.net_pay);
    const days =
      daysBetween(p.paystub_period?.start_date, p.paystub_period?.end_date) ??
      daysBetween(p.pay_period_start_date, p.pay_period_end_date);
    if (!days) continue;
    const factor = AVG_DAYS_PER_MONTH / days;
    if (gross !== null) grossMonthly.push(gross * factor);
    if (net !== null) netMonthly.push(net * factor);
    if (!employer && typeof p.employer === 'string' && p.employer) employer = p.employer;
    if (typeof p.currency === 'string' && p.currency) currency = p.currency;
  }
  if (grossMonthly.length === 0) return null;
  const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
  const monthly_gross_income = avg(grossMonthly);
  const monthly_net_income = netMonthly.length > 0 ? avg(netMonthly) : monthly_gross_income;
  const employerName = employer || 'Connected employer';
  const employer_match = expectedEmployers.length > 0 ? await employerMatches(expectedEmployers, [employerName]) : undefined;
  return {
    provider: 'argyle',
    mode: argyleMode(),
    employer: employerName,
    monthly_gross_income,
    monthly_net_income,
    currency,
    expected_employers: expectedEmployers,
    ...(employer_match !== undefined ? { employer_match } : {}),
    verified_at: now,
  };
}

// --- VOA (assets) ------------------------------------------------------------

/** Order (or reuse) a VOA verification and mint a hosted session link. */
export async function createVoaSessionLink(userId: string, redirectUrl: string): Promise<string> {
  if (userId.startsWith('sim-')) {
    return `${env.PUBLIC_URL}/hosted/argyle?session=${encodeURIComponent(userId)}&return=${encodeURIComponent(redirectUrl)}`;
  }
  const list = (await argyleGet(`/verifications?user=${encodeURIComponent(userId)}`)) as {
    results?: Array<{ id: string; status: { state: string }; report: { type: string } }>;
  };
  const TERMINAL = new Set(['COMPLETED', 'FAILED', 'ERROR']);
  let verificationId = list.results?.find((v) => v.report.type === 'voa' && !TERMINAL.has(v.status.state))?.id;
  if (!verificationId) {
    const created = await argylePost('/verifications', { user: userId, report: { type: 'voa' } });
    verificationId = String(created['id'] ?? '');
  }
  if (!verificationId) throw new Error('argyle_voa_create_failed');
  const session = await argylePost('/sessions', { verification: verificationId, redirect_url: redirectUrl });
  const link = str(session['link']);
  if (!link) throw new Error('argyle_session_bad_shape');
  return link;
}

interface VoaReportLike {
  assets?: { available_balance?: unknown; current_balance?: unknown } | null;
  consolidated_available_balance?: unknown;
  institutions?: Array<{ institution_name?: unknown; name?: unknown; accounts?: Array<Record<string, unknown>> }>;
  end_date?: unknown;
  created_date?: unknown;
}

function last4(v: unknown): string | undefined {
  const digits = (str(v) ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export function mapVoaReport(raw: unknown, reportId: string, now: string, mode: AssetsVerification['mode']): AssetsVerification | null {
  const report = (raw ?? {}) as VoaReportLike;
  const assets = report.assets ?? {};
  const accounts: AssetsVerificationAccount[] = [];
  for (const inst of Array.isArray(report.institutions) ? report.institutions : []) {
    const institution = str(inst.institution_name) ?? str(inst.name) ?? 'Connected institution';
    for (const acct of Array.isArray(inst.accounts) ? inst.accounts : []) {
      const current = num(acct['current_balance']) ?? num(acct['balance']);
      if (current === null) continue;
      const available = num(acct['available_balance']);
      const l4 = last4(acct['account_number']) ?? last4(acct['mask']);
      accounts.push({
        institution,
        account_type: str(acct['account_type']) ?? str(acct['type']) ?? 'account',
        ...(l4 ? { account_last4: l4 } : {}),
        current_balance: current,
        ...(available !== null ? { available_balance: available } : {}),
      });
    }
  }
  const totalAvailable = num(assets.available_balance) ?? num(report.consolidated_available_balance);
  const totalCurrent =
    num(assets.current_balance) ?? (accounts.length > 0 ? accounts.reduce((s, a) => s + a.current_balance, 0) : null) ?? totalAvailable;
  if (totalAvailable === null && totalCurrent === null) return null;
  return {
    provider: 'argyle',
    mode,
    report_id: reportId,
    total_available_balance: totalAvailable ?? totalCurrent ?? 0,
    total_current_balance: totalCurrent ?? totalAvailable ?? 0,
    balance_as_of: str(report.end_date) ?? str(report.created_date) ?? now,
    accounts,
    verified_at: now,
  };
}

/** Completed VOA result, or null while Argyle is still generating the report. */
export async function fetchVoaResult(userId: string, declaredAccounts: { institution: string; type: string }[]): Promise<AssetsVerification | null> {
  const now = new Date().toISOString();
  if (userId.startsWith('sim-')) {
    const accounts: AssetsVerificationAccount[] = (declaredAccounts.length ? declaredAccounts : [{ institution: 'Connected bank', type: 'checking' }]).map(
      (a, i) => ({ institution: a.institution, account_type: a.type, account_last4: String(1000 + i * 1111).slice(-4), current_balance: 0 }),
    );
    return {
      provider: 'argyle',
      mode: 'simulated',
      report_id: `sim-report-${userId.slice(4, 12)}`,
      total_available_balance: 0,
      total_current_balance: 0,
      balance_as_of: now.slice(0, 10),
      accounts,
      verified_at: now,
    };
  }
  const list = (await argyleGet(`/verifications?user=${encodeURIComponent(userId)}`)) as {
    results?: Array<{ id: string; status: { state: string }; report: { type: string; id?: string | null; json_url?: string | null } }>;
  };
  const completed = list.results?.find((v) => v.report.type === 'voa' && v.status.state === 'COMPLETED');
  if (!completed?.report.json_url) return null;
  const url = new URL(completed.report.json_url);
  if (url.protocol !== 'https:' || !(url.hostname === 'argyle.com' || url.hostname.endsWith('.argyle.com'))) {
    throw new Error('argyle_report_url_rejected');
  }
  const res = await fetch(url.toString(), { headers: { Authorization: authHeader() } });
  if (!res.ok) throw new Error(`argyle_report_failed:${res.status}`);
  return mapVoaReport(await res.json(), completed.report.id ?? completed.id, now, argyleMode());
}
