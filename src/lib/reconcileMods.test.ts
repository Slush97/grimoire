import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { reconcileMods } from './reconcileMods';

function mod(id: string): Mod {
  return {
    id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/addons/${id}.vpk`,
    enabled: false, priority: 1, size: 0, installedAt: '2026-01-01T00:00:00Z',
  };
}

describe('reconcileMods', () => {
  it('retains an unchanged large library after IPC serialization', () => {
    const before = Array.from({ length: 1000 }, (_, index) => mod(String(index)));
    expect(reconcileMods(before, JSON.parse(JSON.stringify(before)))).toBe(before);
    expect(reconcileMods(before, before)).toBe(before);
  });

  it('preserves untouched mods while publishing changed nested metadata', () => {
    const before = [mod('one'), { ...mod('two'), forgeInstall: { name: 'Original', origin: 'https://deadlockforge.net', installedAt: '2026-01-01' } }];
    const changed = { ...before[1], forgeInstall: { ...before[1].forgeInstall!, name: 'Edited' } };
    const result = reconcileMods(before, [{ ...before[0] }, changed]);
    expect(result).not.toBe(before);
    expect(result[0]).toBe(before[0]);
    expect(result[1]).toBe(changed);
  });

  it('uses the new order while retaining matching mod identities', () => {
    const before = [mod('one'), mod('two'), mod('three')];
    const result = reconcileMods(before, [{ ...before[2] }, { ...before[0] }, { ...before[1] }]);
    expect(result).not.toBe(before);
    expect(result[0]).toBe(before[2]);
    expect(result[1]).toBe(before[0]);
    expect(result[2]).toBe(before[1]);
  });

  it('publishes additions, removals and renamed IDs without retaining stale records', () => {
    const before = [mod('one'), mod('two')];
    const renamed = { ...before[0], id: 'renamed', fileName: 'renamed.vpk' };
    const added = mod('added');
    const result = reconcileMods(before, [renamed, added]);
    expect(result[0]).toBe(renamed);
    expect(result[1]).toBe(added);
    expect(reconcileMods(before, [{ ...before[1] }])).toEqual([before[1]]);
    expect(reconcileMods(before, [])).toEqual([]);
  });
});
