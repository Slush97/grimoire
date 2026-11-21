// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroSkinsPanel from './HeroSkinsPanel';
import HeroSoundPicker from './HeroSoundPicker';
import { applyHeroSound, revertHeroSound } from '../../lib/api';
import { DISABLED_FAVORITES_KEY, modPreferenceKey, readStoredDisabledFavorites, useModFavorites, writeStoredDisabledFavorites } from '../../lib/disabledModPrefs';
import { createStableKeyMigrationPlan, migrateStoredStableKeyPreferences } from '../../lib/stableKeyMigration';
import type { Mod } from '../../types/mod';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('../../lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/api')>(),
  getHeroAbilitySlots: vi.fn(async () => [{ slot: 1, display: 'Ability one' }]),
  getActiveHeroSounds: vi.fn(async () => [{ slot: 1, sourceFileName: 'active.vpk' }]),
  getGameRunningStatus: vi.fn(async () => ({ running: false })),
  applyHeroSound: vi.fn(), revertHeroSound: vi.fn(),
}));

const skinMod = (id: string, gameBananaId: number, enabled = false): Mod => ({
  id, name: id, fileName: `${id}.vpk`, path: `/addons/${id}.vpk`, metaKey: `${id}.vpk`, enabled, priority: gameBananaId, gameBananaId,
  size: 100, installedAt: '2026-11-19T00:00:00Z',
});

