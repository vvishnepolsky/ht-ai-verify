/**
 * Tolerant name / employer / taxonomy matching: normalized compare first, an
 * LLM verdict when configured, then a conservative heuristic. Returns true
 * when either side is empty — absence must never produce a mismatch flag.
 * Ported from ht-cre's clear.ts / argyle.ts matchers.
 */
import { isOpenAiConfigured } from '../env.js';
import { chatJson } from './openai.js';

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(md|do|np|pa|rn|lcsw|lpc|phd|dds|dmd|pharmd|jr|sr|ii|iii)\b\.?/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function namesMatch(requested: string, found: string): Promise<boolean> {
  const a = requested.trim();
  const b = found.trim();
  if (!a || !b) return true;
  if (normName(a) === normName(b)) return true;
  if (isOpenAiConfigured()) {
    try {
      const res = (await chatJson(
        'You compare two person (or organization) names to decide if they refer to the SAME party for identity verification. Treat nicknames (Bob/Robert), middle names or initials, credential suffixes (MD, LCSW), name order (LAST, FIRST), capitalization and minor typos as a match. Return strict JSON {"match": true} or {"match": false}.',
        `Name on file: "${a}"\nName found: "${b}"`,
      )) as { match?: boolean };
      if (typeof res?.match === 'boolean') return res.match;
    } catch {
      /* fall through */
    }
  }
  const rt = normName(a).split(' ');
  const vt = normName(b).split(' ');
  const rLast = rt[rt.length - 1];
  const vLast = vt[vt.length - 1];
  return !!rLast && (rLast === vLast || rLast === vt[0]) && (rt[0]?.[0] === vt[0]?.[0] || rt[0]?.[0] === vt[vt.length - 1]?.[0]);
}

const normOrg = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|lp|llp|pllc|plc|pc|pa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export async function employerMatches(expected: string[], reported: string[]): Promise<boolean> {
  const exp = expected.map((s) => s.trim()).filter(Boolean);
  const rep = reported.map((s) => s.trim()).filter(Boolean);
  if (exp.length === 0 || rep.length === 0) return true;
  for (const e of exp) for (const r of rep) if (normOrg(e) && normOrg(e) === normOrg(r)) return true;
  if (isOpenAiConfigured()) {
    try {
      const res = (await chatJson(
        'You compare employer names from a benefits application against employer names reported by a payroll provider, to decide whether ANY pair refers to the SAME company. Treat legal suffixes, abbreviations, franchise/DBA and parent-brand names as a match. Return strict JSON {"match": true} or {"match": false}.',
        `Application declared employer(s): ${JSON.stringify(exp)}\nPayroll provider reported employer(s): ${JSON.stringify(rep)}`,
      )) as { match?: boolean };
      if (typeof res?.match === 'boolean') return res.match;
    } catch {
      /* fall through */
    }
  }
  const tokens = (s: string) => new Set(normOrg(s).split(' ').filter((t) => t.length > 3));
  for (const e of exp) for (const r of rep) for (const t of tokens(r)) if (tokens(e).has(t)) return true;
  return false;
}

/** Does the provider type on file agree with the registry taxonomy description? */
export async function taxonomyMatches(providerType: string, taxonomyDesc: string, specialty?: string): Promise<boolean> {
  const a = providerType.trim();
  const b = taxonomyDesc.trim();
  if (!a || !b) return true;
  const na = normOrg(a);
  const nb = normOrg(b);
  if (nb.includes(na) || na.includes(nb)) return true;
  if (specialty && nb.includes(normOrg(specialty))) return true;
  if (isOpenAiConfigured()) {
    try {
      const res = (await chatJson(
        'You decide whether a Medicaid provider type / specialty stated on an enrollment application is consistent with the primary NPPES taxonomy description on the provider\'s NPI record. "Physician — Internal Medicine" vs "Internal Medicine" is consistent; "Physician" vs "Social Worker" is not. Return strict JSON {"match": true} or {"match": false}.',
        `Provider type on application: "${a}"${specialty ? ` (specialty: ${specialty})` : ''}\nNPPES primary taxonomy: "${b}"`,
      )) as { match?: boolean };
      if (typeof res?.match === 'boolean') return res.match;
    } catch {
      /* fall through */
    }
  }
  for (const t of tokensOf(na)) if (tokensOf(nb).has(t)) return true;
  return false;
}
const tokensOf = (s: string) => new Set(s.split(' ').filter((t) => t.length > 4));
