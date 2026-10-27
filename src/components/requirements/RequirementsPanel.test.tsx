// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirementsPanel } from './RequirementsPanel';
import { useAppStore } from '../../stores/appStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { requirementFileKey } from '../../lib/requirementLoadOrder';
import type { RequirementSource } from '../../lib/modRequirements';
import { downloadMod, getModDetails } from '../../lib/api';
import type { Mod } from '../../types/mod';
import type { ModRequirement } from '../../types/gamebanana';
import type { CachedMod } from '../../types/electron';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../../lib/api', () => ({ downloadMod: vi.fn(), getModDetails: vi.fn() }));

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
    useRequirementsStore.setState({ snapshots: {}, targets: [], review: null });
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
    const toggle = vi.spyOn(useAppStore.getState(), 'toggleMod').mockResolvedValue(true);
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
    expect(toggle).toHaveBeenCalledExactlyOnceWith(disabled.id);
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
});
