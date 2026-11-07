// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirementsPanel } from './RequirementsPanel';
import { RequirementToggleDialog } from './RequirementsHost';
import { useAppStore } from '../../stores/appStore';
import { requestRequirementToggle, useRequirementsStore, type RequirementToggleReview } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementFileKey } from '../../lib/requirementLoadOrder';
import type { RequirementSource } from '../../lib/modRequirements';
import { downloadMod, getModDetails } from '../../lib/api';
import type { Mod } from '../../types/mod';
import type { ModRequirement } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';
import { modRestoreKey } from '../../lib/soloRestore';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../../lib/api', () => ({ downloadMod: vi.fn(), getModDetails: vi.fn() }));
vi.mock('../ModDetailsModal', () => ({ default: () => null }));

const mod = (id: number, enabled: boolean, priority = id): Mod => ({
  id: `mod-${id}`, gameBananaId: id, name: `Mod ${id}`, enabled, priority, metaKey: `${id}.vpk`,
  fileName: `${id}.vpk`, path: `/addons/${id}.vpk`, size: 100, installedAt: '2026-10-26T00:00:00Z',
});
const requirement = (id: number, state: ModRequirement['state'] = 'on'): ModRequirement => ({
  name: `Required ${id}`, url: `https://gamebanana.com/mods/${id}`, importance: 'required', state,
});
const source = (items: ModRequirement[]): RequirementSource => ({
  id: 10, section: 'Mod', name: 'Owner', requirements: { status: 'loaded', checkedAt: 1, items },
});

