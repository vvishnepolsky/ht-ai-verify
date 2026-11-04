/**
 * Upload normalization: HEIC/HEIF (iPhone photo library) → JPEG so the
 * worker's preview renders and the AI review can read it. Anything else
 * passes through unchanged. Never throws — a failed conversion keeps the
 * original bytes (the upload still succeeds, just unanalyzed).
 */
import convert from 'heic-convert';

export interface Upload {
  mime: string;
  filename?: string;
  source: 'camera' | 'upload';
  bytes: Buffer;
}

function looksHeic(u: Upload): boolean {
  return /^image\/hei[cf]$/i.test(u.mime) || /\.hei[cf]$/i.test(u.filename ?? '');
}

export async function normalizeUpload(u: Upload): Promise<Upload> {
  if (!looksHeic(u)) return u;
  try {
    const out = await convert({ buffer: u.bytes, format: 'JPEG', quality: 0.85 });
    const bytes = Buffer.from(out);
    const filename = u.filename ? u.filename.replace(/\.hei[cf]$/i, '.jpg') : undefined;
    return { ...u, mime: 'image/jpeg', bytes, ...(filename ? { filename } : {}) };
  } catch (err) {
    console.warn('[normalize] HEIC conversion failed', err instanceof Error ? err.message : err);
    return u;
  }
}
