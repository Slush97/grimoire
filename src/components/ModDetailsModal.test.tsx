// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../types/mod';
import type { GameBananaCategory, GameBananaModDetails } from '../types/gamebanana';
import ModDetailsModal from './ModDetailsModal';
import PreferencesSection from './settings/sections/PreferencesSection';
import { useRequirementsStore } from '../stores/requirementsStore';

const mocks = vi.hoisted(() => ({
  store: { settings: {} as AppSettings, mods: [], soundVolume: 1, saveSettings: vi.fn() },
  replace: vi.fn(), download: vi.fn(), translate: (key: string) => key,
  filePhase: 'idle' as 'idle' | 'queued' | 'finishing',
  categoryState: {
    pathsByModel: {} as Record<string, ReadonlyMap<number, readonly GameBananaCategory[]>>,
    heroNames: ['Violet'],
    load: vi.fn(async () => []),
  },
}));
vi.mock('../stores/appStore', () => ({ useAppStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store) }));
vi.mock('../stores/categoryStore', () => ({ useCategoryStore: (selector: (state: typeof mocks.categoryState) => unknown) => selector(mocks.categoryState) }));
vi.mock('../lib/api', () => ({ getModComments: vi.fn(), getModUpdates: vi.fn() }));
vi.mock('../lib/downloadActivity', () => ({
  useDownloadActivity: () => ({ current: null, queue: [], requested: [], progress: null, extracting: false }),
  selectFileDownloadActivity: () => mocks.filePhase === 'queued' ? { phase: 'queued', position: 1 } : { phase: mocks.filePhase },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.translate }),
  Trans: ({ i18nKey }: { i18nKey: string }) => i18nKey,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mod: GameBananaModDetails = {
  id: 10, name: 'Test mod', nsfw: false,
  files: [{ id: 30, fileName: 'new.zip', fileSize: 100, downloadCount: 1, downloadUrl: '', isArchived: false }],
};

describe('mod details', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousApi: typeof window.electronAPI;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
  const replaceButton = () => host.querySelector<HTMLButtonElement>('[title="modDetails.replace.action"]')!;
  const checkbox = () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const render = async (preferences = false, overrides: Partial<ComponentProps<typeof ModDetailsModal>> = {}) => {
    await act(async () => root.render(<>
      {preferences && <PreferencesSection />}
      <ModDetailsModal
        mod={mod} section="Mod" installed installedFileIds={new Set([20])}
        replaceableFiles={[{ fileId: 20, fileName: 'old.zip', label: 'Old variant' }]}
        onReplace={mocks.replace} onDownload={mocks.download} onClose={vi.fn()}
        hideNsfwPreviews={false} manualReplacement offline variant="sidebar"
        {...overrides}
      />
    </>));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.filePhase = 'idle';
    mocks.store.settings = {} as AppSettings;
    mocks.categoryState.pathsByModel = {};
    mocks.categoryState.heroNames = ['Violet'];
    mocks.categoryState.load.mockResolvedValue([]);
    mocks.store.saveSettings.mockImplementation(async (settings: AppSettings) => { mocks.store.settings = settings; });
    previousApi = window.electronAPI;
    window.electronAPI = { getForgeBridgeStatus: async () => null } as unknown as typeof window.electronAPI;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    useRequirementsStore.getState().finish(false);
    host.remove();
    window.electronAPI = previousApi;
  });

  it('rereads the shared category cache when navigating without remounting', async () => {
    await render();
    expect(mocks.categoryState.load).toHaveBeenCalledExactlyOnceWith('ModCategory');
    await render(false, { mod: { ...mod, id: 11 } });
    expect(mocks.categoryState.load).toHaveBeenCalledTimes(2);
    await render(false, { mod: { ...mod, id: 11 }, installed: false });
    expect(mocks.categoryState.load).toHaveBeenCalledTimes(2);
  });

  it.each((['modal', 'sidebar'] as const).flatMap(variant => [
    { variant, withFiles: true }, { variant, withFiles: false },
  ]))('keeps requirements after every file and before the artist: %j', async ({ variant, withFiles }) => {
    mocks.categoryState.pathsByModel.ModCategory = new Map([[3, [
      { id: 1, name: 'Skins' }, { id: 2, name: 'Violet' }, { id: 3, name: 'Faithful/Vanilla+' },
    ]]]);
    await render(false, { variant, mod: {
      ...mod,
      files: withFiles ? [
        { ...mod.files![0], fileName: 'active.zip' },
        { ...mod.files![0], id: 31, fileName: 'archived.zip', isArchived: true },
      ] : [],
      submitter: { id: 1, name: 'Test artist' },
      category: { id: 3, name: 'Faithful/Vanilla+' },
      requirements: { status: 'loaded', checkedAt: 1, items: [
        { name: 'Dependency', url: 'https://example.com', importance: 'required', state: 'on' },
      ] },
    } });
    if (withFiles) {
      const archived = [...document.querySelectorAll<HTMLButtonElement>('button')]
        .find(item => item.textContent?.includes('modDetails.files.archived'))!;
      await act(async () => archived.click());
      expect(archived.getAttribute('aria-expanded')).toBe('true');
    }
    const hero = document.querySelector<HTMLElement>('[title="Violet"]')!;
    expect(hero.querySelector('img')?.getAttribute('src')).toContain('/heroes/chip-icons/violet.png');
    expect(hero.parentElement?.textContent).toBe('VioletSkinsFaithful/Vanilla+');
    const tags = hero.parentElement!;
    expect(tags.firstElementChild).toBe(hero);
    expect([...tags.children].slice(1).map(tag => tag.textContent)).toEqual(['Skins', 'Faithful/Vanilla+']);
    const requirements = document.querySelector('[aria-label="requirements.title"]')!;
    expect(requirements.querySelector(':scope > h3')?.textContent).toBe('requirements.title');
    const fileTitle = [...document.querySelectorAll('h3')].find(item => item.textContent?.includes('modDetails.sections.files'))!;
    const artist = [...document.querySelectorAll('div')].find(item => item.textContent === 'modDetails.meta.artist')!.closest('section');
    expect(requirements.nextElementSibling).toBe(artist);
    if (withFiles) {
      const files = fileTitle.closest('section')!;
      expect(files.textContent).toContain('active.zip');
      expect(files.textContent).toContain('archived.zip');
      expect(tags.nextElementSibling).toBe(files);
      expect(files.nextElementSibling).toBe(requirements);
    } else {
      expect(fileTitle).toBeUndefined();
      expect(tags.nextElementSibling).toBe(requirements);
    }
    expect(tags.classList.contains('flex-wrap')).toBe(true);
    expect(mocks.categoryState.load).toHaveBeenCalledWith('ModCategory');
  });

  it.each(['modal', 'sidebar'] as const)('places all hero icons first while preserving the other category order in the %s', async variant => {
    mocks.categoryState.heroNames = ['Violet', 'Haze'];
    mocks.categoryState.pathsByModel.ModCategory = new Map([[4, [
      { id: 1, name: 'Skins' }, { id: 2, name: 'Violet' },
      { id: 3, name: 'Faithful/Vanilla+' }, { id: 4, name: 'Haze' },
    ]]]);
    await render(false, { variant, mod: { ...mod, category: { id: 4, name: 'Haze' } } });
    const hero = document.querySelector<HTMLElement>('[title="Violet"]')!;
    expect([...hero.parentElement!.children].map(tag => tag.textContent)).toEqual(['Violet', 'Haze', 'Skins', 'Faithful/Vanilla+']);
  });

  it('leaves no empty badge group before the title when no status is visible', async () => {
    await render(false, { variant: 'modal', installed: false, mod: { ...mod, category: { name: 'Skins' } } });
    const title = document.querySelector('h2')!;
    expect(title.parentElement?.firstElementChild).toBe(title);
    expect(title.parentElement?.textContent).not.toContain('Skins');
    await render(false, { variant: 'modal', installed: false, ignoreUpdates: true, onToggleIgnoreUpdates: vi.fn() });
    expect(title.parentElement?.firstElementChild).toBe(title);
  });

  it.each([
    { installed: true },
    { installed: false, updateAvailable: true },
    { installed: false, archivedByAuthor: true },
    { installed: false, dateModified: 1 },
  ])('retains the badge group for a visible status: %j', async (status) => {
    await render(false, { variant: 'modal', ...status });
    const title = document.querySelector('h2')!;
    expect(title.previousElementSibling?.textContent?.trim()).toBeTruthy();
  });

  it('resolves category ids within the viewed section and keeps supplied names offline', async () => {
    mocks.categoryState.pathsByModel.SoundCategory = new Map([[3, [
      { id: 1, name: 'Music' }, { id: 3, name: 'Menu music' },
    ]]]);
    await render(false, { section: 'Sound', mod: { ...mod, category: { id: 3, name: 'Menu music' } } });
    expect(host.textContent).toContain('MusicMenu music');
    expect(mocks.categoryState.load).toHaveBeenCalledWith('SoundCategory');
    expect(mocks.categoryState.load).toHaveBeenCalledWith('ModCategory');
    mocks.categoryState.load.mockRejectedValueOnce(new Error('Offline'));
    await render(false, { mod: { ...mod, category: { id: 4, name: 'Accessibility' } } });
    expect(host.textContent).toContain('Accessibility');
  });

  it('removes the original backdrop while navigating requirements and restores the same details tree', async () => {
    await render(false, { variant: 'modal' });
    const original = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(original.style.display).toBe('');
    await act(async () => useRequirementsStore.getState().openTarget({ id: 704252, section: 'Mod' }));
    expect(original.style.display).toBe('none');
    expect(original.getAttribute('aria-hidden')).toBe('true');
    await act(async () => useRequirementsStore.getState().back());
    expect(document.querySelector('[role="dialog"]')).toBe(original);
    expect(original.style.display).toBe('');
    expect(original.getAttribute('aria-hidden')).toBeNull();
    await render(false, { variant: 'modal', requirementsLayer: true });
    await act(async () => useRequirementsStore.getState().openTarget({ id: 704252, section: 'Mod' }));
    expect(original.style.display).toBe('');
  });

  it('keeps the resume-updates control visible and blocks duplicate toggles while saving', async () => {
    const toggle = vi.fn();
    await render(false, { ignoreUpdates: true, ignoreUpdatesPending: true, onToggleIgnoreUpdates: toggle });
    const resume = button('modDetails.status.updatesIgnored');
    expect(resume.disabled).toBe(true);
    await act(async () => resume.click());
    expect(toggle).not.toHaveBeenCalled();
    await render(false, { ignoreUpdates: true, onToggleIgnoreUpdates: toggle });
    await act(async () => button('modDetails.status.updatesIgnored').click());
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('keeps a completed automatic update hidden while its library refresh is pending in manual replacement', async () => {
    const stale = { updateFileIds: new Set([30]), replaceableFiles: [] };
    await render(false, stale);
    expect(button('profiles.actions.update')).toBeDefined();
    mocks.filePhase = 'queued';
    await render(false, stale);
    expect(host.textContent).not.toContain('profiles.actions.update');
    mocks.filePhase = 'finishing';
    await render(false, stale);
    expect(host.textContent).not.toContain('profiles.actions.update');
    mocks.filePhase = 'idle';
    await render(false, { installedFileIds: new Set([30]), replaceableFiles: [] });
    expect(host.textContent).not.toContain('profiles.actions.update');
    expect(host.textContent).not.toContain('modDetails.actions.install');
  });

  it('keeps ordinary download actions disabled while the library refresh finishes', async () => {
    mocks.filePhase = 'finishing';
    await render(false, { manualReplacement: false, updateFileIds: new Set([30]), replaceableFiles: [] });
    const finishing = button('modDetails.status.finishing');
    expect(finishing.disabled).toBe(true);
    await act(async () => finishing.click());
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('keeps the warning enabled when a checked confirmation is canceled', async () => {
    await render();
    await act(async () => replaceButton().click());
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => checkbox().click());
    await act(async () => button('common.actions.cancel').click());
    expect(mocks.store.saveSettings).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => replaceButton().click());
    expect(checkbox().checked).toBe(false);
  });

  it('persists the opt-out on confirmation and allows Preferences to restore the warning', async () => {
    await render();
    await act(async () => replaceButton().click());
    await act(async () => checkbox().click());
    const dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => [...dialog.querySelectorAll('button')].find(item => item.textContent === 'modDetails.replace.confirm')!.click());
    expect(mocks.store.saveSettings).toHaveBeenCalledExactlyOnceWith({ skipModReplacementConfirmation: true });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(30, 'new.zip', 20);
    await render();
    await act(async () => replaceButton().click());
    expect(mocks.replace).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await render(true);
    const setting = [...host.querySelectorAll<HTMLLabelElement>('label')].find(item => item.textContent?.includes('settings.preferences.skipModReplacementConfirmation'))!;
    await act(async () => setting.querySelector('input')!.click());
    expect(mocks.store.settings.skipModReplacementConfirmation).toBe(false);
    await render(true);
    await act(async () => replaceButton().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.replace).toHaveBeenCalledTimes(2);
  });

  it('keeps the install and replacement actions correct when the button swap is turned off', async () => {
    await render(true);
    expect(replaceButton().textContent).toBe('modDetails.replace.confirm');
    const setting = [...host.querySelectorAll<HTMLLabelElement>('label')].find(item => item.textContent?.includes('settings.preferences.swapManualReplacementActions'))!;
    await act(async () => setting.querySelector('input')!.click());
    expect(mocks.store.settings.swapManualReplacementActions).toBe(false);
    await render(true);
    expect(replaceButton().textContent).toBe('');
    await act(async () => button('modDetails.actions.install').click());
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith(30, 'new.zip');
    expect(mocks.replace).not.toHaveBeenCalled();
    await act(async () => replaceButton().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  describe('full-size image gestures', () => {
    const open = async (imageWidth = 600, imageHeight = 400) => {
      await render(false, { mod: { ...mod, previewMedia: { images: [
        { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'first.jpg', caption: 'Caption' },
        { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'second.jpg' },
      ] } } });
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="View image 1 of 2 full size"]')!.click());
      const viewer = document.querySelector('figure')!.parentElement!;
      const image = viewer.querySelector('img')!;
      const viewport = viewer.querySelector<HTMLElement>('[data-lightbox-viewport]')!;
      Object.defineProperties(viewport, { clientWidth: { value: 600 }, clientHeight: { value: 400 } });
      viewport.getBoundingClientRect = () => DOMRect.fromRect({ width: 600, height: 400 });
      Object.defineProperties(image, { naturalWidth: { value: imageWidth * 2 }, offsetWidth: { value: imageWidth }, offsetHeight: { value: imageHeight } });
      image.setPointerCapture = vi.fn();
      image.hasPointerCapture = vi.fn(() => true);
      image.releasePointerCapture = vi.fn();
      return { viewer, image, controls: viewer.querySelector<HTMLElement>('[data-lightbox-controls]')! };
    };
    const wheel = async (target: Element, deltaY: number, clientX = 300, clientY = 200) => {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY, clientX, clientY });
      await act(async () => target.dispatchEvent(event));
      return event;
    };
    const transform = (image: HTMLImageElement) => image.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const pointer = async (image: HTMLImageElement, type: string, clientX: number, clientY: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      await act(async () => image.dispatchEvent(event));
    };

    it('toggles fading controls with an image click without closing the viewer', async () => {
      const { image, controls } = await open();
      expect(controls.getAttribute('aria-hidden')).toBe('false');
      await act(async () => image.click());
      expect(controls.getAttribute('aria-hidden')).toBe('true');
      expect(controls.hasAttribute('inert')).toBe(true);
      expect(controls.className).toContain('transition-opacity');
      expect(image.isConnected).toBe(true);
      await act(async () => image.click());
      expect(controls.getAttribute('aria-hidden')).toBe('false');
    });

    it('zooms around the pointer, caps zoom, and restores controls when zooming back to fit', async () => {
      const { image, controls } = await open();
      expect((await wheel(image, -100, 450, 100)).defaultPrevented).toBe(true);
      const [x, y, scale] = transform(image);
      expect(scale).toBeGreaterThan(1);
      expect((150 - x) / scale).toBeCloseTo(150);
      expect((-100 - y) / scale).toBeCloseTo(-100);
      expect(controls.hasAttribute('inert')).toBe(true);
      for (let i = 0; i < 8; i++) await wheel(image, -240);
      expect(transform(image)[2]).toBe(8);
      await act(async () => image.click());
      expect(controls.getAttribute('aria-hidden')).toBe('true');
      for (let i = 0; i < 8; i++) await wheel(image, 240);
      expect(transform(image)).toEqual([0, 0, 1]);
      expect(controls.getAttribute('aria-hidden')).toBe('false');
    });

    it.each([600, 200])('clamps panning at the image edges and centers axes that fit (width=%i)', async width => {
      const { viewer, image, controls } = await open(width);
      await wheel(image, -240);
      const scale = transform(image)[2];
      await pointer(image, 'pointerdown', 300, 200);
      expect(image.setPointerCapture).toHaveBeenCalledWith(1);
      await pointer(image, 'pointermove', 10000, 10000);
      expect(transform(image)).toEqual([Math.max(0, (width * scale - 600) / 2), (400 * scale - 400) / 2, scale]);
      await pointer(image, 'pointermove', -10000, -10000);
      expect(transform(image)[0]).toBeCloseTo(-Math.max(0, (width * scale - 600) / 2));
      expect(transform(image)[1]).toBe(-(400 * scale - 400) / 2);
      await pointer(image, 'pointerup', -10000, -10000);
      expect(image.releasePointerCapture).toHaveBeenCalledWith(1);
      expect(image.classList.contains('cursor-grab')).toBe(true);
      expect(image.classList.contains('cursor-grabbing')).toBe(false);
      expect(viewer.isConnected).toBe(true);
      expect(controls.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps caption scrolling independent and resets gestures on image navigation and reopening', async () => {
      const { viewer, image } = await open();
      await wheel(image, -240);
      const before = image.style.transform;
      expect((await wheel(viewer.querySelector('figcaption')!, 100)).defaultPrevented).toBe(false);
      expect(image.style.transform).toBe(before);
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
      const nextImage = document.querySelector<HTMLImageElement>('figure img')!;
      expect(transform(nextImage)).toEqual([0, 0, 1]);
      expect(document.querySelector('[data-lightbox-controls]')?.getAttribute('aria-hidden')).toBe('false');
      await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
      expect(document.querySelector('figure')).toBeNull();
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="View image"]')!.click());
      expect(transform(document.querySelector<HTMLImageElement>('figure img')!)).toEqual([0, 0, 1]);
    });
  });

  it.each(['modal', 'sidebar'] as const)('shows the selected image caption only in the %s lightbox', async variant => {
    await render(false, {
      variant,
      mod: { ...mod, previewMedia: { images: [
        { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'first.jpg', caption: 'why u bulleh meh' },
        { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'second.jpg', caption: 'Side <b>view</b> & detail' },
        { baseUrl: 'https://images.gamebanana.com/img/ss/mods', file: 'third.jpg' },
      ] } },
    });
    expect(document.querySelector('figcaption')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="View image 1 of 3 full size"]')!.click());
    expect(document.querySelector('figcaption')?.textContent).toBe('why u bulleh meh');
    await act(async () => document.querySelector('figcaption')!.click());
    expect(document.querySelector('figcaption')?.textContent).toBe('why u bulleh meh');
    const next = () => document.querySelector('figure')!.parentElement!
      .querySelector<HTMLButtonElement>('[aria-label="modDetails.aria.nextImage"]')!;
    await act(async () => next().click());
    expect(document.querySelector('figcaption')?.textContent).toBe('Side <b>view</b> & detail');
    expect(document.querySelector('figcaption b')).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(document.querySelector('figcaption')).toBeNull();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(document.querySelector('figcaption')?.textContent).toBe('why u bulleh meh');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('figure')).toBeNull();
  });
});
