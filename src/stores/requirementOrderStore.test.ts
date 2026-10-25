import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import { requirementFileKey, requirementOrderIssues } from '../lib/requirementLoadOrder';
import { useRequirementOrderStore } from './requirementOrderStore';
import { useRequirementsStore } from './requirementsStore';

const api = vi.hoisted(() => ({ getMods: vi.fn(), listUnknownModFiles: vi.fn(), reorderMods: vi.fn(), setState: vi.fn(), invalidateModsReads: vi.fn() }));
vi.mock('../lib/api', () => api);
vi.mock('./appStore', () => ({ invalidateModsReads: api.invalidateModsReads, useAppStore: { setState: api.setState, getState: () => ({ mods }) } }));
const makeMod = (id: string, gameBananaId: number, priority: number): Mod => ({ id, gameBananaId, priority, metaKey: `${id}.vpk`, path: `/addons/${id}.vpk`, fileName: `${id}.vpk`, name: id, enabled: true, size: 100, installedAt: '', sha256: id });
const overlay = makeMod('recolor', 711434, 3);
const base = makeMod('base', 704252, 1);
const middle = makeMod('middle', 3, 2);
const mods = [base, middle, overlay];
const source = { id: 711434, section: 'Mod' };
const snapshot = { status: 'loaded', checkedAt: 1, items: [{ name: 'Base', url: 'https://gamebanana.com/mods/704252', state: 'on', importance: 'required' }] } satisfies Parameters<ReturnType<typeof useRequirementsStore.getState>['remember']>[1];
const files = { [requirementFileKey(overlay)]: ['materials/a.vtex_c'], [requirementFileKey(base)]: ['materials/a.vtex_c', 'models/base.vmdl_c'] };
const issue = requirementOrderIssues(source, snapshot, mods, files)[0];

beforeEach(() => {
  vi.resetAllMocks();
  useRequirementOrderStore.setState({ files: {}, fixing: false });
  useRequirementsStore.setState({ snapshots: {} });
  useRequirementsStore.getState().remember(source, snapshot);
  api.getMods.mockResolvedValue(mods);
  api.listUnknownModFiles.mockImplementation(async (id: string) => ({ paths: files[requirementFileKey(id === 'base' ? base : overlay)] }));
});

describe('requirement order fix', () => {
  it('rechecks the actual files and commits the fresh reordered mod list', async () => {
    const updated = [{ ...overlay, priority: 1 }, { ...base, priority: 2 }, { ...middle, priority: 3 }];
    api.reorderMods.mockResolvedValue(updated);
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('fixed');
    expect(api.listUnknownModFiles).toHaveBeenCalledTimes(2);
    expect(api.reorderMods).toHaveBeenCalledExactlyOnceWith(['recolor', 'base', 'middle']);
    expect(api.setState).toHaveBeenCalledExactlyOnceWith({ mods: updated });
    expect(api.invalidateModsReads).toHaveBeenCalledOnce();
    expect(useRequirementOrderStore.getState().fixing).toBe(false);
  });
  it('does not apply stale IDs after a rename or replacement', async () => {
    api.getMods.mockResolvedValue([{ ...base, sha256: 'different-mod' }, middle, overlay]);
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('changed');
    expect(api.reorderMods).not.toHaveBeenCalled();
  });
  it('does not reorder if the mod stops being a texture overlay or the author requirement changes', async () => {
    api.listUnknownModFiles.mockResolvedValue({ paths: ['models/base.vmdl_c'] });
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('changed');
    expect(api.reorderMods).not.toHaveBeenCalled();
    useRequirementsStore.getState().remember(source, { status: 'loaded', checkedAt: 2, items: [] });
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('changed');
    expect(api.reorderMods).not.toHaveBeenCalled();
  });
  it('does not reorder if the files move while the check is running', async () => {
    api.getMods.mockResolvedValueOnce(mods).mockResolvedValue([{ ...base, path: '/addons/renamed.vpk' }, middle, overlay]);
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('changed');
    expect(api.reorderMods).not.toHaveBeenCalled();
  });
  it('keeps the old mod list on an IPC failure and releases the busy state', async () => {
    api.reorderMods.mockRejectedValue(new Error('Game is running'));
    await expect(useRequirementOrderStore.getState().fix(issue)).rejects.toThrow('Game is running');
    expect(api.setState).not.toHaveBeenCalled();
    expect(api.invalidateModsReads).not.toHaveBeenCalled();
    expect(useRequirementOrderStore.getState().fixing).toBe(false);
  });
  it('blocks a second click before the first request completes', async () => {
    let release: (mods: Mod[]) => void = () => {};
    api.getMods.mockReturnValueOnce(new Promise<Mod[]>(resolve => { release = resolve; }));
    api.reorderMods.mockResolvedValue(mods);
    const first = useRequirementOrderStore.getState().fix(issue);
    await expect(useRequirementOrderStore.getState().fix(issue)).resolves.toBe('changed');
    release(mods);
    await first;
    expect(api.reorderMods).toHaveBeenCalledTimes(1);
  });
  it('reuses unchanged inventory objects after fixing the order', async () => {
    api.reorderMods.mockResolvedValue([{ ...overlay, priority: 1 }, { ...base, priority: 2 }, { ...middle }]);
    await useRequirementOrderStore.getState().fix(issue);
    expect(api.setState.mock.calls[0][0].mods[2]).toBe(middle);
  });
});
