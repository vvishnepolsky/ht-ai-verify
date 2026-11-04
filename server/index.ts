/**
 * AI Verify — one Node process:
 *   /api/*          worker-console REST (admin-api.ts, password-gated)
 *   /flow-api/*     token-scoped hosted-flow REST (flow-api.ts)
 *   /hosted/*       simulated CLEAR / Argyle pages (only when not configured)
 *   /test-documents/* the generated pass/fail sample documents
 *   /health, and the built web bundle (dist/public) for everything else —
 *   the console at `/` and the hosted flow at `/flow?token=…`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { env, isArgyleLive, isClearLive, isEmailConfigured, isOpenAiConfigured, isTwilioConfigured } from './env.js';
import { store } from './db.js';
import { sendJson, sendText, serveStatic } from './http-utils.js';
import { handleAdminApi } from './api/admin-api.js';
import { handleFlowApi } from './api/flow-api.js';
import { handleHosted } from './api/hosted.js';
import { seedDemoData } from './demo/seed.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// dist/server/index.js → dist/public ; server/index.ts (tsx) → dist/public too.
const PUBLIC_DIR = HERE.includes(`${'dist'}`) ? join(HERE, '..', 'public') : join(HERE, '..', 'dist', 'public');
const TEST_DOCS_DIR = HERE.includes('dist') ? join(HERE, '..', '..', 'docs', 'test-documents') : join(HERE, '..', 'docs', 'test-documents');

function securityHeaders(res: ServerResponse): void {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (env.IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${env.PORT}`);
  securityHeaders(res);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', service: 'ht-ai-verify' });
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    void handleAdminApi(req, res, url, TEST_DOCS_DIR).then((handled) => {
      if (!handled) sendJson(res, 404, { error: 'not_found' });
    });
    return;
  }
  if (url.pathname.startsWith('/flow-api/')) {
    void handleFlowApi(req, res, url).then((handled) => {
      if (!handled) sendJson(res, 404, { error: 'not_found' });
    });
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/hosted/')) {
    if (handleHosted(url.pathname, url.searchParams, res)) return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/test-documents/')) {
    if (serveStatic(TEST_DOCS_DIR, url.pathname.slice('/test-documents'.length), res, false)) return;
    sendText(res, 404, 'Not found');
    return;
  }
  if (req.method === 'GET' && serveStatic(PUBLIC_DIR, url.pathname, res)) return;
  sendText(res, 404, 'Not found');
});

async function main(): Promise<void> {
  await store.init();
  if (env.ENABLE_DEMO_SEED && (await store.countCases()) === 0) {
    const n = await seedDemoData();
    console.log(`[boot] seeded ${n} demo cases`);
  }
  httpServer.listen(env.PORT, () => {
    console.log(`[ht-ai-verify] listening on :${env.PORT} (public: ${env.PUBLIC_URL})`);
    console.log(
      `[ht-ai-verify] ai=${isOpenAiConfigured() ? env.OPENAI_OCR_MODEL : 'off'} sms=${isTwilioConfigured() ? 'twilio' : 'off'} email=${
        isEmailConfigured() ? env.EMAIL_VENDOR : 'off'
      } clear=${isClearLive() ? env.CLEAR_MODE : 'simulated'} argyle=${isArgyleLive() ? 'on' : 'simulated'} auth=${env.ADMIN_PASSWORD ? 'password' : 'open'} db=${
        env.DATABASE_URL ? 'postgres' : 'memory'
      }`,
    );
  });
}

void main().catch((err: unknown) => {
  console.error('[boot] failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
