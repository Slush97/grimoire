import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Gauge, RefreshCw, Server } from 'lucide-react';
import type { GameBananaFileServerDiagnostics } from '../../types/electron';
import { Badge, Button, Card } from '../common/ui';
import Tx from '../translation/Tx';

const GAMEBANANA_FILESERVER_STATUS_URL = 'https://gamebanana.com/fileservers';
const MINIMUM_REFRESH_DURATION_MS = 1_000;
const REFRESH_BUTTON_ID = 'download-server-refresh-status';

function waitForMinimumRefreshDuration(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, MINIMUM_REFRESH_DURATION_MS);
  });
}

function formatRelativeTime(
  timestamp: number | undefined,
  now: number,
  locale: string | undefined,
  fallback: { notYet: string; justNow: string },
): string {
  if (!timestamp) return fallback.notYet;

  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return fallback.justNow;
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-elapsedMinutes, 'minute');
  }
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-elapsedHours, 'hour');
  }
  const elapsedDays = Math.round(elapsedHours / 24);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-elapsedDays, 'day');
}

function healthVariant(status: GameBananaFileServerDiagnostics['status']): 'success' | 'warning' | 'error' {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'error';
}

function healthTextClass(variant: 'success' | 'warning' | 'error'): string {
  if (variant === 'success') return 'text-state-success';
  if (variant === 'warning') return 'text-state-warning';
  return 'text-state-danger';
}

function formatSpeed(bytesPerSecond: number | undefined, availableLabel: string): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return availableLabel;
  const megabytesPerSecond = bytesPerSecond / (1024 * 1024);
  if (megabytesPerSecond >= 1) return `${megabytesPerSecond.toFixed(1)} MB/s`;
  return `${Math.round(bytesPerSecond / 1024)} KB/s`;
}

