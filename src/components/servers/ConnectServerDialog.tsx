import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Download, CheckCircle2, AlertTriangle, Play } from 'lucide-react';
import { Button } from '../common/ui';
import { Modal } from '../common/Modal';
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

const STATUS_LABEL: Record<DeadworksConnectProgress['status'], string> = {
  fetching: 'Checking server content',
  checking: 'Verifying files',
  downloading: 'Downloading content',
  decompressing: 'Unpacking content',
  ready: 'Ready',
  connecting: 'Handing off to Steam',
};

function formatBytes(n: number): string {
  if (!n || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ConnectServerDialog({ server, onClose }: Props) {
  const [progress, setProgress] = useState<DeadworksConnectProgress | null>(null);
  const [phase, setPhase] = useState<Phase>('working');
  const [message, setMessage] = useState('Preparing to connect...');
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
            setMessage('Launching Deadlock through Steam. Accept any Steam prompt to join.');
          } else {
            setPhase('error');
            setMessage(result.message);
          }
        })
        .catch((e: unknown) => {
          setPhase('error');
          setMessage(e instanceof Error ? e.message : 'Connection failed.');
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
            aria-label="Close"
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
                    {progress ? STATUS_LABEL[progress.status] : 'Preparing...'}
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
                Done
              </Button>
            </div>
          )}

          {phase === 'error' && (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <AlertTriangle size={40} className="text-red-500" />
              <p className="text-sm text-text-secondary">{message}</p>
              <Button variant="secondary" onClick={onClose} className="mt-2">
                Close
              </Button>
            </div>
          )}
        </div>
    </Modal>
  );
}
