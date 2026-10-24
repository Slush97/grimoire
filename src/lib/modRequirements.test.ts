import { describe, expect, it } from 'vitest';
import { hasRequirementIssues, matchRequirement, modRequirementRefs, parseRequirements, skinRequirementSource, type RequirementMod } from './modRequirements';
import { installedRequirementOrder } from './requirementLoadOrder';
import type { MergedModInfo, Mod } from '../types/mod';
import type { ModRequirement } from '../types/gamebanana';

const requirement: ModRequirement = { name: 'Original Model Replacement Mod', url: 'https://gamebanana.com/mods/704252', state: 'on', importance: 'required' };
const base = (enabled: boolean): RequirementMod => ({ id: 'base', name: 'Livewire Lunatic Seven', enabled, gameBananaId: 704252, sourceSection: 'Mod' });

it('shows saved skin dependencies through requirements without a catalog request', () => {
  const original = { ...base(true), sha256: 'a'.repeat(64) };
  const source = skinRequirementSource({ id: 'overlay', name: 'Mina custom', skinEdit: {
    hero: 'Mina', sources: [original.sha256, original.sha256],
  } }, [original]);
  expect(source?.requirements.status).toBe('loaded');
  if (source?.requirements.status !== 'loaded') throw new Error('Expected local requirements');
  expect(source.requirements.items).toHaveLength(1);
  const item = source.requirements.items[0];
  expect(item.name).toBe(original.name);
  expect(matchRequirement(item, [original]).state).toBe('enabled');
  expect(matchRequirement(item, [{ ...original, enabled: false }]).state).toBe('disabled');
  // A different file from the same listing is not the exact source of this overlay.
  expect(matchRequirement(item, [{ ...original, sha256: 'b'.repeat(64) }]).state).toBe('missing');
  expect(hasRequirementIssues(source.requirements, [])).toBe(true);
});

describe('GameBanana requirement parsing', () => {
  it('parses the live four-column response without losing the target', () => {
    expect(parseRequirements([['Original Model Replacement Mod', requirement.url, '1', '7']], 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [requirement] });
  });
  it('normalizes the labeled ProfilePage response', () => {
    expect(parseRequirements([['Original Model Replacement Mod', requirement.url, 'On', 'BlueColor', 'Required', 'OrangeColor']], 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [requirement] });
  });
  it('distinguishes empty requirements from an omitted or malformed response', () => {
    for (const raw of [null, []]) expect(parseRequirements(raw, 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [] });
    for (const raw of [undefined, {}, [['model']], [['model', '', 1, 7]]]) expect(parseRequirements(raw, 100)).toEqual({ status: 'unavailable', checkedAt: 100 });
  });
  it('reads the simple [name, url] form as optional notes', () => {
    expect(parseRequirements([['optimize mod screenspace_city', 'https://gamebanana.com/mods/722853'], ['a pc helps', '']], 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [
      { name: 'optimize mod screenspace_city', url: 'https://gamebanana.com/mods/722853', state: 'on', importance: 'optional' },
      { name: 'a pc helps', url: undefined, state: 'on', importance: 'optional' },
    ] });
  });
  it('reads Enabled and Disabled labels as states', () => {
    const [enabled, disabled] = [['Enabled', 'on'], ['Disabled', 'off']].map(([label]) =>
      parseRequirements([['Universal Mod Manager', 'https://gamebanana.com/mods/693642', label, 'BlueColor', 'Required', 'OrangeColor']], 100));
    expect(enabled).toMatchObject({ items: [{ state: 'on', importance: 'required' }] });
    expect(disabled).toMatchObject({ items: [{ state: 'off', importance: 'required' }] });
  });
  it('removes unsafe links and preserves text-only requirements', () => {
    const result = parseRequirements([['Manual step', 'javascript:alert(1)', 'On', '', 'Required', '']]);
    expect(result.status === 'loaded' && result.items[0]).toEqual({ name: 'Manual step', url: undefined, state: 'on', importance: 'required' });
  });
  it('keeps unrecognized enum codes for manual review', () => {
    const result = parseRequirements([['Unknown', '', '999', '999']]);
    expect(result.status === 'loaded' && result.items[0]).toMatchObject({ state: 'unknown', importance: 'unknown' });
  });
  it('keeps optional requirements out of warnings', () => {
    const optional = { ...requirement, importance: 'optional' } satisfies ModRequirement;
    expect(matchRequirement(optional, []).state).toBe('optional');
  });
});

