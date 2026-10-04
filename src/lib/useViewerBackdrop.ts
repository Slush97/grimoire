import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { backdropDimensions, ViewerBackdropError, VIEWER_BACKDROP_LIMITS, VIEWER_BACKDROP_TYPES } from './viewerBackdrop';
import { VIEWER_BACKGROUNDS, type ViewerBackground } from './viewerBackgrounds';

async function loadBackdrop(file: File, signal: AbortSignal): Promise<THREE.Texture> {
  if (!VIEWER_BACKDROP_TYPES.some((type) => type === file.type)) throw new ViewerBackdropError('locker.pose.backgroundFailed');
  if (file.size > VIEWER_BACKDROP_LIMITS.bytes) throw new ViewerBackdropError('locker.pose.backgroundTooLarge');
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  backdropDimensions(bytes, file.type);
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        signal.removeEventListener('abort', abort);
        image.onload = null; image.onerror = null;
        if (error) { image.src = ''; reject(error); } else resolve();
      };
      const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      image.onload = () => finish();
      image.onerror = () => finish(new ViewerBackdropError('locker.pose.backgroundFailed'));
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    signal.throwIfAborted();
    // Decoders may honor EXIF orientation; validate their actual dimensions too.
    if (image.naturalWidth > VIEWER_BACKDROP_LIMITS.dimension || image.naturalHeight > VIEWER_BACKDROP_LIMITS.dimension
      || image.naturalWidth * image.naturalHeight > VIEWER_BACKDROP_LIMITS.pixels) throw new ViewerBackdropError('locker.pose.backgroundTooLarge');
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  } finally { URL.revokeObjectURL(url); }
}

export function useViewerBackdrop() {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [preset, setPreset] = useState<ViewerBackground>('broadway');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => {
    if (preset === 'custom' || preset === 'none') return;
    const request = new AbortController();
    pending.current?.abort(); pending.current = request;
    setLoading(true); setErrorKey(null);
    void (async () => {
      try {
        const response = await fetch(VIEWER_BACKGROUNDS[preset], { signal: request.signal });
        if (!response.ok) throw new ViewerBackdropError('locker.pose.backgroundFailed');
        const next = await loadBackdrop(new File([await response.blob()], `${preset}.jpg`, { type: 'image/jpeg' }), request.signal);
        if (request.signal.aborted) next.dispose(); else setTexture(next);
      } catch (error) {
        if (!request.signal.aborted) setErrorKey(error instanceof ViewerBackdropError ? error.key : 'locker.pose.backgroundFailed');
      } finally { if (!request.signal.aborted) setLoading(false); }
    })();
    return () => request.abort();
  }, [preset]);
  const clear = () => { pending.current?.abort(); setPreset('none'); setTexture(null); setLoading(false); setErrorKey(null); };
  const choosePreset = (value: ViewerBackground) => {
    if (value === 'none') clear();
    else if (value !== 'custom') { pending.current?.abort(); setPreset(value); }
  };
  const choose = async (file: File) => {
    pending.current?.abort();
    setPreset('custom');
    const request = new AbortController();
    pending.current = request; setLoading(true); setErrorKey(null);
    try {
      const next = await loadBackdrop(file, request.signal);
      if (request.signal.aborted) next.dispose(); else setTexture(next);
    } catch (error) {
      if (!request.signal.aborted) setErrorKey(error instanceof ViewerBackdropError ? error.key : 'locker.pose.backgroundFailed');
    } finally { if (!request.signal.aborted) setLoading(false); }
  };
  return { texture, choose, clear, preset, choosePreset, errorKey, loading };
}
