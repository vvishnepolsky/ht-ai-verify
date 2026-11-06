/**
 * Domain types for the verification workflow — ported from ht-cre's
 * interview-service `checklist/types.ts` and generalized over two subjects:
 *
 *   - a **household** that applied for benefits (collected over an SMS link), and
 *   - a **Medicaid provider** being enrolled / credentialed (collected over an
 *     email link).
 *
 * The request aggregate (tasks + audit events) is persisted as JSONB and
 * transformed only by the pure reducers in `lifecycle.ts`.
 */

export type CaseKind = 'household' | 'provider';

/** Task categories. The first six are household; the last four are provider. */
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

export const CATEGORY_ORDER: TaskCategory[] = [
  'npi',
  'identity',
  'income',
  'assets',
  'residency_housing',
  'expenses_deductions',
  'medical_bills',
  'license',
  'credential',
  'insurance',
];

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

/**
 * - `needed`: awaiting the applicant/provider (initial state).
 * - `provided`: fulfilled and awaiting review; method-neutral.
 * - `approved` / `rejected`: worker decisions. Rejected carries `reviewer_note`
 *   and can be re-provided.
 */
export type TaskStatus = 'needed' | 'provided' | 'approved' | 'rejected';

/** Lifecycle: sent → in_progress → submitted → under_review → returned | verified. */
export type RequestStatus = 'sent' | 'in_progress' | 'submitted' | 'under_review' | 'returned' | 'verified';

/**
 * How a task can be fulfilled.
 * - `upload`: photo or file (AI first-pass review runs on it).
 * - `clear`: CLEAR identity verification (photo-ID tasks).
 * - `argyle`: Argyle payroll Link (income) or hosted bank/VOA session (assets).
 * - `nppes`: automatic NPI Registry check (provider NPI task; system-fulfilled).
 */
export type TaskMethod = 'upload' | 'clear' | 'argyle' | 'nppes';

/** A fact the case data declares that the uploaded document should agree with. */
export interface DeclaredFact {
  label: string;
  value: string;
}

/**
 * Health coverage CLEAR's identity check discovered (traits.health_insurance),
 * shaped after the CLEAR Verified API payload the State-X / Georgia demos use.
 */
export interface HealthCoverage {
  payer_id: string | null;
  payer_name: string;
  plan_status: string;
  member_id: string | null;
  group_id?: string | null;
  policy_holder: string | null;
  /** Policy holder's relationship to the person when someone else holds the policy (e.g. 'spouse'). */
  policy_holder_relationship?: string | null;
  coverage_start_date?: string | null;
  /** 'medicaid' | 'employer' | 'marketplace' | 'medicare' | 'other' | null when unknown. */
  coverage_type: string | null;
  /** State the coverage belongs to (a Medicaid program's state), when it can be resolved. */
  coverage_state: string | null;
  coverage_state_name: string | null;
  is_medicaid: boolean;
  is_active: boolean;
  /** Medicaid from a state other than the agency's (duplicate-enrollment risk). */
  out_of_state: boolean;
  /** 'clear' when CLEAR returned it; 'demo' when the CLEAR_DEMO_COVERAGE overlay supplied it. */
  source: 'clear' | 'demo';
}

/** Worker-facing classification of the coverage CLEAR found. */
export type CoverageFinding = 'oos_medicaid' | 'in_state_medicaid' | 'third_party' | 'inactive' | null;

export interface IdentityVerification {
  provider: 'clear';
  /** 'sandbox' | 'live' | 'simulated' — the hosted flow never hides a simulation. */
  mode: 'sandbox' | 'live' | 'simulated';
  full_name: string;
  document_type: string;
  issuing_state: string;
  expiration_date: string | null;
  health_coverage: HealthCoverage | null;
  /** Human-readable worker note derived from the coverage (null when nothing to flag). */
  coverage_flag: string | null;
  coverage_finding?: CoverageFinding;
  requested_name?: string;
  name_match?: boolean;
  verified_at: string;
}

export interface IncomeVerification {
  provider: 'argyle';
  mode: 'sandbox' | 'live' | 'simulated';
  employer: string;
  monthly_gross_income: number;
  monthly_net_income: number;
  currency: string;
  expected_employers?: string[];
  employer_match?: boolean;
  verified_at: string;
}

export interface AssetsVerificationAccount {
  institution: string;
  account_type: string;
  account_last4?: string;
  current_balance: number;
  available_balance?: number;
}

