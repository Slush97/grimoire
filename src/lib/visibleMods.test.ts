import { describe, expect, it } from 'vitest';
import type { MergedModSource, Mod } from '../types/mod';
import { buildModEntries, entryDetailsAnchor } from './modEntries';
import { visibleInstalledMods } from './visibleMods';

function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: `${over.id}.vpk`,
    enabled: false,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const source = (over: Partial<MergedModSource>): MergedModSource => ({
  fileName: 'pak10_dir.vpk',
  modName: 'Source',
  enabledAtMergeTime: true,
  priorityAtMergeTime: 1,
  ...over,
});

describe('visibleInstalledMods', () => {
  const merged = mod({
    id: 'merged',
    enabled: true,
    merged: {
      id: 'm1',
      createdAt: '2026-01-01T00:00:00Z',
      shareCode: 'mp1:x',
      sources: [source({ fileName: 'pak10_dir.vpk', gameBananaId: 7, gameBananaFileId: 70 })],
    },
  });

  it('hides an absorbed merge source and Locker artifacts', () => {
    const absorbed = mod({ id: 'absorbed', fileName: 'pak10_dir.vpk', gameBananaId: 7, gameBananaFileId: 70 });
    const cosmetics = mod({ id: 'cosmetics', lockerCosmetics: { cards: [], rebuiltAt: '2026-01-01T00:00:00Z' } });
    const standalone = mod({ id: 'standalone', gameBananaId: 7, gameBananaFileId: 71 });

    expect(visibleInstalledMods([merged, absorbed, cosmetics, standalone]).map((m) => m.id)).toEqual([
      'merged',
      'standalone',
    ]);
  });

  it('keeps an enabled mod or a different file that reuses the source filename', () => {
    const enabledReuse = mod({ id: 'enabled', fileName: 'pak10_dir.vpk', enabled: true });
    const otherFile = mod({ id: 'other', fileName: 'pak10_dir.vpk', gameBananaId: 7, gameBananaFileId: 99 });

    expect(visibleInstalledMods([merged, enabledReuse]).map((m) => m.id)).toEqual(['merged', 'enabled']);
    expect(visibleInstalledMods([merged, otherFile]).map((m) => m.id)).toEqual(['merged', 'other']);
  });
});

describe('entryDetailsAnchor', () => {
  const primary = mod({ id: 'primary', gameBananaId: 9, gameBananaFileId: 1, enabled: true, priority: 1 });
  const stale = mod({ id: 'stale', gameBananaId: 9, gameBananaFileId: 2, priority: 2 });
  const [group] = buildModEntries([primary, stale]);

  it('opens a group on the variant flagged for update', () => {
    expect(group.kind).toBe('group');
    expect(entryDetailsAnchor(group, (id) => id === 'stale').id).toBe('stale');
  });

  it('falls back to the primary when nothing is flagged', () => {
    expect(entryDetailsAnchor(group, () => false).id).toBe('primary');
  });
});
