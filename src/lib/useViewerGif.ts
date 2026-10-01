import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { recordViewerGif } from './viewerGif';

export function useViewerGif(canvas: RefObject<HTMLCanvasElement | null>, captureKey: string, name: string, onError: () => void) {
  const [recording, setRecording] = useState(false);
  const active = useRef<AbortController | null>(null);
  const stop = useRef(false);
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; setRecording(false); }, []);
  useEffect(() => cancel, [captureKey, cancel]);

  const toggle = useCallback(async () => {
    if (active.current) { stop.current = true; return; }
    const source = canvas.current;
    if (!source) return;
    const controller = new AbortController();
    active.current = controller;
    stop.current = false;
    setRecording(true);
    try {
      const bytes = await recordViewerGif(source, { signal: controller.signal, shouldStop: () => stop.current });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/gif' }));
      const link = document.createElement('a');
      link.download = `${name.replace(/[^a-z0-9_-]/gi, '_')}-preview.gif`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (!controller.signal.aborted) onError();
    } finally {
      if (active.current === controller) { active.current = null; setRecording(false); }
    }
  }, [canvas, name, onError]);
  return { recording, toggle, cancel };
}