export default function DownloadServersCard() {
  const { t, i18n } = useTranslation();
  const [diagnostics, setDiagnostics] = useState<GameBananaFileServerDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [downloadActive, setDownloadActive] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const refreshFocusOrigin = useRef<HTMLButtonElement | null>(null);
  const [feedback, setFeedback] = useState<
    'refreshed' | 'refreshFailed' | 'tested' | 'testFailed' | null
  >(null);
  const [clock, setClock] = useState(Date.now);

  const refreshCache = useCallback(async (trigger: HTMLButtonElement) => {
    setIsLoading(true);
    setFeedback(null);
    refreshFocusOrigin.current = diagnostics === null && document.activeElement === trigger
      ? trigger
      : null;
    const minimumDuration = waitForMinimumRefreshDuration();
    try {
      const result = await window.electronAPI.refreshGameBananaFileServerCache();
      await minimumDuration;
      setDiagnostics(result);
      setLoadFailed(false);
      setFeedback(result.error ? 'refreshFailed' : 'refreshed');
    } catch {
      await minimumDuration;
      setFeedback('refreshFailed');
    } finally {
      setIsLoading(false);
    }
  }, [diagnostics]);

  const testServers = useCallback(async () => {
    if (downloadActive) return;
    setIsTesting(true);
    setFeedback(null);
    try {
      const result = await window.electronAPI.testGameBananaFileServers();
      setDiagnostics(result);
      setLoadFailed(false);
      setFeedback('tested');
    } catch {
      setFeedback('testFailed');
    } finally {
      setIsTesting(false);
    }
  }, [downloadActive]);

  useEffect(() => {
    let active = true;
    window.electronAPI
      .getGameBananaFileServerDiagnostics()
      .then((result) => {
        if (active) setDiagnostics(result);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isLoading || !refreshFocusOrigin.current) return;
    const originalButton = refreshFocusOrigin.current;
    refreshFocusOrigin.current = null;
    const focusFellBack = document.activeElement === document.body
      || document.activeElement === originalButton
      || document.activeElement === null;
    if (!originalButton.isConnected && focusFellBack) {
      document.getElementById(REFRESH_BUTTON_ID)?.focus();
    }
  }, [isLoading]);

  useEffect(() => {
    let active = true;
    let sawQueueUpdate = false;
    const unsubscribe = window.electronAPI.onDownloadQueueUpdated((state) => {
      sawQueueUpdate = true;
      if (active) setDownloadActive(state.currentDownload !== null);
    });
    window.electronAPI.getCurrentDownload().then((currentDownload) => {
      if (active && !sawQueueUpdate) setDownloadActive(currentDownload !== null);
    }).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const directoryIsStale = !!diagnostics?.directoryExpiresAt
    && diagnostics.directoryExpiresAt <= clock;
  const healthStatus = diagnostics?.status ?? 'unavailable';
  const healthVariantName = directoryIsStale ? 'warning' : healthVariant(healthStatus);
  const healthLabel = directoryIsStale
    ? t('settings.downloadServers.healthStale', { defaultValue: 'Stale' })
    : healthStatus === 'healthy'
      ? t('settings.downloadServers.healthHealthy', { defaultValue: 'Healthy' })
      : healthStatus === 'degraded'
        ? t('settings.downloadServers.healthDegraded', { defaultValue: 'Degraded' })
        : t('settings.downloadServers.healthUnavailable', { defaultValue: 'Unavailable' });
  const relativeFallback = {
    notYet: t('settings.downloadServers.notTestedYet', { defaultValue: 'Not tested yet' }),
    justNow: t('settings.downloadServers.justNow', { defaultValue: 'just now' }),
  };
  const locale = i18n.resolvedLanguage || i18n.language;
  const testFeedback = feedback === 'tested' || feedback === 'testFailed' ? feedback : null;
  const refreshFeedback = feedback === 'refreshed' || feedback === 'refreshFailed' ? feedback : null;
  const preferredResult = diagnostics?.testedServers.find((server) => (
    server.available && server.server === diagnostics.preferredServer
  ));
  const hasLocalResults = (diagnostics?.testedServers.length ?? 0) > 0;
  const hasLocalTest = hasLocalResults || !!diagnostics?.localProbeCheckedAt;
  const testFailureMessage = hasLocalResults
    ? t('settings.downloadServers.testErrorWithResults', {
      defaultValue: "Couldn't test servers. Previous results are still shown; try again.",
    })
    : t('settings.downloadServers.testError', {
      defaultValue: "Couldn't test servers. Check your connection and try again.",
    });
  const liveMessage = feedback === 'refreshed'
    ? t('settings.downloadServers.refreshSuccess', {
      defaultValue: 'GameBanana status refreshed.',
    })
    : feedback === 'refreshFailed'
      ? diagnostics
        ? t('settings.downloadServers.refreshError', {
          defaultValue: "Couldn't refresh GameBanana status. Showing the last check; try again.",
        })
        : t('settings.downloadServers.refreshErrorNoStatus', {
          defaultValue: "Couldn't refresh GameBanana status. Check your connection and try again.",
        })
      : feedback === 'tested'
        ? t('settings.downloadServers.testSuccess', { defaultValue: 'Server test complete.' })
        : feedback === 'testFailed'
          ? testFailureMessage
          : !isLoading && loadFailed
            ? t('settings.downloadServers.loadUnavailable', {
              defaultValue: 'GameBanana server status is unavailable.',
            })
            : '';

  return (
    <Card
      title={<Tx k="settings.downloadServers.title" fallback="Download servers" />}
      icon={Server}
      action={
        <Badge variant="info">
          <Tx k="settings.downloadServers.automatic" fallback="Automatic" />
        </Badge>
      }
    >
      <div aria-busy={isLoading}>
        <p className="sr-only" role="status" aria-live="polite">
          {liveMessage}
        </p>
        {diagnostics ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-8 gap-y-4">
              <div className="min-w-0 border-l border-accent/40 pl-4">
                <dt className="text-xs text-text-secondary">
                  {!diagnostics.preferredServer ? (
                    <Tx k="settings.downloadServers.selection" fallback="Server selection" />
                  ) : diagnostics.needsProbe ? (
                    <Tx k="settings.downloadServers.lastPreferred" fallback="Last selected" />
                  ) : (
                    <Tx k="settings.downloadServers.preferred" fallback="Selected server" />
                  )}
                </dt>
                <dd
                  className={`mt-1 truncate font-reaver font-semibold tracking-wide text-text-primary ${diagnostics.preferredServer ? 'text-xl' : 'text-base'}`}
                  title={diagnostics.preferredServer}
                >
                  {diagnostics.preferredServer ?? (
                    <Tx
                      k="settings.downloadServers.noServerSelected"
                      fallback="Selected on next download"
                    />
                  )}
                </dd>
                <dd className="mt-1 text-xs text-text-secondary">
                  {diagnostics.localProbeCheckedAt
                    ? (
                      <>
                        {preferredResult
                          ? formatSpeed(preferredResult.bytesPerSecond, t('settings.downloadServers.serverAvailable', {
                            defaultValue: 'Available',
                          }))
                          : <Tx k="settings.downloadServers.localTest" fallback="Local test" />}
                        {' · '}
                        {formatRelativeTime(diagnostics.localProbeCheckedAt, clock, locale, relativeFallback)}
                      </>
                    )
                    : null}
                </dd>
              </div>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-l border-white/10 pl-4">
                <div className="min-w-0 flex-1 basis-48">
                  <dt className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
                    <a
                      href={GAMEBANANA_FILESERVER_STATUS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-6 items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      <span>GameBanana</span>
                      <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                    </a>
                    <span className={`inline-flex items-center gap-1.5 font-medium ${healthTextClass(healthVariantName)}`}>
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                      {healthLabel}
                    </span>
                  </dt>
                  <dd className="mt-1 text-base font-semibold text-text-primary">
                    {diagnostics.status === 'unavailable'
                      ? t('settings.downloadServers.statusUnavailable', { defaultValue: 'Status unavailable' })
                      : t('settings.downloadServers.onlineSummary', {
                        defaultValue: '{{available}} of {{total}} online',
                        available: diagnostics.availableServers,
                        total: diagnostics.totalServers,
                      })}
                  </dd>
                  <dd className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                    <span className={refreshFeedback === 'refreshFailed' ? 'text-state-warning' : undefined}>
                      {refreshFeedback === 'refreshFailed'
                        ? t('settings.downloadServers.refreshError', {
                          defaultValue: "Couldn't refresh GameBanana status. Showing the last check; try again.",
                        })
                        : diagnostics.directoryCheckedAt
                          ? t('settings.downloadServers.checkedAt', {
                            defaultValue: 'Checked {{relativeTime}}',
                            relativeTime: formatRelativeTime(
                              diagnostics.directoryCheckedAt,
                              clock,
                              locale,
                              relativeFallback,
                            ),
                          })
                          : t('settings.downloadServers.notCheckedYet', { defaultValue: 'Not checked yet' })}
                    </span>
                  </dd>
                </div>
                <Button
                  id={REFRESH_BUTTON_ID}
                  type="button"
                  size="sm"
                  variant="ghost"
                  icon={RefreshCw}
                  isLoading={isLoading}
                  disabled={isTesting}
                  onClick={(event) => void refreshCache(event.currentTarget)}
                >
                  <Tx k="settings.downloadServers.refreshCache" fallback="Refresh status" />
                </Button>
              </div>
            </dl>

            <section className="border-t border-white/5 pt-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-medium text-text-primary">
                    {hasLocalTest ? (
                      <Tx k="settings.downloadServers.testedHere" fallback="Tested on this PC" />
                    ) : (
                      <Tx
                        k="settings.downloadServers.emptyTestTitle"
                        fallback="Find the fastest server"
                      />
                    )}
                  </h4>
                  <p
                    id="download-server-test-status"
                    className={`mt-1 min-h-4 text-xs ${testFeedback === 'testFailed' ? 'text-state-warning' : 'text-text-secondary'}`}
                  >
                    {downloadActive
                      ? t('settings.downloadServers.testBlocked', {
                        defaultValue: 'Available after the current download',
                      })
                      : testFeedback === 'testFailed'
                        ? testFailureMessage
                        : diagnostics.localProbeCheckedAt
                          ? formatRelativeTime(diagnostics.localProbeCheckedAt, clock, locale, relativeFallback)
                          : t('settings.downloadServers.noLocalTests', {
                            defaultValue: 'Runs a quick test on this PC.',
                          })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  icon={Gauge}
                  isLoading={isTesting}
                  disabled={isLoading || downloadActive}
                  aria-describedby={downloadActive ? 'download-server-test-status' : undefined}
                  title={downloadActive
                    ? t('settings.downloadServers.testBlocked', {
                      defaultValue: 'Available after the current download',
                    })
                    : t('settings.downloadServers.testHint', {
                      defaultValue: 'Tests 3 servers · up to 768 KB',
                    })}
                  onClick={() => void testServers()}
                >
                  <Tx k="settings.downloadServers.testNow" fallback="Test now" />
                </Button>
              </div>

              {hasLocalResults ? (
                <ul
                  className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-px overflow-hidden rounded-sm border border-white/5 bg-white/5"
                  aria-label={t('settings.downloadServers.localListLabel', {
                    defaultValue: 'Locally tested download servers',
                  })}
                >
                  {diagnostics.testedServers.slice(0, 3).map((server) => {
                    const isPreferred = !diagnostics.needsProbe
                      && server.server === diagnostics.preferredServer;
                    return (
                      <li
                        key={server.server}
                        aria-current={isPreferred ? 'true' : undefined}
                        className={`flex min-h-16 min-w-0 items-center justify-between gap-4 px-3 py-2 text-xs ${isPreferred ? 'bg-accent/[0.08]' : 'bg-bg-secondary'}`}
                      >
                        <div className="min-w-0">
                          <span className="block truncate font-medium text-text-primary" title={server.server}>
                            {server.server}
                          </span>
                        </div>
                        <span className={server.available ? 'shrink-0 tabular-nums font-medium text-text-primary' : 'shrink-0 text-state-danger'}>
                          {server.available
                            ? formatSpeed(server.bytesPerSecond, t('settings.downloadServers.serverAvailable', {
                              defaultValue: 'Available',
                            }))
                            : t('settings.downloadServers.serverUnavailable', { defaultValue: 'Unavailable' })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </section>
          </div>
        ) : (
          <div className="flex min-h-24 flex-wrap items-center justify-between gap-3">
            <div>
              {!isLoading && loadFailed && (
                <p className="text-sm font-medium text-state-danger">{healthLabel}</p>
              )}
              <p className={`${!isLoading && loadFailed ? 'mt-1 text-xs' : 'text-sm'} text-text-secondary`}>
                {isLoading
                  ? t('settings.downloadServers.loading', { defaultValue: 'Loading server status…' })
                  : loadFailed
                    ? t('settings.downloadServers.loadUnavailable', {
                      defaultValue: 'GameBanana server status is unavailable.',
                    })
                    : t('settings.downloadServers.noStatus', {
                      defaultValue: 'No server status has been checked yet.',
                    })}
              </p>
            </div>
            {(!isLoading || loadFailed) && (
              <Button
                id={REFRESH_BUTTON_ID}
                type="button"
                size="sm"
                variant="secondary"
                icon={RefreshCw}
                isLoading={isLoading}
                onClick={(event) => void refreshCache(event.currentTarget)}
              >
                <Tx k="settings.downloadServers.refreshCache" fallback="Refresh status" />
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

export { GAMEBANANA_FILESERVER_STATUS_URL };
