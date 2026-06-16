import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { X, Download, ArrowDownCircle, RefreshCw, Sparkles, AlertTriangle, Package } from 'lucide-react';
import DOMPurify from 'dompurify';
import { Button } from './common/ui';
import { Modal } from './common/Modal';

type InstallSource = 'managed' | 'appimage' | 'standard';

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
    const { t } = useTranslation();
    const [appVersion, setAppVersion] = useState('');
    const [status, setStatus] = useState<UpdateStatus | null>(null);
    const [checkedOnce, setCheckedOnce] = useState(false);
    const [installSource, setInstallSource] = useState<InstallSource>('standard');

    useEffect(() => {
        window.electronAPI.updater.getVersion().then(setAppVersion);
        window.electronAPI.updater.getStatus().then(setStatus);
        window.electronAPI.updater.getInstallSource().then(setInstallSource);
        const unsub = window.electronAPI.updater.onStatus((s) => {
            setStatus(s);
            if (!s.checking) setCheckedOnce(true);
        });
        return unsub;
    }, []);

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
        <Modal
            onClose={onClose}
            labelledBy="update-modal-title"
            size="lg"
            panelClassName="max-h-[85vh] flex flex-col overflow-hidden"
        >
                <div className="flex items-start justify-between p-6 border-b border-white/10">
                    <div className="min-w-0">
                        <h2 id="update-modal-title" className="text-xl font-bold text-text-primary">
                            {status?.downloaded
                                ? t('updateModal.titleReady', { version: status.updateInfo?.version })
                                : status?.available
                                    ? t('updateModal.titleAvailable', { version: status.updateInfo?.version })
                                    : t('updateModal.appUpdates')}
                        </h2>
                        <p className="text-sm text-text-secondary mt-1">
                            <Trans
                                i18nKey="updateModal.youReOn"
                                values={{ version: appVersion || '...' }}
                                components={{ ver: <span className="font-mono text-text-primary" /> }}
                            />
                            {status?.updateInfo?.releaseDate && status.available && (
                                <> {t('updateModal.releasedOn', { date: new Date(status.updateInfo.releaseDate).toLocaleDateString() })}</>
                            )}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
                        aria-label={t('common.actions.close')}
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto flex-1 min-h-0">
                    {installSource === 'managed' && (
                        <div className="flex items-start gap-3 p-4 rounded-lg bg-bg-tertiary border border-white/10 mb-4">
                            <Package className="w-5 h-5 flex-shrink-0 mt-0.5 text-accent" />
                            <div className="text-sm text-text-secondary space-y-2">
                                <p className="text-text-primary font-medium">{t('updateModal.managedByPackageManager')}</p>
                                <p>
                                    <Trans
                                        i18nKey="updateModal.managedDistroTools"
                                        components={{
                                            arch: <code className="font-mono text-text-primary" />,
                                            apt: <code className="font-mono text-text-primary" />,
                                        }}
                                    />
                                </p>
                                <p>
                                    <Trans
                                        i18nKey="updateModal.managedAptRepo"
                                        components={{
                                            deb: <code className="font-mono text-text-primary" />,
                                            url: <code className="font-mono text-text-primary" />,
                                        }}
                                    />
                                </p>
                            </div>
                        </div>
                    )}

                    {status?.error && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm mb-4">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <span>{status.error}</span>
                        </div>
                    )}

                    {status?.downloading && (
                        <div className="mb-4">
                            <div className="flex justify-between text-xs text-text-secondary mb-1">
                                <span>{t('updateModal.downloadingUpdate')}</span>
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
                            <span>{t('updateModal.downloadComplete')}</span>
                        </div>
                    )}

                    {!status?.available && !status?.downloaded && !status?.checking && checkedOnce && !status?.error && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-state-success/10 border border-state-success/30 text-state-success text-sm mb-4">
                            <Sparkles className="w-4 h-4 flex-shrink-0" />
                            <span>{t('updateModal.latestVersion')}</span>
                        </div>
                    )}

                    {hasNotes ? (
                        <>
                            <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
                                {t('updateModal.whatsNew')}
                                {Array.isArray(releaseNotes) && releaseNotes.length > 1 && (
                                    <span className="ml-2 normal-case tracking-normal text-text-secondary/70">
                                        {t('updateModal.releasesCount', { count: releaseNotes.length })}
                                    </span>
                                )}
                            </h3>
                            {typeof releaseNotes === 'string' ? (
                                <div
                                    className="release-notes"
                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(releaseNotes) }}
                                />
                            ) : (
                                <div className="space-y-5 divide-y divide-white/5">
                                    {(releaseNotes as { version: string; note: string | null }[]).map((note, idx) => (
                                        <div key={`${note.version}-${idx}`} className={idx > 0 ? 'pt-5' : ''}>
                                            <h4 className="font-semibold text-accent mb-2">v{note.version}</h4>
                                            {note.note ? (
                                                <div
                                                    className="release-notes"
                                                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.note) }}
                                                />
                                            ) : (
                                                <p className="text-xs text-text-secondary italic">{t('updateModal.noReleaseNotesForThisVersion')}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    ) : installSource !== 'managed' && !status?.available && !status?.checking && (
                        <p className="text-sm text-text-secondary">
                            {t('updateModal.deliveredViaGithub')}
                        </p>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 p-6 border-t border-white/10">
                    <a
                        href="https://discord.gg/KgYGHEMq2P"
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border border-brand-discord/40 bg-brand-discord/10 text-text-primary hover:bg-brand-discord/20 hover:border-brand-discord/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-discord/60 whitespace-nowrap"
                    >
                        <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                        </svg>
                        {t('settings.support.joinDiscord')}
                    </a>
                    <div className="flex items-center gap-3">
                        <Button onClick={onClose} variant="secondary">
                            {t('common.actions.close')}
                        </Button>
                        {installSource === 'managed' ? null : status?.downloaded ? (
                            <Button onClick={handleInstall} icon={ArrowDownCircle}>
                                {t('settings.updates.installRestart')}
                            </Button>
                        ) : status?.available && !status.downloading ? (
                            <Button onClick={handleDownload} icon={Download}>
                                {t('settings.updates.downloadUpdate')}
                            </Button>
                        ) : (
                            <Button
                                onClick={handleCheck}
                                disabled={status?.checking || status?.downloading}
                                isLoading={status?.checking}
                                icon={RefreshCw}
                            >
                                {status?.checking ? t('common.status.checking') : t('settings.updates.checkForUpdates')}
                            </Button>
                        )}
                    </div>
                </div>
        </Modal>
    );
}
