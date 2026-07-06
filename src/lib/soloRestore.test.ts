import { describe, it, expect } from 'vitest';
import type { Mod } from '../types/mod';
import { modRestoreKey, planSolo, planRestore } from './soloRestore';

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

describe('modRestoreKey', () => {
  it('prefers GameBanana file identity, keyed with vpkIndex for siblings', () => {
    expect(modRestoreKey(mod({ id: 'a', gameBananaId: 5, gameBananaFileId: 9, vpkIndex: 0 }))).toBe('gb:5:9:0');
    expect(modRestoreKey(mod({ id: 'a', gameBananaId: 5, gameBananaFileId: 9, vpkIndex: 1 }))).toBe('gb:5:9:1');
  });

  it('falls back to content hash, then name+size', () => {
    expect(modRestoreKey(mod({ id: 'a', sha256: 'deadbeef' }))).toBe('sha:deadbeef');
    expect(modRestoreKey(mod({ id: 'a', name: 'Cool Skin', size: 42 }))).toBe('nm:Cool Skin:42');
  });

  it('is stable across the id/fileName churn that disabling causes', () => {
    // Same GameBanana file, different local id/fileName after a disable rename.
    const enabled = mod({ id: 'id-enabled', fileName: 'pak01_dir.vpk', enabled: true, gameBananaId: 5, gameBananaFileId: 9, vpkIndex: 0 });
    const disabled = mod({ id: 'id-disabled', fileName: 'cool_skin_a1b2_dir.vpk', gameBananaId: 5, gameBananaFileId: 9, vpkIndex: 0 });
    expect(modRestoreKey(enabled)).toBe(modRestoreKey(disabled));
  });
});

describe('planSolo', () => {
  it('disables every other enabled mod and enables the target if off', () => {
    const mods = [
      mod({ id: 'a', enabled: true }),
      mod({ id: 'b', enabled: true }),
      mod({ id: 'c', enabled: false }),
    ];
    expect(planSolo(mods, ['c'])).toEqual({ enable: ['c'], disable: ['a', 'b'] });
  });

  it('is a no-op when the target is already the only thing enabled', () => {
    const mods = [mod({ id: 'a', enabled: true }), mod({ id: 'b', enabled: false })];
    expect(planSolo(mods, ['a'])).toEqual({ enable: [], disable: [] });
  });

  it('keeps multiple target ids enabled (group variants)', () => {
    const mods = [
      mod({ id: 'v1', enabled: true }),
      mod({ id: 'v2', enabled: false }),
      mod({ id: 'other', enabled: true }),
    ];
    expect(planSolo(mods, ['v1', 'v2'])).toEqual({ enable: ['v2'], disable: ['other'] });
  });

  it('ignores unknown ids', () => {
    const mods = [mod({ id: 'a', enabled: true })];
    expect(planSolo(mods, ['ghost'])).toEqual({ enable: [], disable: ['a'] });
  });
});

describe('planRestore', () => {
  it('restores the snapshotted enabled set across id churn', () => {
    // Pre-solo A and B were enabled (GameBanana files 1 and 2). Solo A disabled
    // B, which renamed it to a new id. Restore must re-enable B by its new id.
    const snapshot = [
      modRestoreKey(mod({ id: 'A', gameBananaId: 5, gameBananaFileId: 1 })),
      modRestoreKey(mod({ id: 'B', gameBananaId: 5, gameBananaFileId: 2 })),
    ];
    const postSolo = [
      mod({ id: 'A', enabled: true, gameBananaId: 5, gameBananaFileId: 1 }),
      mod({ id: 'B-renamed', enabled: false, gameBananaId: 5, gameBananaFileId: 2 }),
      mod({ id: 'C', enabled: false, gameBananaId: 5, gameBananaFileId: 3 }),
    ];
    expect(planRestore(postSolo, snapshot)).toEqual({ enable: ['B-renamed'], disable: [] });
  });

  it('disables mods enabled after the snapshot that are not part of it', () => {
    const snapshot = [modRestoreKey(mod({ id: 'A', sha256: 'aa' }))];
    const mods = [
      mod({ id: 'A', enabled: true, sha256: 'aa' }),
      mod({ id: 'B', enabled: true, sha256: 'bb' }),
    ];
    expect(planRestore(mods, snapshot)).toEqual({ enable: [], disable: ['B'] });
  });

  it('skips snapshot keys with no matching mod (deleted mid-test)', () => {
    const snapshot = [
      modRestoreKey(mod({ id: 'A', sha256: 'aa' })),
      modRestoreKey(mod({ id: 'gone', sha256: 'zz' })),
    ];
    const mods = [mod({ id: 'A', enabled: false, sha256: 'aa' })];
    expect(planRestore(mods, snapshot)).toEqual({ enable: ['A'], disable: [] });
  });
});
