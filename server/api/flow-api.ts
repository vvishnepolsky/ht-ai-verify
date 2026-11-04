/**
 * Token-scoped REST surface for the hosted collection flow. The applicant /
 * provider is anonymous; the unguessable token in the URL is the only
 * credential and a dead token renders the same 404 for every route.
 *
 *   GET  /flow-api/:token                       → { session }  (also opens it)
 *   POST /flow-api/:token/attach-file           { task_id, mime, filename?, source, data_base64 }
 *   POST /flow-api/:token/remove-file           { task_id, file_id }
 *   POST /flow-api/:token/reset-task            { task_id }
 *   GET  /flow-api/:token/file/:fileId
 *   POST /flow-api/:token/clear-link            { task_id, return_url } → { hosted_url }
 *   POST /flow-api/:token/clear-finalize        { task_id }
 *   POST /flow-api/:token/argyle-link           { task_id } → { user_token, mode }
 *   POST /flow-api/:token/argyle-finalize       { task_id }
 *   POST /flow-api/:token/argyle-voa-link       { task_id, return_url } → { link }
 *   POST /flow-api/:token/argyle-voa-finalize   { task_id }
 *   POST /flow-api/:token/submit
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { env } from '../env.js';
import { store } from '../db.js';
import { BodyTooLargeError, readJsonBody, sendBytes, sendError, sendJson } from '../http-utils.js';
import { ServiceError, verificationService as svc } from '../services/verification.service.js';
import type { VerificationRequest } from '../domain/types.js';

function allowedReturn(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const pub = new URL(env.PUBLIC_URL);
    if (u.origin !== pub.origin && !/^https?:\/\/localhost(:\d+)?$/.test(u.origin)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function handleFlowApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const m = /^\/flow-api\/([A-Za-z0-9_-]{16,})(?:\/([a-z-]+)(?:\/([0-9a-f-]{36}))?)?$/.exec(url.pathname);
  if (!m) return false;
  const [, token, action, fileId] = m;
  const r0 = await svc.findByToken(token ?? '');
  if (!r0) {
    sendError(res, 404, 'not_found', 'This link is invalid or has expired.');
    return true;
  }

  const reply = (r: VerificationRequest) => sendJson(res, 200, { session: svc.toApplicantView(r) });
  try {
    if (req.method === 'GET' && !action) {
      reply(await svc.open(r0));
      return true;
    }
    if (req.method === 'GET' && action === 'file' && fileId) {
      const f = await store.getFile(fileId);
      if (!f || f.request_id !== r0.id) {
        sendError(res, 404, 'not_found');
        return true;
      }
      sendBytes(res, 200, f.bytes, f.mime, f.filename ?? undefined);
      return true;
    }
    if (req.method !== 'POST') {
      sendError(res, 405, 'method_not_allowed');
      return true;
    }
    // Uploads carry base64 bytes; everything else is small.
    const body = await readJsonBody(req, action === 'attach-file' ? Math.ceil(env.MAX_FILE_BYTES * 1.4) + 4096 : undefined);
    const taskId = str(body['task_id']);

    switch (action) {
      case 'attach-file': {
        const data = str(body['data_base64']);
        if (!taskId || !data) return bad(res, 'task_id and data_base64 required');
        const mime = str(body['mime']) || 'application/octet-stream';
        if (!/^(image\/(jpe?g|png|webp|gif|heic|heif)|application\/pdf)$/i.test(mime)) return bad(res, 'unsupported file type', 415);
        const bytes = Buffer.from(data, 'base64');
        const source = body['source'] === 'camera' ? 'camera' : 'upload';
        const filename = str(body['filename']).slice(0, 120) || undefined;
        reply(await svc.attachFile(r0, taskId, { mime, filename, source, bytes }));
        return true;
      }
      case 'remove-file':
        if (!taskId || !str(body['file_id'])) return bad(res, 'task_id and file_id required');
        reply(await svc.removeFile(r0, taskId, str(body['file_id'])));
        return true;
      case 'reset-task':
        if (!taskId) return bad(res, 'task_id required');
        reply(await svc.resetTask(r0, taskId));
        return true;
      case 'clear-link': {
        const ret = allowedReturn(body['return_url']);
        if (!taskId || !ret) return bad(res, 'task_id and a same-origin return_url required');
        sendJson(res, 200, { hosted_url: await svc.clearStart(r0, taskId, ret) });
        return true;
      }
      case 'clear-finalize':
        if (!taskId) return bad(res, 'task_id required');
        reply(await svc.clearFinalize(r0, taskId, env.STATE_CODE));
        return true;
      case 'argyle-link':
        if (!taskId) return bad(res, 'task_id required');
        sendJson(res, 200, await svc.argyleLink(r0, taskId));
        return true;
      case 'argyle-finalize':
        if (!taskId) return bad(res, 'task_id required');
        reply(await svc.argyleFinalize(r0, taskId));
        return true;
      case 'argyle-voa-link': {
        const ret = allowedReturn(body['return_url']);
        if (!taskId || !ret) return bad(res, 'task_id and a same-origin return_url required');
        sendJson(res, 200, { link: await svc.argyleVoaLink(r0, taskId, ret) });
        return true;
      }
      case 'argyle-voa-finalize':
        if (!taskId) return bad(res, 'task_id required');
        reply(await svc.argyleVoaFinalize(r0, taskId));
        return true;
      case 'submit':
        reply(await svc.submit(r0));
        return true;
      default:
        sendError(res, 404, 'not_found');
        return true;
    }
  } catch (err) {
    if (err instanceof ServiceError) sendError(res, err.status, err.code, err.message);
    else if (err instanceof BodyTooLargeError) sendError(res, 413, 'file_too_large', 'That file is too large.');
    else if (err instanceof SyntaxError) sendError(res, 400, 'bad_json');
    else {
      console.error('[flow-api] error', err instanceof Error ? err.message : err);
      sendError(res, 500, 'internal_error');
    }
    return true;
  }
}

function bad(res: ServerResponse, message: string, status = 400): boolean {
  sendError(res, status, 'bad_request', message);
  return true;
}
