import { describe, expect, it } from 'vitest';
import type { ModConflict } from './api';
import { searchConflicts } from './conflictSearch';

const soundConflict: ModConflict = {
  modA: 'a', modAName: 'Gun sounds', modB: 'b', modBName: 'Sound pack',
  modAIdentity: 'a', modBIdentity: 'b', ignoreKey: 'a::b',
  conflictType: 'file', details: '4 shared files',
  files: ['sounds/one.vsnd_c', 'sounds/two.vsnd_c', 'sounds/three.vsnd_c', 'sounds/solomon/fire.vsnd_c'],
};
const priorityConflict: ModConflict = {
  modA: 'c', modAName: 'Jacket', modB: 'd', modBName: 'Hat',
  modAIdentity: 'c', modBIdentity: 'd', ignoreKey: 'c::d',
  conflictType: 'priority', details: 'Same load-order slot',
};
const conflicts = [soundConflict, priorityConflict];
const mods = new Map([
  ['a', { name: 'Custom weapon audio', fileName: 'pak05_dir.vpk' }],
  ['b', { name: 'Sound pack', fileName: 'pak06_dir.vpk' }],
]);

describe('searchConflicts', () => {
  it('shows every pair for a blank search, including priority conflicts without files', () => {
    expect(searchConflicts(conflicts, mods, '  ').map((result) => result.conflict)).toEqual(conflicts);
  });

  it('finds shared paths beyond the abbreviated details and trims case-insensitive queries', () => {
    const results = searchConflicts(conflicts, mods, '  SOLOMON  ');
    expect(results).toEqual([{ conflict: soundConflict, files: ['sounds/solomon/fire.vsnd_c'] }]);
    expect(soundConflict.files).toHaveLength(4);
  });

  it('keeps the full shared-file list when the installed mod name matches', () => {
    expect(searchConflicts(conflicts, mods, 'weapon')).toEqual([
      { conflict: soundConflict, files: soundConflict.files },
    ]);
  });

  it('finds either VPK filename', () => {
    expect(searchConflicts(conflicts, mods, 'PAK06_DIR').map((result) => result.conflict)).toEqual([soundConflict]);
  });

  it('can find a priority conflict by either mod name without loaded mod metadata', () => {
    expect(searchConflicts(conflicts, new Map(), 'hat')).toEqual([{ conflict: priorityConflict, files: [] }]);
  });

  it('returns no results for an unrelated asset', () => {
    expect(searchConflicts(conflicts, mods, 'materials/unknown')).toEqual([]);
  });
});
