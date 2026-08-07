import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ExternalLink, Gauge, RefreshCw, Server } from 'lucide-react';
import type { GameBananaFileServerDiagnostics } from '../../types/electron';
import { Badge, Button, Card } from '../common/ui';
import Tx from '../translation/Tx';

const GAMEBANANA_FILESERVER_STATUS_URL = 'https://gamebanana.com/fileservers';

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
  const [feedback, setFeedback] = useState<
    'refreshed' | 'refreshFailed' | 'tested' | 'testFailed' | null
  >(null);
  const [clock, setClock] = useState(Date.now);

  const refreshCache = useCallback(async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const result = await window.electronAPI.refreshGameBananaFileServerCache();
      setDiagnostics(result);
      setLoadFailed(false);
      setFeedback(result.error ? 'refreshFailed' : 'refreshed');
    } catch {
      setFeedback('refreshFailed');
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  return (
    <Card
      title={<Tx k="settings.downloadServers.title" fallback="Download servers" />}
      icon={Server}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="info">
            <Tx k="settings.downloadServers.automatic" fallback="Automatic" />
          </Badge>
          {!isLoading && <Badge variant={healthVariantName}>{healthLabel}</Badge>}
        </div>
      }
    >
      <div aria-busy={isLoading} className="space-y-5">
        {diagnostics ? (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">
                  {diagnostics.needsProbe && diagnostics.preferredServer ? (
                    <Tx k="settings.downloadServers.lastPreferred" fallback="Last preferred" />
                  ) : (
                    <Tx k="settings.downloadServers.preferred" fallback="Preferred" />
                  )}
                </dt>
                <dd className="mt-1 truncate text-sm font-medium text-text-primary" title={diagnostics.preferredServer}>
                  {diagnostics.preferredServer ?? (
                    <Tx k="settings.downloadServers.notTestedYet" fallback="Not tested yet" />
                  )}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">
                  <Tx k="settings.downloadServers.localTest" fallback="Local test" />
                </dt>
                <dd className="mt-1 text-sm font-medium text-text-primary">
                  {formatRelativeTime(diagnostics.localProbeCheckedAt, clock, locale, relativeFallback)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-text-secondary">GameBanana</dt>
                <dd className="mt-1 text-sm font-medium text-text-primary">
                  {diagnostics.status === 'unavailable'
                    ? t('settings.downloadServers.statusUnavailable', { defaultValue: 'Status unavailable' })
                    : t('settings.downloadServers.onlineSummary', {
                      defaultValue: '{{available}} of {{total}} online',
                      available: diagnostics.availableServers,
                      total: diagnostics.totalServers,
                    })}
                </dd>
                <dd className="mt-1 text-xs text-text-secondary">
                  {diagnostics.directoryCheckedAt
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
                </dd>
              </div>
            </dl>

            <details className="group border-t border-white/5 pt-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm text-sm font-medium text-text-primary outline-none transition-colors hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/70">
                <ChevronDown
                  aria-hidden
                  className="h-4 w-4 text-text-secondary transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                />
                <Tx k="settings.downloadServers.viewDetails" fallback="View details" />
              </summary>

              <div className="mt-4 space-y-4 pl-6">
                <div>
                  <h4 className="text-xs font-medium text-text-primary">
                    <Tx k="settings.downloadServers.testedHere" fallback="Tested on this PC" />
                  </h4>
                  {diagnostics.testedServers.length > 0 ? (
                    <ul
                      className="mt-2 divide-y divide-white/5"
                      aria-label={t('settings.downloadServers.localListLabel', {
                        defaultValue: 'Locally tested download servers',
                      })}
                    >
                      {diagnostics.testedServers.slice(0, 3).map((server) => (
                        <li key={server.server} className="flex min-w-0 items-center justify-between gap-4 py-2 text-xs">
                          <span className="truncate font-medium text-text-primary" title={server.server}>
                            {server.server}
                          </span>
                          <span className={server.available ? 'shrink-0 tabular-nums text-text-secondary' : 'shrink-0 text-state-danger'}>
                            {server.available
                              ? formatSpeed(server.bytesPerSecond, t('settings.downloadServers.serverAvailable', {
                                defaultValue: 'Available',
                              }))
                              : t('settings.downloadServers.serverUnavailable', { defaultValue: 'Unavailable' })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-text-secondary">
                      <Tx
                        k="settings.downloadServers.noLocalTests"
                        fallback="No results yet."
                      />
                    </p>
                  )}
                </div>

              </div>
            </details>
          </>
        ) : (
          <p className="text-sm text-text-secondary">
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
        )}

        {feedback && (
          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${feedback === 'refreshFailed' || feedback === 'testFailed' ? 'text-state-warning' : 'text-text-secondary'}`}
          >
            {feedback === 'testFailed'
              ? t('settings.downloadServers.testError', { defaultValue: 'Test failed.' })
              : feedback === 'tested'
                ? t('settings.downloadServers.testSuccess', { defaultValue: 'Test complete.' })
              : feedback === 'refreshFailed'
              ? t('settings.downloadServers.refreshError', {
                defaultValue: 'Refresh failed.',
              })
              : t('settings.downloadServers.refreshSuccess', {
                defaultValue: 'Status refreshed.',
              })}
          </p>
        )}

        <div className="flex flex-col items-start justify-between gap-3 border-t border-white/5 pt-4 sm:flex-row sm:items-center">
          <a
            href={GAMEBANANA_FILESERVER_STATUS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-sm text-xs text-text-secondary underline decoration-dotted underline-offset-4 transition-colors hover:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <Tx k="settings.downloadServers.openGameBananaStatus" fallback="GameBanana status" />
            <ExternalLink aria-hidden className="h-3.5 w-3.5" />
          </a>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={Gauge}
              isLoading={isTesting}
              disabled={isLoading || downloadActive}
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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={RefreshCw}
              isLoading={isLoading}
              disabled={isTesting}
              onClick={() => void refreshCache()}
            >
              <Tx k="settings.downloadServers.refreshCache" fallback="Refresh status" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export { GAMEBANANA_FILESERVER_STATUS_URL };
