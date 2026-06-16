import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Download, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { Modal } from '../common/Modal';
import Tx from '../translation/Tx';
import {
  deadworksConnect,
  deadworksOnDownloadProgress,
  type DeadworksServer,
  type DeadworksConnectProgress,
} from '../../lib/api';

interface Props {
  server: DeadworksServer;
  onClose: () => void;
}

type Phase = 'working' | 'done' | 'error';
type MessageKey = 'preparing' | 'launching' | 'connectionFailed';

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function renderStatusLabel(status: DeadworksConnectProgress['status']) {
  switch (status) {
    case 'checking':
      return <Tx k="servers.connect.status.checking" fallback="Verifying files" />;
    case 'downloading':
      return <Tx k="servers.connect.status.downloading" fallback="Downloading content" />;
    case 'decompressing':
      return <Tx k="servers.connect.status.decompressing" fallback="Unpacking content" />;
    case 'ready':
      return <Tx k="servers.connect.status.ready" fallback="Ready" />;
    case 'connecting':
      return <Tx k="servers.connect.status.connecting" fallback="Handing off to Steam" />;
    default:
      return <Tx k="servers.connect.status.fetching" fallback="Checking server content" />;
  }
}

export default function ConnectServerDialog({ server, onClose }: Props) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<DeadworksConnectProgress | null>(null);
  const [phase, setPhase] = useState<Phase>('working');
  const [messageKey, setMessageKey] = useState<MessageKey>('preparing');
  const [messageText, setMessageText] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    // Subscribe before kicking off so we never miss the first progress event.
    const unsubscribe = deadworksOnDownloadProgress((p) => setProgress(p));

    if (!startedRef.current) {
      startedRef.current = true;
      deadworksConnect(server.id, server.raw_address)
        .then((result) => {
          if (result.success) {
            setPhase('done');
            setMessageKey('launching');
            setMessageText('');
          } else {
            setPhase('error');
            setMessageText(result.message);
          }
        })
        .catch((e: unknown) => {
          setPhase('error');
          if (e instanceof Error) {
            setMessageText(e.message);
          } else {
            setMessageKey('connectionFailed');
            setMessageText('');
          }
        });
    }

    return unsubscribe;
  }, [server.id, server.raw_address]);

  // Per-item download bar. Decompression has no reliable total, so we show an
  // indeterminate shimmer for that phase instead of a misleading percentage.
  const pct =
    progress && progress.totalBytes > 0 && progress.status === 'downloading'
      ? Math.min(100, Math.round((progress.bytesDownloaded / progress.totalBytes) * 100))
      : null;
  const indeterminate = progress?.status === 'decompressing';
  const message = messageText || (
    messageKey === 'launching'
      ? t('servers.connect.launchingSteam')
      : messageKey === 'connectionFailed'
        ? t('servers.connect.connectionFailed')
        : t('servers.connect.preparingToConnect')
  );

  return (
    <Modal
      onClose={onClose}
      labelledBy="connect-server-title"
      size="sm"
      dismissable={phase !== 'working'}
      backdropClassName="backdrop-blur-sm"
    >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="connect-server-title" className="font-reaver text-lg tracking-wide text-text-primary truncate">{server.name}</h2>
          <button
            onClick={onClose}
            disabled={phase === 'working'}
            className="rounded-sm p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t('common.actions.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-5">
          {phase === 'working' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-text-primary">
                {progress?.status === 'downloading' || progress?.status === 'decompressing' ? (
                  <Download size={20} className="text-accent" />
                ) : (
                  <Loader2 size={20} className="animate-spin text-accent" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {progress ? (
                      renderStatusLabel(progress.status)
                    ) : (
                      <Tx k="servers.connect.preparing" fallback="Preparing..." />
                    )}
                  </div>
                  {progress?.name && (
                    <div className="truncate text-xs text-text-secondary">
                      {progress.name}
                      {progress.totalItems > 1 && (
                        <span className="ml-1 text-text-secondary/70">
                          ({progress.itemIndex + 1}/{progress.totalItems})
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
                {indeterminate ? (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
                ) : (
                  <div
                    className="h-full rounded-full bg-accent transition-all duration-200"
                    style={{ width: `${pct ?? 8}%` }}
                  />
                )}
              </div>

              {pct !== null && (
                <div className="flex justify-between text-xs text-text-secondary">
                  <span>{pct}%</span>
                  <span>
                    {formatBytes(progress!.bytesDownloaded)} / {formatBytes(progress!.totalBytes)}
                  </span>
                </div>
              )}
            </div>
          )}

          {phase === 'done' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <CheckCircle2 size={40} className="text-green-400" />
              <p className="text-sm text-text-secondary">{message}</p>
              <Button variant="primary" icon={Play} onClick={onClose} className="mt-2">
                <Tx k="common.actions.done" fallback="Done" />
              </Button>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <AlertTriangle size={40} className="text-red-500" />
              <p className="text-sm text-text-secondary">{message}</p>
              <Button variant="secondary" onClick={onClose} className="mt-2">
                <Tx k="common.actions.close" fallback="Close" />
              </Button>
            </div>
          )}
        </div>
    </Modal>
  );
}