describe('compact requirements panel', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousApi: typeof window.electronAPI;
  const getCachedMod = vi.fn();
  const getModRequirements = vi.fn();
  const locate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('fetch', vi.fn());
    useAppStore.setState({ mods: [] });
    useRequirementsStore.setState({ snapshots: {}, targets: [], review: null, toggleReview: null });
    useRequirementOrderStore.setState({ files: {}, fixing: false });
    previousApi = window.electronAPI;
    getCachedMod.mockResolvedValue(null);
    window.electronAPI = { getCachedMod, getModRequirements } as unknown as typeof window.electronAPI;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    window.electronAPI = previousApi;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const button = (element: Element, label: string) => [...element.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.textContent === label)!;

  it('shares one titled card while preserving actions and limiting navigation to the image and name', async () => {
    const disabled = mod(100, false);
    useAppStore.setState({ mods: [disabled, mod(200, true), mod(400, true)] });
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    getCachedMod.mockImplementation(async (id: number) => id === 100 ? {
      id, name: 'Cached base mod', section: 'Mod', thumbnailUrl: 'https://example.invalid/base.png', isNsfw: false,
    } as CachedMod : null);
    const external = { name: 'Optional tool', url: 'https://example.com/tool', importance: 'optional', state: 'on' } as const;
    await act(async () => root.render(<RequirementsPanel source={source([
      requirement(100), requirement(200, 'off'), requirement(300), requirement(400), external,
    ])} onLocate={locate} />));
    const panel = host.querySelector('[aria-label="requirements.title"]')!;
    const rows = [...panel.querySelectorAll<HTMLElement>(':scope > div > ul > li')];
    expect(rows).toHaveLength(5);
    expect(panel.querySelector(':scope > h3')?.textContent).toBe('requirements.title');
    expect(panel.querySelectorAll('ul')).toHaveLength(1);
    expect(rows[0].querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/base.png');
    expect(panel.textContent).not.toContain('requirements.state.');
    expect(button(panel, 'requirements.install')).toBeUndefined();
    expect(panel.querySelector('button button')).toBeNull();
    expect(panel.querySelector('.lucide-chevron-right')).toBeNull();
    await act(async () => {
      rows[0].click();
      rows[0].querySelector<HTMLElement>('p')!.click();
      rows[0].querySelector<HTMLElement>(':scope > div > div')!.click();
    });
    expect(useRequirementsStore.getState().targets).toEqual([]);
    const image = rows[0].querySelector<HTMLButtonElement>('[aria-label="requirements.view"]')!;
    await act(async () => image.click());
    expect(useRequirementsStore.getState().targets).toEqual([{ id: 100, section: 'Mod' }]);
    await act(async () => useRequirementsStore.setState({ targets: [] }));
    await act(async () => button(rows[0], 'Cached base mod').click());
    expect(useRequirementsStore.getState().targets).toEqual([{ id: 100, section: 'Mod' }]);
    await act(async () => useRequirementsStore.setState({ targets: [] }));
    await act(async () => button(rows[0], 'Cached base mod').querySelector('svg')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(useRequirementsStore.getState().targets).toEqual([{ id: 100, section: 'Mod' }]);
    await act(async () => useRequirementsStore.setState({ targets: [] }));
    await act(async () => button(rows[0], 'requirements.enable').click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ key: modRestoreKey(disabled), enabled: true }]);
    expect(useRequirementsStore.getState().targets).toEqual([]);
    await act(async () => button(rows[0], 'requirements.locate').click());
    expect(locate).toHaveBeenCalledExactlyOnceWith(disabled.id);
    expect(rows[1].textContent).toContain('requirements.mustBeOff');
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await act(async () => button(rows[4], external.name).click());
    expect(open).toHaveBeenCalledExactlyOnceWith(external.url, '_blank', 'noopener,noreferrer');
    expect(getCachedMod).toHaveBeenCalledTimes(4);
    expect(getModRequirements).not.toHaveBeenCalled();
    expect(getModDetails).not.toHaveBeenCalled();
    expect(downloadMod).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('places Required, Recommended and Optional tags beside the actions and preserves unlabelled notes', async () => {
    await act(async () => root.render(<RequirementsPanel source={source([
      requirement(100), { ...requirement(200), importance: 'recommended' },
      { name: 'Optional tool', importance: 'optional', state: 'on' },
    ])} />));
    const rows = [...host.querySelectorAll(':scope > section > div > ul > li')];
    const required = rows[0].querySelector('.text-state-danger')!;
    const recommended = rows[1].querySelector('.text-state-warning')!;
    expect(required.textContent).toBe('requirements.required');
    expect(recommended.textContent).toBe('requirements.recommended');
    expect(required.parentElement?.classList.contains('ml-auto')).toBe(true);
    expect(recommended.parentElement?.classList.contains('ml-auto')).toBe(true);
    expect(rows[2].querySelector('.text-state-info')?.textContent).toBe('requirements.optional');
    expect(rows[2].querySelector('button')).toBeNull();
    expect(rows[2].querySelector('.lucide-external-link')).toBeNull();
  });

  it('keeps load-order warnings, fixing and locate-order actions in the shared card', async () => {
    const base = mod(100, true, 1);
    const overlay = mod(10, true, 3);
    useAppStore.setState({ mods: [base, overlay] });
    const texture = 'materials/recolor.vtex_c';
    useRequirementOrderStore.setState({ files: {
      [requirementFileKey(base)]: [texture, 'models/hero.vmdl_c'],
      [requirementFileKey(overlay)]: [texture],
    } });
    const fix = vi.spyOn(useRequirementOrderStore.getState(), 'fix').mockResolvedValue('fixed');
    await act(async () => root.render(<RequirementsPanel source={source([requirement(100)])} onLocate={locate} />));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('requirements.orderWarning');
    await act(async () => button(host, 'requirements.fixOrder').click());
    expect(fix).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ base, overlay, fixable: true }));
    const details = host.querySelector('details')!;
    await act(async () => details.querySelector('summary')!.click());
    expect(details.open).toBe(true);
    expect([...details.querySelectorAll('li')].map(item => item.textContent)).toEqual([base.name, overlay.name]);
    await act(async () => button(details, 'requirements.locateOrder').click());
    expect(locate).toHaveBeenCalledExactlyOnceWith(base.id);
    expect(getModRequirements).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['install', 'inspect'] as const)('enables a requirement without replacing the existing %s review', async kind => {
    const disabled = mod(100, false);
    const owner = { id: 10, section: 'Mod' as const, name: 'Owner', requirements: source([requirement(100)]).requirements };
    const review = kind === 'install' ? { kind, source: owner, resolve: vi.fn() } : { kind, source: owner };
    useAppStore.setState({ mods: [disabled] });
    useRequirementsStore.setState({ review });
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    await act(async () => root.render(<RequirementsPanel source={owner} />));
    await act(async () => button(host, 'requirements.enable').click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ key: modRestoreKey(disabled), enabled: true }]);
    expect(useRequirementsStore.getState().review).toBe(review);
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
    if ('resolve' in review) expect(review.resolve).not.toHaveBeenCalled();
  });

  const toggleReview = (mode: RequirementToggleReview['mode'], owner = mod(10, false), base = mod(100, false)): RequirementToggleReview => ({
    mod: owner, key: modRestoreKey(owner), mode, mods: [owner, base],
    snapshots: { 'Mod:10': source([requirement(100), requirement(999)]).requirements }, resolve: vi.fn(),
  });
  const renderToggle = async (review: RequirementToggleReview) => {
    useAppStore.setState({ mods: [...review.mods] });
    useRequirementsStore.setState({ toggleReview: review, snapshots: { ...review.snapshots } });
    await act(async () => root.render(<RequirementToggleDialog review={review} />));
    return document.querySelector<HTMLElement>('[role="dialog"]')!;
  };

  it('shows the enable choices and lists installed and missing required mods with individual checkboxes', async () => {
    const review = toggleReview('enable');
    const dialog = await renderToggle(review);
    const checks = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checks).toHaveLength(2);
    expect(checks[0].disabled).toBe(false);
    expect(checks[0].checked).toBe(false);
    expect(checks[1].disabled).toBe(true);
    expect(dialog.textContent).toContain('requirements.notInstalled');
    expect(dialog.querySelectorAll('li .h-10.w-10')).toHaveLength(2);
    expect(button(dialog, 'requirements.enableAll')).toBeDefined();
    expect(button(dialog, 'requirements.onlyThis')).toBeDefined();
    expect(button(dialog, 'requirements.disable')).toBeDefined();
    await act(async () => button(dialog, 'requirements.onlyThis').click());
    expect(review.resolve).toHaveBeenCalledExactlyOnceWith('only');
  });

  it('toggles installed requirement checkboxes immediately and follows stable identity after ids change', async () => {
    const review = toggleReview('enable');
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockImplementation(async changes => {
      useAppStore.setState(state => ({ mods: state.mods.map(current => {
        const change = changes.find(change => change.key === modRestoreKey(current));
        return change ? { ...current, id: `${current.id}-changed`, enabled: change.enabled } : current;
      }) }));
      return true;
    });
    const dialog = await renderToggle(review);
    const check = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => check.click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ key: modRestoreKey(review.mods[1]), enabled: true }]);
    expect(check.checked).toBe(true);
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
    await act(async () => check.click());
    expect(apply).toHaveBeenLastCalledWith([{ key: modRestoreKey(review.mods[1]), enabled: false }]);
    expect(check.checked).toBe(false);
  });

  it('makes a missing dependency checkbox usable after that mod is installed', async () => {
    const review = toggleReview('enable');
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    const missing = [...dialog.querySelectorAll('li')].find(row => row.textContent?.includes('Required 999'))!;
    expect(missing.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    const installed = mod(999, false);
    await act(async () => useAppStore.setState({ mods: [...review.mods, installed] }));
    const row = [...dialog.querySelectorAll('li')].find(row => row.textContent?.includes(installed.name))!;
    expect(row).toBeDefined();
    expect(row.textContent).not.toContain('requirements.notInstalled');
    const check = row.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(check.disabled).toBe(false);
    await act(async () => check.click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ key: modRestoreKey(installed), enabled: true }]);
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
  });

  it('swaps enable choices for disable choices and lists enabled dependents', async () => {
    const owner = mod(100, true);
    const dependent = mod(10, true);
    const review = toggleReview('disable', owner, dependent);
    const dialog = await renderToggle(review);
    expect(dialog.querySelectorAll('li')).toHaveLength(1);
    expect(dialog.textContent).toContain(dependent.name);
    expect(button(dialog, 'requirements.disableAll')).toBeDefined();
    expect(button(dialog, 'requirements.onlyThis')).toBeDefined();
    expect(button(dialog, 'requirements.enable')).toBeDefined();
    await act(async () => button(dialog, 'requirements.disableAll').click());
    expect(review.resolve).toHaveBeenCalledExactlyOnceWith('all');
  });

  it('keeps management open while enabling and disabling all installed related mods', async () => {
    const review = toggleReview('manage');
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    expect(button(dialog, 'requirements.onlyThis')).toBeUndefined();
    expect(button(dialog, 'requirements.enableAll')).toBeDefined();
    expect(button(dialog, 'requirements.disableAll')).toBeDefined();
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(apply).toHaveBeenLastCalledWith(review.mods.map(current => ({ key: modRestoreKey(current), enabled: true })));
    await act(async () => button(dialog, 'requirements.disableAll').click());
    expect(apply).toHaveBeenLastCalledWith(review.mods.map(current => ({ key: modRestoreKey(current), enabled: false })));
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
  });

  it('manages captured dependents even when the selected base has no requirements of its own', async () => {
    const base = mod(100, true);
    const dependent = mod(10, true);
    const review = toggleReview('manage', base, dependent);
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockImplementation(async changes => {
      useAppStore.setState(state => ({ mods: state.mods.map(current => {
        const change = changes.find(change => change.key === modRestoreKey(current));
        return change ? { ...current, id: `${current.id}-changed`, enabled: change.enabled } : current;
      }) }));
      return true;
    });
    const dialog = await renderToggle(review);
    expect(dialog.querySelectorAll('li')).toHaveLength(1);
    expect(dialog.querySelector('li')?.textContent).toContain(dependent.name);
    expect(dialog.querySelector('li')?.textContent).toContain('requirements.requiredBy');
    const check = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(check.checked).toBe(true);
    await act(async () => check.click());
    expect(apply).toHaveBeenNthCalledWith(1, [{ key: modRestoreKey(dependent), enabled: false }]);
    expect(check.checked).toBe(false);
    expect(dialog.querySelectorAll('li')).toHaveLength(1);
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(apply).toHaveBeenNthCalledWith(2, [
      { key: modRestoreKey(base), enabled: true }, { key: modRestoreKey(dependent), enabled: true },
    ]);
    expect(check.checked).toBe(true);
    await act(async () => button(dialog, 'requirements.disableAll').click());
    expect(apply).toHaveBeenNthCalledWith(3, [
      { key: modRestoreKey(base), enabled: false }, { key: modRestoreKey(dependent), enabled: false },
    ]);
    expect(check.checked).toBe(false);
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
  });

  it.each([false, true])('enables one alternative per requirement, preferring an enabled variant when present (%s)', async enabled => {
    const initial = toggleReview('manage');
    const alternative = { ...mod(100, enabled), id: 'alternative', name: 'Alternative base', gameBananaFileId: 1002 };
    const review = { ...initial, mods: [...initial.mods, alternative] };
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([
      { key: review.key, enabled: true },
      { key: modRestoreKey(enabled ? alternative : initial.mods[1]), enabled: true },
    ]);
  });

  it('keeps direct and transitive must-be-off requirements disabled when enabling the managed group', async () => {
    const initial = toggleReview('manage');
    const directOff = mod(200, true);
    const nestedOff = mod(300, true);
    const review = { ...initial, mods: [...initial.mods, directOff, nestedOff], snapshots: {
      'Mod:10': source([requirement(100), requirement(200, 'off')]).requirements,
      'Mod:100': source([requirement(300, 'off')]).requirements,
    } };
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([
      { key: review.key, enabled: true }, { key: modRestoreKey(review.mods[1]), enabled: true },
      { key: modRestoreKey(directOff), enabled: false }, { key: modRestoreKey(nestedOff), enabled: false },
    ]);
  });

  it('keeps the dialog open with an error if an individual requirement change fails', async () => {
    const review = toggleReview('manage');
    vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(false);
    const dialog = await renderToggle(review);
    await act(async () => dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('requirements.changeFailed');
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
  });

  it.each([
    ['enable', 'requirements.enableTitle', ['requirements.disable', 'requirements.onlyThis', 'requirements.enableAll']],
    ['disable', 'requirements.disableTitle', ['requirements.disableAll', 'requirements.onlyThis', 'requirements.enable']],
    ['manage', 'requirements.manageTitle', ['requirements.disableAll', 'requirements.enableAll', 'common.actions.close']],
  ] as const)('shows the %s dialog title and ordered footer actions', async (mode, title, actions) => {
    const dialog = await renderToggle(toggleReview(mode));
    expect(dialog.querySelector('h2')?.textContent).toBe(title);
    const footer = dialog.querySelector('.modal-panel > div:last-child')!;
    expect([...footer.querySelectorAll('button')].map(element => element.textContent)).toEqual(actions);
  });

  it.each([
    ['enable', 'requirements.enableAll', 'all'], ['disable', 'requirements.onlyThis', 'only'],
  ] as const)('resolves the %s request with its remaining %s choice', async (mode, label, choice) => {
    const review = toggleReview(mode);
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    await act(async () => button(dialog, label).click());
    expect(review.resolve).toHaveBeenCalledExactlyOnceWith(choice);
    expect(apply).not.toHaveBeenCalled();
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it.each(['enable', 'disable'] as const)('applies the opposite state when declining the %s request', async mode => {
    const review = toggleReview(mode);
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    await act(async () => button(dialog, mode === 'enable' ? 'requirements.disable' : 'requirements.enable').click());
    expect(apply).toHaveBeenCalledExactlyOnceWith([{ key: review.key, enabled: mode === 'disable' }]);
    expect(review.resolve).toHaveBeenCalledExactlyOnceWith('cancel');
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('cancels the original pending toggle when the close button is pressed', async () => {
    const owner = mod(10, false);
    const base = mod(100, false);
    useRequirementsStore.setState({ snapshots: { 'Mod:10': source([requirement(100)]).requirements } });
    const pending = requestRequirementToggle(owner, true, [owner, base]);
    const review = useRequirementsStore.getState().toggleReview!;
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockResolvedValue(true);
    const dialog = await renderToggle(review);
    await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="common.actions.close"]')!.click());
    await expect(pending).resolves.toBe('cancel');
    expect(apply).not.toHaveBeenCalled();
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('submits once and prevents checkbox changes and dismissal while applying', async () => {
    let finish!: (success: boolean) => void;
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates').mockReturnValue(pending);
    const review = toggleReview('manage');
    const dialog = await renderToggle(review);
    await act(async () => {
      button(dialog, 'requirements.enableAll').click();
      button(dialog, 'requirements.enableAll').click();
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    expect(button(dialog, 'requirements.disableAll').disabled).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('[aria-label="common.actions.close"]')!.disabled).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(review.resolve).not.toHaveBeenCalled();
    await act(async () => finish(true));
    expect(dialog.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
    expect(button(dialog, 'requirements.disableAll').disabled).toBe(false);
  });

  it('keeps the dialog open and allows retrying a rejected change', async () => {
    const apply = vi.spyOn(useAppStore.getState(), 'setModEnabledStates')
      .mockRejectedValueOnce(new Error('Write failed')).mockResolvedValue(true);
    const review = toggleReview('manage');
    const dialog = await renderToggle(review);
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('requirements.changeFailed');
    expect(review.resolve).not.toHaveBeenCalled();
    expect(useRequirementsStore.getState().toggleReview).toBe(review);
    expect(button(dialog, 'requirements.enableAll').disabled).toBe(false);
    await act(async () => button(dialog, 'requirements.enableAll').click());
    expect(apply).toHaveBeenCalledTimes(2);
    expect(dialog.querySelector('[role="alert"]')).toBeNull();
  });
});