describe('Installed requirement load order', () => {
  const source = { id: 711434, section: 'Mod' };
  const installed = (id: string, gameBananaId: number, priority: number, metaKey = `${id}.vpk`): Mod => ({
    id, gameBananaId, priority, metaKey, name: id, fileName: `${id}.vpk`, path: '', size: 0, installedAt: '', enabled: true,
  });
  it('shows actual folder precedence rather than assuming the dependency loads first', () => {
    const recolor = installed('recolor', source.id, 2);
    const original = installed('base', 704252, 8);
    expect(installedRequirementOrder(source, requirement, [original, recolor]).map(mod => mod.id)).toEqual(['recolor', 'base']);
    expect(installedRequirementOrder(source, requirement, [{ ...original, metaKey: 'grimoire/base.vpk' }, recolor]).map(mod => mod.id)).toEqual(['base', 'recolor']);
    expect(installedRequirementOrder(source, requirement, [{ ...original, metaKey: 'addons1/base.vpk', priority: 1 }, recolor]).map(mod => mod.id)).toEqual(['recolor', 'base']);
  });
  it('shows no pair for a disabled source, a missing dependency, or a single merged VPK', () => {
    const recolor = installed('recolor', source.id, 2);
    const original = installed('base', 704252, 8);
    expect(installedRequirementOrder(source, requirement, [{ ...recolor, enabled: false }, original])).toEqual([]);
    expect(installedRequirementOrder(source, requirement, [recolor])).toEqual([]);
    const merged = { ...recolor, merged: { id: 'merge', createdAt: '', shareCode: '', sources: [{ fileName: 'base.vpk', modName: 'Base', gameBananaId: 704252, section: 'Mod', enabledAtMergeTime: true, priorityAtMergeTime: 8 }] } } satisfies Mod;
    expect(installedRequirementOrder(source, requirement, [merged])).toEqual([]);
    expect(installedRequirementOrder(source, { ...requirement, state: 'off' }, [recolor, original])).toEqual([]);
  });
});

describe('installed requirement state', () => {
  it('distinguishes missing, installed but disabled, and enabled', () => {
    expect(matchRequirement(requirement, []).state).toBe('missing');
    expect(matchRequirement(requirement, [base(false)]).state).toBe('disabled');
    expect(matchRequirement(requirement, [base(false), { ...base(true), id: 'other-file' }]).state).toBe('enabled');
  });
  it('does not confuse equal numeric IDs in different sections', () => {
    expect(matchRequirement(requirement, [{ ...base(true), sourceSection: 'Sound' }]).state).toBe('missing');
  });
  it('counts an enabled merged source and ignores its old enabled flag', () => {
    const merged: MergedModInfo = { id: 'merge', createdAt: '', shareCode: '', sources: [{ fileName: 'base.vpk', modName: 'Base', gameBananaId: 704252, section: 'Mod', enabledAtMergeTime: false, priorityAtMergeTime: 1 }] };
    const mod = { id: 'merged', name: 'Merged', enabled: true, merged } satisfies RequirementMod;
    expect(matchRequirement(requirement, [mod]).state).toBe('enabled');
    expect(matchRequirement(requirement, [{ ...mod, enabled: false }]).state).toBe('disabled');
    expect(modRequirementRefs(mod)).toEqual([{ id: 704252, section: 'Mod' }]);
  });
  it('handles requirements that must be disabled without toggling anything', () => {
    const off = { ...requirement, state: 'off' } satisfies ModRequirement;
    expect(matchRequirement(off, [base(true)]).state).toBe('manual');
    expect(matchRequirement(off, [base(false)]).state).toBe('met');
  });
  it('treats external links, text-only rows and unknown importance as notes', () => {
    expect(matchRequirement({ ...requirement, url: 'https://example.com/manual' }, []).state).toBe('optional');
    expect(matchRequirement({ ...requirement, url: undefined }, []).state).toBe('optional');
    expect(matchRequirement({ ...requirement, importance: 'unknown' }, []).state).toBe('optional');
  });
  it('reads an unknown state as On', () => {
    expect(matchRequirement({ ...requirement, state: 'unknown' }, [base(true)]).state).toBe('enabled');
    expect(matchRequirement({ ...requirement, state: 'unknown' }, []).state).toBe('missing');
  });
  it('does not warn when the requirements could not be read', () => {
    expect(hasRequirementIssues(undefined, [])).toBe(false);
    expect(hasRequirementIssues({ status: 'unavailable', checkedAt: 100 }, [])).toBe(false);
    expect(hasRequirementIssues({ status: 'loaded', checkedAt: 100, items: [] }, [])).toBe(false);
  });
});
