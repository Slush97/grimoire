import { useLayoutEffect } from 'react';
import { create } from 'zustand';
import type { HeroPoseViewerProps } from '../components/locker/HeroPoseViewer';

/**
 * What the app's one hero viewer shows (see LockerViewerHost). Every page with a 3D hero sets it, so
 * the canvas, the loaded room and the recent hero models carry across pages.
 */
export type LockerViewerRequest = Omit<HeroPoseViewerProps, 'active' | 'onShownHeroChange'>;

interface LockerViewerState {
  /** Whether the Locker shows its 3D model. Kept across heroes for the session. */
  open: boolean;
  /** What the viewer shows; null once it is released. */
  request: LockerViewerRequest | null;
  /** The element showing the viewer; null while it is hidden. */
  slot: HTMLElement | null;
  /** The hero the viewer has on screen, which trails `request` while the next hero loads. */
  shownHero: string | null;
  setOpen: (open: boolean) => void;
}

export const useLockerViewer = create<LockerViewerState>((set) => ({
  open: false,
  request: null,
  slot: null,
  shownHero: null,
  setOpen: (open) => set({ open }),
}));

/** Whether a viewer is loaded, shown or hidden, so opening it again needs no preload. */
export function lockerViewerLoaded(): boolean {
  return useLockerViewer.getState().request !== null;
}

/** What a hidden viewer keeps of a page's request: what it loaded and where it saves its view.
 *  Editing state and callbacks belong to the page that is gone. */
export function parkedViewerRequest(request: LockerViewerRequest): LockerViewerRequest {
  const { heroName, skinSources, fallbackSkinMetaKey, trippyPreview, partEdits, workspaceKey, initialScene, sceneSurface, initialBackground } = request;
  return { heroName, skinSources, fallbackSkinMetaKey, trippyPreview, partEdits, workspaceKey, initialScene, sceneSurface, initialBackground };
}

function sameRequest(a: LockerViewerRequest, b: LockerViewerRequest): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof LockerViewerRequest)[]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/** Points the viewer at `request`, unless it already shows exactly that. */
export function requestLockerViewer(request: LockerViewerRequest): void {
  const current = useLockerViewer.getState().request;
  if (!current || !sameRequest(current, request)) useLockerViewer.setState({ request });
}

/** Points the Locker's viewer at a hero while `shown`. Called by the per-hero view, which remounts per hero. */
export function useLockerViewerRequest(shown: boolean, { heroName, skinSources, fallbackSkinMetaKey, trippyPreview }: LockerViewerRequest) {
  useLayoutEffect(() => {
    if (shown) useLockerViewer.setState({ request: { heroName, skinSources, fallbackSkinMetaKey, trippyPreview } });
  }, [shown, heroName, skinSources, fallbackSkinMetaKey, trippyPreview]);
}
