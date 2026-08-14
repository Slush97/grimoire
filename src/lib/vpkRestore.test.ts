import { describe, it, expect, vi } from 'vitest';
import type { Mod } from '../types/mod';
import {
  getVpkIndex,
  createEnabledVpkRestoreSnapshot,
  createGlobalVpkRestoreSnapshot,
  restoreReplacementVpkState,
  shouldRestoreVpkEnabled,
  shouldRestoreVpkGlobal,
} from './vpkRestore';

/** Minimal Mod; the restore logic only reads `vpkIndex` (via getVpkIndex). */
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

describe('getVpkIndex', () => {
  it('accepts non-negative integers (incl. 0)', () => {
    expect(getVpkIndex({ vpkIndex: 0 })).toBe(0);
    expect(getVpkIndex({ vpkIndex: 3 })).toBe(3);
  });
  it('rejects negatives, non-integers, and absent values', () => {
    expect(getVpkIndex({ vpkIndex: -1 })).toBeUndefined();
    expect(getVpkIndex({ vpkIndex: 1.5 })).toBeUndefined();
    expect(getVpkIndex({})).toBeUndefined();
  });
});

describe('createEnabledVpkRestoreSnapshot', () => {
  it('reports no enabled state when nothing is enabled', () => {
    const snap = createEnabledVpkRestoreSnapshot([
      { enabled: false, vpkIndex: 0 },
      { enabled: false, vpkIndex: 1 },
    ]);
    expect(snap).toEqual({ hadEnabled: false, enabledIndexes: new Set(), enabledUnindexed: false });
  });

  it('records the indexes of the enabled, indexed VPKs', () => {
    const snap = createEnabledVpkRestoreSnapshot([
      { enabled: true, vpkIndex: 0 },
      { enabled: false, vpkIndex: 1 },
      { enabled: true, vpkIndex: 2 },
    ]);
    expect(snap.hadEnabled).toBe(true);
    expect([...snap.enabledIndexes].sort()).toEqual([0, 2]);
    expect(snap.enabledUnindexed).toBe(false);
  });

  it('flags enabled-but-unindexed VPKs (pre-vpkIndex installs)', () => {
    const snap = createEnabledVpkRestoreSnapshot([
      { enabled: true },
      { enabled: false, vpkIndex: 1 },
    ]);
    expect(snap).toEqual({ hadEnabled: true, enabledIndexes: new Set(), enabledUnindexed: true });
  });
});

describe('shouldRestoreVpkEnabled', () => {
  it('restores nothing when the old install had nothing enabled', () => {
    const snap = createEnabledVpkRestoreSnapshot([{ enabled: false, vpkIndex: 0 }]);
    expect(shouldRestoreVpkEnabled(mod({ id: 'a', vpkIndex: 0 }), [mod({ id: 'a', vpkIndex: 0 })], snap)).toBe(false);
  });

  it('restores only the sibling whose index was enabled', () => {
    const snap = createEnabledVpkRestoreSnapshot([
      { enabled: true, vpkIndex: 0 },
      { enabled: false, vpkIndex: 1 },
    ]);
    const fresh = [mod({ id: 'n0', vpkIndex: 0 }), mod({ id: 'n1', vpkIndex: 1 })];
    expect(shouldRestoreVpkEnabled(fresh[0], fresh, snap)).toBe(true);
    expect(shouldRestoreVpkEnabled(fresh[1], fresh, snap)).toBe(false);
  });

  // The regression this suite exists to lock in: a multi-VPK mod installed
  // BEFORE vpkIndex existed has an all-unindexed snapshot, but the redownload
  // stamps indexes. Every fresh VPK must be restored (coarse "something was on")
  // instead of the mod silently landing fully disabled.
  it('restores every fresh VPK when the snapshot predates vpkIndex', () => {
    const snap = createEnabledVpkRestoreSnapshot([{ enabled: true }, { enabled: true }]);
    expect(snap.enabledIndexes.size).toBe(0);
    expect(snap.enabledUnindexed).toBe(true);
    const fresh = [mod({ id: 'n0', vpkIndex: 0 }), mod({ id: 'n1', vpkIndex: 1 })];
    expect(shouldRestoreVpkEnabled(fresh[0], fresh, snap)).toBe(true);
    expect(shouldRestoreVpkEnabled(fresh[1], fresh, snap)).toBe(true);
  });

  it('restores a single-VPK mod (no indexes on either side)', () => {
    const snap = createEnabledVpkRestoreSnapshot([{ enabled: true }]);
    const fresh = [mod({ id: 'n' })];
    expect(shouldRestoreVpkEnabled(fresh[0], fresh, snap)).toBe(true);
  });

  it('restores a sole replacement when the new archive no longer has the old index', () => {
    const snap = createEnabledVpkRestoreSnapshot([{ enabled: true, vpkIndex: 1 }]);
    const fresh = [mod({ id: 'n' })];
    expect(shouldRestoreVpkEnabled(fresh[0], fresh, snap)).toBe(true);
  });

  it('does not restore an indexed sibling that was off, even when another was on', () => {
    const snap = createEnabledVpkRestoreSnapshot([
      { enabled: true, vpkIndex: 1 },
      { enabled: false, vpkIndex: 0 },
    ]);
    const fresh = [mod({ id: 'n0', vpkIndex: 0 }), mod({ id: 'n1', vpkIndex: 1 })];
    expect(shouldRestoreVpkEnabled(fresh[0], fresh, snap)).toBe(false);
    expect(shouldRestoreVpkEnabled(fresh[1], fresh, snap)).toBe(true);
  });
});

