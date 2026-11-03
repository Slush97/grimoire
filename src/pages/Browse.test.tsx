// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameBananaMod, GameBananaModDetails, GameBananaModsResponse } from '../types/gamebanana';
import type { AppSettings } from '../types/mod';
import type { SyncProgressData as SyncProgress } from '../types/electron';

vi.hoisted(() => Object.assign(window, { AnimationEvent: window.Event, electronAPI: { social: { onSessionChanged: () => () => {} } } }));
vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../lib/api', async original => ({ ...await original<typeof import('../lib/api')>(),
  browseMods: vi.fn(), getModDetails: vi.fn(), getGamebananaSections: vi.fn(), getGamebananaCategories: vi.fn(),
}));
vi.mock('../lib/downloadActivity', async original => {
  const activity = { current: null, queue: [], requested: [] };
  return { ...await original<typeof import('../lib/downloadActivity')>(), useDownloadQueueActivity: () => activity };
});
vi.mock('../components/ModDetailsModal', () => ({ default: ({ mod, onClose }: { mod: GameBananaModDetails; onClose: () => void }) =>
  <div role="dialog">{mod.name}<button onClick={onClose}>Close</button></div> }));
vi.mock('../components/browse/BrowseVirtualGrid', () => ({
  BrowseVirtualGrid: ({ mods, onModClick, initialScrollOffset }: { mods: GameBananaMod[]; onModClick: (mod: GameBananaMod) => void; initialScrollOffset: number }) =>
    <div data-grid data-offset={initialScrollOffset}>{mods.map(mod => <button key={`${mod.section}:${mod.id}`} onClick={() => onModClick(mod)}>{mod.name}</button>)}</div>,
  BrowseLoadMore: ({ paused, loading, hasMore, onLoadMore, children }: { paused: boolean; loading: boolean; hasMore: boolean; onLoadMore: () => void; children: React.ReactNode }) =>
    <div><button data-more disabled={paused || loading || !hasMore} onClick={onLoadMore}>More</button>{children}</div>,
}));

import Browse from './Browse';
import { browseMods, getModDetails, getGamebananaSections, getGamebananaCategories } from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useCategoryStore } from '../stores/categoryStore';

