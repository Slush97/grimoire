// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModCard } from './ModCard';
import { HERO_NAMES_SORTED } from '../../lib/lockerUtils';
import { useCategoryStore } from '../../stores/categoryStore';
import { buildCategoryPaths } from '../../lib/categoryPaths';
import type { AppSettings, Mod } from '../../types/mod';
import * as imageActions from '../../lib/imageActions';
import { useAppStore } from '../../stores/appStore';
import { useInstalledTagsStore } from '../../stores/installedTagsStore';
import { getInstallationScope } from '../../lib/appSettings';
import { useRequirementsStore } from '../../stores/requirementsStore';

const translate = vi.hoisted(() => vi.fn((key: string) => key));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('installed card menu mounting', () => {
  let host: HTMLDivElement;
  let root: Root;
  let input: ComponentProps<typeof ModCard>;
  let previousSettings: AppSettings | null;
  let previousMods: Mod[];

  beforeEach(() => {
    vi.clearAllMocks();
    previousSettings = useAppStore.getState().settings;
    previousMods = useAppStore.getState().mods;
    useAppStore.setState({ mods: [] });
    useRequirementsStore.getState().finishToggle();
    useRequirementsStore.setState({ snapshots: {} });
    useCategoryStore.setState({ heroByCategoryId: new Map(), heroNames: [], pathsByModel: {} });
    useInstalledTagsStore.setState({ byScope: {} });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    input = {
      mod: {
        id: 'test', name: 'Test mod', fileName: 'pak01_dir.vpk', enabled: true,
        priority: 1, size: 100, installedAt: '2026-10-10T10:00:00Z',
      },
      viewMode: 'list', hideNsfwPreviews: true, soundVolume: 0, conflicts: [], entryKey: 'test',
      onToggle: vi.fn(), onDelete: vi.fn(), onTagLocker: vi.fn(), onTagGlobal: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    useAppStore.setState({ settings: previousSettings, mods: previousMods });
    useRequirementsStore.getState().finishToggle();
    host.remove();
    vi.restoreAllMocks();
  });

  async function openMenu(kind: 'context' | 'dropdown') {
    if (kind === 'context') {
      await act(async () => host.querySelector('[data-mod-entry-key="test"]')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
      ));
    } else {
      const trigger = host.querySelector<HTMLButtonElement>('[aria-label="installed.card.moreActionsFor"]')!;
      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    }
  }

  async function openLockerTags() {
    const trigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .find((item) => item.textContent?.includes('installed.tag.setLockerTag'))!;
    expect(trigger).toBeDefined();
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
  }

  it.each(['context', 'dropdown'] as const)('constructs %s actions and hero choices only when their menu opens', async (kind) => {
    // Spying on roster iteration detects JSX allocation even if React never
    // mounts the resulting nodes under a closed Radix portal.
    const rosterIteration = vi.spyOn(HERO_NAMES_SORTED, 'map');
    await act(async () => root.render(<ModCard {...input} />));
    expect(rosterIteration).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalledWith('installed.tag.setLockerTag');

    // Closed menus must pick up current callbacks and tag state when opened.
    input = { ...input, mod: { ...input.mod, lockerHero: HERO_NAMES_SORTED[0] }, onTagLocker: vi.fn() };
    await act(async () => root.render(<ModCard {...input} />));
    expect(rosterIteration).not.toHaveBeenCalled();

    await openMenu(kind);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(translate).toHaveBeenCalledWith('installed.tag.setLockerTag');
    expect(rosterIteration).not.toHaveBeenCalled();

    await openLockerTags();
    expect(rosterIteration).toHaveBeenCalled();
    const heroChoices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .filter((item) => item.querySelector('img'));
    expect(heroChoices).toHaveLength(HERO_NAMES_SORTED.length);
    expect(heroChoices[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => heroChoices[1].click());
    expect(input.onTagLocker).toHaveBeenCalledExactlyOnceWith(HERO_NAMES_SORTED[1]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it.each(['grid', 'compact', 'list'] as const)('shows a dynamic hero once in %s cards', async viewMode => {
    useCategoryStore.setState({
      heroByCategoryId: new Map([[2, 'Solomon']]), heroNames: ['Solomon'],
      pathsByModel: { ModCategory: buildCategoryPaths([{
        id: 1, name: 'Skins', itemCount: 1,
        children: [{ id: 2, name: 'Solomon', itemCount: 1 }],
      }]) },
    });
    input = { ...input, viewMode, mod: { ...input.mod, sourceSection: 'Mod', categoryId: 2, categoryName: 'Solomon' } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelectorAll('img[src*="solomon.png"]')).toHaveLength(1);
    const visibleLabels = [...host.querySelectorAll('span')].filter(node =>
      node.childElementCount === 0 && node.textContent === 'Solomon' && !node.classList.contains('sr-only'));
    expect(visibleLabels).toHaveLength(0);
  });

  it('assigns a custom tag from the context menu and immediately renders it on the card', async () => {
    const settings = { deadlockPath: '/game', devDeadlockPath: '/dev', devMode: false } as AppSettings;
    useAppStore.setState({ settings });
    const scope = getInstallationScope(settings)!;
    useInstalledTagsStore.setState({ byScope: { [scope]: [{ id: 'saved', name: 'Saved mods', keys: [] }] } });
    input = { ...input, mod: { ...input.mod, gameBananaId: 17, metaKey: 'test.vpk' } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.textContent).not.toContain('Saved mods');
    await openMenu('context');
    const trigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .find(item => item.textContent === 'installed.tags.title')!;
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const checkbox = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
      .find(item => item.textContent === 'Saved mods')!;
    expect(checkbox.getAttribute('aria-checked')).toBe('false');
    await act(async () => checkbox.click());
    expect(useInstalledTagsStore.getState().byScope[scope][0].keys).toEqual(['Mod:gamebanana:17']);
    expect(host.querySelector('[data-fitting-tags]')?.textContent).toContain('Saved mods');
    expect(input.onToggle).not.toHaveBeenCalled();
    expect(input.onTagLocker).not.toHaveBeenCalled();
  });

  it.each(['grid', 'compact', 'list'] as const)('places repair icons before hero and category tags in %s cards', async viewMode => {
    input = { ...input, viewMode, mod: { ...input.mod, lockerHeroes: ['Abrams'], categoryName: 'Skins',
      outdatedVdata: [{ entry: 'scripts/heroes.vdata_c', missing: 1, sample: ['field'] }],
      staleModels: [{ entry: 'models/hero.vmdl_c', attachments: ['aim'] }],
    } };
    await act(async () => root.render(<ModCard {...input} />));
    const issues = host.querySelector<HTMLElement>('[data-issue-stack]')!;
    const heroes = host.querySelector('[data-hero-stack]')!;
    expect(issues.style.width).toBe('44px');
    expect(issues.querySelectorAll('svg')).toHaveLength(2);
    expect(issues.querySelector('.lucide-file-warning')).not.toBeNull();
    expect(issues.querySelector('.lucide-camera-off')).not.toBeNull();
    for (const icon of issues.querySelectorAll('svg')) {
      expect(icon.classList.contains('h-4')).toBe(true);
      expect(icon.classList.contains('w-4')).toBe(true);
      expect(icon.parentElement?.classList.contains('h-[22px]')).toBe(true);
      expect(icon.parentElement?.classList.contains('w-[22px]')).toBe(true);
      expect(icon.parentElement?.classList.contains('items-center')).toBe(true);
      expect(icon.parentElement?.classList.contains('justify-center')).toBe(true);
    }
    expect(issues.nextElementSibling).toBe(heroes);
    expect(issues.title).toContain('installed.card.outdatedDataTitle');
    expect(issues.title).toContain('installed.card.staleModelTitle');
    expect(host.textContent).not.toContain('installed.card.outdatedData');
    expect(host.textContent).not.toContain('installed.card.staleModel');
    await act(async () => root.render(<ModCard {...input} mod={{ ...input.mod, outdatedVdata: [], staleModels: [] }} />));
    expect(host.querySelector('[data-issue-stack]')).toBeNull();
  });

  it.each(['grid', 'compact', 'list'] as const)('groups the requirements icon with repair icons before taxonomy in %s cards', async viewMode => {
    input = { ...input, viewMode, mod: { ...input.mod, gameBananaId: 1, lockerHeroes: ['Abrams'], categoryName: 'Skins',
      outdatedVdata: [{ entry: 'scripts/heroes.vdata_c', missing: 1, sample: ['field'] }],
      staleModels: [{ entry: 'models/hero.vmdl_c', attachments: ['aim'] }],
    } };
    useAppStore.setState({ mods: [input.mod as Mod] });
    useRequirementsStore.getState().remember({ id: 1, section: 'Mod' }, {
      status: 'loaded', checkedAt: 1, items: [{ name: 'Required base', importance: 'required', state: 'on', url: 'https://gamebanana.com/mods/999' }],
    });
    await act(async () => root.render(<ModCard {...input} />));
    const requirements = host.querySelector<HTMLButtonElement>('[data-requirement-warning]')!;
    const issues = host.querySelector<HTMLElement>('[data-issue-stack]')!;
    const heroes = host.querySelector('[data-hero-stack]')!;
    expect(host.querySelectorAll('[data-requirement-warning]')).toHaveLength(1);
    expect(issues.contains(requirements)).toBe(true);
    expect(issues.nextElementSibling).toBe(heroes);
    expect(issues.style.width).toBe('66px');
    expect(issues.querySelectorAll('svg')).toHaveLength(3);
    expect(issues.getAttribute('role')).toBe('group');
    expect(requirements.querySelector('svg')).not.toBeNull();
    expect(requirements.className).toContain('text-state-warning');
    expect(requirements.textContent).toBe('');
    expect(host.textContent).not.toContain('requirements.missing');
    expect(host.textContent).not.toContain('requirements.title');
    await act(async () => requirements.click());
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mode: 'manage', mod: input.mod });
    await act(async () => root.render(<ModCard {...input} mod={{ ...input.mod, outdatedVdata: [], staleModels: [] }} />));
    const requirementsOnly = host.querySelector<HTMLElement>('[data-issue-stack]')!;
    expect(requirementsOnly.style.width).toBe('22px');
    expect(requirementsOnly.querySelectorAll('svg')).toHaveLength(1);
  });

  it.each(['grid', 'compact', 'list'] as const)('places the hover swap button directly after More actions in %s', async viewMode => {
    input = { ...input, viewMode, mod: { ...input.mod, enabled: false, lockerHeroes: ['Haze'] },
      swapTargets: [{ key: 'old', name: 'Current Haze skin', heroNames: ['Haze'] }], onSwap: vi.fn(async () => {}) };
    await act(async () => root.render(<ModCard {...input} />));
    const button = host.querySelector<HTMLButtonElement>('[data-mod-swap]')!;
    const more = host.querySelector('[aria-label="installed.card.moreActionsFor"]')!;
    expect(more.closest('div')?.nextElementSibling).toBe(button);
    expect(button.className).toContain('installed-card-hover-action');
    expect(button.className).toContain('opacity-0');
    expect(button.querySelector('.lucide-arrow-left-right')).not.toBeNull();
    await act(async () => button.click());
    expect(input.onSwap).toHaveBeenCalledExactlyOnceWith('old');
    expect(input.onToggle).not.toHaveBeenCalled();
    expect(document.querySelector('[data-swap-menu]')).toBeNull();
  });

  it.each(['enabled', 'untagged', 'no-match', 'selection'] as const)('omits the swap button for %s cards', async kind => {
    input = { ...input, mod: { ...input.mod, enabled: kind === 'enabled', lockerHeroes: kind === 'untagged' ? [] : ['Haze'] },
      selectMode: kind === 'selection', swapTargets: kind === 'no-match' ? [] : [{ key: 'old', name: 'Old', heroNames: ['Haze'] }], onSwap: vi.fn(async () => {}) };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('[data-mod-swap]')).toBeNull();
  });

  it('opens the enabled-mod dropdown and swaps only the selected target', async () => {
    input = { ...input, mod: { ...input.mod, enabled: false, lockerHeroes: ['Haze', 'Abrams'] },
      swapTargets: [{ key: 'haze', name: 'Enabled Haze', heroNames: ['Haze', 'Wraith'] }, { key: 'abrams', name: 'Enabled Abrams', heroNames: ['Abrams'] }], onSwap: vi.fn(async () => {}) };
    await act(async () => root.render(<ModCard {...input} />));
    await act(async () => host.querySelector('[data-mod-swap]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const menu = document.querySelector('[data-swap-menu]')!;
    const targets = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(targets.map(item => item.title)).toEqual(['Enabled Haze', 'Enabled Abrams']);
    expect(targets[0].querySelectorAll('[data-hero-stack] img')).toHaveLength(2);
    expect(targets[0].querySelector<HTMLElement>('[data-hero-stack]')?.style.width).toBe('44px');
    expect(targets[0].querySelector('img[src*="haze.png"]')).not.toBeNull();
    expect(targets[0].querySelector('img[src*="wraith.png"]')).not.toBeNull();
    expect(targets[1].querySelector('img[src*="abrams.png"]')).not.toBeNull();
    expect(menu.querySelector('.lucide-arrow-left-right')).toBeNull();
    expect(input.onSwap).not.toHaveBeenCalled();
    await act(async () => targets[1].click());
    expect(input.onSwap).toHaveBeenCalledExactlyOnceWith('abrams');
    expect(document.querySelector('[data-swap-menu]')).toBeNull();
  });

  it('uses the target dropdown for a multihero mod even when only one target is available', async () => {
    input = { ...input, mod: { ...input.mod, enabled: false, lockerHeroes: ['Haze', 'Abrams'] },
      swapTargets: [{ key: 'old', name: 'Enabled Haze', heroNames: ['Haze'] }], onSwap: vi.fn(async () => {}) };
    await act(async () => root.render(<ModCard {...input} />));
    await act(async () => host.querySelector('[data-mod-swap]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(document.querySelector('[data-swap-menu] [role="menuitem"]')?.getAttribute('title')).toBe('Enabled Haze');
    expect(input.onSwap).not.toHaveBeenCalled();
  });

  it('prevents repeated swap clicks while a replacement is being enabled', async () => {
    let finish!: () => void;
    input = { ...input, mod: { ...input.mod, enabled: false, lockerHeroes: ['Haze'] },
      swapTargets: [{ key: 'old', name: 'Old', heroNames: ['Haze'] }], onSwap: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
    await act(async () => root.render(<ModCard {...input} />));
    const button = host.querySelector<HTMLButtonElement>('[data-mod-swap]')!;
    await act(async () => { button.click(); button.click(); });
    expect(input.onSwap).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    await act(async () => finish());
    expect(button.disabled).toBe(false);
  });

  it.each(['context', 'dropdown'] as const)('opens requirement management from the %s menu', async kind => {
    input = { ...input, mod: { ...input.mod, gameBananaId: 1 } };
    useAppStore.setState({ mods: [input.mod as Mod] });
    vi.spyOn(useRequirementsStore.getState(), 'load').mockResolvedValue();
    await act(async () => root.render(<ModCard {...input} />));
    await openMenu(kind);
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(element => element.textContent === 'requirements.manageTitle')!;
    expect(item).toBeDefined();
    await act(async () => item.click());
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mode: 'manage', mod: input.mod });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('omits requirement management for local mods without declared dependencies', async () => {
    await act(async () => root.render(<ModCard {...input} />));
    await openMenu('context');
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .some(element => element.textContent === 'requirements.manageTitle')).toBe(false);
  });

  it.each(['grid', 'compact', 'list'] as const)('shows every grouped hero and puts additional %s tags in a mouse tooltip', async viewMode => {
    const originalBounds = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-fitting-tags')) return DOMRect.fromRect({ width: 70, height: 22 });
      if (this.parentElement?.hasAttribute('data-tag-measure')) {
        return DOMRect.fromRect({ width: this.textContent?.startsWith('+') ? 20 : 40, height: 22 });
      }
      return originalBounds.call(this);
    });
    useCategoryStore.setState({
      heroNames: ['Haze', 'Wraith'],
      pathsByModel: { SoundCategory: buildCategoryPaths([{
        id: 1, name: 'Voices', itemCount: 1,
        children: [{ id: 2, name: 'VOs', itemCount: 1 }],
      }]) },
    });
    const primary = { ...input.mod, gameBananaId: 1, sourceSection: 'Sound', categoryId: 2, lockerHeroes: ['Haze'] };
    const secondary = { ...primary, id: 'second', lockerHeroes: ['Wraith', 'Haze'] };
    input = { ...input, viewMode, mod: primary, group: {
      variants: [primary, secondary] as Mod[], variantCount: 2, enabledCount: 1, enabledLabels: [], onOpenPicker: vi.fn(),
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelectorAll('img[src*="haze.png"]')).toHaveLength(1);
    expect(host.querySelectorAll('img[src*="wraith.png"]')).toHaveLength(1);
    const row = host.querySelector('[data-fitting-tags]')!;
    const visibleTags = [...row.children].filter(node => node.hasAttribute('title'));
    expect(visibleTags.map(node => node.textContent)).toEqual(['VOs', '+2']);
    const overflow = visibleTags.find(node => node.textContent === '+2') as HTMLElement | undefined;
    expect(overflow?.title).toBe('Voices\nSounds');
  });

  it('does not infer hero icons or thumbnail art from a sound submission title', async () => {
    input = { ...input, mod: { ...input.mod, gameBananaId: 1, name: 'Haze voice', sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3' } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('img[src*="haze"]')).toBeNull();
  });

  it.each(['grid', 'compact', 'list'] as const)('keeps single-hero Sound portrait art and image actions in %s', async viewMode => {
    const copyImage = vi.spyOn(imageActions, 'copyImageToClipboard').mockResolvedValue();
    const primary = { ...input.mod, gameBananaId: 1, sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3', lockerHeroes: ['Wraith'] };
    const earlier = { ...primary, id: 'earlier', enabled: false, lockerHeroes: ['Wraith'] };
    input = { ...input, viewMode, mod: primary, group: {
      variants: [earlier, primary] as Mod[], variantCount: 2, enabledCount: 1, enabledLabels: [], onOpenPicker: vi.fn(),
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('img[src*="Wraith_Render.png"]')).not.toBeNull();
    expect(host.querySelector('img[src*="Haze_Render.png"]')).toBeNull();
    expect(host.querySelector('img[src*="haze.png"]')).toBeNull();
    expect(host.querySelector('img[src*="wraith.png"]')).not.toBeNull();
    await openMenu('dropdown');
    const imageMenu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .find(item => item.textContent === 'imageContextMenu.image')!;
    await act(async () => {
      imageMenu.focus();
      imageMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    const copyAction = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find(item => item.textContent === 'imageContextMenu.copyImage')!;
    await act(async () => copyAction.click());
    expect(copyImage).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/locker/heroes/Wraith_Render.png'));
  });

  it.each(['grid', 'compact', 'list'] as const)('uses the normal Sound preview for a multihero file in %s', async viewMode => {
    input = { ...input, viewMode, mod: {
      ...input.mod, gameBananaId: 1, sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3', lockerHeroes: ['Haze', 'Wraith'],
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('img[src*="_Render.png"]')).toBeNull();
    expect(host.textContent).toContain('installed.card.soundPreview');
    expect(host.querySelector('img[src*="haze.png"]')).not.toBeNull();
    expect(host.querySelector('img[src*="wraith.png"]')).not.toBeNull();
    await openMenu('dropdown');
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .some(item => item.textContent === 'imageContextMenu.image')).toBe(false);
  });

  it.each(['grid', 'compact', 'list'] as const)('does not choose a first portrait when Sound variants affect different heroes in %s', async viewMode => {
    const primary = { ...input.mod, gameBananaId: 1, sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3', lockerHeroes: ['Wraith'] };
    const earlier = { ...primary, id: 'earlier', enabled: false, lockerHeroes: ['Haze'] };
    input = { ...input, viewMode, mod: primary, group: {
      variants: [earlier, primary] as Mod[], variantCount: 2, enabledCount: 1, enabledLabels: [], onOpenPicker: vi.fn(),
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('img[src*="_Render.png"]')).toBeNull();
    expect(host.textContent).toContain('installed.card.soundPreview');
    expect(host.querySelector('img[src*="haze.png"]')).not.toBeNull();
    expect(host.querySelector('img[src*="wraith.png"]')).not.toBeNull();
  });

  it.each(['grid', 'compact', 'list'] as const)('retains explicit thumbnail art for a multihero Sound in %s', async viewMode => {
    const thumbnailUrl = 'https://example.invalid/authored-thumbnail.png';
    input = { ...input, viewMode, mod: {
      ...input.mod, gameBananaId: 1, sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3', thumbnailUrl, lockerHeroes: ['Haze', 'Wraith'],
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector(`img[src="${thumbnailUrl}"]`)).not.toBeNull();
    expect(host.querySelector('img[src*="_Render.png"]')).toBeNull();
    await openMenu('dropdown');
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .some(item => item.textContent === 'imageContextMenu.image')).toBe(true);
  });

  it.each(['grid', 'compact', 'list'] as const)('does not borrow a sibling Sound hero for an unresolved %s representative', async viewMode => {
    const primary = { ...input.mod, gameBananaId: 1, sourceSection: 'Sound', audioUrl: 'https://example.invalid/voice.mp3', lockerHeroes: [] };
    const earlier = { ...primary, id: 'earlier', enabled: false, lockerHeroes: ['Haze'] };
    input = { ...input, viewMode, mod: primary, group: {
      variants: [earlier, primary] as Mod[], variantCount: 2, enabledCount: 1, enabledLabels: [], onOpenPicker: vi.fn(),
    } };
    await act(async () => root.render(<ModCard {...input} />));
    expect(host.querySelector('img[src*="_Render.png"]')).toBeNull();
    expect(host.querySelector('img[src*="haze.png"]')).not.toBeNull();
    await openMenu('dropdown');
    expect([...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .some(item => item.textContent === 'imageContextMenu.image')).toBe(false);
  });

  it('offers current category-tree heroes when retagging', async () => {
    useCategoryStore.setState({ heroNames: ['Baba', 'Solomon'] });
    await act(async () => root.render(<ModCard {...input} />));
    await openMenu('dropdown');
    await openLockerTags();
    const choices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .filter(item => item.querySelector('img'));
    expect(choices.map(item => item.textContent)).toEqual(['Baba', 'Solomon']);
    await act(async () => choices[1].click());
    expect(input.onTagLocker).toHaveBeenCalledExactlyOnceWith('Solomon');
  });
});
