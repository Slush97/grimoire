// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PerformanceConfigCard from './PerformanceConfigCard';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { useGameinfoStore } from '../../stores/gameinfoStore';
import type { AppSettings } from '../../types/mod';
import type {
  PerformanceConfigStatus,
  PerformanceLatestInfo,
  PerformanceOptIn,
  PerformancePresetSummary,
} from '../../types/electron';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const OPT_INS: PerformanceOptIn[] = [
  { key: 'citadel_trooper_glow_disabled', value: '1', group: 'visibility' },
  { key: 'citadel_boss_glow_disabled', value: '1', group: 'visibility' },
  { key: 'citadel_camera_fov', value: '100', group: 'camera' },
  { key: 'sv_cheats', value: '1', group: 'devtools' },
];
const CREATOR_DEFAULTS = ['citadel_trooper_glow_disabled', 'citadel_boss_glow_disabled', 'citadel_camera_fov'];

function preset(
  id: string,
  name: string,
  tier: PerformancePresetSummary['tier'],
  author: string,
  extra: Partial<PerformancePresetSummary> = {},
  versions = ['2.9', '2.8']
): PerformancePresetSummary {
  const releases = versions.map((version) => ({
    version,
    ref: `v${version}`,
    refKind: 'tag' as const,
    commit: `c${version}`,
    historyCommit: `c${version}`,
    date: '2026-08-17',
    settingCount: 100,
    optIn: OPT_INS,
  }));
  return {
    id,
    name,
    version: versions[0],
    tier,
    author,
    unstable: false,
    isDefault: false,
    settingCount: 100,
    upstream: {
      url: `https://github.com/${author}/configs`,
      repo: `${author}/configs`,
      ref: releases[0].ref,
      refKind: 'tag',
      commit: releases[0].commit,
      license: 'GPL-3.0',
      credit: `${name} credit`,
    },
    optIn: OPT_INS,
    versions: releases,
    ...extra,
  };
}

// Deliberately out of order: the card sorts mildest to strongest.
const PRESETS = [
  preset('sqooky-testing', "Sqooky's Testing", 'preview', 'Sqooky', { unstable: true }),
  preset('optilock-max', 'OptiLock Max FPS', 'maximum', 'dacooder'),
  preset('sqooky-default', "Sqooky's Default", 'balanced', 'Sqooky', { isDefault: true }),
  preset('kaizu-min-spec', 'kaizuchanerus Minimum Spec', 'potato', 'kaizuchanerus'),
  preset('optilock-fps', 'OptiLock FPS', 'competitive', 'dacooder'),
  preset('boot-max-fps', "boot's Max FPS", 'aggressive', 'boot'),
];

const NO_LATEST: PerformanceLatestInfo = {
  presetId: '',
  version: null,
  ref: null,
  refKind: null,
  commit: null,
  date: null,
  fetchedAt: null,
  withheldCount: 0,
  matchesBundled: null,
  error: null,
};

function applied(presetId: string, version = '2.9', extra: Partial<PerformanceConfigStatus> = {}): PerformanceConfigStatus {
  return {
    state: 'applied',
    appliedPresetId: presetId,
    appliedVersion: version,
    bundledVersion: '2.9',
    appliedOptIns: CREATOR_DEFAULTS,
    message: '',
    ...extra,
  };
}

const NOT_APPLIED: PerformanceConfigStatus = {
  state: 'not-applied',
  appliedVersion: null,
  bundledVersion: '2.9',
  message: '',
};

