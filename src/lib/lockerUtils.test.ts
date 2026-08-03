import { describe, it, expect } from 'vitest';
import type { Mod } from '../types/mod';
import { modLoadOrder, activeLockerSkin } from './lockerUtils';

function mod(over: Partial<Mod> & { id: string; metaKey: string; priority: number }): Mod {
  return {
    name: over.id,
    fileName: `pak${String(over.priority).padStart(2, '0')}_dir.vpk`,
    path: `/addons/${over.id}.vpk`,
    enabled: true,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

/**
 * Load order decides which mod wins when two cover the same file, so it drives
 * the Locker's "active skin", the Conflicts page's winner column, and the
 * per-hero reorder strip. The citadel/grimoire priority root is the first Game
 * line in the canonical SearchPaths block, so it must outrank every addons
 * folder; this used to be mirrored by hand on the Conflicts page and went stale.
 */
describe('modLoadOrder', () => {
  it('ranks the priority root ahead of base addons', () => {
    const global = mod({ id: 'g', metaKey: 'grimoire/pak99_dir.vpk', priority: 99 });
    const base = mod({ id: 'b', metaKey: 'pak01_dir.vpk', priority: 1 });
    // Even the LAST priority slot beats the FIRST base slot: the folder wins,
    // not the number.
    expect(modLoadOrder(global)).toBeLessThan(modLoadOrder(base));
  });

  it('orders within the priority root by pakNN', () => {
    const first = mod({ id: 'a', metaKey: 'grimoire/pak05_dir.vpk', priority: 5 });
    const second = mod({ id: 'b', metaKey: 'grimoire/pak06_dir.vpk', priority: 6 });
    expect(modLoadOrder(first)).toBeLessThan(modLoadOrder(second));
  });

  it('keeps base addons ahead of overflow folders', () => {
    const base = mod({ id: 'b', metaKey: 'pak99_dir.vpk', priority: 99 });
    const overflow = mod({ id: 'o', metaKey: 'addons1/pak01_dir.vpk', priority: 1 });
    expect(modLoadOrder(base)).toBeLessThan(modLoadOrder(overflow));
  });
});

describe('activeLockerSkin', () => {
  // The Locker's hero card art follows the active skin. A Global mod sorts
  // first by construction, so it would hijack every hero card it is grouped
  // under if callers did not filter it out (the shuffle planner does).
  it('returns the lowest load order among enabled mods', () => {
    const mods = [
      mod({ id: 'late', metaKey: 'pak09_dir.vpk', priority: 9 }),
      mod({ id: 'early', metaKey: 'pak02_dir.vpk', priority: 2 }),
      mod({ id: 'off', metaKey: 'pak01_dir.vpk', priority: 1, enabled: false }),
    ];
    expect(activeLockerSkin(mods)?.id).toBe('early');
  });

  it('is undefined when nothing is enabled', () => {
    expect(activeLockerSkin([mod({ id: 'x', metaKey: 'pak01_dir.vpk', priority: 1, enabled: false })])).toBeUndefined();
  });
});
