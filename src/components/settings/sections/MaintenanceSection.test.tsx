// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MaintenanceSection from './MaintenanceSection';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => (
      String(values?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => (
        String(values?.[name] ?? '')
      ))
    ),
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe('MaintenanceSection', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    window.electronAPI = {
      getSyncStatus: vi.fn(async () => ({})),
      getPreviewCacheSize: vi.fn(async () => ({ bytes: 0 })),
      isSyncInProgress: vi.fn(async () => false),
      onSyncProgress: vi.fn(() => vi.fn()),
      getGameBananaFileServerDiagnostics: vi.fn(async () => ({
        status: 'healthy',
        availableServers: 13,
        totalServers: 13,
        needsProbe: true,
        testedServers: [],
      })),
      refreshGameBananaFileServerCache: vi.fn(),
    } as unknown as Window['electronAPI'];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('places download routing diagnostics before the storage caches', async () => {
    await act(async () => {
      root.render(<MaintenanceSection />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const content = host.textContent ?? '';
    expect(content.indexOf('Maintenance')).toBeGreaterThanOrEqual(0);
    expect(content.indexOf('Download servers')).toBeGreaterThan(content.indexOf('Maintenance'));
    expect(content.indexOf('Mod Database Cache')).toBeGreaterThan(content.indexOf('Download servers'));
    expect(content.indexOf('Local preview cache')).toBeGreaterThan(content.indexOf('Mod Database Cache'));
  });
});
