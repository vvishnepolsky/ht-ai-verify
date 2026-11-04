/**
 * Small HTTP helpers for the raw Node server: JSON bodies (with a per-route
 * size cap so document uploads can be large while everything else stays
 * small), JSON/text responses, and static file serving.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

export const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export class BodyTooLargeError extends Error {
  constructor() {
    super('request body exceeds the maximum size');
    this.name = 'BodyTooLargeError';
  }
}

export function readRawBody(req: IncomingMessage, maxBytes = DEFAULT_MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const detach = (): void => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const onData = (c: Buffer): void => {
      total += c.length;
      if (total > maxBytes) {
        detach();
        reject(new BodyTooLargeError());
        return;
      }
      chunks.push(c);
    };
    const onEnd = (): void => {
      detach();
      resolve(Buffer.concat(chunks).toString('utf-8'));
    };
    const onError = (err: Error): void => {
      detach();
      reject(err);
    };
    const onClose = (): void => {
      detach();
      reject(new Error('request closed before the body completed'));
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

export async function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, maxBytes);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, status: number, code: string, message?: string): void {
  sendJson(res, status, { error: code, message: message ?? code });
}

export function sendText(res: ServerResponse, status: number, text: string, contentType = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(text);
}

export function sendBytes(res: ServerResponse, status: number, bytes: Buffer, mime: string, filename?: string): void {
  res.writeHead(status, {
    'Content-Type': mime,
    'Content-Length': bytes.length,
    'Cache-Control': 'private, no-store',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    ...(filename ? { 'Content-Disposition': `inline; filename="${filename.replace(/[^\w.\- ]/g, '_')}"` } : {}),
  });
  res.end(bytes);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/**
 * Serve a static file from `root` for the request path. With `spaFallback`,
 * unknown paths get index.html (client-side routes). Returns false when
 * nothing was served.
 */
export function serveStatic(root: string, pathname: string, res: ServerResponse, spaFallback = true): boolean {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  // Only route-like paths (no file extension) fall back to the SPA shell; a
  // missing asset or document path is a real 404, not a 200 of index.html.
  const routeLike = !extname(safe);
  const candidates = [join(root, safe), ...(spaFallback && routeLike ? [join(root, 'index.html')] : [])];
  for (const file of candidates) {
    if (!file.startsWith(root)) continue;
    try {
      const st = statSync(file);
      if (!st.isFile()) continue;
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
      const isIndex = file.endsWith('index.html');
      const isHashed = /\/assets\//.test(file);
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': isIndex ? 'no-cache' : isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
      });
      createReadStream(file).pipe(res);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function htmlEscape(v: string): string {
  return v.replace(/[<>&"']/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === '"' ? '&quot;' : '&#39;',
  );
}
