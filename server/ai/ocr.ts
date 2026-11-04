/**
 * AI first-pass document review. One uploaded image/PDF is shown to a vision
 * model together with the task and the facts the case declared, and the model
 * answers: is this the right kind of document, is it legible, whose is it, is
 * it still in effect, and does it contradict the application. The answer is
 * surfaced to the applicant/provider at upload time and to the worker at
 * review. Ported from ht-cre's `ocr.ts`, generalized over both subjects.
 *
 * Feature-gated on OPENAI_API_KEY; unsupported types return null so the upload
 * still succeeds. Never throws; never logs document contents.
 */
import { env, isOpenAiConfigured } from '../env.js';
import type { CaseKind, DeclaredFact, OcrDiscrepancy, OcrExtractedField, OcrResult } from '../domain/types.js';
import { namesMatch } from './match.js';

export function isOcrSupportedMime(mime: string): boolean {
  return /^image\/(jpe?g|png|webp|gif)$/i.test(mime);
}
export function isPdfMime(mime: string): boolean {
  return /^application\/pdf$/i.test(mime);
}

const MAX_PDF_BYTES = 20 * 1024 * 1024;

export interface OcrContext {
  kind: CaseKind;
  taskTitle: string;
  taskReason: string;
  category: string;
  subject?: string;
  declared?: DeclaredFact[];
}

const OFFICE: Record<CaseKind, string> = {
  household:
    'a state benefits eligibility office (SNAP / Medicaid). The document was uploaded by an applicant household to satisfy one verification item on their application',
  provider:
    'a state Medicaid provider enrollment and credentialing office. The document was uploaded by a provider (or their practice) to satisfy one credentialing item on their enrollment application',
};

function systemPrompt(kind: CaseKind): string {
  return `You are a document-verification assistant for ${OFFICE[kind]}. You are shown ONE document (an image or a PDF). Read it and decide whether it plausibly satisfies that item. Respond as strict JSON with keys:
- "document_type_detected": short label of what the document actually is (e.g. "Driver's license", "Pay stub", "State medical license certificate", "DEA registration certificate", "Certificate of liability insurance", "Lease agreement", "Bank statement", "Unclear / unreadable").
- "matches_request": boolean — is this the right KIND of document for the item? Judge the document TYPE ONLY. An expired or superseded document of the correct kind still counts as true here — report that separately in "is_current". Answer false only when it is genuinely the wrong sort of thing (a utility bill sent for a pay-stub request; a board certificate sent for a state license request).
- "confidence": "high" or "low" — how well you could READ the document. "low" if blurry, cropped, glare-obscured, partial, or you are unsure what it says. A perfectly legible document is "high" even when it is the wrong type or out of date.
- "holder_name": the full name of the person or organization this document belongs to / is issued to, exactly as printed. Empty string if none is readable.
- "extracted": array of {"label","value"} for the few most relevant fields you can read (name, license/policy/ID number, issuer, dates, employer, amounts, address). Omit anything you cannot read. Never guess.
- "document_date": the date the document speaks to, exactly as printed (pay-period end, statement date, issue date, lease start). Empty string if none is readable.
- "valid_until": the date it stops being in effect, exactly as printed (license/registration/ID expiration, policy end, lease end). Empty string if none.
- "is_current": true if the document is still in effect and recent enough to prove the requested fact as of today's date given below; false if it has clearly lapsed (an expired license, ID, registration or policy; a lease whose term ended; a pay stub or statement far outside the requested window). Omit the key entirely if no date is readable. Never guess — omitting is always better than a wrong verdict. This is the ONLY place staleness is reported.
- "discrepancies": array of {"field","expected","found"} for values on the document that CONTRADICT the facts listed below — a license number, name, employer, rent, policy number or expiration that plainly differs. Compare only what you can actually read; a value you cannot find is NOT a discrepancy, nor is a formatting difference (abbreviations, punctuation, "St" vs "Street", a credential suffix, month names vs numbers). A fact marked "(approximate)" agrees when the document is within roughly 25% of it after converting pay frequency to a monthly amount (a biweekly gross pay of $500 is about $1,083/month; a balance of $389 agrees with "about $420") — never report those as discrepancies. A fact marked "(exact …)" or carrying no marker must match as printed. Return [] when everything agrees or no facts were given.
- "authenticity_concern": true ONLY if the document shows clear signs of alteration (mismatched fonts over edited fields, visible cut-and-paste, inconsistent dates on the same page, placeholder text like "Lorem ipsum"). Otherwise false. A plain, simply formatted document is NOT a concern.
- "summary": one short plain-language sentence for the worker. If it has lapsed, say so with the end date. If it contradicts the application, say which value differs.
Do not include any other keys. Do not invent values.`;
}

