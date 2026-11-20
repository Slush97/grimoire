import { createContext, useContext } from 'react';
import type * as THREE from 'three';

export interface SoulTile {
  el: HTMLElement | null;
  root: THREE.Object3D | null;
  image: HTMLImageElement | null;
  hovered: boolean;
  manual: boolean;
  savedYaw: number;
  portrait?: boolean;
  yaw: number;
  opacity: number;
  onIdle?: () => void;
}

interface Capture {
  id: string;
  yaw: number;
  width: number;
  height: number;
  resolve: (png: string) => void;
  reject: (error: Error) => void;
}

export interface SoulRegistry {
  tiles: Map<string, SoulTile>;
  captures: Capture[];
  register(id: string, el: HTMLElement): void;
  setRoot(id: string, root: THREE.Object3D | null): void;
  hover(id: string, hovered: boolean): void;
  setOpacity(id: string, opacity: number): void;
  capture(id: string, yaw: number): Promise<string>;
  invalidate(): void;
  unregister(id: string): void;
  subscribe(listener: () => void): () => void;
}

export function createSoulRegistry(): SoulRegistry {
  const tiles = new Map<string, SoulTile>();
  const captures: Capture[] = [];
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const tileFor = (id: string) => {
    let tile = tiles.get(id);
    if (!tile) {
      tile = { el: null, root: null, image: null, hovered: false, manual: false, savedYaw: 0, yaw: 0, opacity: 0 };
      tiles.set(id, tile);
    }
    return tile;
  };
  return {
    tiles, captures, invalidate: notify,
    register(id, el) { tileFor(id).el = el; notify(); },
    setRoot(id, root) {
      const tile = tileFor(id);
      if (tile.root) tile.yaw = tile.root.rotation.y;
      tile.root = root;
      if (root) root.rotation.y = tile.manual ? tile.yaw : tile.savedYaw;
      notify();
    },
    hover(id, hovered) {
      const tile = tileFor(id);
      if (hovered && !tile.hovered && !tile.manual && tile.root) tile.root.rotation.y = tile.savedYaw;
      tile.hovered = hovered;
      notify();
    },
    setOpacity(id, opacity) {
      const tile = tileFor(id);
      tile.opacity = opacity;
      if (tile.image) tile.image.style.opacity = String(1 - opacity);
    },
    capture(id, yaw) {
      return new Promise((resolve, reject) => {
        if (!tiles.has(id)) { reject(new Error('Preview unloaded')); return; }
        const capture: Capture = { id, yaw, width: tiles.get(id)?.portrait ? 768 : 1024, height: tiles.get(id)?.portrait ? 1024 : 576,
          resolve(png) { clearTimeout(timeout); resolve(png); },
          reject(error) { clearTimeout(timeout); reject(error); },
        };
        const timeout = setTimeout(() => {
          const index = captures.indexOf(capture);
          if (index >= 0) captures.splice(index, 1);
          capture.reject(new Error('Preview capture timed out'));
        }, 15000);
        captures.push(capture);
        notify();
      });
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    unregister(id) {
      tiles.delete(id);
      for (let i = captures.length - 1; i >= 0; i--) {
        if (captures[i].id === id) captures.splice(i, 1)[0].reject(new Error('Preview unloaded'));
      }
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
