/**
 * Full-screen in-browser camera for document capture (rear camera, live
 * preview, JPEG downscaled to 1600px). Falls back to the file picker when
 * the camera is unavailable or denied. Ported from ht-cre's CameraCapture.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_DIM = 1600;

export function CameraCapture({ onCapture, onClose, onUnavailable }: { onCapture: (file: File) => void; onClose: () => void; onUnavailable: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onUnavailable();
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
      } catch {
        onUnavailable();
      }
    }
    void start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [onUnavailable]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    const vw = video.videoWidth || 1280;
    const vh = video.videoHeight || 960;
    const scale = Math.min(1, MAX_DIM / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    const cx = canvas.getContext('2d');
    if (!cx) {
      setBusy(false);
      return;
    }
    cx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
        setBusy(false);
      },
      'image/jpeg',
      0.85,
    );
  }, [busy, onCapture]);

  return (
    <div className="camera" role="dialog" aria-label="Take a photo">
      <div className="top">
        <span>Center the document, then capture</span>
        <button type="button" onClick={onClose} aria-label="Close camera">
          ×
        </button>
      </div>
      <div className="view">
        <video ref={videoRef} playsInline muted aria-label="Camera preview" />
        <div className="guide" aria-hidden="true" />
      </div>
      <div className="shutter">
        <button type="button" onClick={capture} disabled={!ready || busy} aria-label="Capture photo" />
      </div>
    </div>
  );
}
