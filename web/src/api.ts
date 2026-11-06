/** Console + flow API client and the client-side mirrors of the server types. */
const KEY_STORAGE = 'aiv-admin-key';

export function getAdminKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}
export function setAdminKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; admin?: boolean } = {}): Promise<T> {
  const admin = init.admin ?? path.startsWith('/api/');
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(admin && getAdminKey() ? { 'x-admin-key': getAdminKey() } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: 'bad_response', message: text };
  }
  if (!res.ok) {
    const b = body as { error?: string; message?: string };
    throw new ApiError(res.status, b.error ?? `http_${res.status}`, b.message ?? b.error ?? `HTTP ${res.status}`);
  }
  return body as T;
}

// --- shared types (mirror server/domain) ---------------------------------------

export type CaseKind = 'household' | 'provider';
export type TaskCategory =
  | 'identity'
  | 'income'
  | 'assets'
  | 'residency_housing'
  | 'expenses_deductions'
  | 'medical_bills'
  | 'npi'
  | 'license'
  | 'credential'
  | 'insurance';
export type TaskStatus = 'needed' | 'provided' | 'approved' | 'rejected';
export type RequestStatus = 'sent' | 'in_progress' | 'submitted' | 'under_review' | 'returned' | 'verified';
export type TaskMethod = 'upload' | 'clear' | 'argyle' | 'nppes';
export type Mode = 'sandbox' | 'live' | 'simulated';

export interface DeclaredFact {
  label: string;
  value: string;
}
export interface OcrResult {
  confidence: 'high' | 'low';
  matches_request: boolean;
  document_type_detected: string;
  holder_name?: string;
  name_match?: boolean;
  document_date?: string;
  valid_until?: string;
  is_current?: boolean;
  discrepancies?: { field: string; expected: string; found: string }[];
  flags?: string[];
  verdict: 'pass' | 'review';
  extracted: { label: string; value: string }[];
  summary: string;
  model?: string;
  analyzed_at: string;
}
export interface UploadedFileMeta {
  file_id: string;
  mime: string;
  filename?: string;
  size_bytes: number;
  source: 'camera' | 'upload';
  captured_at: string;
  ocr?: OcrResult;
  ocr_pending?: boolean;
}
export interface HealthCoverage {
  payer_id: string | null;
  payer_name: string;
  plan_status: string;
  member_id: string | null;
  group_id?: string | null;
  policy_holder: string | null;
  policy_holder_relationship?: string | null;
  coverage_start_date?: string | null;
  coverage_type: string | null;
  coverage_state: string | null;
  coverage_state_name: string | null;
  is_medicaid: boolean;
  is_active: boolean;
  out_of_state: boolean;
  source: 'clear' | 'demo';
}
export type CoverageFinding = 'oos_medicaid' | 'in_state_medicaid' | 'third_party' | 'inactive' | null;
export interface IdentityVerification {
  provider: 'clear';
  mode: Mode;
  full_name: string;
  document_type: string;
  issuing_state: string;
  expiration_date: string | null;
  health_coverage: HealthCoverage | null;
  coverage_flag: string | null;
  coverage_finding?: CoverageFinding;
  requested_name?: string;
  name_match?: boolean;
  verified_at: string;
}
export interface IncomeVerification {
  provider: 'argyle';
  mode: Mode;
  employer: string;
  monthly_gross_income: number;
  monthly_net_income: number;
  currency: string;
  expected_employers?: string[];
  employer_match?: boolean;
  verified_at: string;
}
export interface AssetsVerification {
  provider: 'argyle';
  mode: Mode;
  report_id: string;
  total_available_balance: number;
  total_current_balance: number;
  balance_as_of: string;
  accounts: { institution: string; account_type: string; account_last4?: string; current_balance: number; available_balance?: number }[];
  verified_at: string;
}
export interface NpiVerification {
  provider: 'nppes';
  npi: string;
  found: boolean;
  registry_name?: string;
  entity_type?: 'individual' | 'organization';
  status?: string;
  primary_taxonomy?: { code: string; desc: string; state?: string | null; license?: string | null };
  practice_state?: string;
  enumeration_date?: string;
  last_updated?: string;
  name_match?: boolean;
  taxonomy_match?: boolean;
  flags: string[];
  summary: string;
  checked_at: string;
}
export interface VerificationTask {
  id: string;
  category: TaskCategory;
  subject?: string;
  title: string;
  reason: string;
  required: boolean;
  methods: TaskMethod[];
  method: TaskMethod;
  status: TaskStatus;
  declared?: DeclaredFact[];
  expected_employers?: string[];
  files: UploadedFileMeta[];
  reviewer_note?: string;
  /** Set when a worker added this item during review. */
  added_by?: 'worker';
  added_at?: string;
  identity_verification?: IdentityVerification;
  income_verification?: IncomeVerification;
  assets_verification?: AssetsVerification;
  npi_verification?: NpiVerification;
  updated_at: string;
}
export interface RequestEvent {
  at: string;
  actor: 'applicant' | 'provider' | 'worker' | 'system';
  type: string;
  detail?: string;
}
export interface VerificationRequest {
  id: string;
  case_id: string;
  kind: CaseKind;
  subject_name: string;
  token_expires_at: string;
  status: RequestStatus;
  tasks: VerificationTask[];
  events: RequestEvent[];
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  verified_at?: string;
}
export interface ApplicantView {
  kind: CaseKind;
  subject_name: string;
  agency_name: string;
  status: RequestStatus;
  token_expires_at: string;
  tasks: VerificationTask[];
  submitted_at?: string;
  verified_at?: string;
  integrations: { clear: Mode | 'off'; argyle: Mode | 'off' };
}
export interface RequestSummary {
  id: string;
  status: RequestStatus;
  task_count: number;
  provided_count: number;
  approved_count: number;
  flagged_count: number;
  submitted_at: string | null;
  updated_at: string;
}

