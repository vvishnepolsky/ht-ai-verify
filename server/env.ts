/**
 * Environment for the AI Verify service. Plain process.env reads with
 * defaults; the few hard requirements are validated at boot. Every
 * integration is feature-gated — the service boots without any of them and
 * the matching surface fails closed (or runs its clearly-labelled stub).
 *
 * Ported from ht-cre's interview-service env surface, reduced to the
 * verification-collection half.
 */
function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

const PORT = int('PORT', 4040);

export const env = {
  PORT,
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',

  /** Postgres connection string (Render injects DATABASE_URL). Empty → in-memory store (dev only). */
  DATABASE_URL: process.env.DATABASE_URL ?? '',

  /** Public base URL of this service — the secure links in SMS/email point here. No trailing slash. */
  PUBLIC_URL: (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/+$/, ''),

  /**
   * Worker-console password. When set, the console asks for it and sends it as
   * `x-admin-key` on every /api call. Empty → console is open (demo only).
   */
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD ?? '',

  /** Agency name shown in the console command bar and on the hosted flow. */
  AGENCY_NAME: process.env.AGENCY_NAME || 'Healthy Together',
  /** Two-letter state used for demo data, licensing text and branding copy. */
  STATE_CODE: (process.env.STATE_CODE || 'TN').toUpperCase(),

  /** Secure-link lifetime. */
  FLOW_TOKEN_TTL_DAYS: int('FLOW_TOKEN_TTL_DAYS', 14),
  MAX_FILES_PER_TASK: int('MAX_FILES_PER_TASK', 6),
  MAX_FILE_BYTES: int('MAX_FILE_BYTES', 12 * 1024 * 1024),
  MAX_REQUEST_BYTES: int('MAX_REQUEST_BYTES', 60 * 1024 * 1024),

  // --- OpenAI (document analysis + name/employer matching) ---
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  OPENAI_OCR_MODEL: process.env.OPENAI_OCR_MODEL || 'gpt-4o',
  OPENAI_MATCH_MODEL: process.env.OPENAI_MATCH_MODEL || 'gpt-4o-mini',

  // --- Twilio (SMS delivery of the household link) ---
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? '',

  // --- Email (provider link). 'resend' delivers via Resend; 'console' logs a marker only. ---
  EMAIL_VENDOR: (process.env.EMAIL_VENDOR === 'resend' ? 'resend' : 'console') as 'resend' | 'console',
  EMAIL_FROM: process.env.EMAIL_FROM ?? '',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',

  // --- CLEAR identity (sandbox with creds, else a clearly-labelled simulation) ---
  CLEAR_MODE: (process.env.CLEAR_MODE === 'sandbox' || process.env.CLEAR_MODE === 'live' ? process.env.CLEAR_MODE : 'stub') as
    | 'stub'
    | 'sandbox'
    | 'live',
  CLEAR_API_BASE: process.env.CLEAR_API_BASE || 'https://verified.clearme.com',
  CLEAR_API_KEY: process.env.CLEAR_API_KEY ?? '',
  CLEAR_PROJECT_ID: process.env.CLEAR_PROJECT_ID ?? '',
  /**
   * DEMO ONLY — CLEAR's sandbox verifies its OWN test identities, so the name
   * it returns is never the demo person's. On, the requested name is presented
   * as the verified one (document type/state/expiry still come from CLEAR).
   * Must stay off anywhere real: it would mask a genuine mismatch.
   */
  CLEAR_DEMO_NAME_MATCH: bool('CLEAR_DEMO_NAME_MATCH', false),
  /**
   * DEMO ONLY — what CLEAR's coverage discovery "finds" for a household's
   * identity check. CLEAR's sandbox never returns health coverage, so (as in
   * the State-X / Georgia CLEAR demos' DEMO_COVERAGE_SCENARIO) a deterministic
   * coverage record is overlaid on the verified identity:
   *   off            → whatever CLEAR actually returned (nothing in sandbox/simulation)
   *   medicaid       → active Medicaid with CLEAR_DEMO_COVERAGE_STATE's program
   *                    (out of state relative to STATE_CODE → duplicate-enrollment flag)
   *   employer_plan  → an active employer plan held by a spouse (third-party liability note only)
   * Must stay off anywhere real: it would invent coverage that does not exist.
   */
  CLEAR_DEMO_COVERAGE: ((): 'off' | 'medicaid' | 'employer_plan' => {
    const raw = (process.env.CLEAR_DEMO_COVERAGE ?? '').trim().toLowerCase();
    if (raw === 'medicaid' || raw === 'oos_medicaid') return 'medicaid';
    if (raw === 'employer_plan' || raw === 'employer') return 'employer_plan';
    return 'off';
  })(),
  /** State whose Medicaid program the demo coverage belongs to (two-letter code). */
  CLEAR_DEMO_COVERAGE_STATE: (process.env.CLEAR_DEMO_COVERAGE_STATE || 'NY').toUpperCase().slice(0, 2),
  CLEAR_DEMO_COVERAGE_STATUS: (process.env.CLEAR_DEMO_COVERAGE_STATUS || 'ACTIVE').toUpperCase(),
  CLEAR_DEMO_COVERAGE_MEMBER_ID: process.env.CLEAR_DEMO_COVERAGE_MEMBER_ID || 'NY48213579',
  /** ISO date the demo coverage started. */
  CLEAR_DEMO_COVERAGE_START: process.env.CLEAR_DEMO_COVERAGE_START || '2025-11-01',

  // --- Argyle (payroll income via Link; bank assets via a hosted VOA session) ---
  ARGYLE_API_BASE: process.env.ARGYLE_API_BASE || 'https://api-sandbox.argyle.com/v2',
  ARGYLE_API_KEY_ID: process.env.ARGYLE_API_KEY_ID ?? '',
  ARGYLE_API_KEY_SECRET: process.env.ARGYLE_API_KEY_SECRET ?? '',

  /** Seed the synthetic demo households + providers on first boot when the store is empty. */
  ENABLE_DEMO_SEED: bool('ENABLE_DEMO_SEED', true),
} as const;

export function isOpenAiConfigured(): boolean {
  return env.OPENAI_API_KEY.length > 0;
}
export function isTwilioConfigured(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
}
export function isEmailConfigured(): boolean {
  return env.EMAIL_VENDOR === 'resend' && Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}
export function isClearLive(): boolean {
  return env.CLEAR_MODE !== 'stub' && Boolean(env.CLEAR_API_KEY && env.CLEAR_PROJECT_ID);
}
export function isClearDemoCoverageOn(): boolean {
  return env.CLEAR_DEMO_COVERAGE !== 'off';
}
export function isArgyleLive(): boolean {
  return Boolean(env.ARGYLE_API_KEY_ID && env.ARGYLE_API_KEY_SECRET);
}
