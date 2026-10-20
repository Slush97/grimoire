import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkQuickInstallRequirements, useRequirementsStore } from './requirementsStore';
import type { ModRequirementSource } from '../types/gamebanana';

const source: ModRequirementSource = { id: 711434, section: 'Mod', name: 'Recolor', requirements: {
  status: 'loaded', checkedAt: 100, items: [{ name: 'Base', url: 'https://gamebanana.com/mods/704252', state: 'on', importance: 'required' }],
} };
beforeEach(() => { useRequirementsStore.getState().finish(false); useRequirementsStore.setState({ snapshots: {} }); });
describe('requirements install review', () => {
  it('does not let an older cached response overwrite newer requirement data', () => {
    const store = useRequirementsStore.getState();
    store.remember(source, { status: 'loaded', checkedAt: 200, items: [] });
    store.remember(source, source.requirements);
    expect(useRequirementsStore.getState().snapshots['Mod:711434']).toMatchObject({ checkedAt: 200, items: [] });
  });
  it('holds the install until the user continues or cancels', async () => {
    const finished = vi.fn();
    const pending = checkQuickInstallRequirements(source, []).then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    useRequirementsStore.getState().openTarget({ id: 704252, section: 'Mod' });
    useRequirementsStore.getState().back();
    expect(useRequirementsStore.getState().review?.source).toEqual(source);
    useRequirementsStore.getState().finish(true);
    await pending;
    expect(finished).toHaveBeenCalledWith(true);
  });
  it('cancels a pending install when closing the check', async () => {
    const pending = checkQuickInstallRequirements(source, []);
    useRequirementsStore.getState().finish(false);
    await expect(pending).resolves.toBe(false);
  });
  it('does not replace an active check when another install arrives', async () => {
    const first = checkQuickInstallRequirements(source, []);
    await expect(checkQuickInstallRequirements({ ...source, id: 2 }, [])).resolves.toBe(false);
    expect(useRequirementsStore.getState().review?.source.id).toBe(source.id);
    useRequirementsStore.getState().finish(false);
    await first;
  });
  it('passes through mods with no listed requirements', async () => {
    await expect(checkQuickInstallRequirements({ ...source, requirements: { status: 'loaded', checkedAt: 1, items: [] } }, [])).resolves.toBe(true);
    expect(useRequirementsStore.getState().review).toBeNull();
  });
  it('does not create an endless target stack on a dependency cycle', () => {
    const state = useRequirementsStore.getState();
    state.openTarget({ id: 1, section: 'Mod' }); state.openTarget({ id: 2, section: 'Mod' }); state.openTarget({ id: 1, section: 'Mod' });
    expect(useRequirementsStore.getState().targets).toEqual([{ id: 1, section: 'Mod' }]);
  });
});
