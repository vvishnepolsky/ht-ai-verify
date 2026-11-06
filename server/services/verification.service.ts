/**
 * Orchestration over the pure lifecycle reducers + the store + integrations:
 * create a request from a case, deliver the secure link (SMS for households,
 * email for providers), hosted-side actions (uploads with the asynchronous AI
 * review, CLEAR / Argyle finalization), worker review actions, and the
 * return-for-corrections path that rotates the link and re-notifies.
 */
import { randomUUID } from 'node:crypto';
import { env, isEmailConfigured, isTwilioConfigured } from '../env.js';
import { store } from '../db.js';
import { runDocumentReview } from '../ai/ocr.js';
import { normalizeUpload } from '../ai/normalize.js';
import { checkNpi } from '../integrations/npi.js';
import { normalizePhone, sendSms } from '../integrations/twilio.js';
import { isEmailAddress, sendEmail } from '../integrations/email.js';
import { argyleMode, createArgyleUser, createVoaSessionLink, fetchIncomeVerification, fetchVoaResult } from '../integrations/argyle.js';
import { clearMode, createClearSession, deriveIdentityVerification, getClearSession } from '../integrations/clear.js';
import { displayName, isHousehold, isProvider, type CaseRecord, type ProviderCase } from '../domain/case.js';
import { deriveTasks } from '../domain/derive.js';
import {
  applyApplicantAction,
  applyReviewAction,
  rotateReturnedLink,
  type ActionResult,
  type ApplicantAction,
  type NewTaskDraft,
  type ReviewAction,
} from '../domain/lifecycle.js';
import { hashToken, mintToken, tokenExpiry } from '../domain/token.js';
import type { ApplicantView, DeclaredFact, UploadedFileMeta, VerificationRequest, VerificationTask } from '../domain/types.js';
import { stateName } from '../integrations/clear.js';

/**
 * Facts from the case the AI review should check a worker-added document
 * against: the person's name, and for residency items the address on file
 * and the agency's state.
 */
function declaredFactsForAddedTask(c: CaseRecord, draft: NewTaskDraft): DeclaredFact[] {
  const facts: DeclaredFact[] = [...(draft.declared ?? [])];
  const has = (label: string) => facts.some((f) => f.label.toLowerCase() === label.toLowerCase());
  const subject = (draft.subject ?? '').trim();
  if (subject && !has('Name on the document')) facts.push({ label: 'Name on the document', value: subject });
  if (isHousehold(c.data)) {
    const a = c.data.address;
    const address = [a.street, a.city, `${a.state} ${a.zip}`].filter(Boolean).join(', ');
    if (draft.category === 'residency_housing') {
      if (!has('Address')) facts.push({ label: 'Address (as reported on the application)', value: address });
      if (!has('State')) facts.push({ label: 'State the household must live in (exact)', value: `${stateName(env.STATE_CODE) ?? env.STATE_CODE} (${env.STATE_CODE})` });
    }
  } else if (isProvider(c.data) && draft.category === 'license' && !has('State')) {
    facts.push({ label: 'State', value: env.STATE_CODE });
  }
  return facts;
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'ServiceError';
  }
}

export function hostedUrlFor(rawToken: string): string {
  return `${env.PUBLIC_URL}/flow?token=${rawToken}`;
}

/** Contact + channel for a case: households are texted, providers are emailed. */
export function contactFor(c: CaseRecord): { phone: string | null; email: string | null; channel: 'sms' | 'email'; name: string } {
  if (isHousehold(c.data)) {
    return {
      phone: normalizePhone(c.data.primary_contact.phone),
      email: isEmailAddress(c.data.primary_contact.email) ? c.data.primary_contact.email : null,
      channel: 'sms',
      name: c.data.primary_contact.name,
    };
  }
  return {
    phone: normalizePhone(c.data.contact.phone),
    email: isEmailAddress(c.data.contact.email) ? c.data.contact.email : null,
    channel: 'email',
    name: c.data.contact.name,
  };
}