const mod = (id: number, extra: Partial<GameBananaMod> = {}): GameBananaMod => ({
  id, section: 'Mod', name: `Mod ${id}`, profileUrl: '', dateAdded: 1, dateModified: 2, hasFiles: true,
  nsfw: false, likeCount: 0, viewCount: 0, ...extra,
});
const response = (records = [mod(1), mod(2)], perPage = 50): GameBananaModsResponse => ({ records, perPage, totalCount: 127, isComplete: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('Browse navigation and refresh', () => {
  let root: Root;
  let host: HTMLDivElement;
  let localCount: number;
  let listeners: Set<(progress: SyncProgress) => void>;
  const localSearch = vi.fn();
  const refreshHead = vi.fn();
  const render = () => act(async () => root.render(<MemoryRouter><Browse /></MemoryRouter>));
  const more = () => host.querySelector<HTMLButtonElement>('[data-more]')!;
  const click = (button: HTMLButtonElement) => act(async () => button.click());
  const gridNames = () => Array.from(host.querySelectorAll('[data-grid] button')).map(button => button.textContent);
  const refreshButton = () => host.querySelector<HTMLButtonElement>('[title="browse.refreshFromGameBanana"]')!;
  const search = async (query: string) => {
    await act(async () => useAppStore.getState().setBrowseUi({ search: query }));
    await act(async () => { vi.advanceTimersByTime(260); });
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    vi.mocked(browseMods).mockReset().mockResolvedValue(response());
    vi.mocked(getModDetails).mockReset();
    vi.mocked(getGamebananaSections).mockResolvedValue([{ pluralTitle: 'Mods', modelName: 'Mod', categoryModelName: 'ModCategory', itemCount: 127 }]);
    vi.mocked(getGamebananaCategories).mockResolvedValue([]);
    localCount = 0;
    listeners = new Set();
    localSearch.mockReset().mockResolvedValue({ mods: [], totalCount: 0 });
    refreshHead.mockReset().mockResolvedValue({ success: true });
    Object.assign(window, { electronAPI: {
      getLocalModCount: async () => localCount,
      getSyncStatus: async () => ({ Mod: { lastSync: 1 } }),
      isSyncInProgress: async () => false,
      onSyncProgress: (callback: (progress: SyncProgress) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
      getModsNsfwStatus: async () => ({}),
      getCursorPacks: async () => ({ packs: [], activeId: null }),
      onDownloadComplete: () => () => {},
      searchLocalMods: localSearch, refreshCatalogHead: refreshHead,
    } });
    useAppStore.setState({ browseSession: null, browseUi: useAppStore.getInitialState().browseUi,
      settings: { deadlockPath: '/game', nsfwContentMode: 'blur', hiddenCreators: [], hiddenMods: [] } as unknown as AppSettings,
      mods: [], modsLoaded: true, loadMods: async () => {},
    });
    useCategoryStore.setState({ treesByModel: {} });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.useRealTimers(); vi.unstubAllGlobals();
  });

  it('restarts with local page one when a remote search gains a usable catalog', async () => {
    vi.mocked(browseMods).mockResolvedValue(response([mod(1)], 15));
    await render(); await search('haze'); await click(more());
    expect(vi.mocked(browseMods).mock.calls.at(-1)?.[0]).toBe(2);
    await act(async () => {
      localCount = 1000;
      for (const listener of listeners) listener({ phase: 'complete', section: 'Mod' } as SyncProgress);
    });
    expect(localSearch.mock.calls.at(-1)?.[0]).toMatchObject({ offset: 0, limit: 50 });
    expect(gridNames()).toEqual([]);
  });

  it('continues past a fully hidden first remote page', async () => {
    useAppStore.setState(state => ({ settings: { ...state.settings!, hiddenCreators: [{ id: 1, name: 'Hidden' }] } }));
    vi.mocked(browseMods).mockResolvedValueOnce(response([mod(1, { submitter: { id: 1, name: 'Hidden' } })]))
      .mockResolvedValueOnce(response([mod(2)]));
    await render(); expect(gridNames()).toEqual([]); expect(more().disabled).toBe(false);
    await click(more()); expect(gridNames()).toEqual(['Mod 2']);
  });

  it('saves the completed search identity when leaving during debounce', async () => {
    await render();
    await act(async () => useAppStore.getState().setBrowseUi({ search: 'haze' }));
    await act(async () => { vi.advanceTimersByTime(80); });
    await act(async () => root.render(null));
    expect(useAppStore.getState().browseSession?.stamp).not.toContain('|haze|');
    await render();
    expect(vi.mocked(browseMods).mock.calls.at(-1)?.[2]).toBe('haze');
  });

  it('passes the saved scroll offset to the virtualizer on a cache hit', async () => {
    await render(); await act(async () => root.render(null));
    useAppStore.setState(state => ({ browseSession: { ...state.browseSession!, scrollTop: 1800 } }));
    await render();
    expect(host.querySelector('[data-grid]')?.getAttribute('data-offset')).toBe('1800');
    expect(browseMods).toHaveBeenCalledOnce();
  });

  it('does not overwrite or reopen details when earlier card requests finish late', async () => {
    const first = deferred<GameBananaModDetails>(); const second = deferred<GameBananaModDetails>();
    vi.mocked(getModDetails).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await render(); const buttons = host.querySelectorAll<HTMLButtonElement>('[data-grid] button');
    await click(buttons[0]); await click(buttons[1]);
    await act(async () => second.resolve({ id: 2, name: 'Second details', nsfw: false }));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Second details');
    await click(host.querySelector<HTMLButtonElement>('[role="dialog"] button')!);
    await act(async () => first.resolve({ id: 1, name: 'Stale details', nsfw: false }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('refreshes remote data with one listing request and spins until that response settles', async () => {
    await render(); const next = deferred<GameBananaModsResponse>();
    vi.mocked(browseMods).mockReturnValueOnce(next.promise);
    await click(refreshButton());
    expect(refreshHead).not.toHaveBeenCalled(); expect(browseMods).toHaveBeenCalledTimes(2);
    expect(refreshButton().disabled).toBe(true);
    expect(refreshButton().querySelector('.browse-refresh-spin')).not.toBeNull();
    await act(async () => next.resolve(response([mod(3)])));
    expect(refreshButton().disabled).toBe(false); expect(gridNames()).toEqual(['Mod 3']);
    // Finish the current revolution before returning to the resting icon.
    await act(async () => refreshButton().querySelector('svg')!.dispatchEvent(new Event('animationiteration', { bubbles: true })));
    expect(refreshButton().querySelector('.browse-refresh-spin')).toBeNull();
  });

  it('awaits selected catalog heads and the replacement local results during refresh', async () => {
    localCount = 1000;
    useAppStore.getState().setBrowseUi({ search: 'haze' });
    await render(); expect(localSearch).toHaveBeenCalledOnce();
    const head = deferred<{ success: boolean }>(); refreshHead.mockReturnValueOnce(head.promise);
    await click(refreshButton());
    expect(refreshHead).toHaveBeenCalledWith(['Mod']); expect(localSearch).toHaveBeenCalledOnce();
    const next = deferred<{ mods: []; totalCount: number }>(); localSearch.mockReturnValueOnce(next.promise);
    await act(async () => head.resolve({ success: true }));
    expect(refreshButton().disabled).toBe(true); expect(localSearch).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve({ mods: [], totalCount: 0 }));
    expect(refreshButton().disabled).toBe(false); expect(browseMods).not.toHaveBeenCalled();
  });
});
