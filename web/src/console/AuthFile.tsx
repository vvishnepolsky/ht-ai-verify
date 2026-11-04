import { useEffect, useState } from 'react';
import { getAdminKey } from '../api';

/**
 * Console file previews. `<img>` / `<iframe>` cannot send the admin-key
 * header, so the file route would answer 401 — fetch the bytes with the
 * header and hand the element a blob URL instead.
 */
export function useAuthedFile(url: string | null): { src: string | null; error: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!url) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setSrc(null);
    setError(false);
    fetch(url, { headers: getAdminKey() ? { 'x-admin-key': getAdminKey() } : {} })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return { src, error };
}

export function AuthImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const { src, error } = useAuthedFile(url);
  if (error) return <span className="muted small">Preview unavailable</span>;
  if (!src) return <span className="spinner" aria-label="Loading preview" />;
  return <img src={src} alt={alt} className={className} />;
}

/** Fetch with the admin key and open the file in a new tab as a blob. */
export async function openAuthedFile(url: string): Promise<void> {
  const tab = window.open('about:blank', '_blank');
  try {
    const r = await fetch(url, { headers: getAdminKey() ? { 'x-admin-key': getAdminKey() } : {} });
    if (!r.ok) throw new Error(String(r.status));
    const blobUrl = URL.createObjectURL(await r.blob());
    if (tab) tab.location.href = blobUrl;
    else window.open(blobUrl, '_blank');
  } catch {
    tab?.close();
  }
}
