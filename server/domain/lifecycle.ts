/**
 * Pure state-transition reducers for the verification request/task lifecycle.
 * Ported ~verbatim from ht-cre's `checklist/lifecycle.ts`.
 *
 * No I/O, no side effects; inputs are never mutated.
 * - AC-6: the applicant reducer has no branch that approves/rejects a task or
 *   moves a request into under_review/returned/verified — those live only in
 *   `applyReviewAction` (worker).
 * - AU-2: every successful state change appends a RequestEvent.
 * - SI-10: deny-by-default — guards check an explicit allow-list first.
 */
import type {
  AssetsVerification,
  DeclaredFact,
  EventActor,
  IdentityVerification,
  IncomeVerification,
  NpiVerification,
  RequestEvent,
  RequestEventType,
  RequestStatus,
  TaskCategory,
  TaskMethod,
  TaskStatus,
  UploadedFileMeta,
  VerificationRequest,
  VerificationTask,
} from './types.js';

export const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  sent: ['in_progress'],
  in_progress: ['submitted'],
  submitted: ['under_review'],
  under_review: ['returned', 'verified'],
  returned: ['in_progress'],
  verified: [],
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  needed: ['provided'],
  provided: ['approved', 'rejected'],
  approved: ['rejected'],
  rejected: ['provided'],
};

export type ActionResult =
  | { ok: true; request: VerificationRequest }
  | { ok: false; status: 400 | 404 | 409 | 413; error: string };

export interface UploadLimits {
  maxFilesPerTask: number;
  maxRequestBytes: number;
}

export type ApplicantAction =
  | { type: 'open' }
  | { type: 'attach_file'; task_id: string; file: UploadedFileMeta; limits?: UploadLimits }
  | { type: 'remove_file'; task_id: string; file_id: string }
  | { type: 'set_file_ocr'; task_id: string; file_id: string; ocr: UploadedFileMeta['ocr'] }
  | { type: 'verify_identity'; task_id: string; verification: IdentityVerification }
  | { type: 'verify_income'; task_id: string; verification: IncomeVerification }
  | { type: 'verify_assets'; task_id: string; verification: AssetsVerification }
  | { type: 'verify_npi'; task_id: string; verification: NpiVerification }
  | { type: 'reset_task'; task_id: string }
  | { type: 'submit' };

/** A verification the worker adds during review (e.g. proof of residency after an out-of-state Medicaid finding). */
export interface NewTaskDraft {
  category: TaskCategory;
  title: string;
  reason: string;
  subject?: string;
  required?: boolean;
  methods?: TaskMethod[];
  declared?: DeclaredFact[];
}

export type ReviewAction =
  | { type: 'start_review' }
  | { type: 'approve_task'; task_id: string }
  | { type: 'reject_task'; task_id: string; reason: string }
  | { type: 'clear_task_evidence'; task_id: string }
  | { type: 'add_task'; task: NewTaskDraft }
  | { type: 'return' }
  | { type: 'verify' };

