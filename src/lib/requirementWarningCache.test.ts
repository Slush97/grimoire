import { describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import type { ModRequirement, ModRequirementSnapshot } from '../types/gamebanana';
import { createRequirementWarningCache } from './requirementWarningCache';
import { requirementFileKey } from './requirementLoadOrder';

const makeMod = (id: string, gameBananaId: number, priority = 1): Mod => ({
  id, gameBananaId, priority, metaKey: id, fileName: id, path: id, name: id, enabled: true, size: 1, installedAt: '',
});
const overlay = makeMod('overlay', 100, 2);
const base = makeMod('base', 200);
const required: ModRequirement = { name: 'Base', url: 'https://gamebanana.com/mods/200', state: 'on', importance: 'required' };
const snapshot = (items = [required], checkedAt = 1): ModRequirementSnapshot => ({ status: 'loaded', checkedAt, items });

describe('cached Installed requirement warnings', () => {
  it('reuses source calculations across remounted cards and keeps results stable after unrelated updates', () => {
    const select = createRequirementWarningCache();
    const read = vi.fn();
    const mods = [new Proxy(overlay, { get(target, property, receiver) { read(); return Reflect.get(target, property, receiver); } })];
    const snapshots = { 'Mod:100': snapshot() };
    const files = {};
    const first = select(overlay, mods, snapshots, files);
    expect(first).toMatchObject({ label: 'missing', warning: true });
    read.mockClear();
    expect(select(overlay, mods, snapshots, files)).toBe(first);
    expect(select({ ...overlay }, mods, snapshots, files)).toEqual(first);
    expect(select(overlay, mods, { ...snapshots, 'Mod:999': snapshot([]) }, files)).toBe(first);
    expect(select(overlay, mods, { ...snapshots, 'Mod:100': { ...snapshots['Mod:100'], checkedAt: 2 } }, files)).toBe(first);
    expect(read).not.toHaveBeenCalled();
  });

  it('keeps the selected result stable after unrelated inventory or file changes, then updates when the requirement changes', () => {
    const select = createRequirementWarningCache();
    const snapshots = { 'Mod:100': snapshot() };
    const first = select(overlay, [overlay], snapshots, {});
    expect(select(overlay, [overlay, makeMod('unrelated', 999)], snapshots, { unrelated: [] })).toBe(first);
    expect(select(overlay, [overlay, { ...base, enabled: false }], snapshots, {})).toMatchObject({ label: 'disabled', warning: true });
    expect(select(overlay, [overlay, base], snapshots, {})).toMatchObject({ label: 'title', warning: false });
    expect(select(overlay, [overlay], { 'Mod:100': snapshot([]) }, {})).toBeNull();
  });

  it.each(['on', 'unknown'] as const)('preserves order warnings for enabled or unknown required state %s', state => {
    const select = createRequirementWarningCache();
    const files = { [requirementFileKey(overlay)]: ['a.vtex_c'], [requirementFileKey(base)]: ['a.vtex_c', 'a.vmdl_c'] };
    expect(select(overlay, [base, overlay], { 'Mod:100': snapshot([{ ...required, state }]) }, files)).toMatchObject({ label: 'orderWarning', warning: true });
    expect(select(overlay, [base, overlay], { 'Mod:100': snapshot([{ ...required, state: 'off' }]) }, files)).toMatchObject({ label: 'review', warning: true });
    expect(select(overlay, [overlay], { 'Mod:100': snapshot([{ ...required, state: 'off' }]) }, files)).toMatchObject({ label: 'title', warning: false });
  });

  it('keeps order warnings specific to each variant sharing a source and invalidates changed file evidence', () => {
    const select = createRequirementWarningCache();
    const earlierVariant = makeMod('earlier-variant', 100, 0);
    const mods = [earlierVariant, base, overlay];
    const snapshots = { 'Mod:100': snapshot() };
    const files = {
      [requirementFileKey(earlierVariant)]: ['a.vtex_c'],
      [requirementFileKey(overlay)]: ['a.vtex_c'],
      [requirementFileKey(base)]: ['a.vtex_c', 'a.vmdl_c'],
    };

    expect(select(overlay, mods, snapshots, files)).toMatchObject({ label: 'orderWarning', warning: true });
    expect(select(earlierVariant, mods, snapshots, files)).toMatchObject({ label: 'title', warning: false });
    expect(select(overlay, mods, snapshots, { ...files, [requirementFileKey(overlay)]: ['different.vtex_c'] }))
      .toMatchObject({ label: 'title', warning: false });
  });

  it('preserves merged source priority and missing before disabled labels', () => {
    const select = createRequirementWarningCache();
    const merged = { ...overlay, merged: { sources: [{ gameBananaId: 300, section: 'Sound' }] } } as Mod;
    const sources = { 'Mod:100': snapshot([{ ...required, importance: 'optional' }]),
      'Sound:300': snapshot([required, { ...required, name: 'Missing', url: 'https://gamebanana.com/mods/400' }]) };
    expect(select(merged, [merged, { ...base, enabled: false }], sources, {})).toMatchObject({ source: { section: 'Sound', id: 300 }, label: 'missing', warning: true });
  });

  it('does not show a badge for unavailable, empty or optional-only requirements', () => {
    const select = createRequirementWarningCache();
    for (const requirements of [{ status: 'unavailable', checkedAt: 1 } as const, snapshot([]), snapshot([{ ...required, importance: 'optional' }])]) {
      expect(select(overlay, [overlay], { 'Mod:100': requirements }, {})).toBeNull();
    }
  });
});
