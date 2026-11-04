/**
 * Twilio SMS (fetch-based, no SDK). Delivers the household's secure link.
 * Credentials are server-only; the dialed number is never logged.
 */
import { env, isTwilioConfigured } from '../env.js';

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TwilioError';
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!isTwilioConfigured()) throw new TwilioError('Twilio is not configured');
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ To: to, From: env.TWILIO_PHONE_NUMBER, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) {
    let code: unknown;
    try {
      code = ((await res.json()) as { code?: unknown }).code;
    } catch {
      /* ignore */
    }
    console.error('[twilio] SMS rejected', { httpStatus: res.status, twilioCode: code ?? 'unknown' });
    throw new TwilioError('Twilio SMS send failed', res.status);
  }
}

/** E.164 normalization for US numbers typed into the console. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (raw.trim().startsWith('+') && digits.length >= 8) return `+${digits}`;
  return null;
}
