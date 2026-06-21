import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { RefreshCw } from 'lucide-react';
import type { SyncProgressData } from '../types/electron';

interface SyncIndicatorProps {
    className?: string;
}

// The section names ('Mod', 'Sound', 'Gui', 'Model', 'Wip') arrive from the
// main process as raw English identifiers; map them to localized labels, falling
// back to the raw value for anything unmapped.
function localizedSection(section: string, t: TFunction): string {
    return t(`sync.sections.${section}`, { defaultValue: section });
}

export default function SyncIndicator({ className = '' }: SyncIndicatorProps) {
    const { t } = useTranslation();
    const [syncProgress, setSyncProgress] = useState<SyncProgressData | null>(null);

    useEffect(() => {
        const unsub = window.electronAPI.onSyncProgress((data) => {
            if (data.phase === 'complete' || data.phase === 'error') {
                // Clear after a short delay when complete
                setTimeout(() => setSyncProgress(null), 2000);
            }
            setSyncProgress(data);
        });

        return () => unsub();
    }, []);

    if (!syncProgress || syncProgress.phase === 'complete') return null;

    const percent = syncProgress.totalMods > 0
        ? Math.round((syncProgress.modsProcessed / syncProgress.totalMods) * 100)
        : 0;

    return (
        <div className={`flex items-center gap-2 px-3 py-1.5 bg-bg-secondary/80 backdrop-blur-sm rounded-lg text-sm ${className}`}>
            <RefreshCw className="w-4 h-4 animate-spin text-accent" />
            <span className="text-text-secondary">
                {syncProgress.phase === 'error'
                    ? t('sync.error', { section: localizedSection(syncProgress.section, t) })
                    : t('sync.syncing', { section: localizedSection(syncProgress.section, t), percent })}
            </span>
        </div>
    );
}
