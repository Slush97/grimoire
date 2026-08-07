// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DownloadServersCard from './DownloadServersCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, values?: Record<string, unknown>) => (
      String(values?.defaultValue ?? _key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => (
        String(values?.[name] ?? '')
      ))
    ),
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Diagnostics = {
  status: 'healthy' | 'degraded' | 'unavailable';
  availableServers: number;
  totalServers: number;
  directoryCheckedAt?: number;
  directoryExpiresAt?: number;
  preferredServer?: string;
  needsProbe: boolean;
  localProbeCheckedAt?: number;
  testedServers: Array<{ server: string; bytesPerSecond?: number; available: boolean }>;
  error?: string;
};

describe('DownloadServersCard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let getDiagnostics: ReturnType<typeof vi.fn<() => Promise<Diagnostics>>>;
  let refreshCache: ReturnType<typeof vi.fn<() => Promise<Diagnostics>>>;
  let testServers: ReturnType<typeof vi.fn<() => Promise<Diagnostics>>>;
  let getCurrentDownload: ReturnType<typeof vi.fn>;
  let onDownloadQueueUpdated: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    getDiagnostics = vi.fn();
    refreshCache = vi.fn();
    testServers = vi.fn();
    getCurrentDownload = vi.fn().mockResolvedValue(null);
    onDownloadQueueUpdated = vi.fn(() => vi.fn());
    window.electronAPI = {
      getGameBananaFileServerDiagnostics: getDiagnostics,
      refreshGameBananaFileServerCache: refreshCache,
      testGameBananaFileServers: testServers,
      getCurrentDownload,
      onDownloadQueueUpdated,
    } as unknown as Window['electronAPI'];
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  async function render(diagnostics: Diagnostics) {
    getDiagnostics.mockResolvedValueOnce(diagnostics);
    await act(async () => {
      root.render(<DownloadServersCard />);
      await Promise.resolve();
    });
  }

  async function renderWithInitialFailure() {
    getDiagnostics.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      root.render(<DownloadServersCard />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('summarizes the automatic preferred server and current directory health', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now() - 60_000,
      directoryExpiresAt: Date.now() + 11 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 6 * 60_000,
      testedServers: [],
    });

    expect(getDiagnostics).toHaveBeenCalledWith();
    expect(host.textContent).toContain('Download servers');
    expect(host.textContent).toContain('Automatic');
    expect(host.textContent).toContain('Healthy');
    expect(host.textContent).toContain('filecache45');
    expect(host.textContent).toContain('6 minutes ago');
    expect(host.textContent).toContain('13 of 13 online');
  });

  it('tests server speed on demand and shows the measured winner', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now(),
      directoryExpiresAt: Date.now() + 12 * 60_000,
      needsProbe: true,
      testedServers: [],
    });
    let finishTest!: (value: Diagnostics) => void;
    testServers.mockImplementationOnce(() => new Promise((resolve) => {
      finishTest = resolve;
    }));

    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Test now')
    ));
    expect(button).toBeDefined();
    expect(button?.title).toContain('up to 768 KB');

    act(() => button!.click());
    expect(testServers).toHaveBeenCalledOnce();
    expect(button!.disabled).toBe(true);

    await act(async () => {
      finishTest({
        status: 'healthy',
        availableServers: 13,
        totalServers: 13,
        directoryCheckedAt: Date.now(),
        directoryExpiresAt: Date.now() + 12 * 60_000,
        preferredServer: 'filecache44',
        needsProbe: false,
        localProbeCheckedAt: Date.now(),
        testedServers: [
          { server: 'filecache45', bytesPerSecond: 2.1 * 1024 * 1024, available: true },
          { server: 'filecache44', bytesPerSecond: 4.2 * 1024 * 1024, available: true },
          { server: 'filecache43', available: false },
        ],
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain('filecache44');
    expect(host.textContent).toContain('4.2 MB/s');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Test complete');
  });

  it('keeps the controls self-explanatory without repeated instructional copy', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now(),
      directoryExpiresAt: Date.now() + 12 * 60_000,
      needsProbe: true,
      testedServers: [],
    });

    expect(host.textContent).toContain('Test now');
    expect(host.textContent).toContain('Refresh status');
    expect(host.textContent).toContain('No results yet');
    expect(host.textContent).not.toContain("Refresh fetches GameBanana's latest server status");
    expect(host.textContent).not.toContain('The next download retests');
    expect(host.textContent).not.toContain('Downloads can still use its default route');
  });

  it('keeps previous results when an on-demand test fails', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now(),
      directoryExpiresAt: Date.now() + 12 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 60_000,
      testedServers: [
        { server: 'filecache45', bytesPerSecond: 4.2 * 1024 * 1024, available: true },
      ],
    });
    testServers.mockRejectedValueOnce(new Error('offline'));

    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Test now')
    ));
    await act(async () => {
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('filecache45');
    expect(host.textContent).toContain('4.2 MB/s');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Test failed');
  });

  it('does not run a speed test while a download is active', async () => {
    getCurrentDownload.mockResolvedValueOnce({
      modId: 1,
      fileId: 2,
      fileName: 'large.zip',
    });
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now(),
      directoryExpiresAt: Date.now() + 12 * 60_000,
      needsProbe: true,
      testedServers: [],
    });
    await act(async () => Promise.resolve());

    const testButton = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Test now')
    ));
    const refreshButton = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Refresh status')
    ));
    expect(testButton?.disabled).toBe(true);
    expect(testButton?.title).toContain('after the current download');
    expect(refreshButton?.disabled).toBe(false);
  });

  it('refreshes only the cached GameBanana status', async () => {
    await render({
      status: 'healthy',
      availableServers: 12,
      totalServers: 12,
      directoryCheckedAt: Date.now() - 60_000,
      directoryExpiresAt: Date.now() + 11 * 60_000,
      preferredServer: 'filecache44',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 5 * 60_000,
      testedServers: [],
    });

    let finishRefresh!: (value: Diagnostics) => void;
    refreshCache.mockImplementationOnce(() => new Promise((resolve) => {
      finishRefresh = resolve;
    }));

    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Refresh status')
    ));
    expect(button).toBeDefined();

    act(() => button!.click());
    expect(refreshCache).toHaveBeenCalledOnce();
    expect(button!.disabled).toBe(true);

    await act(async () => {
      finishRefresh({
        status: 'degraded',
        availableServers: 8,
        totalServers: 16,
        directoryCheckedAt: Date.now(),
        directoryExpiresAt: Date.now() + 12 * 60_000,
        preferredServer: 'filecache45',
        needsProbe: true,
        testedServers: [],
      });
      await Promise.resolve();
    });

    expect(host.textContent).toContain('Degraded');
    expect(host.textContent).toContain('8 of 16 online');
    expect(host.textContent).toContain('filecache45');
    expect(host.textContent).toContain('Last preferred');
    expect(host.textContent).toContain('Status refreshed');
  });

  it('discloses only the three locally tested mirrors with measured outcomes', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now() - 2 * 60_000,
      directoryExpiresAt: Date.now() + 10 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 2 * 60_000,
      testedServers: [
        { server: 'filecache45', bytesPerSecond: 4.2 * 1024 * 1024, available: true },
        { server: 'filecache44', bytesPerSecond: 3.8 * 1024 * 1024, available: true },
        { server: 'filecache38', available: false },
        { server: 'filecache37', bytesPerSecond: 2.9 * 1024 * 1024, available: true },
      ],
    });

    const details = host.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.querySelector('summary')?.textContent).toContain('View details');
    expect(details?.textContent).toContain('filecache45');
    expect(details?.textContent).toContain('4.2 MB/s');
    expect(details?.textContent).toContain('filecache44');
    expect(details?.textContent).toContain('3.8 MB/s');
    expect(details?.textContent).toContain('filecache38');
    expect(details?.textContent).toContain('Unavailable');
    expect(details?.textContent).not.toContain('filecache37');

    const statusLink = host.querySelector<HTMLAnchorElement>(
      'a[href="https://gamebanana.com/fileservers"]',
    );
    expect(statusLink?.textContent).toContain('GameBanana status');
    expect(statusLink?.target).toBe('_blank');
    expect(statusLink?.rel).toContain('noopener');
  });

  it('marks expired directory data as stale without presenting old local ranking as current', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now() - 20 * 60_000,
      directoryExpiresAt: Date.now() - 8 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: true,
      localProbeCheckedAt: Date.now() - 20 * 60_000,
      testedServers: [
        { server: 'filecache45', bytesPerSecond: 4.2 * 1024 * 1024, available: true },
      ],
    });

    expect(host.textContent).toContain('Last preferred');
    expect(host.textContent).toContain('Stale');
    expect(host.textContent).toContain('Checked 20 minutes ago');
  });

  it('updates the health label when cached directory data expires while the card is open', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now(),
      directoryExpiresAt: Date.now() + 60_000,
      needsProbe: true,
      testedServers: [],
    });

    expect(host.textContent).toContain('Healthy');

    act(() => vi.advanceTimersByTime(60_000));

    expect(host.textContent).toContain('Stale');
  });

  it('keeps recovery available when GameBanana has no usable server directory', async () => {
    await render({
      status: 'unavailable',
      availableServers: 0,
      totalServers: 0,
      needsProbe: true,
      testedServers: [],
      error: 'upstream timed out',
    });

    expect(host.textContent).toContain('Unavailable');
    expect(host.textContent).toContain('Status unavailable');
    expect(host.textContent).toContain('No results yet');
    expect(host.textContent).not.toContain('upstream timed out');
    expect(Array.from(host.querySelectorAll('button')).some((button) => (
      button.textContent?.includes('Refresh status')
    ))).toBe(true);
  });

  it('keeps the previous snapshot and announces a failed cache refresh', async () => {
    await render({
      status: 'healthy',
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now() - 60_000,
      directoryExpiresAt: Date.now() + 11 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 6 * 60_000,
      testedServers: [
        { server: 'filecache45', bytesPerSecond: 4.2 * 1024 * 1024, available: true },
      ],
    });
    refreshCache.mockRejectedValueOnce(new Error('offline'));

    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Refresh status')
    ));
    await act(async () => {
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('filecache45');
    expect(host.textContent).toContain('13 of 13 online');
    const announcement = host.querySelector('[role="status"]');
    expect(announcement?.getAttribute('aria-live')).toBe('polite');
    expect(announcement?.textContent).toContain('Refresh failed');
  });

  it('announces a refresh failure returned with retained diagnostics', async () => {
    const previous = {
      status: 'healthy' as const,
      availableServers: 13,
      totalServers: 13,
      directoryCheckedAt: Date.now() - 60_000,
      directoryExpiresAt: Date.now() + 11 * 60_000,
      preferredServer: 'filecache45',
      needsProbe: false,
      localProbeCheckedAt: Date.now() - 6 * 60_000,
      testedServers: [],
    };
    await render(previous);
    refreshCache.mockResolvedValueOnce({
      ...previous,
      status: 'degraded',
      needsProbe: true,
      error: 'refresh failed',
    });

    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Refresh status')
    ));
    await act(async () => {
      button!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.textContent).toContain('filecache45');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Refresh failed');
  });

  it('offers cache refresh recovery when the initial status request fails', async () => {
    await renderWithInitialFailure();

    expect(host.textContent).toContain('Unavailable');
    expect(host.textContent).toContain('GameBanana server status is unavailable');
    const button = Array.from(host.querySelectorAll('button')).find((candidate) => (
      candidate.textContent?.includes('Refresh status')
    ));
    expect(button).toBeDefined();
    expect(button!.disabled).toBe(false);
  });
});
