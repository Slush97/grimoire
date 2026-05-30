import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, X, ChevronUp, ChevronDown } from 'lucide-react';
import type { DownloadQueueItem, DownloadProgressData } from '../types/electron';

interface DownloadQueueIndicatorProps {
    className?: string;
}

interface QueueState {
    queue: DownloadQueueItem[];
    currentDownload: DownloadQueueItem | null;
    progress: { downloaded: number; total: number } | null;
}

interface SpeedSample {
    time: number;
    bytes: number;
}

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const n = bytes / Math.pow(1024, i);
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec <= 0) return '';
    return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
}

export default function DownloadQueueIndicator({ className = '' }: DownloadQueueIndicatorProps) {
    const [queueState, setQueueState] = useState<QueueState>({
        queue: [],
        currentDownload: null,
        progress: null,
    });
    const [isExpanded, setIsExpanded] = useState(false);

    // Speed/ETA derived from the rate of the current download's progress
    // stream. Anchored to the first sample after the active download
    // changes so we report average throughput for this file rather than
    // bleeding speed from the previous one.
    const sampleRef = useRef<SpeedSample | null>(null);
    const [speed, setSpeed] = useState(0);

    useEffect(() => {
        Promise.all([
            window.electronAPI.getDownloadQueue(),
            window.electronAPI.getCurrentDownload(),
        ]).then(([queue, currentDownload]) => {
            setQueueState((prev) => ({ ...prev, queue, currentDownload }));
        });

        const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
            setQueueState((prev) => {
                const nextCurrent = data.currentDownload;
                const switched =
                    prev.currentDownload?.modId !== nextCurrent?.modId ||
                    prev.currentDownload?.fileId !== nextCurrent?.fileId;
                if (switched) {
                    sampleRef.current = null;
                    setSpeed(0);
                }
                return {
                    ...prev,
                    queue: data.queue,
                    currentDownload: nextCurrent,
                    progress: switched ? null : prev.progress,
                };
            });
        });

        const progressUnsub = window.electronAPI.onDownloadProgress((data: DownloadProgressData) => {
            const now = Date.now();
            const anchor = sampleRef.current;
            if (!anchor) {
                sampleRef.current = { time: now, bytes: data.downloaded };
            } else {
                const dt = (now - anchor.time) / 1000;
                if (dt > 0.25) {
                    const rate = (data.downloaded - anchor.bytes) / dt;
                    // Light smoothing so the readout doesn't twitch every tick.
                    setSpeed((prev) => (prev <= 0 ? rate : prev * 0.7 + rate * 0.3));
                }
            }
            setQueueState((prev) => ({
                ...prev,
                progress: { downloaded: data.downloaded, total: data.total },
            }));
        });

        const completeUnsub = window.electronAPI.onDownloadComplete(() => {
            sampleRef.current = null;
            setSpeed(0);
            setQueueState((prev) => ({ ...prev, progress: null }));
        });

        return () => {
            queueUnsub();
            progressUnsub();
            completeUnsub();
        };
    }, []);

    const handleCancelQueued = async (modId: number) => {
        await window.electronAPI.removeFromQueue(modId);
    };

    const handleCancelActive = async () => {
        await window.electronAPI.cancelActiveDownload();
    };

    const totalItems = queueState.queue.length + (queueState.currentDownload ? 1 : 0);
    const progressPercent =
        queueState.progress && queueState.progress.total > 0
            ? (queueState.progress.downloaded / queueState.progress.total) * 100
            : 0;
    const progressPercentRounded = Math.round(progressPercent);

    const etaSeconds = useMemo(() => {
        if (!queueState.progress || speed <= 0) return 0;
        const remaining = queueState.progress.total - queueState.progress.downloaded;
        return remaining / speed;
    }, [queueState.progress, speed]);

    if (totalItems === 0) return null;

    const currentFileName = queueState.currentDownload?.fileName ?? 'Preparing…';
    const currentTooltip = queueState.currentDownload?.modName ?? currentFileName;

    return (
        <div className={`pointer-events-auto ${className}`}>
            {/* Collapsed pill: compact chip with filename + percent and an
                inline progress bar across the bottom edge. Clicking the body
                pops the expanded panel; the trailing X (when a download is
                actually in flight) cancels the active fetch. */}
            {!isExpanded && (
                <div
                    className="group relative flex w-72 items-stretch overflow-hidden rounded-full border border-white/10 bg-bg-secondary/95 text-left shadow-lg shadow-black/40 backdrop-blur-md transition-colors hover:border-accent/40 hover:bg-bg-tertiary/90"
                >
                    <button
                        type="button"
                        onClick={() => setIsExpanded(true)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 cursor-pointer text-left"
                        title="Show download details"
                    >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent/15">
                            {queueState.currentDownload ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                            ) : (
                                <Download className="h-3.5 w-3.5 text-accent" />
                            )}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] font-medium leading-tight text-text-primary" title={currentTooltip}>
                                {currentFileName}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
                                <span className="tabular-nums">{progressPercentRounded}%</span>
                                {speed > 0 && (
                                    <>
                                        <span className="opacity-50">·</span>
                                        <span className="tabular-nums">{formatSpeed(speed)}</span>
                                    </>
                                )}
                                {totalItems > 1 && (
                                    <>
                                        <span className="opacity-50">·</span>
                                        <span>{totalItems - 1} queued</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <ChevronUp className="h-4 w-4 flex-shrink-0 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                    {queueState.currentDownload && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                void handleCancelActive();
                            }}
                            className="flex flex-shrink-0 items-center justify-center border-l border-white/5 px-3 text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
                            aria-label="Cancel download"
                            title="Cancel download"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                    <span
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-white/5"
                    >
                        <span
                            className="block h-full bg-accent transition-[width] duration-200 ease-out"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </span>
                </div>
            )}

            {/* Expanded panel: opens upward (transform-origin-bottom) so the
                pill stays anchored to the corner. Shows full progress detail
                + the queue. */}
            {isExpanded && (
                <div className="w-80 rounded-2xl border border-white/10 bg-bg-secondary/95 shadow-2xl shadow-black/50 backdrop-blur-md animate-fade-in">
                    <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <Download className="h-4 w-4 text-accent" />
                            <span className="text-sm font-semibold text-text-primary">Downloads</span>
                            <span className="text-xs text-text-secondary">({totalItems})</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsExpanded(false)}
                            className="rounded-md p-1 text-text-secondary hover:bg-white/5 hover:text-text-primary transition-colors cursor-pointer"
                            aria-label="Collapse"
                            title="Collapse"
                        >
                            <ChevronDown className="h-4 w-4" />
                        </button>
                    </div>

                    {queueState.currentDownload && (
                        <div className="px-4 py-3 border-b border-white/5">
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-accent" />
                                <p
                                    className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary"
                                    title={currentTooltip}
                                >
                                    {currentFileName}
                                </p>
                                <span className="text-xs tabular-nums text-accent font-semibold">
                                    {progressPercentRounded}%
                                </span>
                                <button
                                    type="button"
                                    onClick={() => void handleCancelActive()}
                                    className="rounded-md p-1 text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-300 cursor-pointer"
                                    aria-label="Cancel download"
                                    title="Cancel download"
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-accent/80 to-accent transition-[width] duration-200 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div className="mt-2 flex items-center justify-between text-[11px] text-text-secondary tabular-nums">
                                <span>
                                    {queueState.progress
                                        ? `${formatBytes(queueState.progress.downloaded)} / ${formatBytes(queueState.progress.total)}`
                                        : '—'}
                                </span>
                                <span className="flex items-center gap-2">
                                    {speed > 0 && <span>{formatSpeed(speed)}</span>}
                                    {etaSeconds > 0 && (
                                        <>
                                            <span className="opacity-50">·</span>
                                            <span>{formatEta(etaSeconds)} left</span>
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>
                    )}

                    {queueState.queue.length > 0 && (
                        <div className="px-4 py-2 max-h-56 overflow-y-auto">
                            <p className="text-[11px] uppercase tracking-wider text-text-secondary mb-1">
                                Queued ({queueState.queue.length})
                            </p>
                            <ul className="space-y-0.5">
                                {queueState.queue.map((item, index) => (
                                    <li
                                        key={`${item.modId}-${item.fileId}`}
                                        className="group flex items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/5"
                                    >
                                        <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-white/5 text-[10px] tabular-nums text-text-secondary">
                                            {index + 1}
                                        </span>
                                        <span
                                            className="flex-1 truncate text-xs text-text-secondary"
                                            title={item.modName ?? item.fileName}
                                        >
                                            {item.fileName}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                void handleCancelQueued(item.modId);
                                            }}
                                            className="rounded-md p-1 text-text-secondary opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 cursor-pointer"
                                            title="Remove from queue"
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {!queueState.currentDownload && queueState.queue.length === 0 && (
                        <p className="px-4 py-3 text-xs text-text-secondary text-center">No downloads</p>
                    )}
                </div>
            )}
        </div>
    );
}
