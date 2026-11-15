// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariantPickerModal from './VariantPickerModal';
import type { AppSettings, Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { useCategoryStore } from '../stores/categoryStore';
import { buildCategoryPaths } from '../lib/categoryPaths';
import { requestRequirementToggle, useRequirementsStore } from '../stores/requirementsStore';
import soulUrn from '../assets/soul-urn.png';
import { getLocalModGallery, readImageDataUrl, showOpenDialogMulti } from '../lib/api';

vi.mock('../lib/api', async original => ({
    ...await original<typeof import('../lib/api')>(),
    getLocalModGallery: vi.fn(async () => []), readImageDataUrl: vi.fn(), showOpenDialogMulti: vi.fn(),
}));

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
    Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
}));

const variant = (id: string, lockerHeroes: string[] = [], extra: Partial<Mod> = {}): Mod => ({
    id, name: 'Shared mod title', fileName: `${id}.vpk`, path: `/addons/${id}.vpk`, metaKey: `${id}.vpk`,
    gameBananaId: 1, sourceSection: 'Sound', enabled: true, priority: 1, size: 100,
    installedAt: '2026-10-26T00:00:00Z', lockerHeroes, ...extra,
});

describe('variant hero indicators', () => {
    let host: HTMLDivElement;
    let root: Root;
    let props: ComponentProps<typeof VariantPickerModal>;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getLocalModGallery).mockResolvedValue([]);
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        useAppStore.getState().setLoadedGameModIds([]);
        useAppStore.setState({ settings: null });
        useRequirementsStore.setState({ snapshots: {}, review: null, toggleReview: null, targets: [] });
        useCategoryStore.setState({ heroNames: [], heroByCategoryId: new Map(), pathsByModel: {} });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
        props = {
            modName: 'Shared mod title', variants: [], onToggle: vi.fn(), onMoveVariant: vi.fn(),
            onReorderVariantTo: vi.fn(), onDeleteVariant: vi.fn(), onRenameVariant: vi.fn(), onClose: vi.fn(),
        };
    });

    afterEach(() => {
        act(() => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    });

    async function render(variants: Mod[]) {
        props = { ...props, variants };
        await act(async () => root.render(<VariantPickerModal {...props} />));
    }

    const row = (id: string) => document.querySelector(`[title="${id}.vpk"]`)!.closest('[aria-roledescription="sortable"]')!;
    const heroIcons = (id: string) => [...row(id).querySelectorAll<HTMLImageElement>('img[src*="chip-icons"]')]
        .map(image => image.getAttribute('src')?.split('/').at(-1));

    it('omits icons when every variant has the same hero set', async () => {
        await render([variant('first', ['Haze']), variant('second', ['Haze'])]);
        expect(document.querySelector('img[src*="chip-icons"]')).toBeNull();
    });

    it('compares canonical sets independently of ordering, duplicate entries, and aliases', async () => {
        await render([
            variant('first', ['Haze', 'The Doorman', 'Haze']),
            variant('second', ['Doorman', 'haze']),
        ]);
        expect(document.querySelector('img[src*="chip-icons"]')).toBeNull();
    });

    it('shows only each differing variant’s hero icons, without category text', async () => {
        await render([
            variant('first', ['Haze'], { categoryName: 'VOs' }),
            variant('second', ['Wraith'], { categoryName: 'Abilities' }),
        ]);
        expect(heroIcons('first')).toEqual(['haze.png']);
        expect(heroIcons('second')).toEqual(['wraith.png']);
        expect(row('first').textContent).not.toContain('VOs');
        expect(row('second').textContent).not.toContain('Abilities');
        expect(row('first').querySelector('[title="Haze"]')).not.toBeNull();
        expect(row('first').querySelector('.sr-only')?.textContent).toBe('Haze');
    });

    it('retains all heroes for a multihero file and compares enabled and disabled variants together', async () => {
        await render([
            variant('first', ['Haze', 'Wraith']),
            variant('second', ['Wraith'], { enabled: false }),
        ]);
        expect(heroIcons('first').sort()).toEqual(['haze.png', 'wraith.png']);
        expect(heroIcons('second')).toEqual(['wraith.png']);
    });

    it.each([4, 5])('keeps %i heroes within 32px using at most four 16px icons', async count => {
        const selected = ['Haze', 'Wraith', 'Ivy', 'Abrams', 'Baba'].slice(0, count);
        await render([
            variant('first', selected),
            variant('second', ['Wraith']),
        ]);
        const stack = row('first').querySelector<HTMLElement>('[data-hero-stack]')!;
        expect(stack.style.width).toBe('32px');
        expect(stack.style.height).toBe('16px');
        expect(stack.title).toBe(selected.join(', '));
        expect(stack.querySelectorAll('img')).toHaveLength(4);
        expect(heroIcons('first').sort()).toEqual(selected.slice(0, count > 4 ? 3 : 4).map(hero => `${hero.toLowerCase()}.png`).sort());
        expect([...stack.querySelectorAll('img')].filter(image => image.getAttribute('src') === soulUrn)).toHaveLength(count > 4 ? 1 : 0);
        expect(row('second').querySelector<HTMLElement>('[data-hero-stack]')!.style.width).toBe('16px');
    });

    it('treats an empty set as different but renders no icons for that row', async () => {
        await render([variant('first'), variant('second', ['Haze'])]);
        expect(heroIcons('first')).toEqual([]);
        expect(heroIcons('second')).toEqual(['haze.png']);
        await render([variant('first'), variant('second')]);
        expect(document.querySelector('img[src*="chip-icons"]')).toBeNull();
    });

    it('shares manual overrides and category hero resolution with Installed cards', async () => {
        useCategoryStore.setState({
            heroNames: ['Haze', 'Wraith'], heroByCategoryId: new Map([[2, 'Haze']]),
            pathsByModel: { ModCategory: buildCategoryPaths([{
                id: 1, name: 'Skins', itemCount: 1,
                children: [{ id: 2, name: 'Haze', itemCount: 1 }],
            }]) },
        });
        await render([
            variant('first', [], { sourceSection: 'Mod', lockerHeroes: undefined, categoryId: 2 }),
            variant('second', ['Wraith'], { lockerHero: 'Wraith', lockerHeroSource: 'manual' }),
        ]);
        expect(heroIcons('first')).toEqual(['haze.png']);
        expect(heroIcons('second')).toEqual(['wraith.png']);
    });

    it('keeps the existing whole-file toggle action', async () => {
        const first = variant('first', ['Haze', 'Wraith']);
        await render([first, variant('second', ['Wraith'])]);
        await act(async () => row('first').querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());
        expect(props.onToggle).toHaveBeenCalledExactlyOnceWith(first, expect.any(Object));
    });

    const item = (key: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === key)!;
    const click = async (element: HTMLElement) => { await act(async () => element.click()); };
    const openActions = async () => { await act(async () => document.querySelector('[aria-label="installed.card.moreActions"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))); };
    const openImageMenu = async (index: number) => {
        const thumbnail = document.querySelectorAll('[aria-label="modDetails.images.viewFullSize"]')[index];
        await act(async () => thumbnail.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })));
    };

    it('keeps a mixed picker normal and shows the local file action only on the imported row', async () => {
        props = { ...props, onNsfwChange: vi.fn(async () => {}), onGalleryChange: vi.fn(async () => {}), onDetachVariant: vi.fn() };
        const original = variant('normal', [], { localGroupId: 'mixed', localImport: false });
        const imported = variant('custom', [], { localGroupId: 'mixed', localImport: true, thumbnailUrl: 'data:image/png;base64,custom' });
        await render([original, imported]);
        expect(document.querySelector('[aria-label="installed.card.moreActions"]')).toBeNull();
        expect(document.querySelector('[aria-label="installed.batchImport.gallery"]')).toBeNull();
        expect(row('normal').querySelector('[aria-label="variantPicker.detachVariant"]')).toBeNull();
        await click(row('custom').querySelector<HTMLButtonElement>('[aria-label="variantPicker.detachVariant"]')!);
        expect(props.onDetachVariant).toHaveBeenCalledExactlyOnceWith(imported);
    });

    it('keeps a single local file uncluttered and puts file additions in the header menu', async () => {
        props = { ...props, onAddVariant: vi.fn(), onGalleryChange: vi.fn(async () => {}) };
        await render([variant('local', [], { gameBananaId: undefined, thumbnailUrl: 'data:image/png;base64,old' })]);
        const gallery = document.querySelector('[aria-label="installed.batchImport.gallery"]')!;
        expect(gallery.className).toContain('overflow-x-auto');
        expect(gallery.querySelector('.outline-accent')).toBeNull();
        expect(gallery.querySelector('img')?.className).toContain('object-contain');
        expect(document.querySelector('[aria-label="installed.batchImport.removeImage"]')).toBeNull();
        expect(document.querySelector('[aria-label="installed.batchImport.thumbnailHint"]')).toBeNull();
        expect(document.querySelector('[data-local-mod-drop]')).toBeNull();
        vi.mocked(showOpenDialogMulti).mockResolvedValue(['/added.zip']);
        await openActions(); await click(item('variantPicker.addFiles'));
        expect(props.onAddVariant).toHaveBeenCalledExactlyOnceWith(['/added.zip']);
        expect(showOpenDialogMulti).toHaveBeenCalledWith(expect.objectContaining({
            filters: [{ name: 'common.fileTypes.vpkOrArchive', extensions: ['vpk', 'zip', '7z', 'rar'] }],
        }));
    });

    it('appends selected images without duplicating existing artwork and promotes the next image when removed', async () => {
        const first = 'data:image/png;base64,first'; const second = 'data:image/png;base64,second';
        props = { ...props, onGalleryChange: vi.fn(async () => {}) };
        vi.mocked(getLocalModGallery).mockResolvedValue([first, second]);
        await render([variant('local', [], { localGroupId: 'artwork', thumbnailUrl: first })]);
        vi.mocked(showOpenDialogMulti).mockResolvedValue(['/same.png', '/new.png']);
        vi.mocked(readImageDataUrl).mockImplementation(async path => path === '/same.png' ? first : 'data:image/png;base64,new');
        await openActions(); await click(item('variantPicker.addImages'));
        expect(props.onGalleryChange).toHaveBeenLastCalledWith([first, second, 'data:image/png;base64,new']);
        await openImageMenu(0); await click(item('common.actions.remove'));
        expect(props.onGalleryChange).toHaveBeenLastCalledWith([second, 'data:image/png;base64,new']);
    });

    it('keeps the old gallery on a failed save and hides transport prefixes in the error', async () => {
        const first = 'data:image/png;base64,first';
        props = { ...props, onGalleryChange: vi.fn(async () => { throw new Error("Error invoking remote method 'set-local-mod-gallery': Error: Disk full"); }) };
        await render([variant('local', [], { gameBananaId: undefined, thumbnailUrl: first })]);
        await openImageMenu(0); await click(item('common.actions.remove'));
        expect(document.querySelector('[role="alert"]')?.textContent).toBe('Disk full');
        expect(document.querySelector<HTMLImageElement>('[aria-label="installed.batchImport.gallery"] img')?.src).toBe(first);
    });

    it('uses a thumbnail context action to select the card image through gallery order', async () => {
        const images = ['data:image/png;base64,first', 'data:image/png;base64,second'];
        props = { ...props, onGalleryChange: vi.fn(async () => {}) };
        vi.mocked(getLocalModGallery).mockResolvedValue(images);
        await render([variant('local', [], { localGroupId: 'artwork' })]);
        await openImageMenu(1);
        expect(item('imageContextMenu.copyImage')).toBeDefined();
        expect(item('imageContextMenu.copyImageAddress')).toBeDefined();
        await click(item('variantPicker.makeCardThumbnail'));
        expect(props.onGalleryChange).toHaveBeenCalledExactlyOnceWith([images[1], images[0]]);
        expect(document.querySelector<HTMLImageElement>('[aria-label="installed.batchImport.gallery"] img')?.src).toBe(images[1]);
        expect(document.querySelector('[aria-label="installed.batchImport.gallery"] .outline-accent')).toBeNull();
    });

    it('leaves keyboard focus inside a portaled thumbnail menu', async () => {
        props = { ...props, onGalleryChange: vi.fn(async () => {}) };
        await render([variant('local', [], { gameBananaId: undefined, thumbnailUrl: 'data:image/png;base64,first' })]);
        await openImageMenu(0);
        const remove = item('common.actions.remove');
        await act(async () => remove.focus());
        await act(async () => remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
        expect(document.activeElement?.closest('[role="menu"]')).not.toBeNull();
    });

    it('toggles NSFW for the whole mod and reflects the persisted flags', async () => {
        props = { ...props, onNsfwChange: vi.fn(async () => {}) };
        const mods = [variant('first', [], { localGroupId: 'local' }), variant('second', [], { localGroupId: 'local' })];
        await render(mods); await openActions();
        const toggle = () => document.querySelector<HTMLElement>('[role="menuitemcheckbox"]')!;
        expect(toggle().getAttribute('aria-checked')).toBe('false');
        await click(toggle()); expect(props.onNsfwChange).toHaveBeenLastCalledWith(true);
        await render(mods.map(mod => ({ ...mod, nsfw: true })));
        expect(toggle().getAttribute('aria-checked')).toBe('true');
        await click(toggle()); expect(props.onNsfwChange).toHaveBeenLastCalledWith(false);
    });

    it('omits the actions menu for non-local mods even when given an NSFW callback', async () => {
        props = { ...props, onNsfwChange: vi.fn(async () => {}) };
        await render([variant('remote')]);
        expect(document.querySelector('[aria-label="installed.card.moreActions"]')).toBeNull();
    });

    it('renames local mods from the title once and lets Escape cancel without closing', async () => {
        let finish!: () => void;
        props = { ...props, onRenameMod: vi.fn(() => new Promise<void>(resolve => { finish = resolve; })) };
        const mods = [variant('local', [], { gameBananaId: undefined })];
        await render(mods);
        const title = () => document.querySelector<HTMLButtonElement>('[title="variantPicker.renameMod"]')!;
        await click(title());
        const input = () => document.querySelector<HTMLSpanElement>('[aria-label="variantPicker.renameMod"]')!;
        expect(document.activeElement).toBe(input());
        expect(window.getSelection()?.isCollapsed).toBe(true);
        expect(input().tagName).toBe('SPAN');
        await act(async () => {
            input().textContent = 'New name';
            input().dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
        expect(props.onRenameMod).toHaveBeenCalledExactlyOnceWith('New name');
        await act(async () => finish());
        props = { ...props, modName: 'New name' };
        await render(mods.map(mod => ({ ...mod, name: 'New name' })));
        expect(title().textContent).toBe('New name');
        await click(title());
        await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
        expect(props.onRenameMod).toHaveBeenCalledOnce();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(title().textContent).toBe('New name');
    });

    it('keeps the completed gallery write when a late thumbnail read returns', async () => {
        const first = 'data:image/png;base64,first'; const second = 'data:image/png;base64,second';
        let finishSave!: () => void; let finishRead!: (images: string[]) => void;
        props = { ...props, onGalleryChange: vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; })) };
        vi.mocked(getLocalModGallery).mockResolvedValue([first, second]);
        await render([variant('local', [], { localGroupId: 'artwork', thumbnailUrl: first })]);
        await openImageMenu(0); await click(item('common.actions.remove'));
        vi.mocked(getLocalModGallery).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        await render([variant('local', [], { localGroupId: 'artwork', thumbnailUrl: second })]);
        await act(async () => finishSave());
        await act(async () => finishRead([first, second]));
        const images = [...document.querySelectorAll<HTMLImageElement>('[aria-label="installed.batchImport.gallery"] img')];
        expect(images.map(image => image.src)).toEqual([second]);
    });

    it('accepts the minted group identity when saving the first artwork on a standalone file', async () => {
        const image = 'data:image/png;base64,new';
        let finishSave!: () => void; let finishRead!: (images: string[]) => void;
        props = { ...props, onGalleryChange: vi.fn(() => new Promise<void>(resolve => { finishSave = resolve; })) };
        await render([variant('local', [], { gameBananaId: undefined })]);
        vi.mocked(showOpenDialogMulti).mockResolvedValue(['/new.png']);
        vi.mocked(readImageDataUrl).mockResolvedValue(image);
        await openActions(); await click(item('variantPicker.addImages'));
        vi.mocked(getLocalModGallery).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
        await render([variant('local', [], { gameBananaId: undefined, localGroupId: 'minted', thumbnailUrl: image, hasLocalGallery: true })]);
        await act(async () => finishSave());
        await act(async () => finishRead([]));
        expect(document.querySelector<HTMLImageElement>('[aria-label="installed.batchImport.gallery"] img')?.src).toBe(image);
        await openImageMenu(0);
        expect(item('common.actions.remove').hasAttribute('data-disabled')).toBe(false);
    });

    it('closes an open NSFW viewer when privacy settings change and does not reopen it', async () => {
        const settings = { nsfwContentMode: 'show', revealNsfwOnHover: false } as AppSettings;
        props = { ...props, onGalleryChange: vi.fn(async () => {}) };
        useAppStore.setState({ settings });
        await render([variant('local', [], { gameBananaId: undefined, nsfw: true, thumbnailUrl: 'data:image/png;base64,nsfw' })]);
        await click(document.querySelector<HTMLButtonElement>('[aria-label="modDetails.images.viewFullSize"]')!);
        expect(document.querySelector('[aria-label="modDetails.images.fullSizeAria"]')).not.toBeNull();
        await act(async () => useAppStore.setState({ settings: { ...settings, nsfwContentMode: 'blur' } }));
        expect(document.querySelector('[aria-label="modDetails.images.fullSizeAria"]')).toBeNull();
        await act(async () => useAppStore.setState({ settings }));
        expect(document.querySelector('[aria-label="modDetails.images.fullSizeAria"]')).toBeNull();
    });

    it('uses the shared full-screen viewer and closes it before the picker on Escape', async () => {
        const images = ['data:image/png;base64,first', 'data:image/png;base64,second'];
        vi.mocked(getLocalModGallery).mockResolvedValue(images);
        await render([variant('local', [], { localGroupId: 'artwork' })]);
        await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="modDetails.images.viewFullSize"]')!.click());
        const viewer = () => document.querySelector<HTMLElement>('[aria-label="modDetails.images.fullSizeAria"]');
        expect(viewer()?.className).toContain('fixed inset-0');
        expect(viewer()?.querySelector('.modal-panel')).toBeNull();
        const overlay = viewer();
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true })));
        expect(viewer()).toBe(overlay);
        expect(viewer()?.querySelector<HTMLImageElement>('[data-lightbox-viewport] img')?.src).toBe(images[1]);
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
        expect(viewer()).toBeNull();
        expect(props.onClose).not.toHaveBeenCalled();
        await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
        expect(props.onClose).toHaveBeenCalledOnce();
    });

    it('asks once across row changes and asks again after the picker is reopened', async () => {
        const variants = [variant('first', [], { enabled: false }), variant('second', [], { enabled: false })];
        useRequirementsStore.getState().remember({ id: 1, section: 'Sound' }, {
            status: 'loaded', checkedAt: 1, items: [{ name: 'Base', importance: 'required', state: 'on' }],
        });
        props = { ...props, onToggle: async (target, session) =>
            (await requestRequirementToggle(target, true, variants, false, session)) !== 'cancel' };
        const click = async (index: number) => act(async () => {
            document.querySelectorAll<HTMLButtonElement>('button[aria-pressed="false"]')[index].click();
        });
        await render(variants);
        await click(0);
        expect(useRequirementsStore.getState().toggleReview?.mod.id).toBe('first');
        await act(async () => useRequirementsStore.getState().finishToggle('only'));
        await render(variants.map(mod => ({ ...mod, priority: 2 })));
        await click(1);
        expect(useRequirementsStore.getState().toggleReview).toBeNull();
        await act(async () => root.render(null));
        await render(variants);
        await click(0);
        expect(useRequirementsStore.getState().toggleReview?.mod.id).toBe('first');
        await act(async () => useRequirementsStore.getState().finishToggle());
    });

    it('shows the same hero icons in the drag preview', async () => {
        await render([variant('first', ['Haze', 'Wraith']), variant('second', ['Wraith'])]);
        await act(async () => {
            const draggable = row('first') as HTMLElement;
            draggable.focus();
            draggable.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
        });
        const overlay = document.querySelector('[style*="z-index: 60"]');
        expect(overlay).not.toBeNull();
        expect([...overlay!.querySelectorAll<HTMLImageElement>('img[src*="chip-icons"]')]
            .map(image => image.getAttribute('src')?.split('/').at(-1)).sort()).toEqual(['haze.png', 'wraith.png']);
    });
});