function coerceResult(raw: unknown): OcrResult {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const extracted: OcrExtractedField[] = (Array.isArray(o['extracted']) ? (o['extracted'] as unknown[]) : [])
    .map((f) => {
      const r = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      return { label: String(r['label'] ?? '').slice(0, 80), value: String(r['value'] ?? '').slice(0, 200) };
    })
    .filter((f) => f.label && f.value)
    .slice(0, 10);
  const str = (k: string, max: number) => String(o[k] ?? '').trim().slice(0, max);
  const discrepancies: OcrDiscrepancy[] = (Array.isArray(o['discrepancies']) ? (o['discrepancies'] as unknown[]) : [])
    .map((x) => {
      const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      return {
        field: String(r['field'] ?? '').slice(0, 80),
        expected: String(r['expected'] ?? '').slice(0, 200),
        found: String(r['found'] ?? '').slice(0, 200),
      };
    })
    .filter((x) => x.field && x.expected && x.found)
    .slice(0, 6);
  const holder = str('holder_name', 120);
  const docDate = str('document_date', 60);
  const validUntil = str('valid_until', 60);
  return {
    confidence: o['confidence'] === 'high' ? 'high' : 'low',
    matches_request: o['matches_request'] === true,
    document_type_detected: str('document_type_detected', 80) || 'Unknown',
    ...(holder ? { holder_name: holder } : {}),
    ...(docDate ? { document_date: docDate } : {}),
    ...(validUntil ? { valid_until: validUntil } : {}),
    ...(typeof o['is_current'] === 'boolean' ? { is_current: o['is_current'] } : {}),
    ...(discrepancies.length > 0 ? { discrepancies } : {}),
    ...(o['authenticity_concern'] === true ? { flags: ['authenticity_concern'] } : {}),
    verdict: 'review',
    extracted,
    summary: str('summary', 300),
    analyzed_at: new Date().toISOString(),
  };
}

/** Worker-facing issue codes, most specific first. */
export function deriveOcrFlags(r: OcrResult): string[] {
  const flags: string[] = [];
  if (r.name_match === false) flags.push('name_mismatch');
  if (r.is_current === false) flags.push('outdated_document');
  if (r.discrepancies && r.discrepancies.length > 0) flags.push('data_mismatch');
  if (!r.matches_request) flags.push('wrong_document_type');
  if (r.flags?.includes('authenticity_concern')) flags.push('authenticity_concern');
  if (r.confidence === 'low') flags.push('low_confidence');
  return flags;
}

export async function runDocumentReview(bytes: Buffer, mime: string, ctx: OcrContext): Promise<OcrResult | null> {
  if (!isOpenAiConfigured()) return null;
  const isImage = isOcrSupportedMime(mime);
  const isPdf = isPdfMime(mime);
  if (!isImage && !isPdf) return null;
  if (isPdf && bytes.length > MAX_PDF_BYTES) return null;

  const attachment: Record<string, unknown> = isPdf
    ? { type: 'file', file: { filename: 'document.pdf', file_data: `data:application/pdf;base64,${bytes.toString('base64')}` } }
    : { type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}`, detail: 'high' } };

  const today = new Date().toISOString().slice(0, 10);
  const userText =
    `Verification item the document should satisfy:\nTitle: ${ctx.taskTitle}\nWhy it's needed: ${ctx.taskReason}\nCategory: ${ctx.category}` +
    (ctx.subject ? `\nThe document should belong to: ${ctx.subject}` : '') +
    `\nToday's date is ${today}. Judge "is_current" against that date.` +
    (ctx.declared?.length
      ? `\n\nThe application states the following. Cross-check what you read against these and report only genuine contradictions in "discrepancies":\n` +
        ctx.declared.map((d) => `- ${d.label}: ${d.value}`).join('\n')
      : '');

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.OPENAI_OCR_MODEL,
        messages: [
          { role: 'system', content: systemPrompt(ctx.kind) },
          { role: 'user', content: [{ type: 'text', text: userText }, attachment] },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 800,
      }),
    });
    if (!res.ok) {
      console.warn('[ai-review] model request failed', { status: res.status });
      return null;
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const result = coerceResult(JSON.parse(content));
    if (ctx.subject && result.holder_name) {
      result.name_match = await namesMatch(ctx.subject, result.holder_name);
    }
    result.flags = deriveOcrFlags(result);
    result.verdict = result.flags.length === 0 ? 'pass' : 'review';
    result.model = env.OPENAI_OCR_MODEL;
    return result;
  } catch {
    return null;
  }
}
