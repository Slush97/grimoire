import { describe, it, expect } from 'vitest';
import {
  planLocalVariantGroup,
  resolveLocalVariantGroupProfile,
  type LocalVariantGroupMember,
} from './localVariantGroup';

/** Minimal member; metaKey defaults to `<id>.vpk` like the real scan. */
function member(over: Partial<LocalVariantGroupMember> & { id: string }): LocalVariantGroupMember {
  return {
    metaKey: `${over.id}.vpk`,
    name: over.id,
    ...over,
  };
}

/** Deterministic stand-in for randomUUID. */
const mint = () => 'minted-uuid';

describe('planLocalVariantGroup', () => {
  it('mints a group and unifies the name on the first mod', () => {
    const all = [member({ id: 'a', name: 'Red Geist' }), member({ id: 'b', name: 'Blue Geist' })];
    const plan = planLocalVariantGroup(all, ['a', 'b'], { mode: 'mint' }, mint);
    expect(plan.groupId).toBe('minted-uuid');
    expect(plan.writes).toEqual([
      { id: 'a', metaKey: 'a.vpk', localGroupId: 'minted-uuid', modName: undefined },
      { id: 'b', metaKey: 'b.vpk', localGroupId: 'minted-uuid', modName: 'Red Geist' },
    ]);
  });

  it('takes the name from an existing member when joining a group', () => {
    const all = [
      member({ id: 'a', name: 'Red Geist', localGroupId: 'g1' }),
      member({ id: 'b', name: 'Red Geist', localGroupId: 'g1' }),
      member({ id: 'c', name: 'some_archive_file' }),
    ];
    const plan = planLocalVariantGroup(all, ['c'], { mode: 'join', groupId: 'g1' }, mint);
    expect(plan.groupId).toBe('g1');
    expect(plan.writes).toEqual([
      { id: 'c', metaKey: 'c.vpk', localGroupId: 'g1', modName: 'Red Geist' },
    ]);
  });

  it('rejects a GameBanana mod', () => {
    const all = [member({ id: 'a' }), member({ id: 'gb', name: 'Store Skin', gameBananaId: 42 })];
    expect(() => planLocalVariantGroup(all, ['a', 'gb'], { mode: 'mint' }, mint)).toThrow(
      /Only local mods/
    );
  });

  it('keeps an adopted GameBanana identity editable inside an explicit local group', () => {
    const all = [
      member({ id: 'a', localGroupId: 'local', gameBananaId: 42 }),
      member({ id: 'b', localGroupId: 'local' }),
    ];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'clear' }, mint);
    expect(plan.writes).toEqual([
      { id: 'a', metaKey: 'a.vpk', localGroupId: undefined, modName: undefined },
      { id: 'b', metaKey: 'b.vpk', localGroupId: undefined },
    ]);
  });

  it('rejects merged outputs even when invoked outside the renderer', () => {
    const all = [member({ id: 'merge', merged: true }), member({ id: 'local' })];
    expect(() => planLocalVariantGroup(all, ['merge', 'local'], { mode: 'mint' }, mint))
      .toThrow(/Merged outputs cannot be grouped/);
  });

  it('ignores a non-positive GameBanana id', () => {
    const all = [member({ id: 'a', gameBananaId: 0 }), member({ id: 'b' })];
    expect(() => planLocalVariantGroup(all, ['a', 'b'], { mode: 'mint' }, mint)).not.toThrow();
  });

  it('rejects an unknown mod id', () => {
    expect(() => planLocalVariantGroup([member({ id: 'a' })], ['ghost'], { mode: 'mint' }, mint))
      .toThrow(/Mod not found: ghost/);
  });

  it('rejects an empty selection', () => {
    expect(() => planLocalVariantGroup([member({ id: 'a' })], [], { mode: 'mint' }, mint)).toThrow();
  });

  it('rejects a blank group id on join', () => {
    const all = [member({ id: 'a' })];
    expect(() => planLocalVariantGroup(all, ['a'], { mode: 'join', groupId: '  ' }, mint)).toThrow(
      /variant group is required/
    );
  });

  it('clears membership and leaves the names alone', () => {
    const all = [
      member({ id: 'a', name: 'Pack', localGroupId: 'g1' }),
      member({ id: 'b', name: 'Pack', localGroupId: 'g1' }),
      member({ id: 'c', name: 'Pack', localGroupId: 'g1' }),
    ];
    const plan = planLocalVariantGroup(all, ['a', 'b', 'c'], { mode: 'clear' }, mint);
    expect(plan.groupId).toBeNull();
    expect(plan.writes).toEqual([
      { id: 'a', metaKey: 'a.vpk', localGroupId: undefined, modName: undefined },
      { id: 'b', metaKey: 'b.vpk', localGroupId: undefined, modName: undefined },
      { id: 'c', metaKey: 'c.vpk', localGroupId: undefined, modName: undefined },
    ]);
  });

  it('dissolves the group when detaching would leave one member behind', () => {
    const all = [
      member({ id: 'a', name: 'Pack', localGroupId: 'g1' }),
      member({ id: 'b', name: 'Pack', localGroupId: 'g1' }),
    ];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'clear' }, mint);
    expect(plan.writes).toEqual([
      { id: 'a', metaKey: 'a.vpk', localGroupId: undefined, modName: undefined },
      { id: 'b', metaKey: 'b.vpk', localGroupId: undefined },
    ]);
  });

  it('keeps a group that still has two members after a detach', () => {
    const all = [
      member({ id: 'a', localGroupId: 'g1' }),
      member({ id: 'b', localGroupId: 'g1' }),
      member({ id: 'c', localGroupId: 'g1' }),
    ];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'clear' }, mint);
    expect(plan.writes.map((w) => w.id)).toEqual(['a']);
  });

  it('dissolves the group a moved member left behind', () => {
    const all = [
      member({ id: 'a', name: 'Old', localGroupId: 'g1' }),
      member({ id: 'b', name: 'Old', localGroupId: 'g1' }),
      member({ id: 'c', name: 'New', localGroupId: 'g2' }),
      member({ id: 'd', name: 'New', localGroupId: 'g2' }),
    ];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'join', groupId: 'g2' }, mint);
    expect(plan.writes).toEqual([
      { id: 'a', metaKey: 'a.vpk', localGroupId: 'g2', modName: 'New' },
      { id: 'b', metaKey: 'b.vpk', localGroupId: undefined },
    ]);
  });

  it('is a no-op for a mod already in the group under the group name', () => {
    const all = [
      member({ id: 'a', name: 'Pack', localGroupId: 'g1' }),
      member({ id: 'b', name: 'Pack', localGroupId: 'g1' }),
    ];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'join', groupId: 'g1' }, mint);
    expect(plan.writes).toEqual([]);
  });

  it('deduplicates repeated ids', () => {
    const all = [member({ id: 'a' }), member({ id: 'b' })];
    const plan = planLocalVariantGroup(all, ['a', 'a', 'b'], { mode: 'mint' }, mint);
    expect(plan.writes.map((w) => w.id)).toEqual(['a', 'b']);
  });

  it('treats an empty-string group id as no membership', () => {
    const all = [member({ id: 'a', localGroupId: '' }), member({ id: 'b' })];
    const plan = planLocalVariantGroup(all, ['a'], { mode: 'clear' }, mint);
    expect(plan.writes).toEqual([]);
  });

  it('groups mixed CompLock components without rewriting any per-file classification', () => {
    const all = [
      member({ id: 'map', name: 'CompLock', globalType: 'maps', globalTypeSource: 'manual' }),
      member({ id: 'particles', lockerHero: 'Ivy', lockerHeroSource: 'manual', resolvedHeroes: ['Ivy'] }),
      member({ id: 'outlines', globalType: 'hud', resolvedHeroes: [], resolvedGlobalType: 'hud' }),
      member({ id: 'sound', resolvedHeroes: ['Haze', 'Wraith'] }),
      member({ id: 'unknown', globalType: null, globalTypeSource: 'manual' }),
    ];
    const before = structuredClone(all);
    const plan = planLocalVariantGroup(all, all.map(file => file.id), { mode: 'mint' }, mint);
    expect(plan.writes).toEqual(all.map(file => ({
      id: file.id, metaKey: file.metaKey, localGroupId: 'minted-uuid',
      modName: file.name === 'CompLock' ? undefined : 'CompLock',
    })));
    expect(all).toEqual(before);
    expect(resolveLocalVariantGroupProfile(all)).toEqual({ priorityMod: false });
  });

  it('adds a differently classified file to an already mixed group without changing existing members', () => {
    const all = [
      member({ id: 'a', name: 'CompLock', localGroupId: 'g', lockerHero: 'Ivy', lockerHeroSource: 'manual' }),
      member({ id: 'b', name: 'CompLock', localGroupId: 'g', globalType: 'hud', globalTypeSource: 'manual' }),
      member({ id: 'lowdetailmap', globalType: 'maps', resolvedHeroes: [] }),
    ];
    expect(planLocalVariantGroup(all, ['lowdetailmap'], { mode: 'join', groupId: 'g' }, mint).writes)
      .toEqual([{ id: 'lowdetailmap', metaKey: 'lowdetailmap.vpk', localGroupId: 'g', modName: 'CompLock' }]);
  });

  it('does not give an unclassified incoming file a peer’s manual assignment', () => {
    const all = [
      member({ id: 'a', name: 'Pack', localGroupId: 'g', lockerHero: 'Ivy', lockerHeroSource: 'manual' }),
      member({ id: 'b' }),
    ];
    expect(planLocalVariantGroup(all, ['b'], { mode: 'join', groupId: 'g' }, mint).writes)
      .toEqual([{ id: 'b', metaKey: 'b.vpk', localGroupId: 'g', modName: 'Pack' }]);
  });

  it('rejects mixed priority-root placement without moving files', () => {
    const all = [member({ id: 'a', priorityMod: true }), member({ id: 'b' })];
    expect(() => planLocalVariantGroup(all, ['a', 'b'], { mode: 'mint' }, mint))
      .toThrow(/same Global priority-folder setting/);
  });
});