export interface DeliveryResult {
  sms: boolean;
  email: boolean;
  /** Returned to the worker so the link can be shared by hand when no channel delivered. */
  hosted_url: string;
  channel: 'sms' | 'email';
}

async function deliver(c: CaseRecord, rawToken: string, variant: 'initial' | 'returned' | 'resend'): Promise<DeliveryResult> {
  const url = hostedUrlFor(rawToken);
  const contact = contactFor(c);
  const first = contact.name.split(/\s+/)[0] ?? contact.name;
  const agency = env.AGENCY_NAME;
  const household = isHousehold(c.data);
  const what = household ? 'documents' : 'credentials';
  const smsBody =
    variant === 'returned'
      ? `${agency}: your caseworker reviewed your ${what} and needs a few updates. Use this secure link to upload them: ${url}`
      : `${agency}: to finish your application, please upload your ${what} using this secure link: ${url} (expires in ${env.FLOW_TOKEN_TTL_DAYS} days)`;
  const subject = household
    ? variant === 'returned'
      ? 'Updated documents needed for your application'
      : 'Finish your application — upload your documents'
    : variant === 'returned'
      ? 'Medicaid enrollment: updates needed on your credentialing documents'
      : 'Medicaid enrollment: please verify your identity, licenses and credentials';
  const emailBody = household
    ? `Hi ${first},\n\n${variant === 'returned' ? 'Your caseworker reviewed your documents and needs a few updates.' : 'To finish your benefits application, we need a few documents from your household.'} Use this secure link to provide them:\n\n${url}\n\nThe link expires in ${env.FLOW_TOKEN_TTL_DAYS} days. Do not forward it — it is personal to your case.\n\n${agency}`
    : `Hello ${first},\n\n${
        variant === 'returned'
          ? 'Our enrollment team reviewed your credentialing documents and needs a few corrections.'
          : `As part of Medicaid provider enrollment for ${displayName(c.data)} (NPI ${isProvider(c.data) ? c.data.npi : ''}), we need to verify identity, licenses and credentials.`
      } Use this secure link to upload them:\n\n${url}\n\nThe link expires in ${env.FLOW_TOKEN_TTL_DAYS} days and is personal to this application.\n\n${agency} Provider Enrollment`;

  let sms = false;
  let email = false;
  if (contact.channel === 'sms' && contact.phone && isTwilioConfigured()) {
    try {
      await sendSms(contact.phone, smsBody);
      sms = true;
    } catch {
      /* fall through to email */
    }
  }
  if (contact.email && isEmailConfigured() && (contact.channel === 'email' || !sms)) {
    try {
      await sendEmail(contact.email, subject, emailBody);
      email = true;
    } catch {
      /* worker gets the manual-share link */
    }
  }
  if (!sms && !email) console.log(`[deliver] no channel delivered for case ${c.id} — manual share`);
  return { sms, email, hosted_url: url, channel: contact.channel };
}

function save(result: ActionResult): Promise<VerificationRequest> {
  if (!result.ok) throw new ServiceError(result.status, result.error);
  return store.saveRequest(result.request).then(() => result.request);
}

