import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Replace, X, ChevronUp, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
    DownloadEventData,
    DownloadProgressData,
    DownloadServerStatusData,
} from '../types/electron';
import { formatBytes } from '../lib/formatBytes';
import { rollPreparingSuffix } from '../lib/easterEggs';
import { showToast } from '../stores/toastStore';
import { useModUpdatesStore } from '../stores/modUpdatesStore';
import DownloadQueueRows from './downloads/DownloadQueueRows';
import Tx from './translation/Tx';
import {
    cancelDownloadRequest,
    getVisibleDownloadQueue,
    useDownloadActivity,
} from '../lib/downloadActivity';

interface DownloadQueueIndicatorProps {
    className?: string;
}
type QueueView = 'collapsed' | 'preview' | 'expanded';

interface SpeedSample {
    target: string;
    time: number;
    bytes: number;
}

function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec <= 0) return '';
    return `${formatBytes(bytesPerSec)}/s`;
}

function formatEta(seconds: number, t: TFunction): string {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds < 60) return t('downloadQueue.eta.seconds', { count: Math.round(seconds) });
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    if (m < 60) return t('downloadQueue.eta.minutesSeconds', { minutes: m, seconds: s });
    const h = Math.floor(m / 60);
    return t('downloadQueue.eta.hoursMinutes', { hours: h, minutes: m % 60 });
}

