import { create } from 'zustand';
import type { TrippyStyleName, TrippySkinTargets } from '../types/mod';

/**
 * Live (unsaved) trippy-skin params, shared from the Body + Gun paint panel to
 * the Locker's floating 3D model viewer so it can preview the pattern animated
 * on the hero body in real time. This is a preview-only side channel: the
 * actual bake/apply still goes through `applyTrippySkin`. The panel pushes its
 * slider state here on change and clears it on unmount; the viewer reads the
 * entry that matches the hero it is currently showing.
 *
 * Body only: the pose GLB carries no weapon mesh, so a `weapons`-only paint has
 * nothing to show here (the viewer ignores it). The model materials are also an
 * approximation of the engine's UV-scroll shader, not the exact bake.
 */
export interface TrippyPreview {
  heroName: string;
  style: TrippyStyleName;
  /** Pattern strength 0..1; 0 means no overlay. */
  intensity: number;
  phase: number;
  /** UV-scroll speed scale; drives the flipbook loop speed. */
  scroll: number;
  targets: TrippySkinTargets;
}

interface TrippyPreviewStore {
  preview: TrippyPreview | null;
  setPreview: (preview: TrippyPreview) => void;
  clearPreview: () => void;
}

export const useTrippyPreviewStore = create<TrippyPreviewStore>((set) => ({
  preview: null,
  setPreview: (preview) => set({ preview }),
  clearPreview: () => set({ preview: null }),
}));