export const TASK_CATEGORIES: TaskCategory[] = [
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

/** Methods a worker-added task may offer, by category (the registry check is never worker-added). */
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

/** Items the worker added that the applicant has not provided yet. */
export function workerAddedPending(request: Pick<VerificationRequest, 'tasks'>): VerificationTask[] {
  return request.tasks.filter((t) => t.added_by === 'worker' && t.status === 'needed');
}

const allowedRequest = (from: RequestStatus, to: RequestStatus) => REQUEST_TRANSITIONS[from].includes(to);
const allowedTask = (from: TaskStatus, to: TaskStatus) => TASK_TRANSITIONS[from].includes(to);

function findTask(request: VerificationRequest, taskId: string): VerificationTask | undefined {
  return request.tasks.find((t) => t.id === taskId);
}

function replaceTask(
  request: VerificationRequest,
  taskId: string,
  patch: (task: VerificationTask) => VerificationTask,
): VerificationTask[] {
  return request.tasks.map((t) => (t.id === taskId ? patch(t) : t));
}

export function addEvent(
  request: VerificationRequest,
  actor: EventActor,
  type: RequestEventType,
  detail?: string,
  now: string = new Date().toISOString(),
): VerificationRequest {
  const event: RequestEvent = detail === undefined ? { at: now, actor, type } : { at: now, actor, type, detail };
  return { ...request, events: [...request.events, event] };
}

export function canSubmit(request: Pick<VerificationRequest, 'tasks'>): boolean {
  return request.tasks.every((t) => !t.required || t.status === 'provided' || t.status === 'approved');
}

function err(status: 400 | 404 | 409 | 413, error: string): ActionResult {
  return { ok: false, status, error };
}
function ok(request: VerificationRequest): ActionResult {
  return { ok: true, request };
}

/** The actor label for the hosted side depends on who the request is for. */
function hostedActor(request: VerificationRequest): EventActor {
  return request.kind === 'provider' ? 'provider' : 'applicant';
}

function handleOpen(request: VerificationRequest, now: string): ActionResult {
  if (allowedRequest(request.status, 'in_progress')) {
    const updated: VerificationRequest = { ...request, status: 'in_progress', updated_at: now };
    return ok(addEvent(updated, hostedActor(request), 'opened', undefined, now));
  }
  if (request.status === 'in_progress' || request.status === 'submitted' || request.status === 'under_review') {
    return ok(request);
  }
  return err(409, 'invalid_status');
}

/** Shared guard for every hosted-side task mutation. */
function guardTask(request: VerificationRequest, taskId: string): ActionResult | VerificationTask {
  if (request.status !== 'in_progress') return err(409, 'invalid_status');
  const task = findTask(request, taskId);
  if (!task) return err(404, 'task_not_found');
  if (task.status === 'approved') return err(409, 'locked');
  return task;
}
const isErr = (x: ActionResult | VerificationTask): x is ActionResult => 'ok' in x;

function handleAttachFile(
  request: VerificationRequest,
  taskId: string,
  file: UploadedFileMeta,
  now: string,
  limits?: UploadLimits,
): ActionResult {
  const g = guardTask(request, taskId);
  if (isErr(g)) return g;
  if (!g.methods.includes('upload')) return err(409, 'method_not_allowed');
  if (limits) {
    if (g.files.length >= limits.maxFilesPerTask) return err(409, 'too_many_files');
    const currentBytes = request.tasks.reduce((sum, t) => sum + t.files.reduce((s, f) => s + (f.size_bytes ?? 0), 0), 0);
    if (currentBytes + (file.size_bytes ?? 0) > limits.maxRequestBytes) return err(413, 'request_too_large');
  }
  const tasks = replaceTask(request, taskId, (t) => ({
    ...t,
    method: 'upload',
    files: [...t.files, file],
    status: 'provided',
    reviewer_note: undefined,
    updated_at: now,
  }));
  return ok(addEvent({ ...request, tasks, updated_at: now }, hostedActor(request), 'file_uploaded', taskId, now));
}

function handleRemoveFile(request: VerificationRequest, taskId: string, fileId: string, now: string): ActionResult {
  const g = guardTask(request, taskId);
  if (isErr(g)) return g;
  if (!g.files.some((f) => f.file_id === fileId)) return err(404, 'file_not_found');
  const tasks = replaceTask(request, taskId, (t) => {
    const files = t.files.filter((f) => f.file_id !== fileId);
    const status: TaskStatus = files.length === 0 && t.status === 'provided' ? 'needed' : t.status;
    return { ...t, files, status, updated_at: now };
  });
  return ok(addEvent({ ...request, tasks, updated_at: now }, hostedActor(request), 'file_removed', taskId, now));
}

/** Attaches the asynchronous AI review to a stored file (no status change). */
function handleSetFileOcr(
  request: VerificationRequest,
  taskId: string,
  fileId: string,
  ocr: UploadedFileMeta['ocr'],
  now: string,
): ActionResult {
  const task = findTask(request, taskId);
  if (!task) return err(404, 'task_not_found');
  if (!task.files.some((f) => f.file_id === fileId)) return err(404, 'file_not_found');
  const tasks = replaceTask(request, taskId, (t) => ({
    ...t,
    files: t.files.map((f) => (f.file_id === fileId ? { ...f, ocr, ocr_pending: false } : f)),
  }));
  const updated = { ...request, tasks, updated_at: now };
  return ok(ocr ? addEvent(updated, 'system', 'ai_reviewed', `${taskId}:${ocr.verdict}`, now) : updated);
}

function recordVerification(
  request: VerificationRequest,
  taskId: string,
  method: 'clear' | 'argyle' | 'nppes',
  patch: Partial<VerificationTask>,
  event: RequestEventType,
  actor: EventActor,
  now: string,
  allowedCategories: VerificationTask['category'][],
): ActionResult {
  const g = guardTask(request, taskId);
  if (isErr(g)) return g;
  if (!allowedCategories.includes(g.category)) return err(409, 'invalid_task_status');
  if (!g.methods.includes(method)) return err(409, 'method_not_allowed');
  const tasks = replaceTask(request, taskId, (t) => ({
    ...t,
    ...patch,
    method,
    files: [],
    status: 'provided',
    reviewer_note: undefined,
    updated_at: now,
  }));
  return ok(addEvent({ ...request, tasks, updated_at: now }, actor, event, taskId, now));
}

function clearedTask(t: VerificationTask, now: string): VerificationTask {
  return {
    ...t,
    status: 'needed',
    method: t.methods[0] ?? 'upload',
    files: [],
    identity_verification: undefined,
    income_verification: undefined,
    assets_verification: undefined,
    npi_verification: undefined,
    clear_session_id: undefined,
    argyle_user_id: undefined,
    reviewer_note: undefined,
    updated_at: now,
  };
}

function handleResetTask(request: VerificationRequest, taskId: string, now: string): ActionResult {
  const g = guardTask(request, taskId);
  if (isErr(g)) return g;
  const tasks = replaceTask(request, taskId, (t) => clearedTask(t, now));
  return ok(addEvent({ ...request, tasks, updated_at: now }, hostedActor(request), 'file_removed', taskId, now));
}

function handleSubmit(request: VerificationRequest, now: string): ActionResult {
  if (!allowedRequest(request.status, 'submitted')) return err(409, 'invalid_status');
  if (!canSubmit(request)) return err(409, 'incomplete');
  const updated: VerificationRequest = { ...request, status: 'submitted', submitted_at: now, updated_at: now };
  return ok(addEvent(updated, hostedActor(request), 'submitted', undefined, now));
}

export function applyApplicantAction(
  request: VerificationRequest,
  action: ApplicantAction,
  now: string = new Date().toISOString(),
): ActionResult {
  if (request.status === 'verified') return err(409, 'terminal');
  switch (action.type) {
    case 'open':
      return handleOpen(request, now);
    case 'attach_file':
      return handleAttachFile(request, action.task_id, action.file, now, action.limits);
    case 'remove_file':
      return handleRemoveFile(request, action.task_id, action.file_id, now);
    case 'set_file_ocr':
      return handleSetFileOcr(request, action.task_id, action.file_id, action.ocr, now);
    case 'verify_identity':
      return recordVerification(
        request,
        action.task_id,
        'clear',
        { identity_verification: action.verification },
        'identity_verified',
        hostedActor(request),
        now,
        ['identity'],
      );
    case 'verify_income':
      return recordVerification(
        request,
        action.task_id,
        'argyle',
        { income_verification: action.verification },
        'income_verified',
        hostedActor(request),
        now,
        ['income'],
      );
    case 'verify_assets':
      return recordVerification(
        request,
        action.task_id,
        'argyle',
        { assets_verification: action.verification },
        'assets_verified',
        hostedActor(request),
        now,
        ['assets'],
      );
    case 'verify_npi':
      return recordVerification(
        request,
        action.task_id,
        'nppes',
        { npi_verification: action.verification },
        'npi_verified',
        'system',
        now,
        ['npi'],
      );
    case 'reset_task':
      return handleResetTask(request, action.task_id, now);
    case 'submit':
      return handleSubmit(request, now);
  }
}

function handleStartReview(request: VerificationRequest, now: string): ActionResult {
  if (allowedRequest(request.status, 'under_review')) {
    const updated: VerificationRequest = { ...request, status: 'under_review', updated_at: now };
    return ok(addEvent(updated, 'worker', 'review_started', undefined, now));
  }
  if (request.status === 'under_review') return ok(request);
  return err(409, 'invalid_status');
}

function handleApproveTask(request: VerificationRequest, taskId: string, now: string): ActionResult {
  if (request.status !== 'under_review') return err(409, 'invalid_status');
  const task = findTask(request, taskId);
  if (!task) return err(404, 'task_not_found');
  if (task.status === 'approved') return ok(request);
  if (!allowedTask(task.status, 'approved')) return err(409, 'invalid_task_status');
  const tasks = replaceTask(request, taskId, (t) => ({ ...t, status: 'approved', reviewer_note: undefined, updated_at: now }));
  return ok(addEvent({ ...request, tasks, updated_at: now }, 'worker', 'task_approved', taskId, now));
}

function handleRejectTask(request: VerificationRequest, taskId: string, reason: string, now: string): ActionResult {
  if (request.status !== 'under_review') return err(409, 'invalid_status');
  const trimmed = reason.trim();
  if (trimmed.length === 0) return err(400, 'reason_required');
  const task = findTask(request, taskId);
  if (!task) return err(404, 'task_not_found');
  // The registry item is system-fulfilled: the worker re-runs or overrides it, never returns it to the provider.
  if (task.category === 'npi') return err(409, 'system_task');
  if (!allowedTask(task.status, 'rejected')) return err(409, 'invalid_task_status');
  const tasks = replaceTask(request, taskId, (t) => ({ ...t, status: 'rejected', reviewer_note: trimmed, updated_at: now }));
  return ok(addEvent({ ...request, tasks, updated_at: now }, 'worker', 'task_rejected', taskId, now));
}

function handleClearTaskEvidence(request: VerificationRequest, taskId: string, now: string): ActionResult {
  if (request.status !== 'under_review' && request.status !== 'returned') return err(409, 'invalid_status');
  const task = findTask(request, taskId);
  if (!task) return err(404, 'task_not_found');
  if (task.status === 'needed') return ok(request);
  if (task.status === 'approved') return err(409, 'locked');
  const tasks = replaceTask(request, taskId, (t) => clearedTask(t, now));
  return ok(addEvent({ ...request, tasks, updated_at: now }, 'worker', 'task_evidence_cleared', taskId, now));
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/**
 * Worker adds a verification item during review. Allowed in any non-terminal
 * status: before submission it simply appears on the applicant's list; after
 * submission the worker uses Return for corrections to send it back.
 */
function handleAddTask(request: VerificationRequest, draft: NewTaskDraft, now: string): ActionResult {
  const title = (draft.title ?? '').trim();
  const reason = (draft.reason ?? '').trim();
  if (!TASK_CATEGORIES.includes(draft.category)) return err(400, 'invalid_category');
  if (title.length === 0) return err(400, 'title_required');
  if (reason.length === 0) return err(400, 'reason_required');
  if (title.length > 120 || reason.length > 1000) return err(400, 'too_long');
  const allowed = allowedMethodsFor(draft.category);
  const requested: TaskMethod[] = draft.methods && draft.methods.length > 0 ? draft.methods : ['upload'];
  const methods = requested.filter((m) => allowed.includes(m));
  if (methods.length === 0) return err(400, 'invalid_methods');
  const subject = (draft.subject ?? '').trim();
  const base = `${draft.category}:${slugify(title) || 'item'}`;
  let id = base;
  for (let n = 2; request.tasks.some((t) => t.id === id); n++) id = `${base}-${n}`;
  const task: VerificationTask = {
    id,
    category: draft.category,
    ...(subject ? { subject } : {}),
    title,
    reason,
    required: draft.required !== false,
    methods,
    method: methods[0] ?? 'upload',
    status: 'needed',
    ...(draft.declared && draft.declared.length > 0 ? { declared: draft.declared } : {}),
    files: [],
    added_by: 'worker',
    added_at: now,
    updated_at: now,
  };
  const updated: VerificationRequest = { ...request, tasks: [...request.tasks, task], updated_at: now };
  return ok(addEvent(updated, 'worker', 'task_added', id, now));
}

function handleReturn(request: VerificationRequest, now: string): ActionResult {
  if (!allowedRequest(request.status, 'returned')) return err(409, 'invalid_status');
  const rejected = request.tasks.filter((t) => t.status === 'rejected');
  const hasCleared = request.tasks.some(
    (t) => t.status === 'needed' && request.events.some((e) => e.type === 'task_evidence_cleared' && e.detail === t.id),
  );
  const hasAdded = workerAddedPending(request).length > 0;
  if (rejected.length === 0 && !hasCleared && !hasAdded) return err(409, 'no_rejected_tasks');
  if (!rejected.every((t) => !!t.reviewer_note && t.reviewer_note.trim().length > 0)) return err(409, 'missing_reviewer_note');
  const updated: VerificationRequest = { ...request, status: 'returned', updated_at: now };
  return ok(addEvent(updated, 'worker', 'returned', undefined, now));
}

function handleVerify(request: VerificationRequest, now: string): ActionResult {
  if (!allowedRequest(request.status, 'verified')) return err(409, 'invalid_status');
  if (request.tasks.some((t) => t.status === 'rejected')) return err(409, 'has_rejected_tasks');
  if (!request.tasks.every((t) => !t.required || t.status === 'approved')) return err(409, 'incomplete_review');
  const updated: VerificationRequest = { ...request, status: 'verified', verified_at: now, updated_at: now };
  return ok(addEvent(updated, 'worker', 'verified', undefined, now));
}

export function applyReviewAction(
  request: VerificationRequest,
  action: ReviewAction,
  now: string = new Date().toISOString(),
): ActionResult {
  if (request.status === 'verified') return err(409, 'terminal');
  switch (action.type) {
    case 'start_review':
      return handleStartReview(request, now);
    case 'approve_task':
      return handleApproveTask(request, action.task_id, now);
    case 'reject_task':
      return handleRejectTask(request, action.task_id, action.reason, now);
    case 'clear_task_evidence':
      return handleClearTaskEvidence(request, action.task_id, now);
    case 'add_task':
      return handleAddTask(request, action.task, now);
    case 'return':
      return handleReturn(request, now);
    case 'verify':
      return handleVerify(request, now);
  }
}

/**
 * Rotate the secure link on a returned request: fresh token hash/expiry and a
 * `returned_link_sent` event. Status stays `returned` — it moves to
 * `in_progress` when the applicant opens the new link (handleOpen), exactly as
 * the first send works.
 */
export function rotateReturnedLink(
  request: VerificationRequest,
  tokenHash: string,
  tokenExpiresAt: string,
  now: string = new Date().toISOString(),
): VerificationRequest {
  const updated: VerificationRequest = { ...request, token_hash: tokenHash, token_expires_at: tokenExpiresAt, updated_at: now };
  return addEvent(updated, 'system', 'returned_link_sent', undefined, now);
}
