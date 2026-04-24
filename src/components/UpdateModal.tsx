import { useEffect, useState } from 'react';
import { X, Download, ArrowDownCircle, RefreshCw, Sparkles, AlertTriangle } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button } from './common/ui';

interface UpdateInfo {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | { version: string; note: string | null }[] | null;
}

interface UpdateStatus {
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: UpdateInfo | null;
}

interface Props {
    onClose: () => void;
}

export default function UpdateModal({ onClose }: Props) {
    const [appVersion, setAppVersion] = useState('');
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [checkedOnce, setCheckedOnce] = useState(false);

    useEffect(() => {
        window.electronAPI.updater.getVersion().then(setAppVersion);
        window.electronAPI.updater.getStatus().then(setStatus);
        const unsub = window.electronAPI.updater.onStatus((s) => {
            setStatus(s);
            if (!s.checking) setCheckedOnce(true);
        });
        return unsub;
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const handleCheck = async () => {
        setCheckedOnce(false);
        try {
            await window.electronAPI.updater.checkForUpdates();
        } catch (err) {
            console.error('Update check failed:', err);
        }
    };

    const handleDownload = async () => {
        try {
            await window.electronAPI.updater.downloadUpdate();
        } catch (err) {
            console.error('Update download failed:', err);
        }
    };

    const handleInstall = () => {
        window.electronAPI.updater.installUpdate();
    };

    const releaseNotes = status?.updateInfo?.releaseNotes;
    const hasNotes = Array.isArray(releaseNotes) ? releaseNotes.length > 0 : Boolean(releaseNotes);

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-modal-title"
            onClick={onClose}
        >
            <div
                className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-start justify-between p-6 border-b border-white/10">
                    <div className="min-w-0">
                        <h2 id="update-modal-title" className="text-xl font-bold text-text-primary">
                            {status?.downloaded
                                ? `v${status.updateInfo?.version} ready to install`
                                : status?.available
                                    ? `Update available — v${status.updateInfo?.version}`
                                    : 'App Updates'}
                        </h2>
                        <p className="text-sm text-text-secondary mt-1">
                            You're on <span className="font-mono text-text-primary">v{appVersion || '...'}</span>
                            {status?.updateInfo?.releaseDate && status.available && (
                                <> — released {new Date(status.updateInfo.releaseDate).toLocaleDateString()}</>
                            )}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
                        aria-label="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 min-h-0">
                    {status?.error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm mb-4">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>{status.error}</span>
                        </div>
                    )}

                    {status?.downloading && (
                        <div className="mb-4">
                            <div className="flex justify-between text-xs text-text-secondary mb-1">
                                <span>Downloading update…</span>
                                <span className="tabular-nums">{Math.round(status.progress)}%</span>
                            </div>
                            <div className="w-full bg-bg-tertiary rounded-full h-1.5 overflow-hidden">
                                <div
                                    className="bg-accent h-full rounded-full transition-all duration-300 ease-out"
                                    style={{ width: `${status.progress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {status?.downloaded && !status.downloading && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-state-success/10 border border-state-success/30 text-state-success text-sm mb-4">
                            <Sparkles className="w-4 h-4 flex-shrink-0" />
                            <span>Download complete. Click Install &amp; Restart to apply.</span>
                        </div>
                    )}

                    {!status?.available && !status?.downloaded && !status?.checking && checkedOnce && !status?.error && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-state-success/10 border border-state-success/30 text-state-success text-sm mb-4">
                            <Sparkles className="w-4 h-4 flex-shrink-0" />
                            <span>You're on the latest version.</span>
                        </div>
                    )}

                    {hasNotes ? (
                        <>
                            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                What's new
                            </h3>
                            {typeof releaseNotes === 'string' ? (
                                <div
                                    className="prose prose-invert prose-sm max-w-none"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(releaseNotes) }}
                                />
                            ) : (
                                <div className="space-y-4">
                                    {(releaseNotes as { version: string; note: string | null }[]).map((note, idx) => (
                                        <div key={idx}>
                                            <h4 className="font-semibold text-accent">v{note.version}</h4>
                                            {note.note && (
                                                <div
                                                    className="prose prose-invert prose-sm max-w-none mt-1"
                                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.note) }}
                                                />
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : !status?.available && !status?.checking && (
                        <p className="text-sm text-text-secondary">
                            Updates are delivered automatically through GitHub Releases. Click Check for Updates to look now.
                        </p>
                    )}
                </div>

                <div className="flex justify-end gap-3 p-6 border-t border-white/10">
                    <Button onClick={onClose} variant="secondary">
                        Close
                    </Button>
                    {status?.downloaded ? (
                        <Button onClick={handleInstall} icon={ArrowDownCircle}>
                            Install &amp; Restart
                        </Button>
                    ) : status?.available && !status.downloading ? (
                        <Button onClick={handleDownload} icon={Download}>
                            Download Update
                        </Button>
                    ) : (
                        <Button
                            onClick={handleCheck}
                            disabled={status?.checking || status?.downloading}
                            isLoading={status?.checking}
                            icon={RefreshCw}
                        >
                            {status?.checking ? 'Checking…' : 'Check for Updates'}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
