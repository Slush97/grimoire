import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import type { ModRequirementSnapshot } from '../types/gamebanana';
import { isTextureOverlay, moveRequirementAboveBase, requirementFileKey, requirementOrderCandidates, requirementOrderIssues } from './requirementLoadOrder';

const mod = (id: string, gameBananaId: number, priority: number, metaKey = `${id}.vpk`): Mod => ({
  id, gameBananaId, priority, metaKey, name: id, path: `/addons/${id}.vpk`, fileName: `${id}.vpk`, size: 100, installedAt: '', enabled: true,
});
const source = { id: 711434, section: 'Mod' };
const snapshot: ModRequirementSnapshot = { status: 'loaded', checkedAt: 1, items: [{ name: 'Original', url: 'https://gamebanana.com/mods/704252', importance: 'required', state: 'on' }] };
const texture = 'materials/skin_color.vtex_c';
const material = 'materials/skin.vmat_c';
const model = 'models/skin.vmdl_c';
const base = mod('base', 704252, 1);
const overlay = mod('recolor', source.id, 3);
const files = { [requirementFileKey(base)]: [texture, material, model], [requirementFileKey(overlay)]: [texture, material, 'addoninfo.txt', 'grimoire_meta.json'] };

describe('texture dependency order', () => {
  it('warns only for an enabled texture overlay below its author-listed base', () => {
    const mods = [base, overlay];
    expect(requirementOrderIssues(source, snapshot, mods, files)).toMatchObject([{ overlay: { id: 'recolor' }, base: { id: 'base' }, fixable: true }]);
    expect(requirementOrderIssues(source, snapshot, [{ ...base, priority: 4 }, overlay], files)).toEqual([]);
    expect(requirementOrderIssues(source, snapshot, [{ ...base, enabled: false }, overlay], files)).toEqual([]);
    expect(requirementOrderIssues(source, snapshot, [base, { ...overlay, enabled: false }], files)).toEqual([]);
    expect(requirementOrderIssues(source, undefined, mods, files)).toEqual([]);
    expect(requirementOrderIssues(source, { ...snapshot, items: [{ ...snapshot.items[0], importance: 'optional' }] }, mods, files)).toEqual([]);
    expect(requirementOrderIssues(source, { ...snapshot, items: [{ ...snapshot.items[0], state: 'off' }] }, mods, files)).toEqual([]);
    expect(requirementOrderIssues(source, snapshot, mods, {})).toEqual([]);
  });
  it('does not infer an order rule from unrelated, unreadable, or complete skin files', () => {
    expect(isTextureOverlay([texture], [texture, model])).toBe(true);
    expect(isTextureOverlay(['MATERIALS\\SKIN_COLOR.VTEX_C'], [texture, model])).toBe(true);
    expect(isTextureOverlay([texture, 'README.txt'], [texture, model])).toBe(true);
    expect(isTextureOverlay([texture, 'scripts/settings.txt'], [texture, model])).toBe(false);
    expect(isTextureOverlay([texture, model], [texture, model])).toBe(false);
    expect(isTextureOverlay([texture], ['materials/other.vtex_c', model])).toBe(false);
    expect(isTextureOverlay([], [texture, model])).toBe(false);
    expect(isTextureOverlay([material], [material, model])).toBe(false);
    expect(isTextureOverlay([texture], [texture])).toBe(false);
  });
  it('uses actual SearchPaths precedence and refuses to move above a Global base', () => {
    const globalBase = { ...base, metaKey: 'grimoire/base.vpk', priorityMod: true };
    expect(requirementOrderIssues(source, snapshot, [globalBase, overlay], files)[0]?.fixable).toBe(false);
    expect(moveRequirementAboveBase([globalBase, overlay], overlay.id, globalBase.id)).toBeNull();
    expect(requirementOrderIssues(source, snapshot, [{ ...base, metaKey: 'addons1/base.vpk' }, overlay], files)).toEqual([]);
  });
  it('does not treat a dependency inside the same merged VPK as a separate order problem', () => {
    const merged = { ...overlay, merged: { id: 'merge', shareCode: '', createdAt: '', sources: [{ fileName: 'base.vpk', modName: 'Base', gameBananaId: 704252, enabledAtMergeTime: true, priorityAtMergeTime: 1 }] } } satisfies Mod;
    expect(requirementOrderIssues(source, snapshot, [base, merged], files)).toEqual([]);
  });
  it('only reads files for enabled required pairs', () => {
    expect(requirementOrderCandidates([base, overlay, mod('other', 2, 2)], { 'Mod:711434': snapshot }).map(mod => mod.id)).toEqual(['recolor', 'base']);
    expect(requirementOrderCandidates([{ ...base, enabled: false }, overlay], { 'Mod:711434': snapshot })).toEqual([]);
  });
});

describe('move overlay above base', () => {
  it('moves only the overlay and preserves other mods relative to each other', () => {
    const mods = [mod('first', 1, 1), { ...base, priority: 2 }, mod('middle', 2, 3), { ...overlay, priority: 5 }, mod('last', 3, 6), { ...mod('off', 4, 4), enabled: false }];
    expect(moveRequirementAboveBase(mods, overlay.id, base.id)).toEqual(['first', 'recolor', 'base', 'middle', 'last']);
    expect(moveRequirementAboveBase(mods, 'off', base.id)).toBeNull();
    expect(moveRequirementAboveBase(mods, overlay.id, 'missing')).toBeNull();
    expect(moveRequirementAboveBase(mods, base.id, base.id)).toBeNull();
  });
});