export const verificationService = {
  previewTasks(c: CaseRecord): VerificationTask[] {
    return deriveTasks(c.data);
  },

  /** Any request for the case that is still the applicant's/worker's to act on. */
  async activeRequest(caseId: string): Promise<VerificationRequest | null> {
    const list = await store.listRequests({ caseId });
    return list.find((r) => r.status !== 'verified') ?? list[0] ?? null;
  },

  /** Create the request from the case, run the automatic checks, send the link. */
  async createAndSend(c: CaseRecord): Promise<{ request: VerificationRequest; delivery: DeliveryResult }> {
    const existing = await store.listRequests({ caseId: c.id });
    if (existing.some((r) => r.status !== 'verified')) throw new ServiceError(409, 'request_exists', 'A verification request is already open for this case.');
    const now = new Date().toISOString();
    const rawToken = mintToken();
    let request: VerificationRequest = {
      id: randomUUID(),
      case_id: c.id,
      kind: c.kind,
      subject_name: displayName(c.data),
      token_hash: hashToken(rawToken),
      token_expires_at: tokenExpiry(env.FLOW_TOKEN_TTL_DAYS),
      status: 'sent',
      tasks: deriveTasks(c.data, now),
      events: [{ at: now, actor: 'worker', type: 'created' }],
      created_at: now,
      updated_at: now,
    };
    await store.insertRequest(request);

    // Provider: the NPI task is system-fulfilled right away. The reducer only
    // accepts hosted-side mutations in `in_progress`, so run it in a scratch
    // copy and persist the merged task.
    if (isProvider(c.data)) {
      const npiTask = request.tasks.find((t) => t.category === 'npi');
      if (npiTask) {
        try {
          const verification = await checkNpi({
            npi: c.data.npi,
            name: c.data.name,
            entity_type: c.data.entity_type,
            provider_type: c.data.provider_type,
            specialty: c.data.specialty,
          });
          const scratch = applyApplicantAction({ ...request, status: 'in_progress' }, { type: 'verify_npi', task_id: npiTask.id, verification });
          if (scratch.ok) request = { ...scratch.request, status: request.status };
          c.data.npi_check = verification;
          await store.updateCase(c.id, c.subject_name, c.data);
        } catch (err) {
          console.warn('[npi] registry check failed at send time', err instanceof Error ? err.message : err);
        }
      }
    }

    const delivery = await deliver(c, rawToken, 'initial');
    request = {
      ...request,
      events: [
        ...request.events,
        { at: new Date().toISOString(), actor: 'system', type: 'link_sent', detail: delivery.sms ? 'sms' : delivery.email ? 'email' : 'manual' },
      ],
    };
    await store.saveRequest(request);
    return { request, delivery };
  },

  /** Re-mint the link on an open request and re-deliver it (manual resend). */
  async resend(requestId: string): Promise<{ request: VerificationRequest; delivery: DeliveryResult }> {
    const r = await store.getRequest(requestId);
    if (!r) throw new ServiceError(404, 'not_found');
    if (r.status === 'verified') throw new ServiceError(409, 'terminal');
    const c = await store.getCase(r.case_id);
    if (!c) throw new ServiceError(404, 'case_not_found');
    const rawToken = mintToken();
    const now = new Date().toISOString();
    let updated: VerificationRequest = { ...r, token_hash: hashToken(rawToken), token_expires_at: tokenExpiry(env.FLOW_TOKEN_TTL_DAYS), updated_at: now };
    const delivery = await deliver(c, rawToken, r.status === 'returned' ? 'returned' : 'resend');
    updated = { ...updated, events: [...updated.events, { at: now, actor: 'worker', type: 'link_resent', detail: delivery.sms ? 'sms' : delivery.email ? 'email' : 'manual' }] };
    await store.saveRequest(updated);
    return { request: updated, delivery };
  },

  /**
   * Re-run the CMS registry check for a provider case and refresh both the
   * case's `npi_check` and the open request's system-fulfilled NPI task (any
   * non-terminal status — the worker is re-checking, not the provider).
   */
  async refreshNpi(c: CaseRecord): Promise<{ npi_check: NonNullable<ProviderCase['npi_check']>; request: VerificationRequest | null }> {
    if (!isProvider(c.data)) throw new ServiceError(409, 'not_a_provider');
    const npi_check = await checkNpi({
      npi: c.data.npi,
      name: c.data.name,
      entity_type: c.data.entity_type,
      provider_type: c.data.provider_type,
      specialty: c.data.specialty,
    });
    c.data.npi_check = npi_check;
    await store.updateCase(c.id, c.subject_name, c.data);
    const open = (await store.listRequests({ caseId: c.id })).find((r) => r.status !== 'verified') ?? null;
    if (!open) return { npi_check, request: null };
    const now = new Date().toISOString();
    // The title/declared facts name the NPI — re-derive them so a corrected
    // number shows on the item, not the typo it replaced.
    const fresh = deriveTasks(c.data, now).find((t) => t.category === 'npi');
    const tasks = open.tasks.map((t) =>
      t.category === 'npi' && t.status !== 'approved'
        ? {
            ...t,
            ...(fresh ? { title: fresh.title, reason: fresh.reason, declared: fresh.declared, subject: fresh.subject } : {}),
            npi_verification: npi_check,
            method: 'nppes' as const,
            status: 'provided' as const,
            reviewer_note: undefined,
            updated_at: now,
          }
        : t,
    );
    const updated: VerificationRequest = {
      ...open,
      tasks,
      updated_at: now,
      events: [...open.events, { at: now, actor: 'system', type: 'npi_verified', detail: tasks.find((t) => t.category === 'npi')?.id }],
    };
    await store.saveRequest(updated);
    return { npi_check, request: updated };
  },

  // --- worker review -----------------------------------------------------------

  async review(requestId: string, action: ReviewAction): Promise<{ request: VerificationRequest; delivery?: DeliveryResult }> {
    const r = await store.getRequest(requestId);
    if (!r) throw new ServiceError(404, 'not_found');
    if (action.type === 'clear_task_evidence') {
      const result = applyReviewAction(r, action);
      if (!result.ok) throw new ServiceError(result.status, result.error);
      await store.deleteFilesForTask(r.id, action.task_id);
      await store.saveRequest(result.request);
      return { request: result.request };
    }
    if (action.type === 'add_task') {
      const c = await store.getCase(r.case_id);
      if (!c) throw new ServiceError(404, 'case_not_found');
      const draft: NewTaskDraft = { ...action.task, declared: declaredFactsForAddedTask(c, action.task) };
      const request = await save(applyReviewAction(r, { type: 'add_task', task: draft }));
      return { request };
    }
    if (action.type === 'return') {
      const result = applyReviewAction(r, action);
      if (!result.ok) throw new ServiceError(result.status, result.error);
      const c = await store.getCase(r.case_id);
      if (!c) throw new ServiceError(404, 'case_not_found');
      const rawToken = mintToken();
      const rotated = rotateReturnedLink(result.request, hashToken(rawToken), tokenExpiry(env.FLOW_TOKEN_TTL_DAYS));
      await store.saveRequest(rotated);
      const delivery = await deliver(c, rawToken, 'returned');
      return { request: rotated, delivery };
    }
    const request = await save(applyReviewAction(r, action));
    return { request };
  },

  // --- hosted (token-scoped) side ------------------------------------------------

  async findByToken(rawToken: string): Promise<VerificationRequest | null> {
    if (!rawToken || rawToken.length < 16) return null;
    const r = await store.findRequestByTokenHash(hashToken(rawToken));
    if (!r) return null;
    if (Date.parse(r.token_expires_at) < Date.now()) return null;
    return r;
  },

  toApplicantView(r: VerificationRequest): ApplicantView {
    const lastReturned = r.events.map((e) => e.type).lastIndexOf('returned');
    const lastSubmitted = r.events.map((e) => e.type).lastIndexOf('submitted');
    const corrections = (r.status === 'returned' || r.status === 'in_progress') && lastReturned > lastSubmitted;
    return {
      kind: r.kind,
      subject_name: r.subject_name,
      agency_name: env.AGENCY_NAME,
      status: r.status,
      corrections,
      ...(corrections ? { corrections_since: r.events[lastReturned]!.at } : {}),
      token_expires_at: r.token_expires_at,
      tasks: r.tasks.map((t) => {
        const { clear_session_id: _c, argyle_user_id: _a, ...rest } = t;
        return rest;
      }),
      ...(r.submitted_at ? { submitted_at: r.submitted_at } : {}),
      ...(r.verified_at ? { verified_at: r.verified_at } : {}),
      integrations: { clear: clearMode(), argyle: argyleMode() },
    };
  },

  async open(r: VerificationRequest): Promise<VerificationRequest> {
    const result = applyApplicantAction(r, { type: 'open' });
    if (!result.ok) return r; // idempotent read — a dead state still renders
    if (result.request !== r) await store.saveRequest(result.request);
    return result.request;
  },

  async apply(r: VerificationRequest, action: ApplicantAction): Promise<VerificationRequest> {
    return save(applyApplicantAction(r, action));
  },

  /**
   * Store the bytes, record the file on the task, then run the AI review in
   * the background and attach it (the upload never waits on the model).
   */
  async attachFile(
    r: VerificationRequest,
    taskId: string,
    file: { mime: string; filename?: string; source: 'camera' | 'upload'; bytes: Buffer },
  ): Promise<VerificationRequest> {
    if (file.bytes.length > env.MAX_FILE_BYTES) throw new ServiceError(413, 'file_too_large');
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task) throw new ServiceError(404, 'task_not_found');
    // iPhone photo-library uploads arrive as HEIC, which browsers cannot
    // render and the vision model does not accept — convert to JPEG first.
    file = await normalizeUpload(file);
    const meta: UploadedFileMeta = {
      file_id: randomUUID(),
      mime: file.mime,
      ...(file.filename ? { filename: file.filename } : {}),
      size_bytes: file.bytes.length,
      source: file.source,
      captured_at: new Date().toISOString(),
      ocr_pending: true,
    };
    const result = applyApplicantAction(r, {
      type: 'attach_file',
      task_id: taskId,
      file: meta,
      limits: { maxFilesPerTask: env.MAX_FILES_PER_TASK, maxRequestBytes: env.MAX_REQUEST_BYTES },
    });
    if (!result.ok) throw new ServiceError(result.status, result.error);
    await store.putFile({ id: meta.file_id, request_id: r.id, task_id: taskId, mime: file.mime, filename: file.filename ?? null, bytes: file.bytes });
    await store.saveRequest(result.request);

    void (async () => {
      const ocr = await runDocumentReview(file.bytes, file.mime, {
        kind: r.kind,
        taskTitle: task.title,
        taskReason: task.reason,
        category: task.category,
        subject: task.subject,
        declared: task.declared,
      });
      // Re-read: other uploads may have landed meanwhile.
      const latest = await store.getRequest(r.id);
      if (!latest) return;
      const set = applyApplicantAction(latest, { type: 'set_file_ocr', task_id: taskId, file_id: meta.file_id, ocr: ocr ?? undefined });
      if (set.ok) await store.saveRequest(set.request);
    })().catch((err: unknown) => console.warn('[ai-review] failed', err instanceof Error ? err.message : err));

    return result.request;
  },

  async removeFile(r: VerificationRequest, taskId: string, fileId: string): Promise<VerificationRequest> {
    const next = await save(applyApplicantAction(r, { type: 'remove_file', task_id: taskId, file_id: fileId }));
    return next;
  },

  async resetTask(r: VerificationRequest, taskId: string): Promise<VerificationRequest> {
    const next = await save(applyApplicantAction(r, { type: 'reset_task', task_id: taskId }));
    await store.deleteFilesForTask(r.id, taskId);
    return next;
  },

  // CLEAR -------------------------------------------------------------------------

  async clearStart(r: VerificationRequest, taskId: string, returnUrl: string): Promise<string> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'identity' || !task.methods.includes('clear')) throw new ServiceError(409, 'clear_not_applicable');
    if (r.status !== 'in_progress') throw new ServiceError(409, 'invalid_status');
    const { clearSessionId, hostedUrl } = await createClearSession(returnUrl);
    const tasks = r.tasks.map((t) => (t.id === taskId ? { ...t, clear_session_id: clearSessionId } : t));
    await store.saveRequest({ ...r, tasks });
    return hostedUrl;
  },

  async clearFinalize(r: VerificationRequest, taskId: string, homeState: string): Promise<VerificationRequest> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'identity') throw new ServiceError(404, 'task_not_found');
    if (task.identity_verification) return r;
    const sessionId = task.clear_session_id;
    if (!sessionId) throw new ServiceError(409, 'not_started');
    let session = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      session = await getClearSession(sessionId);
      if (session?.succeeded || (session && !['pending', 'in_progress', 'created', ''].includes(session.status))) break;
      await new Promise((res) => setTimeout(res, 1500));
    }
    if (!session) throw new ServiceError(404, 'session_not_found');
    if (!session.succeeded) throw new ServiceError(409, 'clear_not_complete', `CLEAR session status: ${session.status}`);
    // Coverage discovery applies to households (eligibility); providers verify identity only.
    const verification = await deriveIdentityVerification(session.traits, task.subject ?? r.subject_name, clearMode(), homeState, r.kind === 'household');
    return save(applyApplicantAction(r, { type: 'verify_identity', task_id: taskId, verification }));
  },

  // Argyle ------------------------------------------------------------------------

  async argyleLink(r: VerificationRequest, taskId: string): Promise<{ user_token: string; mode: string }> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'income' || !task.methods.includes('argyle')) throw new ServiceError(409, 'argyle_not_applicable');
    if (r.status !== 'in_progress') throw new ServiceError(409, 'invalid_status');
    const user = await createArgyleUser();
    const tasks = r.tasks.map((t) => (t.id === taskId ? { ...t, argyle_user_id: user.id } : t));
    await store.saveRequest({ ...r, tasks });
    return { user_token: user.user_token, mode: argyleMode() };
  },

  /** Finalize income after Link connects; 409 `income_not_ready` while Argyle is still scraping. */
  async argyleFinalize(r: VerificationRequest, taskId: string): Promise<VerificationRequest> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'income') throw new ServiceError(404, 'task_not_found');
    if (task.income_verification) return r;
    if (!task.argyle_user_id) throw new ServiceError(409, 'not_started');
    const verification = await fetchIncomeVerification(task.argyle_user_id, task.expected_employers ?? []);
    if (!verification) throw new ServiceError(409, 'income_not_ready');
    return save(applyApplicantAction(r, { type: 'verify_income', task_id: taskId, verification }));
  },

  async argyleVoaLink(r: VerificationRequest, taskId: string, returnUrl: string): Promise<string> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'assets' || !task.methods.includes('argyle')) throw new ServiceError(409, 'argyle_not_applicable');
    if (r.status !== 'in_progress') throw new ServiceError(409, 'invalid_status');
    const user = task.argyle_user_id ? { id: task.argyle_user_id } : await createArgyleUser();
    const link = await createVoaSessionLink(user.id, returnUrl);
    const tasks = r.tasks.map((t) => (t.id === taskId ? { ...t, argyle_user_id: user.id } : t));
    await store.saveRequest({ ...r, tasks });
    return link;
  },

  async argyleVoaFinalize(r: VerificationRequest, taskId: string): Promise<VerificationRequest> {
    const task = r.tasks.find((t) => t.id === taskId);
    if (!task || task.category !== 'assets') throw new ServiceError(404, 'task_not_found');
    if (task.assets_verification) return r;
    if (!task.argyle_user_id) throw new ServiceError(409, 'not_started');
    const c = await store.getCase(r.case_id);
    const declared = c && isHousehold(c.data) ? c.data.assets.accounts : [];
    const verification = await fetchVoaResult(task.argyle_user_id, declared);
    if (!verification) throw new ServiceError(409, 'report_not_ready');
    return save(applyApplicantAction(r, { type: 'verify_assets', task_id: taskId, verification }));
  },

  async submit(r: VerificationRequest): Promise<VerificationRequest> {
    return save(applyApplicantAction(r, { type: 'submit' }));
  },
};
