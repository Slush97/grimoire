import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkQuickInstallRequirements, requestRequirementToggle, useRequirementsStore } from './requirementsStore';
import type { ModRequirementSource } from '../types/gamebanana';
import type { Mod } from '../types/mod';

const required = { name: 'Base', url: 'https://gamebanana.com/mods/704252', state: 'on' as const, importance: 'required' as const };
const source: ModRequirementSource = { id: 711434, section: 'Mod', name: 'Recolor', requirements: {
  status: 'loaded', checkedAt: 100, items: [required],
} };
const mod = (id: string, extra: Partial<Mod> = {}): Mod => ({
  id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: `/game/citadel/addons/${id}.vpk`,
  priority: 1, enabled: true, installedAt: '', size: 100, sha256: id, ...extra,
});
const owner = mod('owner', { gameBananaId: source.id, enabled: false });
const base = mod('base', { gameBananaId: 704252 });
beforeEach(() => {
  useRequirementsStore.getState().finish(false);
  useRequirementsStore.getState().finishToggle();
  useRequirementsStore.setState({ snapshots: {} });
});
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
    expect(useRequirementsStore.getState().review?.source).toMatchObject({ id: source.id });
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

describe('requirements toggle review', () => {
  it.each(['missing', 'disabled', 'enabled'] as const)('asks before enabling a mod with a %s required dependency', async state => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const mods = state === 'missing' ? [owner] : [owner, { ...base, enabled: state === 'enabled' }];
    const finished = vi.fn();
    const pending = requestRequirementToggle(owner, true, mods).then(finished);
    await Promise.resolve();
    expect(finished).not.toHaveBeenCalled();
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mod: owner, mode: 'enable', mods });
    useRequirementsStore.getState().finishToggle('only');
    await pending;
    expect(finished).toHaveBeenCalledExactlyOnceWith('only');
  });

  it.each(['optional', 'recommended', 'unknown'] as const)('does not prompt for %s requirements alone', async importance => {
    useRequirementsStore.getState().remember(source, {
      ...source.requirements, status: 'loaded', items: [{ ...required, importance }],
    });
    await expect(requestRequirementToggle(owner, true, [owner])).resolves.toBe('skip');
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('does not ask to enable requirements whose declared state is off', async () => {
    useRequirementsStore.getState().remember(source, {
      ...source.requirements, status: 'loaded', items: [{ ...required, state: 'off' }],
    });
    await expect(requestRequirementToggle(owner, true, [owner, base])).resolves.toBe('skip');
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('treats an unknown requirement state as on and includes required local edit sources', async () => {
    useRequirementsStore.getState().remember(source, {
      ...source.requirements, status: 'loaded', items: [{ ...required, state: 'unknown' }],
    });
    const pending = requestRequirementToggle(owner, true, [owner]);
    expect(useRequirementsStore.getState().toggleReview?.mode).toBe('enable');
    useRequirementsStore.getState().finishToggle();
    await expect(pending).resolves.toBe('cancel');
    const local = mod('local', { enabled: false, skinEdit: { hero: 'Violet', sources: ['missing-source'] } });
    const editPending = requestRequirementToggle(local, true, [local]);
    expect(useRequirementsStore.getState().toggleReview?.mod).toBe(local);
    useRequirementsStore.getState().finishToggle('all');
    await expect(editPending).resolves.toBe('all');
  });

  it.each(['all', 'only', 'cancel'] as const)('resolves the original request with the %s choice', async choice => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const pending = requestRequirementToggle(owner, true, [owner]);
    useRequirementsStore.getState().finishToggle(choice);
    await expect(pending).resolves.toBe(choice);
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('cancels by default and clears nested requirement targets on close', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const pending = requestRequirementToggle(owner, true, [owner]);
    useRequirementsStore.getState().openTarget({ id: 704252, section: 'Mod' });
    useRequirementsStore.getState().finishToggle();
    await expect(pending).resolves.toBe('cancel');
    expect(useRequirementsStore.getState().targets).toEqual([]);
  });

  it('asks before disabling the sole enabled fulfiller of an enabled dependent', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const enabledOwner = { ...owner, enabled: true };
    const pending = requestRequirementToggle(base, false, [enabledOwner, base]);
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mod: base, mode: 'disable' });
    useRequirementsStore.getState().finishToggle('all');
    await expect(pending).resolves.toBe('all');
  });

  it.each(['disabled owner', 'enabled alternative', 'optional requirement', 'off requirement'] as const)(
    'does not prompt on disable with %s', async scenario => {
      useRequirementsStore.getState().remember(source, {
        ...source.requirements, status: 'loaded', items: [{ ...required,
          importance: scenario === 'optional requirement' ? 'optional' : 'required',
          state: scenario === 'off requirement' ? 'off' : 'on',
        }],
      });
      const mods = [{ ...owner, enabled: scenario !== 'disabled owner' }, base,
        ...(scenario === 'enabled alternative' ? [{ ...base, id: 'alternative', sha256: 'alternative' }] : [])];
      await expect(requestRequirementToggle(base, false, mods)).resolves.toBe('skip');
      expect(useRequirementsStore.getState().toggleReview).toBeNull();
    },
  );

  it('preserves an active install review and rejects a competing toggle', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const install = checkQuickInstallRequirements(source, []);
    const review = useRequirementsStore.getState().review;
    await expect(requestRequirementToggle(owner, true, [owner])).resolves.toBe('cancel');
    expect(useRequirementsStore.getState().review).toBe(review);
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
    useRequirementsStore.getState().finish(false);
    await expect(install).resolves.toBe(false);
  });

  it('preserves inspection and nested item navigation when a competing toggle arrives', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    useRequirementsStore.getState().inspect(source);
    const review = useRequirementsStore.getState().review;
    await expect(requestRequirementToggle(owner, true, [owner])).resolves.toBe('cancel');
    expect(useRequirementsStore.getState().review).toBe(review);
    useRequirementsStore.getState().finish(false);
    useRequirementsStore.getState().openTarget({ id: 704252, section: 'Mod' });
    await expect(requestRequirementToggle(owner, true, [owner])).resolves.toBe('cancel');
    expect(useRequirementsStore.getState().targets).toEqual([{ id: 704252, section: 'Mod' }]);
  });

  it('keeps the first toggle pending and rejects additional toggles and install reviews', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const first = requestRequirementToggle(owner, true, [owner]);
    const review = useRequirementsStore.getState().toggleReview;
    await expect(requestRequirementToggle(owner, true, [owner])).resolves.toBe('cancel');
    await expect(checkQuickInstallRequirements(source, [])).resolves.toBe(false);
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
    expect(useRequirementsStore.getState().review).toBeNull();
    useRequirementsStore.getState().finishToggle('only');
    await expect(first).resolves.toBe('only');
  });

  it('cancels a pending toggle when explicit management replaces it', async () => {
    useRequirementsStore.getState().remember(source, source.requirements);
    const pending = requestRequirementToggle(owner, true, [owner]);
    useRequirementsStore.getState().manage(base, [owner, base]);
    await expect(pending).resolves.toBe('cancel');
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mod: base, mode: 'manage', mods: [owner, base] });
    await expect(checkQuickInstallRequirements(source, [])).resolves.toBe(false);
    expect(useRequirementsStore.getState().review).toBeNull();
  });

  it('cancels a pending install when explicit management replaces it', async () => {
    const pending = checkQuickInstallRequirements(source, []);
    useRequirementsStore.getState().manage(owner, [owner]);
    await expect(pending).resolves.toBe(false);
    expect(useRequirementsStore.getState().review).toBeNull();
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mod: owner, mode: 'manage' });
  });
});
