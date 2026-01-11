import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { SyncProgressData } from '../types/electron';

interface SyncIndicatorProps {
    className?: string;
}

export default function SyncIndicator({ className = '' }: SyncIndicatorProps) {
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
                    ? `Sync error: ${syncProgress.section}`
                    : `Syncing ${syncProgress.section}: ${percent}%`}
            </span>
        </div>
    );
}
