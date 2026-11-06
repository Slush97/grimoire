// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledFilterMenu, type InstalledSourceFilter, type InstalledStatusFilter } from './InstalledFilterMenu';
import type { InstalledSortMode } from '../../lib/installedSort';
import type { InstalledListView } from '../../lib/installedListGroups';
import soulUrn from '../../assets/soul-urn.png';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('Installed filter menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  const changed = { source: vi.fn(), status: vi.fn(), hero: vi.fn(), sort: vi.fn(), view: vi.fn(), reset: vi.fn(), manage: vi.fn() };
  const heroes = ['Abrams', 'Haze', 'Baba', 'Bebop', 'Calico', 'Drifter', 'Dynamo', 'Ivy', 'Paradox'];
  function Harness({ emptyLists = false, selectedHeroes = [] }: { emptyLists?: boolean; selectedHeroes?: string[] } = {}) {
    const [sort, setSort] = useState<InstalledSortMode>('priority');
    const [view, setView] = useState<InstalledListView>('all');
    const [sourceSel, setSourceSel] = useState<InstalledSourceFilter[]>(['gamebanana', 'local']);
    const [statusSel, setStatusSel] = useState<InstalledStatusFilter[]>(['enabled', 'disabled']);
    const [hero, setHero] = useState<string[]>(selectedHeroes);
    const [tags, setTags] = useState<string[]>([]);
    const [excluded, setExcluded] = useState<string[]>([]);
    const [lists, setLists] = useState<string[]>([]);
    return <InstalledFilterMenu sortMode={sort} onSortModeChange={next => { changed.sort(next); setSort(next); }}
      view={view} onViewChange={next => { changed.view(next); setView(next); }}
      sourceSel={sourceSel} sourceCounts={{ gamebanana: 20, local: 2 }}
      onSourceChange={next => { changed.source(next); setSourceSel(next); }}
      statusSel={statusSel} statusCounts={{ enabled: 4, disabled: 18 }}
      onStatusChange={next => { changed.status(next); setStatusSel(next); }}
      heroFilter={hero} heroOptions={heroes.map((name, index) => ({ name, count: index === 0 ? 2 : 1 }))}
      onHeroChange={next => { changed.hero(next); setHero(next); }}
      tagFilter={tags} tagOptions={[{ key: 'hud', label: 'HUD', count: 3 }]} onTagChange={setTags}
      excludedTagFilter={excluded} onExcludedTagChange={setExcluded} onCreateTag={vi.fn()} onRenameTag={vi.fn()} onDeleteTag={vi.fn()}
      listFilter={lists} listOptions={emptyLists ? [] : [{ key: 'empty', label: 'Empty list', count: 0 }]} onListChange={setLists}
      onManageLists={changed.manage}
      active={view !== 'all' || sourceSel.length !== 2 || statusSel.length !== 2 || hero.length > 0 || tags.length > 0 || excluded.length > 0 || lists.length > 0}
      onReset={() => {
        changed.reset(); setSourceSel(['gamebanana', 'local']); setStatusSel(['enabled', 'disabled']);
        setHero([]); setTags([]); setExcluded([]); setLists([]); setView('all');
      }} />;
  }
  const trigger = () => host.querySelector<HTMLButtonElement>('button')!;
  const panel = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
  const group = (name: string) => panel().querySelector<HTMLElement>(`[role="tablist"][aria-label="installed.filters.${name}"]`)!;
  const tabs = (name: string) => [...group(name).querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const button = (label: string) => [...panel().querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<Harness />));
    act(() => trigger().click());
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('preserves empty Source and Status selections and separates keyboard focus from selection', () => {
    act(() => tabs('source')[0].click());
    act(() => tabs('source')[1].click());
    expect(changed.source).toHaveBeenLastCalledWith([]);
    expect(tabs('source').map(tab => tab.getAttribute('aria-selected'))).toEqual(['false', 'false']);
    act(() => tabs('status')[0].click());
    act(() => tabs('status')[1].click());
    expect(changed.status).toHaveBeenLastCalledWith([]);
    const before = changed.source.mock.calls.length;
    act(() => {
      tabs('source')[0].focus();
      tabs('source')[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs('source')[1]);
    expect(changed.source).toHaveBeenCalledTimes(before);
    act(() => button('browse.filters.clearAll').click());
    expect(changed.reset).toHaveBeenCalledOnce();
    expect(tabs('source').every(tab => tab.getAttribute('aria-selected') === 'true')).toBe(true);
    expect(tabs('status').every(tab => tab.getAttribute('aria-selected') === 'true')).toBe(true);
  });

  it('keeps all five sorts embedded without closing the filter panel', () => {
    const radios = [...panel().querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map(radio => radio.value)).toEqual(['priority', 'name', 'hero', 'recent', 'size']);
    expect(radios.map(radio => radio.parentElement?.textContent)).toEqual([
      'installed.sort.loadOrder', 'installed.sort.nameAZ', 'installed.sort.heroAZ', 'installed.sort.recentlyAdded', 'installed.sort.sizeLargest',
    ]);
    expect(new Set(radios.map(radio => radio.name)).size).toBe(1);
    act(() => radios[3].click());
    expect(changed.sort).toHaveBeenCalledExactlyOnceWith('recent');
    expect(radios[3].checked).toBe(true);
    expect(radios[3].parentElement?.className).toContain('bg-bg-tertiary');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().className).toContain('bg-bg-secondary');
    expect(button('browse.filters.clearAll')).toBeUndefined();
    act(() => tabs('source')[0].click());
    expect(trigger().className).toContain('border-accent/40');
    act(() => button('browse.filters.clearAll').click());
    expect(radios[3].checked).toBe(true);
    expect(trigger().className).toContain('bg-bg-secondary');
    expect(button('browse.filters.clearAll')).toBeUndefined();
  });

  it('combines Default/Lists modes with list filtering and management', () => {
    const modes = [...panel().querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="installed.lists.view"] [role="tab"]')];
    expect(modes.map(mode => mode.textContent)).toEqual(['installed.lists.defaultView', 'installed.lists.viewLists']);
    act(() => modes[1].click());
    expect(changed.view).toHaveBeenCalledExactlyOnceWith('lists');
    expect(modes.map(mode => mode.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(modes[1].className).toContain('bg-bg-tertiary');
    expect(modes[1].className).not.toContain('bg-accent/15');
    act(() => modes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement).toBe(modes[0]);
    act(() => modes[0].click());
    expect(changed.view).toHaveBeenLastCalledWith('all');
    const checks = [...panel().querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
    expect(checks.map(check => check.textContent)).toEqual(['Empty list0']);
    act(() => checks[0].click());
    expect(checks.every(check => check.getAttribute('aria-checked') === 'true')).toBe(true);
    act(() => button('installed.lists.manage').click());
    expect(changed.manage).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the mode picker and Manage action reachable when there are no saved lists', () => {
    act(() => root.render(<Harness emptyLists />));
    const modes = [...panel().querySelectorAll<HTMLButtonElement>('[role="tablist"][aria-label="installed.lists.view"] [role="tab"]')];
    expect(modes).toHaveLength(2);
    expect(panel().querySelector('[role="checkbox"]')).toBeNull();
    act(() => button('installed.lists.manage').click());
    expect(changed.manage).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('uses neutral active colors for the Source and Status tablists', () => {
    for (const name of ['source', 'status']) for (const tab of tabs(name)) {
      expect(tab.className).toContain('bg-bg-tertiary');
      expect(tab.className).not.toContain('bg-accent/15');
    }
  });

  it.each([2, 8, 9])('fits %i selected hero icons into the shared 66px stack', count => {
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(<Harness selectedHeroes={heroes.slice(0, count)} />));
    act(() => trigger().click());
    const heroTrigger = panel().querySelector<HTMLButtonElement>('[aria-label="browse.filters.filterByHero"]')!;
    const stack = heroTrigger.querySelector<HTMLElement>('[data-hero-stack]')!;
    const images = [...stack.querySelectorAll<HTMLImageElement>('img')];
    expect(stack.style.width).toBe(`${Math.min(66, count * 22)}px`);
    expect(stack.title).toBe(heroes.slice(0, count).join(', '));
    expect(images.filter(image => image.getAttribute('src') !== soulUrn)).toHaveLength(count > 8 ? 7 : count);
    expect(images.filter(image => image.getAttribute('src') === soulUrn)).toHaveLength(count > 8 ? 1 : 0);
    expect(heroTrigger.textContent).toContain('installed.filters.heroCount');
  });

  it('keeps the outer popover open through portaled hero selection and closes on Escape', () => {
    const heroTrigger = panel().querySelector<HTMLButtonElement>('[aria-label="browse.filters.filterByHero"]')!;
    act(() => heroTrigger.click());
    const abrams = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent === 'Abrams (2)')!;
    act(() => { abrams.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); abrams.click(); });
    expect(changed.hero).toHaveBeenLastCalledWith(['Abrams']);
    expect(panel()).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const haze = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(option => option.textContent === 'Haze (1)')!;
    act(() => haze.click());
    expect(changed.hero).toHaveBeenLastCalledWith(['Abrams', 'Haze']);
    expect(heroTrigger.className).toContain('border-accent/40');
    expect(trigger().className).toContain('border-accent/40');
    act(() => haze.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(panel()).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