export default function DownloadQueueIndicator({ className = '' }: DownloadQueueIndicatorProps) {
    const { t } = useTranslation();
    const downloadActivity = useDownloadActivity();
    const manualRequests = useModUpdatesStore((state) => state.state.manualRequests);
    const preparingUpdates = useModUpdatesStore((state) => state.state.preparing || state.submittingModIds.size > 0);
    const openReplacement = useModUpdatesStore((state) => state.openRequest);
    const { current, queue, requested } = downloadActivity;
    const visibleDownloads = useMemo(() => getVisibleDownloadQueue({ current, queue, requested }), [current, queue, requested]);
    const queueState = {
        queue: visibleDownloads.queue,
        currentDownload: visibleDownloads.current,
        progress: downloadActivity.current ? downloadActivity.progress : null,
    };
    const [isExpanded, setIsExpanded] = useState(false);
    const [collapsing, setCollapsing] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [keyboardFocused, setKeyboardFocused] = useState(false);
    const frameRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const viewsRef = useRef<Record<QueueView, HTMLDivElement | null>>({ collapsed: null, preview: null, expanded: null });
    const restoreFocusRef = useRef(false);
    const panelId = useId();
    const view: QueueView = isExpanded ? 'expanded' : !collapsing && (hovered || keyboardFocused) ? 'preview' : 'collapsed';
    const changeExpanded = (expanded: boolean) => {
        restoreFocusRef.current = !!frameRef.current?.contains(document.activeElement);
        if (!expanded) {
            setHovered(false);
            setCollapsing(true);
        } else setCollapsing(false);
        setIsExpanded(expanded);
    };
    useEffect(() => {
        if (!collapsing) return;
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // Match the frame's duration-300 transition, including reduced motion.
        const timer = window.setTimeout(() => setCollapsing(false), reducedMotion ? 0 : 300);
        return () => window.clearTimeout(timer);
    }, [collapsing]);
    const [cancellingQueued, setCancellingQueued] = useState(false);
    const [serverStatus, setServerStatus] = useState<DownloadServerStatusData | null>(null);

    // Speed/ETA derived from the rate of the current download's progress
    // stream. Advance the sample window after each reading so fast transfers
    // cannot update React state for every network chunk after the first 250ms.
    const sampleRef = useRef<SpeedSample | null>(null);
    const [speedState, setSpeedState] = useState<{ job: string | null; target: string | null; value: number }>({
        job: null,
        target: null,
        value: 0,
    });
    const [preparingSuffix] = useState(rollPreparingSuffix);
    const currentTarget = queueState.currentDownload
        ? `${queueState.currentDownload.modId}:${queueState.currentDownload.fileId}`
        : null;
    const currentJob = queueState.currentDownload?.jobId ?? currentTarget;
    if (speedState.job !== currentJob) {
        setSpeedState({ job: currentJob, target: null, value: 0 });
    }

    useEffect(() => {
        sampleRef.current = null;
        const progressUnsub = window.electronAPI.onDownloadProgress((data: DownloadProgressData) => {
            const now = Date.now();
            if (`${data.modId}:${data.fileId}` !== currentTarget || (data.jobId && data.jobId !== currentJob)) return;
            const target = currentJob!;
            const anchor = sampleRef.current;
            if (!anchor || anchor.target !== target || data.downloaded < anchor.bytes) {
                sampleRef.current = { target, time: now, bytes: data.downloaded };
                setSpeedState({ job: currentJob, target, value: 0 });
            } else {
                const dt = (now - anchor.time) / 1000;
                if (dt >= 0.25) {
                    const rate = Math.max(0, (data.downloaded - anchor.bytes) / dt);
                    sampleRef.current = { target, time: now, bytes: data.downloaded };
                    // Light smoothing so the readout doesn't twitch every tick.
                    setSpeedState((prev) => ({
                        job: currentJob,
                        target,
                        value: prev.target !== target || prev.value <= 0
                            ? rate
                            : prev.value * 0.7 + rate * 0.3,
                    }));
                }
            }
        });

        const resetTransfer = ({ modId, fileId, jobId }: DownloadEventData) => {
            if (`${modId}:${fileId}` === currentTarget && (!jobId || jobId === currentJob)) {
                sampleRef.current = null;
                setSpeedState({ job: currentJob, target: null, value: 0 });
            }
            setServerStatus((status) => status?.modId === modId && status.fileId === fileId ? null : status);
        };
        const completeUnsub = window.electronAPI.onDownloadComplete(resetTransfer);
        const errorUnsub = window.electronAPI.onDownloadError(resetTransfer);

        const serverStatusUnsub = window.electronAPI.onDownloadServerStatus(setServerStatus);

        return () => {
            progressUnsub();
            completeUnsub();
            errorUnsub();
            serverStatusUnsub();
        };
    }, [currentTarget, currentJob]);
    const currentSpeed = speedState.job === currentJob && speedState.target === currentJob ? speedState.value : 0;

    const handleCancelQueued = useCallback(async (modId: number, fileId: number, jobId?: string) => {
        cancelDownloadRequest(modId, fileId);
        await window.electronAPI.cancelDownloadTarget(modId, fileId, jobId);
    }, []);

    const handleCancelActive = async () => {
        const current = queueState.currentDownload;
        if (!current) return;
        cancelDownloadRequest(current.modId, current.fileId);
        await window.electronAPI.cancelDownloadTarget(current.modId, current.fileId, current.jobId);
    };

    const handleCancelAllQueued = async () => {
        if (cancellingQueued) return;
        setCancellingQueued(true);
        const pendingTargets = queueState.queue.filter(item => !item.jobId)
            .map(({ modId, fileId }) => ({ modId, fileId }));
        queueState.queue.forEach(({ modId, fileId }) => cancelDownloadRequest(modId, fileId));
        try {
            await window.electronAPI.cancelQueuedDownloads(pendingTargets);
        } catch {
            showToast(t('downloadQueue.cancelAllFailed'), { tone: 'error' });
        } finally {
            setCancellingQueued(false);
        }
    };

    const totalItems = queueState.queue.length + (queueState.currentDownload ? 1 : 0) + manualRequests.length;
    const progressPercent =
        queueState.progress && queueState.progress.total > 0
            ? (queueState.progress.downloaded / queueState.progress.total) * 100
            : 0;
    const progressPercentRounded = Math.round(progressPercent);

    const etaSeconds = useMemo(() => {
        if (!queueState.progress || currentSpeed <= 0) return 0;
        const remaining = queueState.progress.total - queueState.progress.downloaded;
        return remaining / currentSpeed;
    }, [queueState.progress, currentSpeed]);

    const visible = totalItems > 0 || preparingUpdates;
    if (!visible && (hovered || keyboardFocused)) {
        setHovered(false);
        setKeyboardFocused(false);
    }

    useLayoutEffect(() => {
        const frame = frameRef.current;
        const content = viewsRef.current[view];
        if (!visible || !frame || !content) return;
        // Each view retains its own intrinsic layout. Only the clipping frame
        // changes size, so text never reflows during the size transition.
        const transitionEnds = performance.now() + 300;
        const measure = (contentChanged = false) => {
            const bounds = content.getBoundingClientRect();
            const width = `${Math.ceil(bounds.width)}px`;
            const height = `${Math.ceil(bounds.height)}px`;
            if (frame.style.width === width && frame.style.height === height) return;
            const instant = contentChanged && performance.now() >= transitionEnds;
            if (instant) frame.style.transitionProperty = 'none';
            frame.style.width = width;
            frame.style.height = height;
            if (instant) {
                // Commit content-driven sizes immediately without affecting view transitions.
                frame.getBoundingClientRect();
                frame.style.transitionProperty = '';
            }
        };
        measure();
        if (restoreFocusRef.current) {
            restoreFocusRef.current = false;
            const target = view === 'expanded' ? content.querySelector('button') : triggerRef.current;
            target?.focus({ preventScroll: true });
        }
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure(true));
        observer?.observe(content);
        return () => observer?.disconnect();
    }, [view, visible]);

    if (!visible) return null;

    const currentFileName =
        queueState.currentDownload?.fileName ?? (preparingUpdates || queueState.queue.length > 0
            ? t('downloadQueue.preparing') + preparingSuffix
            : t('installed.updateAll.needsManualReplacement'));
    const currentTooltip = queueState.currentDownload?.modName ?? currentFileName;
    const currentServerStatus = queueState.currentDownload
        && serverStatus?.modId === queueState.currentDownload.modId
        && serverStatus.fileId === queueState.currentDownload.fileId
        && (!serverStatus.jobId || serverStatus.jobId === queueState.currentDownload.jobId)
        ? serverStatus
        : null;
    const serverStatusText = currentServerStatus
        ? currentServerStatus.phase === 'switching'
            ? t('downloadQueue.serverSwitching', {
                server: currentServerStatus.previousServer ?? currentServerStatus.server,
            })
            : t('downloadQueue.serverAutomatic', { server: currentServerStatus.server })
        : '';

    const activityIcon = queueState.currentDownload || preparingUpdates
        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
        : manualRequests.length > 0 ? <Replace className="h-3.5 w-3.5 text-accent" />
            : <Download className="h-3.5 w-3.5 text-accent" />;
    const summary = [
        queueState.currentDownload ? `${progressPercentRounded}%` : '',
        currentSpeed > 0 ? formatSpeed(currentSpeed) : '',
        totalItems > 1 ? t('downloadQueue.remainingQueued', { count: totalItems - 1 }) : '',
    ].filter(Boolean).join(' · ');
    const layerClasses = 'absolute bottom-0 right-0 transition-opacity duration-200 ease-in-out motion-reduce:transition-none';
    const contentLimit = 'max-w-[min(20rem,calc(100vw-2rem))]';

    return (
        <div className={`pointer-events-auto ${className}`}
            onPointerEnter={event => { if (event.pointerType !== 'touch' && !collapsing) setHovered(true); }}
            onPointerLeave={() => setHovered(false)}
            onPointerDownCapture={() => setKeyboardFocused(false)}
            onFocusCapture={event => setKeyboardFocused(event.target.matches(':focus-visible'))}
            onBlurCapture={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardFocused(false);
            }}
            onKeyDown={event => {
                if (event.key === 'Escape' && isExpanded) {
                    event.preventDefault();
                    event.stopPropagation();
                    changeExpanded(false);
                }
            }}>
            <div ref={frameRef} data-download-view={view}
                className="relative overflow-hidden rounded-xl bg-bg-secondary/95 ring-1 ring-inset ring-hl/10 shadow-xl shadow-shade/40 backdrop-blur-md transition-[width,height,background-color,box-shadow] duration-300 ease-in-out motion-reduce:transition-none">
                <button ref={triggerRef} type="button" onClick={() => changeExpanded(true)}
                    aria-label={t('downloadQueue.showDetails')} aria-expanded={isExpanded} aria-controls={panelId}
                    aria-description={`${currentFileName}${summary ? `, ${summary}` : ''}`}
                    aria-hidden={isExpanded} inert={isExpanded}
                    className={`absolute inset-0 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${isExpanded ? 'pointer-events-none' : ''}`}>
                    <div ref={node => { viewsRef.current.collapsed = node; }} data-download-panel="collapsed" aria-hidden={view !== 'collapsed'}
                        className={`${layerClasses} flex h-9 w-max items-center gap-2 px-2.5 text-xs tabular-nums text-text-secondary ${contentLimit} ${view === 'collapsed' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                        {activityIcon}
                        {queueState.currentDownload ? `${progressPercentRounded}%` : totalItems > 0 ? totalItems : null}
                    </div>
                    <div ref={node => { viewsRef.current.preview = node; }} data-download-panel="preview" aria-hidden={view !== 'preview'}
                        className={`${layerClasses} flex w-max items-center gap-2 px-2.5 py-2 ${contentLimit} ${view === 'preview' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15">{activityIcon}</span>
                        <span className="min-w-0 flex-auto">
                            <span className="block truncate text-xs font-medium leading-4 text-text-primary" title={currentTooltip}>{currentFileName}</span>
                            {summary && <span className="mt-0.5 block truncate text-2xs tabular-nums leading-4 text-text-secondary">{summary}</span>}
                        </span>
                        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-text-secondary" />
                    </div>
                </button>
                <div ref={node => { viewsRef.current.expanded = node; }} data-download-panel="expanded" id={panelId} role="region" aria-label={t('downloadQueue.downloads')}
                    aria-hidden={view !== 'expanded'} inert={view !== 'expanded'}
                    className={`${layerClasses} w-80 ${contentLimit} ${view === 'expanded' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                    <div className="flex items-center justify-between border-b border-hl/5 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <Download className="h-4 w-4 text-accent" />
                            <span className="text-sm font-semibold text-text-primary">
                                <Tx k="downloadQueue.downloads" fallback="Downloads" />
                            </span>
                            <span className="text-xs text-text-secondary">({totalItems})</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => changeExpanded(false)}
                            className="rounded-md p-1 text-text-secondary hover:bg-hl/5 hover:text-text-primary transition-colors cursor-pointer"
                            aria-label={t('downloadQueue.collapse')}
                            title={t('downloadQueue.collapse')}
                        >
                            <ChevronDown className="h-4 w-4" />
                        </button>
                    </div>

                    {queueState.currentDownload && (
                        <div className="px-4 py-3 border-b border-hl/5">
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
                                    className="rounded-md p-1 text-text-secondary transition-colors hover:bg-state-danger/10 hover:text-state-danger cursor-pointer"
                                    aria-label={t('downloadQueue.cancelDownload')}
                                    title={t('downloadQueue.cancelDownload')}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hl/5">
                                <div
                                    className="h-full rounded-full bg-gradient-to-r from-accent/80 to-accent transition-[width] duration-200 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <p className="mt-1 h-4 truncate text-2xs leading-4 text-text-secondary" title={serverStatusText || undefined}>
                                {serverStatusText}
                            </p>
                            <div className="mt-2 flex items-center justify-between text-2xs text-text-secondary tabular-nums">
                                <span>
                                    {queueState.progress
                                        ? `${formatBytes(queueState.progress.downloaded)} / ${formatBytes(queueState.progress.total)}`
                                        : '-'}
                                </span>
                                <span className="flex items-center gap-2">
                                    {currentSpeed > 0 && <span>{formatSpeed(currentSpeed)}</span>}
                                    {etaSeconds > 0 && (
                                        <>
                                            <span className="opacity-50">·</span>
                                            <span>{t('downloadQueue.eta.left', { eta: formatEta(etaSeconds, t) })}</span>
                                        </>
                                    )}
                                </span>
                            </div>
                        </div>
                    )}

                    {(queueState.queue.length > 0 || manualRequests.length > 0) && (
                        <div className="px-4 py-2 max-h-56 overflow-y-auto">
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <p className="text-2xs uppercase tracking-wider text-text-secondary">
                                    <Tx
                                        k="downloadQueue.queuedHeader"
                                        values={{ count: queueState.queue.length + manualRequests.length }}
                                        fallback={`Queued (${queueState.queue.length + manualRequests.length})`}
                                    />
                                </p>
                                <button
                                    type="button"
                                    disabled={cancellingQueued}
                                    onClick={() => void handleCancelAllQueued()}
                                    className="shrink-0 cursor-pointer text-2xs text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50"
                                >
                                    {t('downloadQueue.cancelAll')}
                                </button>
                            </div>
                            <DownloadQueueRows items={queueState.queue} manualRequests={manualRequests}
                                priorityDeferred={queueState.currentDownload?.phase === 'installing' || queueState.currentDownload?.phase === 'finalizing'}
                                onCancel={handleCancelQueued} onOpenReplacement={openReplacement} />
                        </div>
                    )}

                    {!queueState.currentDownload && queueState.queue.length === 0 && manualRequests.length === 0 && (
                        <p className="px-4 py-3 text-xs text-text-secondary text-center">
                            {preparingUpdates ? t('downloadQueue.preparing') : <Tx k="downloadQueue.noDownloads" fallback="No downloads" />}
                        </p>
                    )}
                </div>
                <span aria-hidden className={`pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-hl/5 transition-opacity duration-200 motion-reduce:transition-none ${isExpanded ? 'opacity-0' : 'opacity-100'}`}>
                    <span className="block h-full bg-accent transition-[width] duration-200 ease-out motion-reduce:transition-none" style={{ width: `${progressPercent}%` }} />
                </span>
            </div>
        </div>
    );
}
