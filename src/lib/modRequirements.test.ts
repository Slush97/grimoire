import { describe, expect, it } from 'vitest';
import { hasInstalledRequirementIssues, hasRequirementIssues, installedModRequirements, matchRequirement, modRequirementRefs, parseRequirements, requiredModClosure, skinRequirementSource, type RequirementMod } from './modRequirements';
import { installedRequirementOrder } from './requirementLoadOrder';
import type { MergedModInfo, Mod } from '../types/mod';
import type { ModRequirement, ModRequirementSnapshot } from '../types/gamebanana';

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
  it('keeps Recommended separate from Required in raw and labeled responses', () => {
    for (const row of [
      ['Base mod', requirement.url, '2', '7'],
      ['Mal0 Billy Supplementary Additions', 'https://gamebanana.com/mods/672307', '2', '1'],
      ['Base mod', requirement.url, 'On', 'BlueColor', 'Recommended', 'GreyColor'],
      ['Mal0 Billy Supplementary Additions', 'https://gamebanana.com/mods/672307', 'Installed', 'BlueColor', 'Recommended', 'GreyColor'],
    ]) {
      const snapshot = parseRequirements([row]);
      expect(snapshot).toMatchObject({ items: [{ importance: 'recommended', state: 'on' }] });
      expect(hasRequirementIssues(snapshot, [])).toBe(false);
    }
  });
  it('distinguishes empty requirements from an omitted or malformed response', () => {
    for (const raw of [null, []]) expect(parseRequirements(raw, 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [] });
    for (const raw of [undefined, {}, [['model']], [['model', '', 1, 7]]]) expect(parseRequirements(raw, 100)).toEqual({ status: 'unavailable', checkedAt: 100 });
  });
  it('defaults unlabelled requirements to Required', () => {
    expect(parseRequirements([['optimize mod screenspace_city', 'https://gamebanana.com/mods/722853'], ['a pc helps', '']], 100)).toEqual({ status: 'loaded', checkedAt: 100, items: [
      { name: 'optimize mod screenspace_city', url: 'https://gamebanana.com/mods/722853', state: 'on', importance: 'required' },
      { name: 'a pc helps', url: undefined, state: 'on', importance: 'required' },
    ] });
  });
  it.each([
    ['(Optional)Doorman Fox mod', 'optional'],
    ['OPTIONAL: Doorman Fox mod (recommended)', 'optional'],
    ['Recommended addon - optional', 'optional'],
    ['(rEcOmMeNdEd) Doorman Fox mod', 'recommended'],
    ['An optionally named mod', 'required'],
    ['An unrecommended mod', 'required'],
  ])('infers %s as %s only when no importance is provided', (name, importance) => {
    expect(parseRequirements([[name, requirement.url]])).toMatchObject({ items: [{ name, importance }] });
  });
  it('preserves explicit labels when names contain conflicting words', () => {
    expect(parseRequirements([
      ['Optional addon', requirement.url, '1', '7'],
      ['Optional addon', requirement.url, 'On', 'BlueColor', 'Recommended', 'GreyColor'],
    ])).toMatchObject({ items: [{ importance: 'required' }, { importance: 'recommended' }] });
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
  it('ignores the requirements of an installed mod that is off', () => {
    const snapshot = { status: 'loaded' as const, checkedAt: 100, items: [requirement] };
    const mods = [{ ...base(false), id: 'base' }] as Mod[];
    expect(hasInstalledRequirementIssues({ enabled: true }, snapshot, mods)).toBe(true);
    expect(hasInstalledRequirementIssues({ enabled: false }, snapshot, mods)).toBe(false);
    expect(hasInstalledRequirementIssues({ enabled: false }, snapshot, [])).toBe(false);
  });
});

