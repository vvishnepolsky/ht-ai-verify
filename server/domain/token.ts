/**
 * Secure-link tokens. The raw token is the applicant's / provider's only
 * credential; only sha256(token) is stored, so a database read can never
 * reproduce a live link. Mirrors ht-cre's checklist/token.ts.
 */
import { createHash, randomBytes } from 'node:crypto';

export function mintToken(): string {
  return randomBytes(24).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function tokenExpiry(ttlDays: number, now = new Date()): string {
  return new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
}