// --- case types ------------------------------------------------------------------

export interface Contact {
  name: string;
  phone: string | null;
  email: string | null;
}
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}
export interface HouseholdMember {
  name: string;
  dob: string;
  relationship: 'self' | 'spouse' | 'partner' | 'child' | 'parent' | 'other';
  employers: { name: string; monthly_gross: number }[];
  other_income?: { source: string; monthly: number }[];
}
export interface HouseholdCase {
  kind: 'household';
  case_number: string;
  programs: string[];
  applied_at: string;
  primary_contact: Contact;
  address: Address;
  members: HouseholdMember[];
  housing: { type: 'rent' | 'own' | 'other'; monthly_cost: number; landlord?: string; utilities: string[] };
  assets: { declared_total: number; accounts: { institution: string; type: string }[] };
  medical: { has_elderly_disabled: boolean; monthly_expenses: number };
  notes?: string;
}
export type CredentialType = 'state_license' | 'dea' | 'board_certification' | 'malpractice' | 'facility_license' | 'clia';
export interface ProviderCredential {
  type: CredentialType;
  label: string;
  number: string;
  issuer: string;
  state?: string;
  issued_on?: string;
  expires_on: string;
}
export interface ProviderCase {
  kind: 'provider';
  case_number: string;
  name: string;
  credential_suffix?: string;
  npi: string;
  entity_type: 'individual' | 'organization';
  provider_type: string;
  taxonomy_code?: string;
  specialty?: string;
  practice: { name: string; address: Address; phone: string | null };
  contact: Contact;
  enrollment: { application_type: 'new' | 'revalidation' | 'change'; submitted_at: string; medicaid_id?: string };
  credentials: ProviderCredential[];
  npi_check?: NpiVerification;
  notes?: string;
}
export type CaseData = HouseholdCase | ProviderCase;
export interface CaseRecord {
  id: string;
  kind: CaseKind;
  subject_name: string;
  data: CaseData;
  created_at: string;
  updated_at: string;
  request?: RequestSummary | null;
}
export interface Config {
  authRequired: boolean;
  agencyName: string;
  stateCode: string;
  publicUrl: string;
  integrations: { ai: string; sms: string; email: string; clear: string; argyle: string; nppes: string };
  clearDemoCoverage: { scenario: string; summary: string } | null;
  demoSeed: boolean;
}

