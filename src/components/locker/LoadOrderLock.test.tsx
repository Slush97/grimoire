// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariantPickerModal from '../VariantPickerModal';
import { SkinLoadOrderStrip } from './HeroSkinsPanel';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';
import { isGameRunningModLockError, isModLoadedInGame, isReorderBlocked } from '../../lib/modLocks';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const mod = (id: string, priority: number, gameBananaId = priority): Mod => ({
  id, name: id, fileName: `${id}_dir.vpk`, path: `/addons/${id}_dir.vpk`, metaKey: `${id}_dir.vpk`,
  enabled: true, priority, gameBananaId, size: 100, installedAt: '2026-10-23T00:00:00Z',
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useAppStore.getState().setLoadedGameModIds(['loaded']);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useAppStore.getState().setLoadedGameModIds([]);
  vi.unstubAllGlobals();
});

describe('loaded mod order controls', () => {
  it.each([
    [0, 3, true], [3, 0, true], [1, 2, true], [2, 1, true],
    [2, 3, false], [3, 2, false], [1, 1, false],
  ])('checks all affected positions when moving %i to %i', (from, to, blocked) => {
    const mods = [mod('later-a', 1), mod('loaded', 2), mod('later-b', 3), mod('later-c', 4)];
    expect(isReorderBlocked(mods, from, to, (item) => isModLoadedInGame(item, useAppStore.getState().loadedGameModIds)))
      .toBe(blocked);
  });

  it.each([
    [new Error("Error invoking remote method 'disable-mod': Error: Game is running"), true],
    ['Vanilla launch in progress', true],
    [new Error('Mod not found'), false],
  ])('recognizes lock errors across IPC: %s', (error, blocked) => {
    expect(isGameRunningModLockError(error)).toBe(blocked);
  });

  it('locks variant dragging and arrows while retaining toggles and later-enabled moves', async () => {
    const onMoveVariant = vi.fn();
    await act(async () => root.render(<VariantPickerModal modName="Variants"
      variants={[mod('loaded', 1), mod('later-b', 2), mod('later-c', 3)]}
      onToggle={vi.fn()} onMoveVariant={onMoveVariant} onReorderVariantTo={vi.fn()}
      onDeleteVariant={vi.fn()} onRenameVariant={vi.fn()} onClose={vi.fn()} />));

    const rows = () => [...document.querySelectorAll<HTMLElement>('[aria-roledescription="sortable"]')];
    const up = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="variantPicker.moveFileUp"]')];
    const down = () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="variantPicker.moveFileDown"]')];
    expect(rows().map(row => row.getAttribute('aria-disabled'))).toEqual(['true', 'false', 'false']);
    expect(up()[1].disabled).toBe(true);
    expect(down()[0].disabled).toBe(true);
    expect(down()[1].disabled).toBe(false);
    expect(document.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!.disabled).toBe(false);
    await act(async () => down()[0].click());
    expect(onMoveVariant).not.toHaveBeenCalled();
    await act(async () => down()[1].click());
    expect(onMoveVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'later-b' }), 'down');

    await act(async () => useAppStore.getState().setLoadedGameModIds([]));
    expect(rows().every(row => row.getAttribute('aria-disabled') === 'false')).toBe(true);
    expect(down()[0].disabled).toBe(false);
    expect(up()[1].disabled).toBe(false);
  });

  it('locks a Locker group when one variant was loaded, and unlocks it after exit', async () => {
    await act(async () => root.render(<SkinLoadOrderStrip
      mods={[mod('loaded', 1, 1), mod('later-variant', 2, 1), mod('later-group', 3, 2)]}
      onReorder={vi.fn()} />));
    const rows = () => [...host.querySelectorAll<HTMLElement>('[aria-label="locker.skins.dragToReorder"]')];
    expect(rows()).toHaveLength(2);
    expect(rows().map(row => row.getAttribute('aria-disabled'))).toEqual(['true', 'false']);
    expect(rows()[0].hasAttribute('tabindex')).toBe(false);

    await act(async () => useAppStore.getState().setLoadedGameModIds([]));
    expect(rows().every(row => row.getAttribute('aria-disabled') === 'false')).toBe(true);
    expect(rows()[0].tabIndex).toBe(0);
  });

  it('keeps identical status polls from publishing new shared state', () => {
    const before = useAppStore.getState();
    before.setLoadedGameModIds(['loaded', 'loaded']);
    expect(useAppStore.getState()).toBe(before);
    before.setLoadedGameModIds([]);
    expect(useAppStore.getState().loadedGameModIds.size).toBe(0);
  });
});
