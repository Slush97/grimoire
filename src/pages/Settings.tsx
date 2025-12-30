import { useEffect, useState, useMemo } from 'react';
import { Settings as SettingsIcon, FolderOpen, Check, X, Loader2, RefreshCw, Database, Trash2 } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  cleanupAddons,
  createDevDeadlockPath,
  fixGameinfo,
  getGameinfoStatus,
  validateDeadlockPath,
  showOpenDialog,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';

export default function Settings() {
  const { settings, settingsLoading, loadSettings, saveSettings, detectDeadlock } = useAppStore();
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isCreatingDevPath, setIsCreatingDevPath] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [gameinfoStatus, setGameinfoStatus] = useState<string | null>(null);
  const [gameinfoConfigured, setGameinfoConfigured] = useState<boolean | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  const [syncStatus, setSyncStatus] = useState<Record<string, { lastSync: number; count: number } | null> | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ section: string; modsProcessed: number; totalMods: number } | null>(null);
  const [isWipingCache, setIsWipingCache] = useState(false);
  const [wipeResult, setWipeResult] = useState<string | null>(null);

  const isDevMode = settings?.devMode ?? false;
  const activeDeadlockPath = getActiveDeadlockPath(settings);

  // The displayed path: local override or settings value
  const displayPath = isDevMode
    ? settings?.devDeadlockPath ?? ''
    : localPath ?? settings?.deadlockPath ?? '';

  // Compute isValidPath: if we have a saved path and no local override, it's valid
  // Otherwise use the validation result
  const isValidPath = useMemo(() => {
    if (isDevMode) {
      return settings?.devDeadlockPath ? true : null;
    }
    if (localPath !== null) {
      return validationResult;
    }
    return settings?.deadlockPath ? true : null;
  }, [isDevMode, localPath, validationResult, settings?.deadlockPath, settings?.devDeadlockPath]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      if (!activeDeadlockPath) {
        setGameinfoStatus(null);
        setGameinfoConfigured(null);
        return;
      }
      try {
        const status = await getGameinfoStatus();
        if (!active) return;
        setGameinfoStatus(status.message);
        setGameinfoConfigured(status.configured);
      } catch (err) {
        if (!active) return;
        setGameinfoStatus(String(err));
        setGameinfoConfigured(false);
      }
    };
    loadStatus();
    return () => {
      active = false;
    };
  }, [activeDeadlockPath]);

  const handleBrowse = async () => {
    if (isDevMode) return;
    const selected = await showOpenDialog({
      directory: true,
      title: 'Select Deadlock Installation Folder',
    });

    if (selected) {
      setLocalPath(selected);
      const valid = await validateDeadlockPath(selected);
      setValidationResult(valid);

      if (valid && settings) {
        await saveSettings({ ...settings, deadlockPath: selected });
        setLocalPath(null); // Clear local override after saving
      }
    }
  };

  const handleAutoDetect = async () => {
    if (isDevMode) return;
    setIsDetecting(true);
    const detected = await detectDeadlock();
    setIsDetecting(false);

    if (detected) {
      setLocalPath(detected);
      setValidationResult(true);
      if (settings) {
        await saveSettings({ ...settings, deadlockPath: detected });
        setLocalPath(null);
      }
    } else {
      setValidationResult(false);
    }
  };

  const handlePathChange = async (newPath: string) => {
    if (isDevMode) return;
    setLocalPath(newPath);
    if (newPath) {
      const valid = await validateDeadlockPath(newPath);
      setValidationResult(valid);

      if (valid && settings) {
        await saveSettings({ ...settings, deadlockPath: newPath });
        setLocalPath(null);
      }
    } else {
      setValidationResult(null);
    }
  };

  const handleAutoConfigChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, autoConfigureGameInfo: checked });
    }
  };

  const handleHideNsfwChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, hideNsfwPreviews: checked });
    }
  };

  const handleDevModeChange = async (checked: boolean) => {
    if (!settings) return;
    if (checked) {
      setIsCreatingDevPath(true);
      try {
        const devPath = await createDevDeadlockPath();
        await saveSettings({
          ...settings,
          devMode: true,
          devDeadlockPath: devPath,
        });
        setLocalPath(null);
        setValidationResult(null);
      } finally {
        setIsCreatingDevPath(false);
      }
    } else {
      await saveSettings({ ...settings, devMode: false });
    }
  };

  const handleCleanup = async () => {
    setIsCleaning(true);
    setCleanupResult(null);
    try {
      const result = await cleanupAddons();
      setCleanupResult(
        [
          `${result.removedArchives} archive file(s) removed.`,
          `${result.renamedMinaTextures} Mina texture file(s) normalized to pak21.`,
          `${result.renamedMinaPresets} Mina preset file(s) normalized to pak format.`,
          result.skippedMinaTextures > 0
            ? `${result.skippedMinaTextures} Mina texture file(s) skipped due to conflicts.`
            : null,
          result.skippedMinaPresets > 0
            ? `${result.skippedMinaPresets} Mina preset file(s) skipped due to conflicts.`
            : null,
        ]
          .filter(Boolean)
          .join(' ')
      );
    } catch (err) {
      setCleanupResult(String(err));
    } finally {
      setIsCleaning(false);
    }
  };

  const handleFixGameinfo = async () => {
    setIsFixingGameinfo(true);
    setGameinfoStatus(null);
    try {
      const result = await fixGameinfo();
      setGameinfoStatus(result.message);
      setGameinfoConfigured(result.configured);
    } catch (err) {
      setGameinfoStatus(String(err));
      setGameinfoConfigured(false);
    } finally {
      setIsFixingGameinfo(false);
    }
  };

  // Load sync status
  useEffect(() => {
    const loadSyncStatus = async () => {
      try {
        const status = await window.electronAPI.getSyncStatus();
        setSyncStatus(status);
      } catch (err) {
        console.error('Failed to load sync status:', err);
      }
    };
    loadSyncStatus();
  }, []);

  // Listen for sync progress
  useEffect(() => {
    const unsub = window.electronAPI.onSyncProgress((data) => {
      if (data.phase === 'fetching') {
        setSyncProgress({ section: data.section, modsProcessed: data.modsProcessed, totalMods: data.totalMods });
      } else if (data.phase === 'complete') {
        setSyncProgress(null);
        // Reload sync status after completion
        window.electronAPI.getSyncStatus().then(setSyncStatus);
      }
    });
    return unsub;
  }, []);

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
    if (!confirm('Wipe the local mod cache? This will remove all cached mods and sync state.')) {
      return;
    }
    setIsWipingCache(true);
    setWipeResult(null);
    try {
      await window.electronAPI.wipeModCache();
      const status = await window.electronAPI.getSyncStatus();
      setSyncStatus(status);
      setWipeResult('Cache cleared.');
    } catch (err) {
      setWipeResult(String(err));
    } finally {
      setIsWipingCache(false);
    }
  };

  const totalCachedMods = syncStatus
    ? Object.values(syncStatus).reduce((sum, s) => sum + (s?.count ?? 0), 0)
    : 0;

  const lastSyncTime = syncStatus
    ? Math.max(...Object.values(syncStatus).filter(Boolean).map(s => s!.lastSync))
    : 0;

  if (settingsLoading && !settings) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="w-6 h-6 text-accent" />
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      <div className="space-y-6">
        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <label className="block text-sm font-medium text-text-secondary mb-2">
            Deadlock Installation Path
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={displayPath}
                onChange={(e) => handlePathChange(e.target.value)}
                placeholder="/path/to/Deadlock"
                disabled={isDevMode}
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 pr-10 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 disabled:cursor-not-allowed"
              />
              {isValidPath !== null && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isValidPath ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <X className="w-5 h-5 text-red-500" />
                  )}
                </div>
              )}
            </div>
            <button
              onClick={handleBrowse}
              disabled={isDevMode}
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-text-secondary">
              {isDevMode
                ? 'Dev mode is active. Deadlock path selection is disabled.'
                : "Select your Deadlock game folder (contains the 'game' directory)"}
            </p>
            <button
              onClick={handleAutoDetect}
              disabled={isDetecting || isDevMode}
              className="text-xs text-accent hover:text-accent-hover transition-colors disabled:opacity-50"
            >
              {isDetecting ? 'Detecting...' : 'Auto-detect'}
            </button>
          </div>
          {isValidPath === false && (
            <p className="text-xs text-red-500 mt-2">
              Invalid Deadlock path. Make sure the folder contains a 'game/citadel' directory.
            </p>
          )}
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={isDevMode}
              onChange={(e) => handleDevModeChange(e.target.checked)}
              disabled={isCreatingDevPath}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent disabled:opacity-50"
            />
            <div>
              <span className="font-medium">
                {isCreatingDevPath ? 'Creating dev folder…' : 'Dev mode'}
              </span>
              <p className="text-xs text-text-secondary">
                Use a dummy Deadlock directory for local testing.
              </p>
            </div>
          </label>
          {isDevMode && settings?.devDeadlockPath && (
            <p className="text-xs text-text-secondary mt-2">
              Using dummy path: {settings.devDeadlockPath}
            </p>
          )}
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.autoConfigureGameInfo ?? true}
              onChange={(e) => handleAutoConfigChange(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
            />
            <div>
              <span className="font-medium">Auto-configure gameinfo.gi</span>
              <p className="text-xs text-text-secondary">
                Automatically update gameinfo.gi when enabling/disabling mods
              </p>
            </div>
          </label>
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings?.hideNsfwPreviews ?? false}
              onChange={(e) => handleHideNsfwChange(e.target.checked)}
              className="w-4 h-4 rounded border-border bg-bg-tertiary accent-accent"
            />
            <div>
              <span className="font-medium">Hide NSFW previews</span>
              <p className="text-xs text-text-secondary">
                Blur thumbnail images for mods marked as NSFW
              </p>
            </div>
          </label>
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">gameinfo.gi Status</div>
              <p className="text-xs text-text-secondary">
                {gameinfoStatus ?? 'Checking gameinfo.gi…'}
              </p>
              {gameinfoConfigured === false && (
                <p className="text-xs text-red-400 mt-2">
                  Addon search paths are missing. Mods may not load.
                </p>
              )}
            </div>
            <button
              onClick={handleFixGameinfo}
              disabled={isFixingGameinfo || !activeDeadlockPath}
              className="px-4 py-2 rounded-lg bg-bg-tertiary border border-border hover:border-accent/60 text-sm disabled:opacity-50"
            >
              {isFixingGameinfo ? 'Fixing…' : 'Fix gameinfo.gi'}
            </button>
          </div>
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium">Cleanup Addons Folder</div>
              <p className="text-xs text-text-secondary">
                Removes leftover archive downloads (zip, 7z, rar) from addons and disabled folders.
              </p>
              {cleanupResult && (
                <p className="text-xs mt-2 text-text-secondary">{cleanupResult}</p>
              )}
            </div>
            <button
              onClick={handleCleanup}
              disabled={isCleaning || !activeDeadlockPath}
              className="px-4 py-2 rounded-lg bg-bg-tertiary border border-border hover:border-accent/60 text-sm disabled:opacity-50"
            >
              {isCleaning ? 'Cleaning…' : 'Clean'}
            </button>
          </div>
        </div>

        <div className="bg-bg-secondary rounded-lg p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <Database className="w-4 h-4 text-accent" />
            <div className="font-medium">Mod Database Cache</div>
          </div>
          <p className="text-xs text-text-secondary mb-3">
            Cache all GameBanana mods locally for lightning-fast search and browsing.
          </p>
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm">
              {syncStatus ? (
                <>
                  <span className="text-text-primary">{totalCachedMods.toLocaleString()} mods cached</span>
                  {lastSyncTime > 0 && (
                    <span className="text-text-secondary ml-2">
                      (last sync: {new Date(lastSyncTime * 1000).toLocaleDateString()})
                    </span>
                  )}
                </>
              ) : (
                <span className="text-text-secondary">Checking cache status...</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleWipeCache}
                disabled={isWipingCache || isSyncing}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-tertiary border border-border hover:border-red-400 text-sm text-red-300 disabled:opacity-50"
              >
                {isWipingCache ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Wiping...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Wipe Cache
                  </>
                )}
              </button>
              <button
                onClick={handleSyncDatabase}
                disabled={isSyncing || isWipingCache}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm disabled:opacity-50 transition-colors"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Sync Database
                  </>
                )}
              </button>
            </div>
          </div>
          {wipeResult && (
            <div className="mt-2 text-xs text-text-secondary">{wipeResult}</div>
          )}
          {syncProgress && (
            <div className="mt-3">
              <div className="text-xs text-text-secondary mb-1">
                Syncing {syncProgress.section}: {syncProgress.modsProcessed.toLocaleString()} / {syncProgress.totalMods.toLocaleString()}
              </div>
              <div className="w-full bg-bg-tertiary rounded-full h-2">
                <div
                  className="bg-accent h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (syncProgress.modsProcessed / syncProgress.totalMods) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
