import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { captureViewerGif, encodeViewerGif, gifTrimBounds, type GifCapture } from './viewerGif';

export function useViewerGif(canvas: RefObject<HTMLCanvasElement | null>, captureKey: string, name: string, onError: () => void) {
  const [status, setStatus] = useState<'idle' | 'recording' | 'review' | 'encoding'>('idle');
  const [capture, setCapture] = useState<GifCapture | null>(null);
  const [trim, setTrim] = useState<[number, number]>([0, 1]);
  const active = useRef<AbortController | null>(null);
  const stop = useRef(false);
  const cancel = useCallback(() => {
    active.current?.abort(); active.current = null;
    setCapture(null); setStatus('idle');
  }, []);
  useEffect(() => cancel, [captureKey, cancel]);
  const toggle = useCallback(async () => {
    if (active.current) { if (status === 'recording') stop.current = true; return; }
    const source = canvas.current;
    if (!source) return;
    const controller = new AbortController();
    active.current = controller; stop.current = false;
    setCapture(null); setStatus('recording');
    try {
      const result = await captureViewerGif(source, { signal: controller.signal, shouldStop: () => stop.current });
      controller.signal.throwIfAborted();
      setCapture(result); setTrim([0, result.frames.length]); setStatus('review');
    } catch { if (!controller.signal.aborted) { setStatus('idle'); onError(); } }
    finally { if (active.current === controller) active.current = null; }
  }, [canvas, status, onError]);
  const save = useCallback(async () => {
    if (!capture || active.current) return;
    const controller = new AbortController(); active.current = controller; setStatus('encoding');
    try {
      const bytes = await encodeViewerGif(capture, trim[0], trim[1], controller.signal);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }));
      const link = document.createElement('a');
      link.download = `${name.replace(/[^a-z0-9_-]/gi, '_')}-preview.gif`; link.href = url; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('review');
    } catch { if (!controller.signal.aborted) { setStatus('review'); onError(); } }
    finally { if (active.current === controller) active.current = null; }
  }, [capture, trim, name, onError]);
  const onTrim = (start: number, end: number) => { if (capture) setTrim(gifTrimBounds(capture.frames.length, start, end)); };
  return { status, capture, trim, onTrim, recording: status === 'recording', toggle, save, cancel };
}
export type ViewerGifControls = ReturnType<typeof useViewerGif>;
