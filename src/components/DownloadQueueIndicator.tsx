import { useEffect, useState } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import type { DownloadQueueItem, DownloadProgressData } from '../types/electron';

interface DownloadQueueIndicatorProps {
    className?: string;
}

interface QueueState {
    queue: DownloadQueueItem[];
    currentDownload: DownloadQueueItem | null;
    progress: { downloaded: number; total: number } | null;
}

export default function DownloadQueueIndicator({ className = '' }: DownloadQueueIndicatorProps) {
    const [queueState, setQueueState] = useState<QueueState>({ queue: [], currentDownload: null, progress: null });
    const [isExpanded, setIsExpanded] = useState(false);

    useEffect(() => {
        // Fetch initial state
        Promise.all([
            window.electronAPI.getDownloadQueue(),
            window.electronAPI.getCurrentDownload(),
        ]).then(([queue, currentDownload]) => {
            setQueueState(prev => ({ ...prev, queue, currentDownload }));
        });

        // Listen for queue updates
        const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
            setQueueState(prev => ({
                ...prev,
                queue: data.queue,
                currentDownload: data.currentDownload,
            }));
        });

        // Listen for download progress
        const progressUnsub = window.electronAPI.onDownloadProgress((data: DownloadProgressData) => {
            setQueueState(prev => ({
                ...prev,
                progress: { downloaded: data.downloaded, total: data.total },
            }));
        });

        // Clear progress on complete
        const completeUnsub = window.electronAPI.onDownloadComplete(() => {
            setQueueState(prev => ({ ...prev, progress: null }));
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

    const totalItems = queueState.queue.length + (queueState.currentDownload ? 1 : 0);
    const progressPercent = queueState.progress && queueState.progress.total > 0
        ? Math.round((queueState.progress.downloaded / queueState.progress.total) * 100)
        : 0;

    if (totalItems === 0) return null;

    return (
        <div className={`bg-bg-secondary/95 backdrop-blur-sm rounded-lg border border-border shadow-xl min-w-[280px] ${className}`}>
            {/* Header - always visible */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 px-3 py-2 w-full hover:bg-bg-tertiary/50 rounded-lg transition-colors"
            >
                <Download className="w-4 h-4 text-accent" />
                <span className="text-sm text-text-primary font-medium">
                    Downloads
                </span>
                <span className="text-xs text-text-secondary">
                    ({totalItems})
                </span>
                {queueState.currentDownload && (
                    <span className="ml-auto text-xs text-accent font-medium">
                        {progressPercent}%
                    </span>
                )}
                {queueState.currentDownload && (
                    <Loader2 className="w-3 h-3 animate-spin text-accent" />
                )}
            </button>

            {/* Expanded queue list */}
            {isExpanded && (
                <div className="border-t border-border px-3 py-2 max-h-64 overflow-y-auto">
                    {/* Current download */}
                    {queueState.currentDownload && (
                        <div className="flex items-center gap-2 py-2 border-b border-border/50 mb-2">
                            <Loader2 className="w-4 h-4 animate-spin text-accent flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm text-text-primary truncate" title={queueState.currentDownload.fileName}>
                                    {queueState.currentDownload.fileName}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="flex-1 h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-accent transition-all duration-300"
                                            style={{ width: `${progressPercent}%` }}
                                        />
                                    </div>
                                    <span className="text-xs text-text-secondary">{progressPercent}%</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Queued items */}
                    {queueState.queue.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-xs text-text-secondary mb-1">Queued ({queueState.queue.length})</p>
                            {queueState.queue.map((item, index) => (
                                <div
                                    key={`${item.modId}-${item.fileId}`}
                                    className="flex items-center gap-2 py-1.5 group hover:bg-bg-tertiary/30 rounded px-1 -mx-1"
                                >
                                    <span className="w-5 h-5 flex items-center justify-center bg-bg-tertiary rounded-full text-xs text-text-secondary flex-shrink-0">
                                        {index + 1}
                                    </span>
                                    <span className="text-sm text-text-secondary truncate flex-1" title={item.fileName}>
                                        {item.fileName}
                                    </span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCancelQueued(item.modId);
                                        }}
                                        className="p-1 text-text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                                        title="Cancel"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!queueState.currentDownload && queueState.queue.length === 0 && (
                        <p className="text-sm text-text-secondary text-center py-2">No downloads</p>
                    )}
                </div>
            )}
        </div>
    );
}