describe('PerformanceConfigCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let status: PerformanceConfigStatus;
  let latest: PerformanceLatestInfo;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let saveSettings: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    status = NOT_APPLIED;
    latest = NO_LATEST;
    api = {
      getPerformanceConfigStatus: vi.fn(async () => status),
      listPerformancePresets: vi.fn(async () => PRESETS),
      checkPerformanceLatest: vi.fn(async () => latest),
      applyPerformanceConfig: vi.fn(async (presetId: string, optIns: string[], version: string) => {
        status = applied(presetId, version === 'latest' ? latest.version! : version, { appliedOptIns: optIns });
        return status;
      }),
      removePerformanceConfig: vi.fn(async () => {
        status = NOT_APPLIED;
        return status;
      }),
      reapplyWipedPerformanceConfig: vi.fn(async () => {
        status = applied('sqooky-default');
        return status;
      }),
      restorePerformanceConfigBackup: vi.fn(async () => status),
      resetPerformanceConfigOverrides: vi.fn(async () => status),
      openPerformanceConfigFile: vi.fn(async () => undefined),
    };
    window.electronAPI = api as unknown as Window['electronAPI'];
    saveSettings = vi.fn(async (settings: AppSettings) => {
      useAppStore.setState({ settings });
    });
    useAppStore.setState({
      settings: {} as AppSettings,
      saveSettings,
      setBrowseUi: vi.fn(),
    } as never);
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

  async function render(settings: Partial<AppSettings> = {}) {
    useAppStore.setState({ settings: settings as AppSettings });
    await act(async () => {
      root.render(
        <MemoryRouter>
          <PerformanceConfigCard />
        </MemoryRouter>
      );
    });
    await flush();
  }

  async function click(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      (el as HTMLElement).click();
    });
    await flush();
  }

  const cards = () => [...host.querySelectorAll<HTMLLabelElement>('[role="radiogroup"] label')];
  const card = (tier: string) => cards().find((c) => c.textContent?.includes(`performance.preset.tier.${tier}`));
  const radio = (tier: string) => card(tier)?.querySelector('input[type="radio"]');
  const powerSwitch = () => host.querySelector<HTMLInputElement>('input[role="switch"]')!;
  const button = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

  describe('layout', () => {
    it('lists every config mildest to strongest with the recommended one selected', async () => {
      await render();
      expect(cards().map((c) => c.querySelector('.font-medium')?.textContent)).toEqual([
        'performance.preset.tier.balanced',
        'performance.preset.tier.competitive',
        'performance.preset.tier.aggressive',
        'performance.preset.tier.maximum',
        'performance.preset.tier.potato',
        'performance.preset.tier.preview',
      ]);
      expect((radio('balanced') as HTMLInputElement).checked).toBe(true);
      expect(card('balanced')?.textContent).toContain('performance.preset.recommended');
      expect(card('preview')?.textContent).toContain('performance.preset.experimental');
    });

    it('names the author once, without repeating it through the config name', async () => {
      await render();
      for (const p of PRESETS) {
        const text = card(p.tier)?.textContent ?? '';
        expect(text).toContain(p.author);
        expect(text).not.toContain(p.name);
      }
    });

    it('shows bundled pictures for verified authors and an initial for the rest', async () => {
      await render();
      for (const tier of ['balanced', 'competitive', 'maximum', 'preview']) {
        expect(card(tier)?.querySelector('img')).toBeTruthy();
      }
      expect(card('aggressive')?.querySelector('img')).toBeNull();
      expect(card('aggressive')?.textContent).toContain('b');
      expect(card('potato')?.querySelector('img')).toBeNull();
    });

    it('never shows commit hashes or raw status prose on the main card', async () => {
      status = applied('sqooky-default', '2.9', { message: 'Sqooky v2.9 is applied.' });
      await render();
      expect(host.textContent).not.toContain('c2.9');
      expect(host.textContent).not.toContain('is applied');
    });
  });

  describe('turning it on and off', () => {
    it('applies the selected config with its saved choices when switched on', async () => {
      await render({ performanceConfigOptIns: { 'sqooky-default': ['citadel_camera_fov'] } });
      expect(powerSwitch().checked).toBe(false);
      await click(powerSwitch());
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', ['citadel_camera_fov'], '2.9');
      expect(powerSwitch().checked).toBe(true);
    });

    it('removes the config when switched off', async () => {
      status = applied('sqooky-default');
      await render();
      await click(powerSwitch());
      expect(api.removePerformanceConfig).toHaveBeenCalled();
      expect(powerSwitch().checked).toBe(false);
    });
  });

  it('tells the app-wide banner to re-check after writing', async () => {
    api.getGameinfoStatus = vi.fn(async () => ({
      configured: true,
      reason: 'ok',
      message: '',
      missing: false,
      candidates: [],
    }));
    useGameinfoStore.setState({
      gameinfo: { configured: true, reason: 'ok', message: '', missing: false, candidates: [] },
      perfWiped: true,
    });
    status = { ...NOT_APPLIED, state: 'wiped', appliedPresetId: 'sqooky-default' };
    await render();
    await click(button('performance.restore'));
    expect(api.getGameinfoStatus).toHaveBeenCalled();
    expect(useGameinfoStore.getState().perfWiped).toBe(false);
  });

  describe('picking a config', () => {
    it('only saves the choice while it is off', async () => {
      await render();
      await click(radio('competitive'));
      expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ performanceConfigPresetId: 'optilock-fps' }));
      expect(api.applyPerformanceConfig).not.toHaveBeenCalled();
    });

    it('applies straight away while it is on, and Undo puts the previous one back', async () => {
      status = applied('sqooky-default', '2.8', { appliedOptIns: ['citadel_camera_fov'] });
      const before = { performanceConfigVersions: { 'sqooky-default': '2.8' } } as Partial<AppSettings>;
      await render(before);

      await click(radio('competitive'));
      expect(api.applyPerformanceConfig).toHaveBeenLastCalledWith('optilock-fps', CREATOR_DEFAULTS, '2.9');
      expect((radio('competitive') as HTMLInputElement).checked).toBe(true);

      const toast = useToastStore.getState().toasts.at(-1)!;
      expect(toast.message).toBe('performance.switched');
      expect(toast.actionLabel).toBe('common.actions.undo');

      await act(async () => toast.onAction!());
      await flush();
      expect(api.applyPerformanceConfig).toHaveBeenLastCalledWith('sqooky-default', ['citadel_camera_fov'], '2.8');
      expect(saveSettings).toHaveBeenLastCalledWith(before);
    });

    it('shows the config that is in the file, not a stale saved choice', async () => {
      status = applied('boot-max-fps');
      await render({ performanceConfigPresetId: 'sqooky-default' });
      expect((radio('aggressive') as HTMLInputElement).checked).toBe(true);
    });
  });

  describe('following the newest upstream version', () => {
    it('writes the fetched upstream release when it is newer than the bundle', async () => {
      latest = { ...NO_LATEST, presetId: 'sqooky-default', version: 'abc1234', ref: 'v3.0' };
      await render();
      await click(powerSwitch());
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', CREATOR_DEFAULTS, 'latest');
    });

    it('prefers the reviewed bundled release when upstream is identical to it', async () => {
      latest = { ...NO_LATEST, presetId: 'sqooky-default', version: 'abc1234', matchesBundled: '2.9' };
      await render();
      await click(powerSwitch());
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', CREATOR_DEFAULTS, '2.9');
    });

    it('never overrides a deliberate rollback', async () => {
      latest = { ...NO_LATEST, presetId: 'sqooky-default', version: 'abc1234' };
      await render({ performanceConfigVersions: { 'sqooky-default': '2.8' } });
      await click(powerSwitch());
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', CREATOR_DEFAULTS, '2.8');
    });

    it('stays on the bundle when tracking is off', async () => {
      latest = { ...NO_LATEST, presetId: 'sqooky-default', version: 'abc1234' };
      await render({ performanceTrackLatest: false });
      await click(powerSwitch());
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', CREATOR_DEFAULTS, '2.9');
    });
  });

  describe('notices', () => {
    it('shows nothing extra when the newest config is applied', async () => {
      status = applied('sqooky-default');
      await render();
      expect(host.textContent).not.toContain('performance.notice.');
    });

    it('offers an update when a newer release exists', async () => {
      status = applied('sqooky-default', '2.8');
      await render();
      expect(host.textContent).toContain('performance.notice.update');
      await click(button('performance.update'));
      expect(api.applyPerformanceConfig).toHaveBeenCalledWith('sqooky-default', CREATOR_DEFAULTS, '2.9');
    });

    it('does not nag about updates after a deliberate rollback', async () => {
      status = applied('sqooky-default', '2.8');
      await render({ performanceConfigVersions: { 'sqooky-default': '2.8' } });
      expect(host.textContent).not.toContain('performance.notice.update');
    });

    it('restores exactly what a game update removed', async () => {
      status = { ...NOT_APPLIED, state: 'wiped', appliedPresetId: 'sqooky-default' };
      await render();
      expect(host.textContent).toContain('performance.notice.wiped');
      await click(button('performance.restore'));
      expect(api.reapplyWipedPerformanceConfig).toHaveBeenCalled();
      expect(api.applyPerformanceConfig).not.toHaveBeenCalled();
      expect(powerSwitch().checked).toBe(true);
    });

    it('offers the backup, and blocks switching on, when the game file is damaged', async () => {
      status = { ...NOT_APPLIED, state: 'wiped', canRestoreBackup: true };
      await render();
      expect(host.textContent).toContain('performance.notice.damaged');
      expect(powerSwitch().disabled).toBe(true);
      await click(button('performance.restoreBackup'));
      expect(api.restorePerformanceConfigBackup).toHaveBeenCalled();
    });

    it('mentions hand edits to the file', async () => {
      status = applied('sqooky-default', '2.9', { handEdited: true });
      await render();
      expect(host.textContent).toContain('performance.notice.handEdited');
    });

    it('shows the error from the main process', async () => {
      status = { ...NOT_APPLIED, state: 'error', message: 'gameinfo.gi not found.' };
      await render();
      expect(host.textContent).toContain('gameinfo.gi not found.');
    });
  });

  describe('advanced', () => {
    async function openAdvanced() {
      await click(button('performance.advanced'));
    }

    it('stays collapsed until asked', async () => {
      await render();
      expect(host.textContent).not.toContain('performance.version.label');
      await openAdvanced();
      expect(host.textContent).toContain('performance.version.label');
      expect(host.textContent).toContain('performance.trackLatest.label');
    });

    it('lists gameplay settings as a table with visibility open and camera closed', async () => {
      await render();
      await openAdvanced();
      expect(host.textContent).toContain('citadel_trooper_glow_disabled');
      expect(host.textContent).not.toContain('citadel_camera_fov');
      await click(button('performance.optIn.group.camera'));
      expect(host.textContent).toContain('citadel_camera_fov');
    });

    it('shows what the file really holds when it differs from the author', async () => {
      status = applied('sqooky-default', '2.9', {
        appliedOptIns: ['citadel_trooper_glow_disabled'],
        managedConvarValues: { citadel_trooper_glow_disabled: '0', citadel_boss_glow_disabled: '1' },
      });
      await render({ performanceConfigOptIns: { 'sqooky-default': ['citadel_trooper_glow_disabled'] } });
      await openAdvanced();
      const row = (key: string) =>
        host.querySelector(`input[aria-label="${key}"]`)?.closest('tr')?.textContent ?? '';
      expect(row('citadel_trooper_glow_disabled')).toContain('0');
      expect(row('citadel_trooper_glow_disabled')).toContain('performance.optIn.authorValue');
      expect(row('citadel_boss_glow_disabled')).toContain('performance.optIn.stray');
    });

    it('writes a gameplay setting change straight away while on', async () => {
      status = applied('sqooky-default');
      await render();
      await openAdvanced();
      await click(host.querySelector('input[aria-label="citadel_boss_glow_disabled"]'));
      const remaining = ['citadel_trooper_glow_disabled', 'citadel_camera_fov'];
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ performanceConfigOptIns: { 'sqooky-default': remaining } })
      );
      expect(api.applyPerformanceConfig).toHaveBeenLastCalledWith('sqooky-default', remaining, '2.9');
    });

    it('writes a version change straight away while on, without following upstream', async () => {
      status = applied('sqooky-default');
      latest = { ...NO_LATEST, presetId: 'sqooky-default', version: 'abc1234' };
      await render();
      await openAdvanced();
      const select = host.querySelector('select')!;
      await act(async () => {
        select.value = '2.8';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flush();
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ performanceConfigVersions: { 'sqooky-default': '2.8' } })
      );
      expect(api.applyPerformanceConfig).toHaveBeenLastCalledWith('sqooky-default', CREATOR_DEFAULTS, '2.8');
    });

    it('offers file tools only while a config is applied', async () => {
      await render();
      await openAdvanced();
      expect(button('performance.editFile')).toBeUndefined();
      await click(powerSwitch());
      expect(button('performance.editFile')).toBeTruthy();
    });
  });
});