/** A verification item the worker adds during review (mirrors the server's NewTaskDraft). */
export interface NewTaskDraft {
  category: TaskCategory;
  title: string;
  reason: string;
  subject?: string;
  required?: boolean;
  methods?: TaskMethod[];
}
export function allowedMethodsFor(category: TaskCategory): TaskMethod[] {
  switch (category) {
    case 'identity':
      return ['upload', 'clear'];
    case 'income':
    case 'assets':
      return ['upload', 'argyle'];
    default:
      return ['upload'];
  }
}
export interface AddTaskPreset {
  key: string;
  label: string;
  category: TaskCategory;
  title: string;
  reason: string;
}
/** Common things a worker asks for after review. The worker can edit every field or start blank. */
export const HOUSEHOLD_PRESETS: AddTaskPreset[] = [
  {
    key: 'residency',
    label: 'Proof of residency',
    category: 'residency_housing',
    title: 'Proof of where you live',
    reason: 'We need a document dated in the last 60 days that shows your name and your current home address in this state — for example a utility bill, a lease, a bank statement, or a letter from a government agency.',
  },
  {
    key: 'coverage_ended',
    label: 'Proof other coverage ended',
    category: 'insurance',
    title: 'Proof your other health coverage has ended',
    reason: 'Our records show health coverage in another state. Please send a termination or disenrollment letter from that program, or a notice showing the end date of that coverage.',
  },
  {
    key: 'citizenship',
    label: 'Citizenship or immigration status',
    category: 'identity',
    title: 'Proof of citizenship or immigration status',
    reason: 'Please send a U.S. passport, birth certificate, naturalization certificate, permanent resident card, or another immigration document for this person.',
  },
  {
    key: 'income',
    label: 'Additional income proof',
    category: 'income',
    title: 'Additional proof of income',
    reason: 'Please send your most recent pay stubs covering the last 30 days, or a letter from your employer showing your pay and hours.',
  },
  {
    key: 'childcare',
    label: 'Child care expenses',
    category: 'expenses_deductions',
    title: 'Proof of child care expenses',
    reason: 'Please send a statement or receipt from your child care provider showing what you pay each month.',
  },
];
export const PROVIDER_PRESETS: AddTaskPreset[] = [
  {
    key: 'license',
    label: 'State license',
    category: 'license',
    title: 'Current state license',
    reason: 'Please upload the current license certificate or a verification printout from the state licensing board showing the license number, status, and expiration date.',
  },
  {
    key: 'malpractice',
    label: 'Liability insurance',
    category: 'insurance',
    title: 'Professional liability insurance certificate',
    reason: 'Please upload the current certificate of insurance showing the insured name, policy number, coverage limits, and the policy period.',
  },
  {
    key: 'board',
    label: 'Board certification',
    category: 'credential',
    title: 'Board certification',
    reason: 'Please upload the current board certification or a verification printout from the certifying board.',
  },
  {
    key: 'w9',
    label: 'IRS Form W-9',
    category: 'credential',
    title: 'Signed IRS Form W-9',
    reason: 'Please upload a signed W-9 for the billing entity so payments can be set up.',
  },
];
export interface Delivery {
  sms: boolean;
  email: boolean;
  hosted_url: string;
  channel: 'sms' | 'email';
}
export interface NppesSummary {
  npi: string;
  name: string;
  entity_type: 'individual' | 'organization';
  status: string;
  credential: string;
  primary_taxonomy: { code: string; desc: string; state: string | null; license: string | null } | null;
  practice: { name: string; street: string; city: string; state: string; zip: string; phone: string } | null;
  enumeration_date: string;
  last_updated: string;
}

// --- labels ---------------------------------------------------------------------

export const CATEGORY_LABELS: Record<TaskCategory, string> = {
  identity: 'Identity',
  income: 'Income',
  assets: 'Assets & banking',
  residency_housing: 'Residency & housing',
  expenses_deductions: 'Expenses & deductions',
  medical_bills: 'Medical bills',
  npi: 'NPI registry',
  license: 'Licenses',
  credential: 'Credentials',
  insurance: 'Insurance',
};
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  needed: 'Needed',
  provided: 'Provided',
  approved: 'Approved',
  rejected: 'Needs attention',
};
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  sent: 'Link sent',
  in_progress: 'In progress',
  submitted: 'Submitted',
  under_review: 'Under review',
  returned: 'Returned',
  verified: 'Verified',
};
export const METHOD_LABELS: Record<TaskMethod, string> = {
  upload: 'Photo or file upload',
  clear: 'CLEAR identity',
  argyle: 'Argyle',
  nppes: 'NPI Registry (automatic)',
};
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';
export function requestTone(s: RequestStatus): Tone {
  return s === 'verified' ? 'success' : s === 'returned' ? 'warning' : s === 'submitted' ? 'primary' : s === 'under_review' ? 'info' : s === 'in_progress' ? 'info' : 'neutral';
}
export function taskTone(s: TaskStatus): Tone {
  return s === 'approved' ? 'success' : s === 'rejected' ? 'warning' : s === 'provided' ? 'info' : 'neutral';
}
export const FLAG_LABELS: Record<string, string> = {
  name_mismatch: 'Belongs to someone else',
  outdated_document: 'No longer in effect',
  data_mismatch: 'Contradicts the application',
  wrong_document_type: 'Wrong document type',
  authenticity_concern: 'Possible alteration',
  low_confidence: 'Hard to read',
  npi_not_found: 'NPI not in registry',
  inactive: 'NPI deactivated',
  taxonomy_mismatch: 'Taxonomy differs',
  entity_type_mismatch: 'Entity type differs',
};
export function fileFlagText(flag: string, f: UploadedFileMeta, subject?: string): string {
  const o = f.ocr;
  switch (flag) {
    case 'name_mismatch':
      return `Document may belong to someone else${o?.holder_name ? ` (reads: ${o.holder_name})` : ''} — expected ${subject ?? 'the task subject'}.`;
    case 'outdated_document':
      return `This document is no longer in effect${o?.valid_until ? ` (ended ${o.valid_until})` : ''} — ask for the current one.`;
    case 'data_mismatch': {
      const d = o?.discrepancies?.[0];
      return d ? `Contradicts the application — ${d.field.toLowerCase()} reads ${d.found}; application says ${d.expected}.` : 'Contradicts what was reported.';
    }
    case 'wrong_document_type':
      return `Does not look like the requested document (reads as ${o?.document_type_detected ?? 'something else'}).`;
    case 'authenticity_concern':
      return 'Shows signs of alteration — verify with the issuer.';
    case 'low_confidence':
      return 'Image is hard to read — verify manually.';
    default:
      return flag;
  }
}
