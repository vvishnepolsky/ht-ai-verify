/**
 * Email delivery of the provider's secure link. 'resend' delivers via the
 * Resend HTTP API (RESEND_API_KEY + EMAIL_FROM); 'console' logs a static
 * marker only — never the recipient, subject or body — and the console then
 * offers the link for manual sharing.
 */
import { env, isEmailConfigured } from '../env.js';
import { htmlEscape } from '../http-utils.js';

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!isEmailConfigured()) {
    console.log('[email:console] delivery skipped — EMAIL_VENDOR is not resend or EMAIL_FROM/RESEND_API_KEY unset');
    throw new EmailError('Email is not configured');
  }
  const html = `<div style="font-family:Geist,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.5;color:#1d1a2e">${text
    .split('\n')
    .map((line) => {
      const esc = htmlEscape(line);
      return `<p style="margin:0 0 12px">${esc.replace(/(https?:\/\/\S+)/g, '<a href="$1" style="color:#1f1094">$1</a>')}</p>`;
    })
    .join('')}</div>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, text, html }),
  });
  if (!res.ok) {
    console.error('[email] send rejected', { httpStatus: res.status });
    throw new EmailError('Email send failed');
  }
}

export function isEmailAddress(v: string | null | undefined): boolean {
  return !!v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
