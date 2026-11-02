import { useEffect, useState } from 'react';
import { previewTrippySprite } from './api';
import { TRIPPY_STYLES, type TrippyStyleName, type TrippySpriteResult } from '../types/mod';

type Swatches = Partial<Record<TrippyStyleName, TrippySpriteResult>>;
let loading: Promise<Swatches> | null = null;

/** Small still previews of every pattern, loaded once per session and shared by every picker. */
export function useTrippySwatches(): Swatches {
  const [sprites, setSprites] = useState<Swatches>({});
  useEffect(() => {
    let cancelled = false;
    loading ??= Promise.all(TRIPPY_STYLES.map(async (style) => {
      try { return [style, await previewTrippySprite({ style, intensity: 1, phase: 0, scroll: 0, frames: 1, size: 64 })] as const; }
      catch { return null; }
    })).then((entries) => Object.fromEntries(entries.filter((entry) => entry !== null)));
    void loading.then((value) => { if (!cancelled) setSprites(value); });
    return () => { cancelled = true; };
  }, []);
  return sprites;
}
