import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, HardDrive, RefreshCw, Trash2, Wrench } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import { cleanupAddons } from '../../../lib/api';
import { getActiveDeadlockPath } from '../../../lib/appSettings';
import { Badge, Button, Card } from '../../common/ui';
import { ConfirmModal } from '../../common/PageComponents';
import Tx from '../../translation/Tx';

/** Human-readable byte size (MB below a GB, GB above). */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

// Housekeeping: leftover archives, the setup wizard, and the two on-disk caches.
export default function MaintenanceSection() {
  const { t } = useTranslation();
  const { settings, saveSettings } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);

  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<Record<string, { lastSync: number; count: number } | null> | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ section: string; modsProcessed: number; totalMods: number } | null>(null);
  const [isWipingCache, setIsWipingCache] = useState(false);
  const [wipeResult, setWipeResult] = useState<string | null>(null);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);

  const [previewCacheBytes, setPreviewCacheBytes] = useState<number | null>(null);
  const [isClearingPreview, setIsClearingPreview] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewConfirmOpen, setPreviewConfirmOpen] = useState(false);

  useEffect(() => {
    window.electronAPI
      .getSyncStatus()
      .then(setSyncStatus)
      .catch((err) => console.error('Failed to load sync status:', err));
  }, []);

  useEffect(() => {
    window.electronAPI
      .getPreviewCacheSize()
      .then((r) => setPreviewCacheBytes(r.bytes))
      .catch(() => setPreviewCacheBytes(null));
  }, []);

  // A sync outlives this component: it runs in main, and switching settings
  // panes unmounts us. Ask main whether one is already running so we come back
  // showing the spinner instead of an idle button that quietly no-ops (main
  // refuses a second sync while one is in flight).
  useEffect(() => {
    window.electronAPI
      .isSyncInProgress()
      .then(setIsSyncing)
      .catch(() => {});
  }, []);

  // Listen for sync progress
  useEffect(() => {
    const unsub = window.electronAPI.onSyncProgress((data) => {
      if (data.phase === 'fetching') {
        setSyncProgress({ section: data.section, modsProcessed: data.modsProcessed, totalMods: data.totalMods });
      } else if (data.phase === 'complete') {
        setSyncProgress(null);
        // Also clears the button for a sync we adopted on mount rather than
        // started ourselves: that one has no handler waiting on it to finish.
        setIsSyncing(false);
        // Reload sync status after completion
        window.electronAPI.getSyncStatus().then(setSyncStatus);
      }
    });
    return unsub;
  }, []);

  const handleCleanup = async () => {
    setIsCleaning(true);
    setCleanupResult(null);
    try {
      const result = await cleanupAddons();
      setCleanupResult(t('settings.maintenance.archivesRemoved', { count: result.removedArchives }));
    } catch (err) {
      setCleanupResult(String(err));
    } finally {
      setIsCleaning(false);
    }
  };

  const handleResetWizard = async () => {
    setResetConfirmOpen(false);
    if (!settings) return;
    try {
      await saveSettings({ ...settings, hasCompletedSetup: false });
      setResetResult(t('settings.setupWizard.resetResult'));
      setTimeout(() => setResetResult(null), 5000);
    } catch (err) {
      setResetResult(`Error: ${String(err)}`);
    }
  };

  const handleSyncDatabase = async () => {
    setIsSyncing(true);
    setSyncProgress(null);
    try {
      await window.electronAPI.syncAllMods();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleWipeCache = async () => {
    setWipeConfirmOpen(false);
    setIsWipingCache(true);
    setWipeResult(null);
    try {
      await window.electronAPI.wipeModCache();
      const status = await window.electronAPI.getSyncStatus();
      setSyncStatus(status);
      setWipeResult(t('settings.cache.cleared'));
    } catch (err) {
      setWipeResult(String(err));
    } finally {
      setIsWipingCache(false);
    }
  };

  const handleClearPreviewCache = async () => {
    setPreviewConfirmOpen(false);
    setIsClearingPreview(true);
    setPreviewResult(null);
    try {
      const { bytesFreed } = await window.electronAPI.clearPreviewCache();
      setPreviewCacheBytes(0);
      setPreviewResult(t('settings.cache.previewCleared', { size: formatBytes(bytesFreed) }));
    } catch (err) {
      setPreviewResult(String(err));
    } finally {
      setIsClearingPreview(false);
    }
  };

  const totalCachedMods = syncStatus
    ? Object.values(syncStatus).reduce((sum, s) => sum + (s?.count ?? 0), 0)
    : 0;

  const lastSyncTime = syncStatus
    ? Math.max(...Object.values(syncStatus).filter(Boolean).map((s) => s!.lastSync))
    : 0;

  return (
    <>
      <Card title={<Tx k="settings.sections.maintenance" fallback="Maintenance" />} icon={Wrench}>
        <div className="space-y-6">
          <div className="flex justify-between items-start gap-4">
            <div>
              <h4 className="font-medium text-sm">
                <Tx k="settings.maintenance.cleanupAddons" fallback="Cleanup Addons Folder" />
              </h4>
              <p className="text-xs text-text-secondary mt-1">
                <Tx
                  k="settings.maintenance.cleanupDescription"
                  fallback="Remove leftover archive downloads (zip, 7z)."
                />
              </p>
              {cleanupResult && (
                <p className="text-xs text-accent-ink mt-2 animate-fade-in">{cleanupResult}</p>
              )}
            </div>
            <Button
              onClick={handleCleanup}
              disabled={isCleaning || !activeDeadlockPath}
              isLoading={isCleaning}
              variant="secondary"
              size="sm"
              icon={Trash2}
            >
              <Tx k="settings.maintenance.cleanup" fallback="Cleanup" />
            </Button>
          </div>

          <div className="h-px bg-hl/5" />

          <div className="flex justify-between items-start gap-4">
            <div>
              <h4 className="font-medium text-sm">
                <Tx k="settings.setupWizard.title" fallback="Reset Setup Wizard" />
              </h4>
              <p className="text-xs text-text-secondary mt-1">
                <Tx
                  k="settings.setupWizard.description"
                  fallback="Show the first-run setup wizard again on next app launch."
                />
              </p>
              {resetResult && (
                <p className="text-xs text-accent-ink mt-2 animate-fade-in">{resetResult}</p>
              )}
            </div>
            <Button
              onClick={() => setResetConfirmOpen(true)}
              variant="secondary"
              size="sm"
              icon={RefreshCw}
            >
              <Tx k="common.actions.reset" fallback="Reset" />
            </Button>
          </div>
        </div>
      </Card>

      <Card title={<Tx k="settings.sections.modDatabaseCache" fallback="Mod Database Cache" />} icon={Database}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-2">
              <div className="text-2xl font-bold font-valvepulp text-text-primary">
                {syncStatus ? totalCachedMods.toLocaleString() : '---'}
              </div>
              <Badge variant="info">
                <Tx k="settings.cache.cachedMods" fallback="Cached Mods" />
              </Badge>
            </div>
            <p className="text-xs text-text-secondary">
              {lastSyncTime > 0
                ? t('settings.cache.lastSynchronized', { date: new Date(lastSyncTime * 1000).toLocaleString() })
                : t('settings.cache.neverSynchronized')}
            </p>

            {syncProgress && (
              <div className="mt-4 animate-fade-in">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>{t('settings.cache.syncingSection', { section: syncProgress.section })}</span>
                  <span>{Math.round((syncProgress.modsProcessed / syncProgress.totalMods) * 100)}%</span>
                </div>
                <div className="w-full bg-bg-tertiary rounded-sm h-1.5 overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-sm transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, (syncProgress.modsProcessed / syncProgress.totalMods) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {wipeResult && (
              <p className="text-xs text-text-secondary mt-2 animate-fade-in">{wipeResult}</p>
            )}
          </div>

          <div className="flex gap-3 shrink-0">
            <Button
              onClick={() => setWipeConfirmOpen(true)}
              disabled={isWipingCache || isSyncing}
              isLoading={isWipingCache}
              variant="danger"
              icon={Trash2}
            >
              <Tx k="settings.cache.wipeCache" fallback="Wipe Cache" />
            </Button>
            <Button
              onClick={handleSyncDatabase}
              disabled={isSyncing || isWipingCache}
              isLoading={isSyncing}
              icon={RefreshCw}
            >
              <Tx k="settings.cache.syncDatabase" fallback="Sync Database" />
            </Button>
          </div>
        </div>
      </Card>

      <Card title={<Tx k="settings.sections.localPreviewCache" fallback="Local preview cache" />} icon={HardDrive}>
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-4 mb-2">
              <div className="text-2xl font-bold font-valvepulp text-text-primary">
                {previewCacheBytes != null ? formatBytes(previewCacheBytes) : '---'}
              </div>
              <Badge variant="info">
                <Tx k="settings.cache.onDisk" fallback="On Disk" />
              </Badge>
            </div>
            <p className="text-xs text-text-secondary">
              <Tx
                k="settings.cache.previewDescription"
                fallback="3D model stills, hero portraits, and locker card thumbnails. These rebuild automatically from your installed mods when next viewed. Your installed mods are not affected."
              />
            </p>
            {previewResult && (
              <p className="text-xs text-text-secondary mt-2 animate-fade-in">{previewResult}</p>
            )}
          </div>

          <div className="flex gap-3 shrink-0">
            <Button
              onClick={() => setPreviewConfirmOpen(true)}
              disabled={isClearingPreview || !previewCacheBytes}
              isLoading={isClearingPreview}
              variant="danger"
              icon={Trash2}
            >
              <Tx k="common.actions.clear" fallback="Clear" />
            </Button>
          </div>
        </div>
      </Card>

      <ConfirmModal
        isOpen={wipeConfirmOpen}
        onCancel={() => setWipeConfirmOpen(false)}
        onConfirm={handleWipeCache}
        title={<Tx k="settings.cache.wipeTitle" fallback="Wipe mod cache?" />}
        message={<Tx k="settings.cache.wipeMessage" fallback="Removes cached mod metadata and sync state. Browse re-syncs from GameBanana next time. Installed mods are not affected." />}
        confirmLabel={<Tx k="settings.cache.wipeCache" fallback="Wipe Cache" />}
        variant="danger"
      />

      <ConfirmModal
        isOpen={previewConfirmOpen}
        onCancel={() => setPreviewConfirmOpen(false)}
        onConfirm={handleClearPreviewCache}
        title={<Tx k="settings.cache.clearPreviewTitle" fallback="Clear preview cache?" />}
        message={<Tx k="settings.cache.clearPreviewMessage" fallback="Deletes cached preview images to reclaim disk. They regenerate when you next view them. Installed mods are not affected." />}
        confirmLabel={<Tx k="common.actions.clear" fallback="Clear" />}
        variant="danger"
      />

      <ConfirmModal
        isOpen={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={handleResetWizard}
        title={<Tx k="settings.setupWizard.confirmTitle" fallback="Reset setup wizard?" />}
        message={
          <Tx
            k="settings.setupWizard.confirmMessage"
            fallback="The first-run setup wizard will appear the next time you launch the app. Your settings and installed mods are not affected."
          />
        }
        confirmLabel={<Tx k="common.actions.reset" fallback="Reset" />}
        variant="primary"
      />
    </>
  );
}
