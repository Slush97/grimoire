// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCategoryStore } from '../../stores/categoryStore';
import type { GameBananaMod } from '../../types/gamebanana';
import { MemoizedModCard } from './BrowseModCard';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
}));

const layouts = [
  { label: 'classic', viewMode: 'grid', cardDesign: 'classic' },
  { label: 'readable', viewMode: 'grid', cardDesign: 'readable' },
  { label: 'list', viewMode: 'list', cardDesign: 'classic' },
] as const;

const sound = (name: string, extra: Partial<GameBananaMod> = {}): GameBananaMod => ({
  id: 1, name, section: 'Sound', profileUrl: 'https://gamebanana.com/sounds/1',
  dateAdded: 0, dateModified: 0, likeCount: 12, viewCount: 34, hasFiles: true, nsfw: false,
  rootCategory: { name: 'VOs' }, ...extra,
});

describe('Browse Sound hero rendering', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousCategories: ReturnType<typeof useCategoryStore.getState>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }));
    previousCategories = useCategoryStore.getState();
    useCategoryStore.setState({ heroNames: ['Solomon', 'Violet'], pathsByModel: {}, heroByCategoryId: new Map() });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useCategoryStore.setState(previousCategories);
    vi.unstubAllGlobals();
  });

  const render = async (
    layout: typeof layouts[number],
    mod: GameBananaMod,
    extra: Partial<ComponentProps<typeof MemoizedModCard>> = {},
  ) => {
    await act(async () => root.render(<MemoizedModCard
      mod={mod} installed={false} downloading={false} viewMode={layout.viewMode} cardDesign={layout.cardDesign}
      cardSize={320} cardWidth={320} section="Sound" volume={1} onVolumeChange={vi.fn()}
      hideNsfwPreviews={false} isPlaying={false} onPlayingChange={vi.fn()} onClick={vi.fn()} onQuickDownload={vi.fn()}
      {...extra}
    />));
  };
  const portraits = () => [...host.querySelectorAll<HTMLImageElement>('img[src*="/locker/heroes/"]')];
  const heroIcons = () => [...host.querySelectorAll<HTMLImageElement>('img[src*="/heroes/chip-icons/"]')];

  it.each(layouts)('uses a single hero from the current cached roster for the $label Sound portrait and icon', async layout => {
    await render(layout, sound('Violet_voices'));
    expect(portraits().map(image => image.getAttribute('src'))).toEqual(['/locker/heroes/Violet_Render.png']);
    expect(heroIcons().map(image => image.getAttribute('src'))).toEqual(['/heroes/chip-icons/violet.png']);
  });

  it.each(layouts)('shows every matched hero and generic Sound media for the $label multihero card', async layout => {
    const shared = sound('Solomon and Violet voices');
    await render(layout, shared);
    expect(portraits()).toHaveLength(0);
    expect(heroIcons().map(image => image.getAttribute('src'))).toEqual([
      '/heroes/chip-icons/solomon.png', '/heroes/chip-icons/violet.png',
    ]);
    expect(host.querySelector('img:not([src*="chip-icons"])')).toBeNull();
    if (layout.cardDesign === 'readable') {
      expect(host.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('browse.card.audioPreviewAria');
    } else {
      expect(host.textContent).toContain('browse.card.sound');
    }
  });

  it.each(layouts)('keeps the uploader thumbnail for the $label multihero card', async layout => {
    await render(layout, sound('Solomon and Violet voices', { previewMedia: { images: [{
      baseUrl: 'https://images.gamebanana.com/img/ss/sounds', file: 'preview.jpg', file530: '530-90_preview.jpg',
    }] } }));
    expect(portraits()).toHaveLength(0);
    const thumbnail = host.querySelector<HTMLImageElement>('img[src^="https://images.gamebanana.com/"]');
    expect(thumbnail?.getAttribute('src')).toMatch(/\/(?:220-90_|530-90_)?preview\.jpg$/);
    expect(heroIcons()).toHaveLength(2);
  });

  it.each(layouts)('keeps all hero identities accessible for a four-hero $label card', async layout => {
    const heroes = ['Baba', 'Haze', 'Solomon', 'Violet'];
    useCategoryStore.setState({ heroNames: heroes });
    await render(layout, sound(`${heroes.join(' and ')} voices`));
    expect(portraits()).toHaveLength(0);
    if (layout.cardDesign === 'readable') {
      expect(heroIcons().map(image => image.getAttribute('src'))).toEqual(['/heroes/chip-icons/baba.png']);
      const overflow = [...host.querySelectorAll<HTMLElement>('[title]')].find(element => element.textContent === '+3');
      expect(overflow?.title).toBe('Haze\nSolomon\nViolet');
    } else {
      expect(heroIcons().map(image => image.getAttribute('src'))).toEqual(heroes.map(hero => `/heroes/chip-icons/${hero.toLowerCase()}.png`));
    }
  });

  it.each([160, 220])('keeps a three-hero %ipx readable card neutral while exposing the hidden names', async width => {
    useCategoryStore.setState({ heroNames: ['Baba', 'Haze', 'Violet'] });
    await render(layouts[1], sound('Baba, Haze and Violet voices'), { cardWidth: width });
    expect(portraits()).toHaveLength(0);
    expect(heroIcons().map(image => image.getAttribute('src'))).toEqual(['/heroes/chip-icons/baba.png']);
    const overflow = [...host.querySelectorAll<HTMLElement>('[title]')].find(element => element.textContent === '+2');
    expect(overflow?.title).toBe('Haze\nViolet');
  });

  it('updates a memoized card when a hero newer than the bundled roster arrives in the category cache', async () => {
    useCategoryStore.setState({ heroNames: [] });
    await render(layouts[1], sound('Future_Hero voices'));
    expect(portraits()).toHaveLength(0);
    expect(heroIcons()).toHaveLength(0);
    await act(async () => useCategoryStore.setState({ heroNames: ['Future Hero'] }));
    expect(portraits().map(image => image.alt)).toEqual(['Future Hero']);
    expect(heroIcons().map(image => image.getAttribute('src'))).toEqual(['/heroes/chip-icons/future_hero.png']);
  });
});