describe('Global placement restore', () => {
  it('restores Global placement to the matching replacement VPK only', () => {
    const snap = createGlobalVpkRestoreSnapshot([
      { priorityMod: true, vpkIndex: 0 },
      { priorityMod: false, vpkIndex: 1 },
    ]);
    const fresh = [mod({ id: 'n0', vpkIndex: 0 }), mod({ id: 'n1', vpkIndex: 1 })];

    expect(shouldRestoreVpkGlobal(fresh[0], fresh, snap)).toBe(true);
    expect(shouldRestoreVpkGlobal(fresh[1], fresh, snap)).toBe(false);
  });

  it('marks a disabled replacement Global without enabling it', async () => {
    const fresh = [mod({ id: 'replacement', enabled: false })];
    const setGlobal = vi.fn(async () => {});
    const enable = vi.fn(async () => {});

    const failures = await restoreReplacementVpkState(
      fresh,
      createEnabledVpkRestoreSnapshot([{ enabled: false }]),
      createGlobalVpkRestoreSnapshot([{ priorityMod: true }]),
      { setGlobal, enable },
    );

    expect(setGlobal).toHaveBeenCalledWith('replacement');
    expect(enable).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it('restores Global placement before enabling the replacement', async () => {
    const calls: string[] = [];
    const fresh = [mod({ id: 'replacement', enabled: false })];

    await restoreReplacementVpkState(
      fresh,
      createEnabledVpkRestoreSnapshot([{ enabled: true }]),
      createGlobalVpkRestoreSnapshot([{ priorityMod: true }]),
      {
        setGlobal: async () => { calls.push('global'); },
        enable: async () => { calls.push('enable'); },
      },
    );

    expect(calls).toEqual(['global', 'enable']);
  });

  it('restores Global placement to a sole replacement after archive topology changes', () => {
    const snap = createGlobalVpkRestoreSnapshot([{ priorityMod: true, vpkIndex: 1 }]);
    const fresh = [mod({ id: 'replacement' })];

    expect(shouldRestoreVpkGlobal(fresh[0], fresh, snap)).toBe(true);
  });

  it('flags mixed legacy placement as ambiguous instead of promoting ordinary siblings', () => {
    const snap = createGlobalVpkRestoreSnapshot([
      { priorityMod: true },
      { priorityMod: false },
    ]);
    const fresh = [mod({ id: 'n0', vpkIndex: 0 }), mod({ id: 'n1', vpkIndex: 1 })];

    expect(snap.ambiguous).toBe(true);
    expect(shouldRestoreVpkGlobal(fresh[0], fresh, snap)).toBe(false);
    expect(shouldRestoreVpkGlobal(fresh[1], fresh, snap)).toBe(false);
  });
});
