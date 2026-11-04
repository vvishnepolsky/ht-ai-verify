/**
 * Simulated hosted pages for CLEAR and Argyle, served only when those
 * integrations are not configured. Clearly labelled as simulations — they
 * exist so the end-to-end "verify instantly" paths can be demonstrated
 * without sandbox credentials, never to pass as the real check.
 */
import type { ServerResponse } from 'node:http';
import { env } from '../env.js';
import { htmlEscape, sendText } from '../http-utils.js';

function allowedReturn(raw: string): string | null {
  try {
    const u = new URL(raw);
    const pub = new URL(env.PUBLIC_URL);
    if (u.origin !== pub.origin && !/^https?:\/\/localhost(:\d+)?$/.test(u.origin)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function page(title: string, brand: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title>
<style>
body{margin:0;background:#f8f7fc;font-family:Geist,-apple-system,"Segoe UI",system-ui,sans-serif;color:#1d1a2e}
.wrap{max-width:460px;margin:48px auto;padding:0 16px}
.card{background:#fff;border:1px solid #e4e4ec;border-radius:12px;box-shadow:0 4px 30px rgba(31,16,148,.12);overflow:hidden}
.hero{padding:28px 24px;color:#fff;background:linear-gradient(135deg,#1f1094,#4860fc)}
.hero h1{margin:0;font-size:20px;font-weight:600}.hero p{margin:6px 0 0;font-size:13px;opacity:.85}
.body{padding:24px}.sim{display:inline-block;background:#fff3bf;color:#7d5700;border:1px solid #f0d25b;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;margin-bottom:14px}
p{line-height:1.5;margin:0 0 12px}label{display:block;font-size:13px;font-weight:500;margin:14px 0 6px}
input{width:100%;box-sizing:border-box;height:40px;border:1px solid #d6d5e0;border-radius:8px;padding:0 12px;font:inherit;background:#fafafc}
.btn{display:block;width:100%;margin-top:18px;height:42px;border:0;border-radius:8px;background:#1f1094;color:#fff;font:inherit;font-weight:500;cursor:pointer}
.btn.secondary{background:transparent;color:#1d1a2e;border:1px solid #d6d5e0;margin-top:8px}
.foot{font-size:12px;color:#6b7280;margin-top:16px}
</style></head><body><div class="wrap"><div class="card"><div class="hero"><h1>${htmlEscape(brand)}</h1><p>${htmlEscape(title)}</p></div><div class="body">${body}</div></div></div></body></html>`;
}

export function handleHosted(pathname: string, params: URLSearchParams, res: ServerResponse): boolean {
  const ret = allowedReturn(params.get('return') ?? '');
  if (pathname === '/hosted/clear') {
    if (!ret) {
      sendText(res, 400, 'invalid return url');
      return true;
    }
    sendText(
      res,
      200,
      page(
        'Identity verification',
        'CLEAR',
        `<span class="sim">Simulation — CLEAR is not configured</span>
<p>In production this page is CLEAR's hosted verification: the person scans a government ID and takes a selfie, and CLEAR returns the verified name, document type and expiration to the agency.</p>
<p>Choose an outcome to continue the demo.</p>
<a class="btn" style="text-align:center;line-height:42px;text-decoration:none" href="${htmlEscape(ret)}">Complete verification</a>
<a class="btn secondary" style="text-align:center;line-height:42px;text-decoration:none" href="${htmlEscape(ret.replace(/([?&])clear_task=/, '$1clear_cancel=1&clear_task='))}">Cancel</a>
<p class="foot">The result is recorded as <strong>simulated</strong> and labelled that way for the worker.</p>`,
      ),
      'text/html; charset=utf-8',
    );
    return true;
  }
  if (pathname === '/hosted/argyle') {
    if (!ret) {
      sendText(res, 400, 'invalid return url');
      return true;
    }
    sendText(
      res,
      200,
      page(
        'Connect your bank account',
        'Argyle',
        `<span class="sim">Simulation — Argyle is not configured</span>
<p>In production this is Argyle's hosted bank-connection session: the person signs in to their bank and Argyle generates a Verification of Assets report (balances and account summaries — never transactions or full account numbers).</p>
<a class="btn" style="text-align:center;line-height:42px;text-decoration:none" href="${htmlEscape(ret)}">Connect a sample bank</a>
<p class="foot">The result is recorded as <strong>simulated</strong> and labelled that way for the worker.</p>`,
      ),
      'text/html; charset=utf-8',
    );
    return true;
  }
  return false;
}
