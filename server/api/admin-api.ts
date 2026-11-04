/**
 * Worker-console REST surface (password-gated when ADMIN_PASSWORD is set).
 *
 *   GET    /api/config
 *   GET    /api/stats
 *   GET    /api/cases?kind=household|provider         → { cases: [{...case, request?: summary}] }
 *   POST   /api/cases                                  { data: HouseholdCase | ProviderCase }
 *   GET    /api/cases/:id                              → { case, tasks_preview, requests }
 *   PUT    /api/cases/:id                              { data }
 *   DELETE /api/cases/:id
 *   POST   /api/cases/:id/send                         → { request, delivery }
 *   POST   /api/cases/:id/npi-check                    → { npi_check }
 *   GET    /api/npi/:npi                               → NPPES summary (console autofill)
 *   GET    /api/npi/search?last_name=&first_name=&organization_name=&state=
 *   GET    /api/requests/:id                           → { request, case }
 *   POST   /api/requests/:id/resend                    → { request, delivery }
 *   POST   /api/requests/:id/review                    { action, task_id?, reason? } → { request, delivery? }
 *   GET    /api/requests/:id/file/:fileId
 *   POST   /api/demo/seed
 *   POST   /api/demo/reset
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { env, isArgyleLive, isClearLive, isEmailConfigured, isOpenAiConfigured, isTwilioConfigured } from '../env.js';
import { store } from '../db.js';
import { readJsonBody, sendBytes, sendError, sendJson } from '../http-utils.js';
import { displayName, isHousehold, isProvider, type CaseData, type CaseRecord } from '../domain/case.js';
import type { ReviewAction } from '../domain/lifecycle.js';
import { isValidNpiFormat, lookupNpi, searchNpi, summarizeRecord } from '../integrations/npi.js';
import { ServiceError, verificationService as svc } from '../services/verification.service.js';
import { seedDemoData } from '../demo/seed.js';
import { validateCaseData } from './validate.js';

function authorized(req: IncomingMessage): boolean {
  if (!env.ADMIN_PASSWORD) return true;
  const h = req.headers['x-admin-key'];
  const key = Array.isArray(h) ? h[0] : h;
  if (!key) return false;
  const a = Buffer.from(key);
  const b = Buffer.from(env.ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestSummary(r: { id: string; status: string; tasks: { status: string; required: boolean; files: { ocr?: { verdict: string } }[] }[]; submitted_at?: string; updated_at: string }) {
  // Only unresolved items count as flagged — an approved item's history is settled.
  const flagged = r.tasks.reduce((n, t) => (t.status === 'approved' ? n : n + t.files.filter((f) => f.ocr?.verdict === 'review').length), 0);
  return {
    id: r.id,
    status: r.status,
    task_count: r.tasks.length,
    provided_count: r.tasks.filter((t) => t.status === 'provided' || t.status === 'approved').length,
    approved_count: r.tasks.filter((t) => t.status === 'approved').length,
    flagged_count: flagged,
    submitted_at: r.submitted_at ?? null,
    updated_at: r.updated_at,
  };
}

export async function handleAdminApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const p = url.pathname;
  if (p === '/api/config' && req.method === 'GET') {
    sendJson(res, 200, {
      authRequired: Boolean(env.ADMIN_PASSWORD),
      agencyName: env.AGENCY_NAME,
      stateCode: env.STATE_CODE,
      publicUrl: env.PUBLIC_URL,
      integrations: {
        ai: isOpenAiConfigured() ? env.OPENAI_OCR_MODEL : 'off',
        sms: isTwilioConfigured() ? 'twilio' : 'off',
        email: isEmailConfigured() ? env.EMAIL_VENDOR : 'off',
        clear: isClearLive() ? env.CLEAR_MODE : 'simulated',
        argyle: isArgyleLive() ? (env.ARGYLE_API_BASE.includes('sandbox') ? 'sandbox' : 'live') : 'simulated',
        nppes: 'live',
      },
      demoSeed: env.ENABLE_DEMO_SEED,
    });
    return true;
  }
  if (!authorized(req)) {
    sendError(res, 401, 'unauthorized');
    return true;
  }

  try {
    if (p === '/api/stats' && req.method === 'GET') {
      const [cases, requests] = await Promise.all([store.listCases(), store.listRequests()]);
      sendJson(res, 200, {
        households: cases.filter((c) => c.kind === 'household').length,
        providers: cases.filter((c) => c.kind === 'provider').length,
        awaiting_review: requests.filter((r) => r.status === 'submitted' || r.status === 'under_review').length,
        verified: requests.filter((r) => r.status === 'verified').length,
        queue: requests
          .filter((r) => r.status === 'submitted' || r.status === 'under_review')
          .map((r) => ({ ...requestSummary(r), case_id: r.case_id, kind: r.kind, subject_name: r.subject_name })),
      });
      return true;
    }

    if (p === '/api/cases' && req.method === 'GET') {
      const kind = url.searchParams.get('kind');
      const cases = await store.listCases(kind === 'household' || kind === 'provider' ? kind : undefined);
      const requests = await store.listRequests();
      const byCase = new Map<string, (typeof requests)[number]>();
      for (const r of requests) if (!byCase.has(r.case_id)) byCase.set(r.case_id, r);
      sendJson(res, 200, {
        cases: cases.map((c) => ({ ...c, request: byCase.has(c.id) ? requestSummary(byCase.get(c.id)!) : null })),
      });
      return true;
    }
    if (p === '/api/cases' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const data = validateCaseData(body['data']);
      const c = await store.createCase(data.kind, displayName(data), data);
      sendJson(res, 201, { case: c });
      return true;
    }

    const caseMatch = /^\/api\/cases\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/.exec(p);
    if (caseMatch) {
      const [, id, sub] = caseMatch;
      const c = await store.getCase(id ?? '');
      if (!c) {
        sendError(res, 404, 'not_found');
        return true;
      }
      if (!sub && req.method === 'GET') {
        const requests = await store.listRequests({ caseId: c.id });
        sendJson(res, 200, { case: c, tasks_preview: svc.previewTasks(c), requests });
        return true;
      }
      if (!sub && req.method === 'PUT') {
        const body = await readJsonBody(req);
        const data = validateCaseData(body['data']);
        if (data.kind !== c.kind) throw new ServiceError(400, 'kind_mismatch');
        if (isProvider(data) && isProvider(c.data)) data.npi_check = data.npi === c.data.npi ? c.data.npi_check : undefined;
        const updated = await store.updateCase(c.id, displayName(data), data);
        sendJson(res, 200, { case: updated });
        return true;
      }
      if (!sub && req.method === 'DELETE') {
        await store.deleteCase(c.id);
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (sub === 'send' && req.method === 'POST') {
        const out = await svc.createAndSend(c);
        sendJson(res, 201, out);
        return true;
      }
      if (sub === 'npi-check' && req.method === 'POST') {
        sendJson(res, 200, await svc.refreshNpi(c));
        return true;
      }
    }

    if (p === '/api/npi/search' && req.method === 'GET') {
      const q = url.searchParams;
      const results = await searchNpi({
        first_name: q.get('first_name') ?? undefined,
        last_name: q.get('last_name') ?? undefined,
        organization_name: q.get('organization_name') ?? undefined,
        state: q.get('state') ?? undefined,
        limit: 10,
      });
      sendJson(res, 200, { results: results.map(summarizeRecord) });
      return true;
    }
    const npiMatch = /^\/api\/npi\/(\d{10})$/.exec(p);
    if (npiMatch && req.method === 'GET') {
      const npi = npiMatch[1] ?? '';
      if (!isValidNpiFormat(npi)) {
        sendJson(res, 200, { found: false, reason: 'invalid_check_digit' });
        return true;
      }
      const rec = await lookupNpi(npi);
      sendJson(res, 200, rec ? { found: true, record: summarizeRecord(rec) } : { found: false, reason: 'not_in_registry' });
      return true;
    }

    const reqMatch = /^\/api\/requests\/([0-9a-f-]{36})(?:\/([a-z-]+)(?:\/([0-9a-f-]{36}))?)?$/.exec(p);
    if (reqMatch) {
      const [, id, sub, fileId] = reqMatch;
      const r = await store.getRequest(id ?? '');
      if (!r) {
        sendError(res, 404, 'not_found');
        return true;
      }
      if (!sub && req.method === 'GET') {
        const c = await store.getCase(r.case_id);
        sendJson(res, 200, { request: r, case: c });
        return true;
      }
      if (sub === 'file' && fileId && req.method === 'GET') {
        const f = await store.getFile(fileId);
        if (!f || f.request_id !== r.id) {
          sendError(res, 404, 'not_found');
          return true;
        }
        sendBytes(res, 200, f.bytes, f.mime, f.filename ?? undefined);
        return true;
      }
      if (sub === 'resend' && req.method === 'POST') {
        sendJson(res, 200, await svc.resend(r.id));
        return true;
      }
      if (sub === 'npi-recheck' && req.method === 'POST') {
        const c = await store.getCase(r.case_id);
        if (!c) throw new ServiceError(404, 'case_not_found');
        const out = await svc.refreshNpi(c);
        sendJson(res, 200, { request: out.request ?? r });
        return true;
      }
      if (sub === 'review' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const action = parseReviewAction(body);
        sendJson(res, 200, await svc.review(r.id, action));
        return true;
      }
    }

    if (p === '/api/demo/seed' && req.method === 'POST') {
      const n = await seedDemoData();
      sendJson(res, 200, { seeded: n });
      return true;
    }
    if (p === '/api/demo/reset' && req.method === 'POST') {
      const body = await readJsonBody(req);
      if (body['confirm'] !== 'RESET') throw new ServiceError(400, 'confirm_required', 'Send {"confirm":"RESET"}.');
      await store.deleteAll();
      const n = await seedDemoData();
      sendJson(res, 200, { reset: true, seeded: n });
      return true;
    }
    return false;
  } catch (err) {
    if (err instanceof ServiceError) sendError(res, err.status, err.code, err.message);
    else if (err instanceof SyntaxError) sendError(res, 400, 'bad_json');
    else {
      console.error('[admin-api] error', err instanceof Error ? err.message : err);
      sendError(res, 500, 'internal_error', err instanceof Error ? err.message : 'internal error');
    }
    return true;
  }
}

function parseReviewAction(body: Record<string, unknown>): ReviewAction {
  const type = body['action'];
  const task_id = typeof body['task_id'] === 'string' ? body['task_id'] : '';
  const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
  switch (type) {
    case 'start_review':
    case 'return':
    case 'verify':
      return { type };
    case 'approve_task':
    case 'clear_task_evidence':
      if (!task_id) throw new ServiceError(400, 'task_id_required');
      return { type, task_id };
    case 'reject_task':
      if (!task_id) throw new ServiceError(400, 'task_id_required');
      return { type, task_id, reason };
    default:
      throw new ServiceError(400, 'unknown_action');
  }
}

export type { CaseData, CaseRecord };
export { isHousehold };
