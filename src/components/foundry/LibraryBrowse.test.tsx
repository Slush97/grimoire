// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextureCategory, TextureGridItem } from '../../types/foundry';
import { foundryThumbnails } from '../../lib/api';
import LibraryBrowse from './LibraryBrowse';

vi.mock('../../lib/api', () => ({ foundryThumbnails: vi.fn() }));
vi.mock('./TextureLightbox', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }));

const heroNames = new Map([['atlas', 'Abrams'], ['viper', 'Vyper']]);
function item(hero: string | null, label: string, category: TextureCategory): TextureGridItem {
    return { hero, label, category, path: `${label}.vtex_c`, thumbUrl: null };
}
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.mocked(foundryThumbnails).mockImplementation(async (category) => category === 'item-icon'
        ? [item(null, 'Shared item', category)]
        : [item('atlas', 'Abrams art', category), item('viper', 'Vyper art', category)]);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

async function selectCategory(value: TextureCategory) {
    const select = host.querySelector('select');
    if (!select) throw new Error('Category filter missing');
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('Foundry workshop image scope', () => {
    it('ignores a slow result from the previously selected category', async () => {
        let finish!: (items: TextureGridItem[]) => void;
        vi.mocked(foundryThumbnails).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await act(async () => root.render(<LibraryBrowse heroNames={heroNames} />));
        await selectCategory('hero-image');
        expect(host.textContent).toContain('Abrams art');
        await act(async () => finish([item('atlas', 'Stale icon', 'ability-icon')]));
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).not.toContain('Stale icon');
    });
    it('keeps hero art scoped across categories and leaves shared item icons available', async () => {
        await act(async () => root.render(<LibraryBrowse heroNames={heroNames} heroCodename="atlas" />));
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).not.toContain('Vyper art');
        await selectCategory('hero-image');
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).not.toContain('Vyper art');
        await selectCategory('item-icon');
        expect(host.textContent).toContain('Shared item');
        await selectCategory('ability-icon');
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).not.toContain('Vyper art');
    });

    it('follows a different workshop hero without keeping the old selection', async () => {
        await act(async () => root.render(<LibraryBrowse heroNames={heroNames} heroCodename="atlas" />));
        await act(async () => root.render(<LibraryBrowse heroNames={heroNames} heroCodename="viper" />));
        expect(host.textContent).toContain('Vyper art');
        expect(host.textContent).not.toContain('Abrams art');
    });

    it('lets the standalone library browse all heroes and select one', async () => {
        await act(async () => root.render(<LibraryBrowse heroNames={heroNames} />));
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).toContain('Vyper art');
        const select = host.querySelectorAll('select')[1];
        await act(async () => {
            select.value = 'atlas';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect(host.textContent).toContain('Abrams art');
        expect(host.textContent).not.toContain('Vyper art');
    });
});
