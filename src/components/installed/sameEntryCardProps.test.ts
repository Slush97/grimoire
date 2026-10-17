import { describe, expect, it } from 'vitest';
import { buildModEntries } from '../../lib/modEntries';
import type { Mod } from '../../types/mod';
import { sameEntryCardProps } from './sameEntryCardProps';

function mod(id: string, extra: Partial<Mod> = {}): Mod {
  return {
    id, name: id, fileName: `${id}.vpk`, path: `/addons/${id}.vpk`,
    metaKey: `${id}.vpk`, enabled: false, priority: 1, size: 10,
    installedAt: '2026-01-01T00:00:00Z', ...extra,
  };
}

describe('Installed card memo equality', () => {
  it('skips unchanged singles after another mod changes, but refreshes the changed card', () => {
    const mods = [mod('one'), mod('two')];
    const before = buildModEntries(mods);
    const after = buildModEntries([mods[0], { ...mods[1], enabled: true }]);
    expect(sameEntryCardProps({ entry: before[0] }, { entry: after[0] })).toBe(true);
    expect(sameEntryCardProps({ entry: before[1] }, { entry: after[1] })).toBe(false);
  });

  it('keeps groups only while every ordered variant is unchanged', () => {
    const one = mod('one', { gameBananaId: 1, priority: 1 });
    const two = mod('two', { gameBananaId: 1, priority: 2 });
    const [before] = buildModEntries([one, two]);
    const props = { entry: before };
    expect(sameEntryCardProps(props, { entry: buildModEntries([one, two])[0] })).toBe(true);
    for (const changed of [
      [one, { ...two, enabled: true }],
      [one, { ...two, variantLabel: 'New label' }],
      [one, { ...two, safety: { trusted: false } as Mod['safety'] }],
      [one, two, mod('three', { gameBananaId: 1 })],
      [one],
      [one, { ...two, localGroupId: 'local' }],
    ]) {
      expect(sameEntryCardProps(props, { entry: buildModEntries(changed)[0] })).toBe(false);
    }
    if (before.kind !== 'group') throw new Error('Expected a group');
    expect(sameEntryCardProps(props, { entry: { ...before, variants: [two, one] } })).toBe(false);
  });

  it('compares callbacks and every additional prop, including sortable state', () => {
    const [entry] = buildModEntries([mod('one')]);
    const onToggle = () => {};
    const before = { entry, onToggle, selected: false, sortableDisabled: false };
    expect(sameEntryCardProps(before, { ...before })).toBe(true);
    expect(sameEntryCardProps(before, { ...before, onToggle: () => {} })).toBe(false);
    expect(sameEntryCardProps(before, { ...before, selected: true })).toBe(false);
    expect(sameEntryCardProps(before, { ...before, sortableDisabled: true })).toBe(false);
    expect(sameEntryCardProps({ entry }, { entry, selected: false })).toBe(false);
    expect(sameEntryCardProps({ entry, selected: undefined }, { entry, shiftHeld: undefined })).toBe(false);
  });
});
