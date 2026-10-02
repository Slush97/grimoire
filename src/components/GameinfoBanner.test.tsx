// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameinfoBanner from './GameinfoBanner';
import { useGameinfoStore } from '../stores/gameinfoStore';
import { useToastStore } from '../stores/toastStore';
import type { GameinfoStatus, PerformanceConfigStatus } from '../types/electron';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const OK: GameinfoStatus = { configured: true, reason: 'ok', message: 'ok', missing: false, candidates: [] };
const MODS_OFF: GameinfoStatus = {
  configured: false,
  reason: 'mods-not-loaded',
  message: 'Addon search paths are missing from gameinfo.gi',
  missing: false,
  candidates: [],
};
const PERF_ON: PerformanceConfigStatus = {
  state: 'applied',
  appliedPresetId: 'sqooky-default',
  appliedVersion: '2.9',
  bundledVersion: '2.9',
  message: '',
};
const PERF_WIPED: PerformanceConfigStatus = { ...PERF_ON, state: 'wiped', appliedVersion: null };

describe('GameinfoBanner', () => {
  let host: HTMLDivElement;
  let root: Root;
  let gameinfo: GameinfoStatus;
  let perf: PerformanceConfigStatus;
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    gameinfo = OK;
    perf = PERF_ON;
    api = {
      getGameinfoStatus: vi.fn(async () => gameinfo),
      getPerformanceConfigStatus: vi.fn(async () => perf),
      fixGameinfo: vi.fn(async () => {
        gameinfo = OK;
        return gameinfo;
      }),
      reapplyWipedPerformanceConfig: vi.fn(async () => {
        perf = PERF_ON;
        return perf;
      }),
    };
    window.electronAPI = api as unknown as Window['electronAPI'];
    useGameinfoStore.setState({ gameinfo: null, perfWiped: false, fixing: false });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function flush() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function render() {
    await act(async () => {
      await useGameinfoStore.getState().refresh();
    });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <GameinfoBanner />
        </MemoryRouter>
      );
    });
    await flush();
  }

  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
    await flush();
  }

  it('stays hidden when everything is fine', async () => {
    await render();
    expect(host.textContent).toBe('');
  });

  it('says mods are not loading in plain words, keeping the file detail as a tooltip', async () => {
    gameinfo = MODS_OFF;
    await render();
    expect(host.textContent).toContain('layout.gameinfo.modsOff');
    expect(host.textContent).not.toContain('gameinfo.gi');
    expect(host.querySelector('p')?.getAttribute('title')).toBe(MODS_OFF.message);
    expect(button('layout.fixNow')).toBeTruthy();
  });

  it('mentions the performance config when the same update removed it', async () => {
    gameinfo = MODS_OFF;
    perf = PERF_WIPED;
    await render();
    expect(host.textContent).toContain('layout.gameinfo.modsAndPerfOff');
  });

  it('leaves a performance config taken out of a file that still loads mods to the settings card', async () => {
    perf = PERF_WIPED;
    await render();
    expect(host.textContent).toBe('');
    expect(useGameinfoStore.getState().perfWiped).toBe(false);
  });

  it('ignores a damaged file the performance card handles with its own backup restore', async () => {
    perf = { ...PERF_WIPED, canRestoreBackup: true };
    await render();
    expect(host.textContent).toBe('');
  });

  it('offers no fix when the file cannot be found', async () => {
    gameinfo = { ...MODS_OFF, reason: 'not-found', missing: true };
    await render();
    expect(host.textContent).toContain('layout.gameinfo.notFound');
    expect(button('layout.fixNow')).toBeUndefined();
    expect(button('layout.openSettings')).toBeTruthy();
  });

  it('repairs mods and restores the performance config with one click', async () => {
    gameinfo = MODS_OFF;
    perf = PERF_WIPED;
    await render();
    await click(button('layout.fixNow'));
    expect(api.fixGameinfo).toHaveBeenCalled();
    expect(api.reapplyWipedPerformanceConfig).toHaveBeenCalled();
    expect(host.textContent).toBe('');
    expect(useToastStore.getState().toasts.map((t) => t.message)).toContain('layout.perfRestored');
  });

  it('does not touch the performance config when the mod repair fails', async () => {
    gameinfo = MODS_OFF;
    perf = PERF_WIPED;
    api.fixGameinfo.mockImplementation(async () => ({ ...MODS_OFF, reason: 'unrepairable' }));
    await render();
    await click(button('layout.fixNow'));
    expect(api.reapplyWipedPerformanceConfig).not.toHaveBeenCalled();
    expect(host.textContent).toContain('layout.gameinfo.unrepairable');
  });

  it('clears itself when something else fixed the problem', async () => {
    gameinfo = MODS_OFF;
    perf = PERF_WIPED;
    await render();
    gameinfo = OK;
    perf = PERF_ON;
    await act(async () => {
      await useGameinfoStore.getState().recheck();
    });
    await flush();
    expect(host.textContent).toBe('');
  });

  it('re-checks when the window regains focus', async () => {
    await render();
    gameinfo = MODS_OFF;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(host.textContent).toContain('layout.gameinfo.modsOff');
  });

  it('never re-checks before the startup check, so a fresh install is not flagged', async () => {
    await act(async () => {
      await useGameinfoStore.getState().recheck();
    });
    expect(api.getGameinfoStatus).not.toHaveBeenCalled();
  });

  it('hides until a different problem appears', async () => {
    gameinfo = MODS_OFF;
    await render();
    await click(host.querySelector('button[aria-label="layout.hideGameinfoBanner"]'));
    expect(host.textContent).toBe('');
    perf = PERF_WIPED;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(host.textContent).toContain('layout.gameinfo.modsAndPerfOff');
  });
});