describe('installed requirement toggle graph', () => {
  const mod = (id: string, gameBananaId: number, enabled = false): Mod => ({
    id, gameBananaId, enabled, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: '', size: 0, installedAt: '', priority: 1,
  });
  const needs = (id: number, changes: Partial<ModRequirement> = {}): ModRequirement => ({
    name: `Mod ${id}`, url: `https://gamebanana.com/mods/${id}`, importance: 'required', state: 'on', ...changes,
  });
  const snapshot = (...items: ModRequirement[]): ModRequirementSnapshot => ({ status: 'loaded', checkedAt: 1, items });

  it('collects own and merged requirements once, preserving optional and missing rows for management', () => {
    const owner = { ...mod('owner', 1), merged: { id: 'merge', createdAt: '', shareCode: '', sources: [
      { fileName: 'owner.vpk', modName: 'Owner', gameBananaId: 1, section: 'Mod' as const, enabledAtMergeTime: true, priorityAtMergeTime: 1 },
      { fileName: 'other.vpk', modName: 'Other', gameBananaId: 2, section: 'Mod' as const, enabledAtMergeTime: true, priorityAtMergeTime: 2 },
    ] } };
    const installed = mod('base', 3);
    const rows = installedModRequirements(owner, [owner, installed], {
      'Mod:1': snapshot(needs(3), needs(4, { importance: 'optional' })),
      'Mod:2': snapshot(needs(3, { name: 'Same base, different author label' }), needs(5)),
    });
    expect(rows).toHaveLength(3);
    expect(rows.map(row => row.matches.map(match => match.modId))).toEqual([['base'], [], []]);
    expect(rows[1].item.importance).toBe('optional');
  });

  it('matches optional entries for the management UI without changing warning behavior', () => {
    const owner = mod('owner', 1), optional = mod('optional', 2, true);
    const item = needs(2, { importance: 'optional' });
    expect(installedModRequirements(owner, [owner, optional], { 'Mod:1': snapshot(item) })[0].matches).toEqual([
      { modId: optional.id, name: optional.name, enabled: true },
    ]);
    expect(matchRequirement(item, [optional]).matches).toEqual([]);
  });

  it('follows transitive required dependencies once and terminates cycles', () => {
    const mods = [mod('a', 1), mod('b', 2), mod('c', 3)];
    expect(requiredModClosure('a', mods, {
      'Mod:1': snapshot(needs(2)), 'Mod:2': snapshot(needs(3)), 'Mod:3': snapshot(needs(1)),
    }, 'dependencies')).toEqual(['b', 'c']);
  });

  it('ignores optional, recommended, off-state and missing entries when enabling all', () => {
    const mods = [mod('owner', 1), mod('optional', 2), mod('recommended', 3), mod('off', 4)];
    expect(requiredModClosure('owner', mods, { 'Mod:1': snapshot(
      needs(2, { importance: 'optional' }), needs(3, { importance: 'recommended' }), needs(4, { state: 'off' }), needs(5),
    ) }, 'dependencies')).toEqual([]);
  });

  it('uses an enabled alternative or just one installed disabled alternative', () => {
    const owner = mod('owner', 1), a = mod('a', 2), b = mod('b', 2, true);
    const snapshots = { 'Mod:1': snapshot(needs(2)) };
    expect(requiredModClosure('owner', [owner, a, b], snapshots, 'dependencies')).toEqual(['b']);
    expect(requiredModClosure('owner', [owner, a, { ...b, enabled: false }], snapshots, 'dependencies')).toEqual(['a']);
  });

  it('does not enable another file when a merged owner contains its own required source', () => {
    const owner = { ...mod('owner', 1), merged: { id: 'merge', createdAt: '', shareCode: '', sources: [
      { fileName: 'base.vpk', modName: 'Base', gameBananaId: 2, section: 'Mod' as const, enabledAtMergeTime: true, priorityAtMergeTime: 2 },
    ] } };
    expect(requiredModClosure('owner', [owner, mod('base', 2)], { 'Mod:1': snapshot(needs(2)) }, 'dependencies')).toEqual([]);
  });

  it('matches SHA skin bases exactly and keeps sections separate', () => {
    const a = mod('base', 2, true), b = { ...mod('sound', 2), sourceSection: 'Sound' as const };
    const base = { ...a, sha256: 'a'.repeat(64) }, alternate = { ...a, id: 'alternate', sha256: 'b'.repeat(64) };
    const owner = { ...mod('skin', 1), skinEdit: { hero: 'Mina', sources: [base.sha256, base.sha256] } };
    expect(requiredModClosure('skin', [owner, base, alternate], {}, 'dependencies')).toEqual(['base']);
    expect(requiredModClosure('skin', [owner, alternate], {}, 'dependencies')).toEqual([]);
    expect(requiredModClosure('skin', [owner, b], { 'Mod:1': snapshot(needs(2)) }, 'dependencies')).toEqual([]);
  });

  it('disables transitive enabled dependents while retaining disabled and optional owners', () => {
    const mods = [mod('base', 1, true), mod('middle', 2, true), mod('leaf', 3, true), mod('disabled', 4), mod('optional', 5, true)];
    expect(requiredModClosure('base', mods, {
      'Mod:2': snapshot(needs(1)), 'Mod:3': snapshot(needs(2)), 'Mod:4': snapshot(needs(1)),
      'Mod:5': snapshot(needs(1, { importance: 'optional' })),
    }, 'dependents')).toEqual(['middle', 'leaf']);
  });

  it('preserves an owner while another enabled alternative still satisfies it', () => {
    const mods = [mod('base', 1, true), mod('alternate', 1, true), mod('owner', 2, true)];
    const snapshots = { 'Mod:2': snapshot(needs(1)) };
    expect(requiredModClosure('base', mods, snapshots, 'dependents')).toEqual([]);
    expect(requiredModClosure('base', [mods[0], { ...mods[1], enabled: false }, mods[2]], snapshots, 'dependents')).toEqual(['owner']);
  });

  it('does not disable already broken owners or confuse an unrelated section', () => {
    const mods = [mod('base', 1), mod('owner', 2, true), { ...mod('sound', 1, true), sourceSection: 'Sound' as const }];
    expect(requiredModClosure('base', mods, { 'Mod:2': snapshot(needs(1)) }, 'dependents')).toEqual([]);
    expect(requiredModClosure('sound', mods, { 'Mod:2': snapshot(needs(1)) }, 'dependents')).toEqual([]);
  });

  it('terminates reverse cycles and follows merged identities', () => {
    const owner = { ...mod('merged', 1, true), merged: { id: 'merge', createdAt: '', shareCode: '', sources: [
      { fileName: 'base.vpk', modName: 'Base', gameBananaId: 3, section: 'Mod' as const, enabledAtMergeTime: false, priorityAtMergeTime: 2 },
    ] } };
    expect(requiredModClosure('merged', [owner, mod('other', 2, true)], {
      'Mod:1': snapshot(needs(2)), 'Mod:2': snapshot(needs(3)),
    }, 'dependents')).toEqual(['other']);
  });
});