describe.each(['cards', 'list'] as const)('Locker favorites in %s', layout => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
  const cards = () => [...host.querySelectorAll<HTMLElement>(layout === 'cards' ? '.group\\/card' : '.group\\/row')];
  const names = () => cards().map(card => card.querySelector(layout === 'cards' ? 'h3' : '.font-medium.truncate')?.textContent);

  it('stars a grouped mod below active mods, persists the Installed key, and never activates or shuffles it', async () => {
    const mods = [skinMod('plain', 1), skinMod('active', 2, true), skinMod('later', 3), skinMod('variant', 3)];
    const onSelect = vi.fn(), onToggleVariant = vi.fn(), onToggleShuffleIncluded = vi.fn();
    await act(async () => root.render(<HeroSkinsPanel mods={mods} onSelect={onSelect}
      onToggleVariant={onToggleVariant} onToggleShuffleIncluded={onToggleShuffleIncluded} showDownloadable={false} layout={layout} />));
    expect(names()).toEqual(['active', 'plain', 'later']);
    await act(async () => cards()[2].querySelector<HTMLButtonElement>('[aria-label="installed.card.favorite"]')!.click());
    expect(names()).toEqual(['active', 'later', 'plain']);
    expect(readStoredDisabledFavorites()).toEqual(new Set([modPreferenceKey(mods[2])]));
    expect(cards()[1].querySelector('[aria-label="installed.card.unfavorite"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(onSelect).not.toHaveBeenCalled(); expect(onToggleVariant).not.toHaveBeenCalled(); expect(onToggleShuffleIncluded).not.toHaveBeenCalled();
    await act(async () => writeStoredDisabledFavorites([]));
    expect(names()).toEqual(['active', 'plain', 'later']);
  });

  it('retains favorites for local groups when their primary variant changes', async () => {
    const first = { ...skinMod('local one', 4), localGroupId: 'shared-group', sha256: 'one' };
    const second = { ...skinMod('local two', 5), localGroupId: 'shared-group', sha256: 'two' };
    writeStoredDisabledFavorites([modPreferenceKey(first)]);
    const render = async (mods: Mod[]) => act(async () => root.render(<HeroSkinsPanel mods={mods} onSelect={vi.fn()} showDownloadable={false} layout={layout} />));
    await render([skinMod('plain', 1), first, second]);
    expect(names()).toEqual(['local one', 'plain']);
    await render([skinMod('plain', 1), first, { ...second, enabled: true }]);
    expect(names()).toEqual(['local two', 'plain']);
    expect(cards()[0].querySelector('[aria-label="installed.card.unfavorite"]')).not.toBeNull();
  });
});

describe('Locker sound favorites', () => {
  const soundMod = (id: string, gameBananaId: number, ability: boolean): Mod => ({
    id, name: id, fileName: `${id}.vpk`, path: `/addons/${id}.vpk`, metaKey: `${id}.vpk`, enabled: id === 'active-other',
    priority: gameBananaId, gameBananaId, size: 100, installedAt: '2026-11-19T00:00:00Z',
    abilitySounds: ability ? {
      dominantHero: 'Ivy', shipsHeroVsndevts: false, abilitySoundFiles: 1, voSoundFiles: 0,
      perHero: [{ hero: 'Ivy', slots: { 1: 1 }, unclassified: 0, voFiles: 0, total: 1 }],
    } : undefined,
  });
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

  it('keeps applied ability sounds and active whole mods ahead of shared favorites without toggling sound playback or application', async () => {
    const onSelect = vi.fn();
    const soundList = [soundMod('plain', 1, true), soundMod('active', 2, true), soundMod('favorite', 3, true),
      soundMod('plain-other', 4, false), soundMod('active-other', 5, false), soundMod('favorite-other', 6, false)];
    await act(async () => root.render(<HeroSoundPicker heroName="Ivy" soundList={soundList} onSelect={onSelect} />));
    const rows = () => [...host.querySelectorAll<HTMLElement>('.group\\/sound')];
    const names = () => rows().map(row => row.querySelector('button[title$=".vpk"]')?.getAttribute('title'));
    expect(names()).toEqual(['active.vpk', 'plain.vpk', 'favorite.vpk', 'active-other.vpk', 'plain-other.vpk', 'favorite-other.vpk']);
    await act(async () => {
      rows()[2].querySelector<HTMLButtonElement>('[aria-label="installed.card.favorite"]')!.click();
      rows()[5].querySelector<HTMLButtonElement>('[aria-label="installed.card.favorite"]')!.click();
    });
    expect(names()).toEqual(['active.vpk', 'favorite.vpk', 'plain.vpk', 'active-other.vpk', 'favorite-other.vpk', 'plain-other.vpk']);
    expect(readStoredDisabledFavorites()).toEqual(new Set(['gamebanana:3', 'gamebanana:6']));
    expect(onSelect).not.toHaveBeenCalled(); expect(applyHeroSound).not.toHaveBeenCalled(); expect(revertHeroSound).not.toHaveBeenCalled();
  });
});

function Consumer({ name }: { name: string }) {
  const { favorites, toggleFavorite } = useModFavorites();
  return <button data-consumer={name} onClick={() => toggleFavorite('sha256:one')}>{[...favorites].join(',')}</button>;
}

describe('shared mod favorites', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    localStorage.clear();
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const buttons = () => [...host.querySelectorAll('button')];
  const render = async () => act(async () => root.render(<StrictMode><Consumer name="installed" /><Consumer name="locker" /></StrictMode>));

  it('loads saved favorites and synchronizes rapid toggles from either mounted consumer', async () => {
    writeStoredDisabledFavorites(['sha256:one']);
    await render();
    expect(buttons().map(button => button.textContent)).toEqual(['sha256:one', 'sha256:one']);
    await act(async () => { buttons()[0].click(); buttons()[1].click(); });
    expect(buttons().map(button => button.textContent)).toEqual(['sha256:one', 'sha256:one']);
    expect(readStoredDisabledFavorites()).toEqual(new Set(['sha256:one']));
    await act(async () => buttons()[1].click());
    expect(buttons().every(button => button.textContent === '')).toBe(true);
  });

  it('follows grouping migrations in both consumers', async () => {
    writeStoredDisabledFavorites(['sha256:one']); await render();
    const before = [{ id: 'one', enabled: false, priority: 1, key: 'sha256:one' }];
    const after = [{ ...before[0], key: 'localgroup:group' }];
    await act(async () => { migrateStoredStableKeyPreferences(createStableKeyMigrationPlan({ before, after, keyOf: item => item.key })); });
    expect(buttons().map(button => button.textContent)).toEqual(['localgroup:group', 'localgroup:group']);
  });

  it('reacts to storage changes and storage being cleared', async () => {
    await render();
    await act(async () => {
      localStorage.setItem(DISABLED_FAVORITES_KEY, '["sha256:one"]');
      window.dispatchEvent(new StorageEvent('storage', { key: DISABLED_FAVORITES_KEY }));
    });
    expect(buttons().every(button => button.textContent === 'sha256:one')).toBe(true);
    await act(async () => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage', { key: null })); });
    expect(buttons().every(button => button.textContent === '')).toBe(true);
  });

  it('keeps mounted consumers synchronized when persistence fails', async () => {
    await render();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    await act(async () => buttons()[0].click());
    expect(buttons().every(button => button.textContent === 'sha256:one')).toBe(true);
    await act(async () => buttons()[1].click());
    expect(buttons().every(button => button.textContent === '')).toBe(true);
  });
});
