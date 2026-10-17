import { createContext, useContext } from 'react';
import type * as THREE from 'three';

/**
 * Registry shared between the soul-container cards (SoulContainerTile) and the
 * single shared renderer (SoulContainerCanvas).
 *
 * Each tile registers its DOM track element and, once its GLB is loaded, the
 * normalized THREE group to draw. The shared canvas reads this live map every
 * frame and scissor-renders each tile into its card's current on-screen rect.
 * One WebGL context paints the whole grid, so the number of mods no longer
 * matters for the browser's live-context cap.
 *
 * Three is a type-only import here (erased at runtime) so this module and the
 * provider stay in the main bundle while three + @react-three/fiber split into
 * the lazy tile/canvas chunks.
 */

export interface SoulTile {
  /** The card's media-window element, measured each frame for scissor placement. */
  el: HTMLElement | null;
  /** The normalized, spinnable group, or null until the GLB finishes loading. */
  root: THREE.Object3D | null;
}

export interface SoulRegistry {
  /** Live map the render loop iterates; keyed by mod metaKey. */
  tiles: Map<string, SoulTile>;
  register(id: string, el: HTMLElement): void;
  setRoot(id: string, root: THREE.Object3D | null): void;
  unregister(id: string): void;
  subscribe(listener: () => void): () => void;
}

export function createSoulRegistry(): SoulRegistry {
  const tiles = new Map<string, SoulTile>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  return {
    tiles,
    register(id, el) {
      const existing = tiles.get(id);
      if (existing) existing.el = el;
      else tiles.set(id, { el, root: null });
      notify();
    },
    setRoot(id, root) {
      const existing = tiles.get(id);
      if (existing) existing.root = root;
      else tiles.set(id, { el: null, root });
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    unregister(id) {
      tiles.delete(id);
      notify();
    },
  };
}

export const SoulRegistryContext = createContext<SoulRegistry | null>(null);

export function useSoulRegistry(): SoulRegistry {
  const registry = useContext(SoulRegistryContext);
  if (!registry) throw new Error('useSoulRegistry must be used within SoulRegistryProvider');
  return registry;
}