export interface AssetsVerification {
  provider: 'argyle';
  mode: 'sandbox' | 'live' | 'simulated';
  report_id: string;
  total_available_balance: number;
  total_current_balance: number;
  balance_as_of: string;
  accounts: AssetsVerificationAccount[];
  verified_at: string;
}

/** Result of the automatic NPI Registry (NPPES) check for a provider. */
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
  /** Name on file vs. registry name (AI/normalized match). Absent when nothing to compare. */
  name_match?: boolean;
  /** Does the case's provider type agree with the registry taxonomy? */
  taxonomy_match?: boolean;
  /** Issue codes: 'npi_not_found' | 'name_mismatch' | 'inactive' | 'taxonomy_mismatch' | 'entity_type_mismatch'. */
  flags: string[];
  summary: string;
  checked_at: string;
}

export type EventActor = 'applicant' | 'provider' | 'worker' | 'system';

export type RequestEventType =
  | 'created'
  | 'link_sent'
  | 'opened'
  | 'file_uploaded'
  | 'file_removed'
  | 'ai_reviewed'
  | 'income_verified'
  | 'assets_verified'
  | 'identity_verified'
  | 'npi_verified'
  | 'submitted'
  | 'review_started'
  | 'task_approved'
  | 'task_rejected'
  | 'task_added'
  | 'task_evidence_cleared'
  | 'returned'
  | 'link_resent'
  | 'returned_link_sent'
  | 'verified';

export interface RequestEvent {
  at: string;
  actor: EventActor;
  type: RequestEventType;
  detail?: string;
}

export interface OcrExtractedField {
  label: string;
  value: string;
}

export interface OcrDiscrepancy {
  field: string;
  expected: string;
  found: string;
}

/** AI first-pass review of one uploaded document, scored against its task. */
export interface OcrResult {
  confidence: 'high' | 'low';
  matches_request: boolean;
  document_type_detected: string;
  holder_name?: string;
  name_match?: boolean;
  document_date?: string;
  valid_until?: string;
  is_current?: boolean;
  discrepancies?: OcrDiscrepancy[];
  /** 'name_mismatch' | 'outdated_document' | 'data_mismatch' | 'wrong_document_type' | 'low_confidence' | 'authenticity_concern' */
  flags?: string[];
  /** Overall verdict for the worker: 'pass' (no flags) | 'review' (flags present). */
  verdict: 'pass' | 'review';
  extracted: OcrExtractedField[];
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
  /** Set while the AI review is still running (uploads never wait on it). */
  ocr_pending?: boolean;
}

export interface VerificationTask {
  id: string;
  category: TaskCategory;
  /** Person this verification belongs to; undefined for household-level items. */
  subject?: string;
  title: string;
  reason: string;
  required: boolean;
  /** Methods the applicant/provider may use. The first is the default. */
  methods: TaskMethod[];
  /** Method actually used (after fulfilment). */
  method: TaskMethod;
  status: TaskStatus;
  /** Case facts the document must agree with (fed to the AI review). */
  declared?: DeclaredFact[];
  expected_employers?: string[];
  files: UploadedFileMeta[];
  reviewer_note?: string;
  /** Set when a worker added this item during review (not derived from the case data). */
  added_by?: 'worker';
  added_at?: string;
  identity_verification?: IdentityVerification;
  income_verification?: IncomeVerification;
  assets_verification?: AssetsVerification;
  npi_verification?: NpiVerification;
  /** Provider-side ids (stripped from the hosted view). */
  clear_session_id?: string;
  argyle_user_id?: string;
  updated_at: string;
}

export interface VerificationRequest {
  id: string;
  case_id: string;
  kind: CaseKind;
  subject_name: string;
  token_hash: string;
  token_expires_at: string;
  status: RequestStatus;
  tasks: VerificationTask[];
  events: RequestEvent[];
  created_at: string;
  updated_at: string;
  submitted_at?: string;
  verified_at?: string;
}

/** Hosted-flow projection (PHI/secret minimization): no hashes, ids, or events. */
export interface ApplicantView {
  kind: CaseKind;
  subject_name: string;
  agency_name: string;
  status: RequestStatus;
  token_expires_at: string;
  tasks: VerificationTask[];
  submitted_at?: string;
  verified_at?: string;
  integrations: { clear: 'sandbox' | 'live' | 'simulated' | 'off'; argyle: 'sandbox' | 'live' | 'simulated' | 'off' };
}

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
