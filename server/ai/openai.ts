/**
 * Minimal server-side OpenAI client (fetch-based, no SDK). The key is
 * server-only and never reaches a browser; response bodies are never surfaced
 * in errors (they can echo document contents).
 */
import { env, isOpenAiConfigured } from '../env.js';

export class OpenAiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpenAiError';
  }
}

type Content = string | Array<Record<string, unknown>>;

export async function chatJson(system: string, user: Content, model?: string, maxTokens = 500): Promise<unknown> {
  if (!isOpenAiConfigured()) throw new OpenAiError('OpenAI is not configured (OPENAI_API_KEY missing)');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model ?? env.OPENAI_MATCH_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new OpenAiError('OpenAI request failed', res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new OpenAiError('OpenAI returned no content');
  return JSON.parse(content) as unknown;
}
