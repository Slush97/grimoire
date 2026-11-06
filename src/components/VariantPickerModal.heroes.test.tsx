// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariantPickerModal from './VariantPickerModal';
import type { Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { useCategoryStore } from '../stores/categoryStore';
import { buildCategoryPaths } from '../lib/categoryPaths';
import { requestRequirementToggle, useRequirementsStore } from '../stores/requirementsStore';

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
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
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        useAppStore.getState().setLoadedGameModIds([]);
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
        expect(heroIcons('first')).toEqual(['haze.png', 'wraith.png']);
        expect(heroIcons('second')).toEqual(['wraith.png']);
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
            .map(image => image.getAttribute('src')?.split('/').at(-1))).toEqual(['haze.png', 'wraith.png']);
    });
});
