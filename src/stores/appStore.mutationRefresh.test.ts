import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { modRestoreKey } from '../lib/soloRestore';
import { useAppStore } from './appStore';
import { useRequirementsStore } from './requirementsStore';
import { useToastStore } from './toastStore';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../lib/api', () => ({
  getMods: vi.fn(), reorderMods: vi.fn(), swapModPriority: vi.fn(),
  enableMod: vi.fn(), disableMod: vi.fn(), applyModToggleBatch: vi.fn(),
  getGamebananaCategories: vi.fn(async () => []), deleteMod: vi.fn(), editLocalMod: vi.fn(),
}));

function mod(id: string, enabled = true): Mod {
  return { id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/addons/${id}.vpk`,
    sha256: id, enabled, priority: 1, size: 1, installedAt: '' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  useRequirementsStore.getState().finish(false);
  useRequirementsStore.getState().finishToggle();
  useRequirementsStore.setState({ snapshots: {} });
  useToastStore.setState({ toasts: [] });
  useAppStore.setState({
    mods: [], modsLoaded: true, modsLoading: false, modsError: null, modsNotice: null,
    soloRestore: null, shuffleOnLaunch: false, shuffleIncluded: new Set(), shuffleVariants: new Map(),
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe.each([true, false])('mutation results versus older scans (silent=%s)', silent => {
  it.each(['reorder', 'swap', 'toggle', 'requirements', 'solo', 'restore', 'shuffle'] as const)('keeps a completed %s when an older scan returns stale slot occupants', async operation => {
    let first = mod('slot-1');
    let second = mod('slot-2');
    if (operation === 'restore') second = { ...second, enabled: false };
    if (operation === 'shuffle') {
      first = { ...first, globalType: 'hud', gameBananaId: 41, sourceSection: 'Mod' };
      second = { ...second, enabled: false, globalType: 'hud', gameBananaId: 42, sourceSection: 'Mod' };
    }
    const before = [first, second];
    const swapped = [{ ...first, name: second.name, sha256: second.sha256 }, { ...second, name: first.name, sha256: first.sha256 }];
    const disabled = { ...first, id: 'disabled-first', enabled: false };
    const solo = [{ ...first }, { ...second, id: 'disabled-second', enabled: false }];
    const restored = [{ ...first }, { ...second, enabled: true }];
    const shuffled = [{ ...first, enabled: false }, { ...second, enabled: true }];
    const scan = deferred<Mod[]>();
    vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
    useAppStore.setState({ mods: before });
    const loading = useAppStore.getState().loadMods({ silent });
    if (!silent) expect(useAppStore.getState().modsLoading).toBe(true);
    let expected: Mod[];
    if (operation === 'reorder') {
      expected = swapped;
      vi.mocked(api.reorderMods).mockResolvedValueOnce(swapped);
      await useAppStore.getState().reorderMods(['slot-2', 'slot-1']);
    } else if (operation === 'swap') {
      expected = swapped;
      vi.mocked(api.swapModPriority).mockResolvedValueOnce(swapped);
      await useAppStore.getState().swapModPriority('slot-1', 'slot-2');
    } else if (operation === 'toggle') {
      expected = [disabled, second];
      vi.mocked(api.disableMod).mockResolvedValueOnce(disabled);
      expect(await useAppStore.getState().toggleMod('slot-1')).toBe(true);
    } else if (operation === 'requirements') {
      expected = [disabled, second];
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: expected, failures: [] });
      expect(await useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(first), enabled: false }])).toBe(true);
    } else if (operation === 'solo') {
      expected = solo;
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: solo, failures: [] });
      expect(await useAppStore.getState().soloMod([modRestoreKey(first)], 'First')).toMatchObject({ applied: true });
    } else if (operation === 'restore') {
      expected = restored;
      useAppStore.setState({ soloRestore: { keys: before.map(modRestoreKey), label: 'Original' } });
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: restored, failures: [] });
      await useAppStore.getState().restoreSoloMods();
    } else {
      expected = shuffled;
      useAppStore.setState({ shuffleOnLaunch: true, shuffleIncluded: new Set(['bucket:hud:gamebanana:41', 'bucket:hud:gamebanana:42']) });
      vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: shuffled, failures: [] });
      await useAppStore.getState().runLaunchShuffle();
      expect(api.applyModToggleBatch).toHaveBeenCalledWith(['slot-2'], ['slot-1']);
    }
    expect(useAppStore.getState().mods).toEqual(expected);
    scan.resolve(before.map(entry => ({ ...entry })));
    await loading;
    expect(useAppStore.getState().mods).toEqual(expected);
    expect(useAppStore.getState().modsLoading).toBe(false);
    expect(useAppStore.getState().modsError).toBeNull();
  });
});

it('does not resurrect a deleted mod or lose an edit when an earlier scan finishes', async () => {
  const before = [mod('first'), mod('second')];
  useAppStore.setState({ mods: before });
  const scan = deferred<Mod[]>();
  vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
  const loading = useAppStore.getState().loadMods({ silent: true });
  vi.mocked(api.deleteMod).mockResolvedValueOnce({ skipped: [] });
  await useAppStore.getState().deleteMod(before[0]);
  const edited = { ...before[1], name: 'Edited second' };
  vi.mocked(api.editLocalMod).mockResolvedValueOnce(edited);
  await useAppStore.getState().editLocalMod(edited.id, { name: edited.name });
  scan.resolve(before);
  await loading;
  expect(useAppStore.getState().mods).toEqual([edited]);
});

it('ignores an older failed non-silent scan after a successful mutation and clears its spinner', async () => {
  const before = [mod('first'), mod('second')];
  useAppStore.setState({ mods: before });
  const scan = deferred<Mod[]>();
  vi.mocked(api.getMods).mockReturnValueOnce(scan.promise);
  const loading = useAppStore.getState().loadMods({ silent: false });
  const after = [...before].reverse();
  vi.mocked(api.reorderMods).mockResolvedValueOnce(after);
  await useAppStore.getState().reorderMods(['second', 'first']);
  scan.reject(new Error('late scan failure'));
  await loading;
  expect(useAppStore.getState().mods).toEqual(after);
  expect(useAppStore.getState().modsLoading).toBe(false);
  expect(useAppStore.getState().modsError).toBeNull();
});

describe('requirements toggle decisions', () => {
  const setup = (enabled = false) => {
    const owner = { ...mod('owner', enabled), gameBananaId: 1 };
    const base = { ...mod('base', enabled), gameBananaId: 2 };
    useAppStore.setState({ mods: [owner, base] });
    useRequirementsStore.setState({ snapshots: { 'Mod:1': { status: 'loaded', checkedAt: Date.now(), items: [
      { name: 'Base', url: 'https://gamebanana.com/mods/2', importance: 'required', state: 'on' },
    ] } } });
    return { owner, base };
  };

  it('enables the target and its required dependencies in one batch', async () => {
    const { owner, base } = setup();
    const pending = useAppStore.getState().toggleMod(owner.id);
    expect(useRequirementsStore.getState().toggleReview?.mode).toBe('enable');
    expect(api.applyModToggleBatch).not.toHaveBeenCalled();
    const updated = [owner, base].map(mod => ({ ...mod, enabled: true }));
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: updated, failures: [] });
    useRequirementsStore.getState().finishToggle('all');
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenCalledExactlyOnceWith(['owner', 'base'], []);
    expect(useAppStore.getState().mods).toEqual(updated);
  });

  it('enables only the requested target when the user chooses Only this', async () => {
    const { owner, base } = setup();
    const pending = useAppStore.getState().toggleMod(owner.id);
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [{ ...owner, enabled: true }, base], failures: [] });
    useRequirementsStore.getState().finishToggle('only');
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenCalledExactlyOnceWith(['owner'], []);
  });

  it.each(['all', 'only'] as const)('honors required-off companions only when choosing %s', async choice => {
    const { owner, base } = setup();
    const incompatible = { ...mod('incompatible', true), gameBananaId: 3 };
    useAppStore.setState({ mods: [owner, base, incompatible] });
    useRequirementsStore.setState(state => ({ snapshots: {
      ...state.snapshots,
      'Mod:1': { status: 'loaded', checkedAt: Date.now(), items: [
        { name: 'Base', url: 'https://gamebanana.com/mods/2', importance: 'required', state: 'on' },
        { name: 'Incompatible', url: 'https://gamebanana.com/mods/3', importance: 'required', state: 'off' },
      ] },
      // Contradictory off rows must not undo the selected root or dependency.
      'Mod:2': { status: 'loaded', checkedAt: Date.now(), items: [
        { name: 'Owner', url: 'https://gamebanana.com/mods/1', importance: 'required', state: 'off' },
        { name: 'Base', url: 'https://gamebanana.com/mods/2', importance: 'required', state: 'off' },
      ] },
    } }));
    const pending = useAppStore.getState().toggleMod(owner.id);
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [
      { ...owner, enabled: true }, { ...base, enabled: choice === 'all' }, { ...incompatible, enabled: choice !== 'all' },
    ], failures: [] });
    useRequirementsStore.getState().finishToggle(choice);
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenCalledExactlyOnceWith(
      choice === 'all' ? ['owner', 'base'] : ['owner'], choice === 'all' ? ['incompatible'] : [],
    );
  });

  it('makes no mutation when the review is dismissed', async () => {
    const { owner } = setup();
    const pending = useAppStore.getState().toggleMod(owner.id);
    useRequirementsStore.getState().finishToggle();
    await expect(pending).resolves.toBe(false);
    expect(api.applyModToggleBatch).not.toHaveBeenCalled();
    expect(api.enableMod).not.toHaveBeenCalled();
    expect(api.disableMod).not.toHaveBeenCalled();
  });

  it('disables the base and enabled dependents together when requested', async () => {
    const { owner, base } = setup(true);
    const pending = useAppStore.getState().toggleMod(base.id);
    expect(useRequirementsStore.getState().toggleReview?.mode).toBe('disable');
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [owner, base].map(mod => ({ ...mod, enabled: false })), failures: [] });
    useRequirementsStore.getState().finishToggle('all');
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenCalledExactlyOnceWith([], ['owner', 'base']);
  });

  it('keeps the normal single-toggle path for an unrelated mod', async () => {
    const { owner } = setup(true);
    vi.mocked(api.disableMod).mockResolvedValueOnce({ ...owner, enabled: false });
    await expect(useAppStore.getState().toggleMod(owner.id)).resolves.toBe(true);
    expect(api.disableMod).toHaveBeenCalledExactlyOnceWith(owner.id);
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
    expect(api.applyModToggleBatch).not.toHaveBeenCalled();
  });

  it('allows individual checkbox changes while the original review remains open', async () => {
    const { owner, base } = setup();
    const pending = useAppStore.getState().toggleMod(owner.id);
    const enabledBase = { ...base, id: 'renamed-base', enabled: true };
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [owner, enabledBase], failures: [] });
    await expect(useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(base), enabled: true }])).resolves.toBe(true);
    expect(useRequirementsStore.getState().toggleReview).not.toBeNull();
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [{ ...owner, enabled: true }, enabledBase], failures: [] });
    useRequirementsStore.getState().finishToggle('only');
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenNthCalledWith(1, ['base'], []);
    expect(api.applyModToggleBatch).toHaveBeenNthCalledWith(2, ['owner'], []);
  });

  it('retains the original dependent scope after a checkbox already disabled the base', async () => {
    const { owner, base } = setup(true);
    const pending = useAppStore.getState().toggleMod(base.id);
    const disabledBase = { ...base, id: 'disabled-base', enabled: false };
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [owner, disabledBase], failures: [] });
    await useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(base), enabled: false }]);
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [{ ...owner, enabled: false }, disabledBase], failures: [] });
    useRequirementsStore.getState().finishToggle('all');
    await expect(pending).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenNthCalledWith(1, [], ['base']);
    expect(api.applyModToggleBatch).toHaveBeenNthCalledWith(2, [], ['owner']);
  });

  it('resolves explicit state keys after an earlier toggle renames the same file', async () => {
    const before = mod('original');
    useAppStore.setState({ mods: [before] });
    const mutation = deferred<Mod>();
    vi.mocked(api.disableMod).mockReturnValueOnce(mutation.promise);
    const toggling = useAppStore.getState().toggleMod(before.id);
    await vi.waitFor(() => expect(api.disableMod).toHaveBeenCalled());
    const setting = useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(before), enabled: true }]);
    expect(api.applyModToggleBatch).not.toHaveBeenCalled();
    const disabled = { ...before, id: 'renamed-disabled', enabled: false };
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: [{ ...disabled, enabled: true }], failures: [] });
    mutation.resolve(disabled);
    await expect(toggling).resolves.toBe(true);
    await expect(setting).resolves.toBe(true);
    expect(api.applyModToggleBatch).toHaveBeenCalledExactlyOnceWith(['renamed-disabled'], []);
  });

  it('publishes partial results, reports the failure, and returns false', async () => {
    const { owner, base } = setup();
    const updated = [{ ...owner, enabled: true }, base];
    vi.mocked(api.applyModToggleBatch).mockResolvedValueOnce({ mods: updated, failures: ['MOD_SAFETY_REJECTED: base'] });
    await expect(useAppStore.getState().setModEnabledStates([owner, base].map(mod => ({ key: modRestoreKey(mod), enabled: true })))).resolves.toBe(false);
    expect(useAppStore.getState().mods).toEqual(updated);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ tone: 'error', message: 'MOD_SAFETY_REJECTED: base' });
  });

  it('avoids empty batches and reports deleted review targets without changing unrelated mods', async () => {
    const owner = mod('owner');
    useAppStore.setState({ mods: [owner] });
    await expect(useAppStore.getState().setModEnabledStates([{ key: modRestoreKey(owner), enabled: true }])).resolves.toBe(true);
    await expect(useAppStore.getState().setModEnabledStates([{ key: 'sha:deleted', enabled: true }])).resolves.toBe(false);
    expect(api.applyModToggleBatch).not.toHaveBeenCalled();
  });

  it('loads library requirement snapshots before deciding whether a toggle needs review', async () => {
    const owner = { ...mod('owner', false), gameBananaId: 1 };
    useAppStore.setState({ mods: [owner] });
    const getModRequirements = vi.fn(async () => ({ 'Mod:1': { status: 'loaded' as const, checkedAt: Date.now(), items: [
      { name: 'Base', url: 'https://gamebanana.com/mods/2', importance: 'required' as const, state: 'on' as const },
    ] } }));
    vi.stubGlobal('window', { electronAPI: { getModRequirements } });
    const pending = useAppStore.getState().toggleMod(owner.id);
    await vi.waitFor(() => expect(useRequirementsStore.getState().toggleReview?.mode).toBe('enable'));
    expect(getModRequirements).toHaveBeenCalledExactlyOnceWith([{ id: 1, section: 'Mod' }], false);
    useRequirementsStore.getState().finishToggle();
    await expect(pending).resolves.toBe(false);
  });
});
