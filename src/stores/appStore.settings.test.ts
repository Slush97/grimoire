import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '../types/mod';
import * as api from '../lib/api';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  default: { t: (key: string) => key },
  applyLanguagePreference: vi.fn(),
}));
vi.mock('../lib/api', () => ({ setSettings: vi.fn(), getMods: vi.fn() }));

const setSettings = vi.mocked(api.setSettings);
const initial = {
  deadlockPath: null, devDeadlockPath: null, devMode: false, keepModBackups: false,
  dateFormat: 'MM/DD/YYYY', language: null,
} as AppSettings;

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ settings: initial, settingsLoading: false, settingsError: null });
});

describe('saving settings', () => {
  it('preserves newer preferences in the backend and renderer when a mode change waits', async () => {
    let release!: () => void;
    const lock = new Promise<void>(resolve => { release = resolve; });
    let persisted = initial;
    setSettings.mockImplementation(async patch => {
      if (patch.devMode) await lock;
      persisted = { ...persisted, ...patch };
      return persisted;
    });

    const switching = useAppStore.getState().saveSettings({ ...initial, devMode: true });
    await useAppStore.getState().saveSettings({ ...initial, keepModBackups: true });
    expect(setSettings.mock.calls).toEqual([[{ devMode: true }], [{ keepModBackups: true }]]);
    expect(useAppStore.getState().settings).toMatchObject({ devMode: false, keepModBackups: true });

    release();
    await switching;
    expect(persisted).toEqual({ ...initial, devMode: true, keepModBackups: true });
    expect(useAppStore.getState().settings).toEqual(persisted);
  });

  it('uses the authoritative response even when the requested settings are unchanged', async () => {
    const saved = { ...initial, keepModBackups: true };
    setSettings.mockResolvedValue(saved);

    await useAppStore.getState().saveSettings(initial);

    expect(setSettings).toHaveBeenCalledExactlyOnceWith({});
    expect(useAppStore.getState().settings).toBe(saved);
    expect(useAppStore.getState().settingsLoading).toBe(false);
  });
});
