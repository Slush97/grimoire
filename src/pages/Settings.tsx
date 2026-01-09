import { useEffect, useState, useMemo, useCallback } from 'react';
import { Settings as SettingsIcon, FolderOpen, Check, X, Loader2, RefreshCw, Database, Trash2, Shield, Wrench, HardDrive, Beaker, Download, Sparkles, ArrowDownCircle } from 'lucide-react';
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
import { Card, Badge, Toggle, Button } from '../components/common/ui';

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

  // Updater state
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<{
    checking: boolean;
    available: boolean;
    downloading: boolean;
    downloaded: boolean;
    error: string | null;
    progress: number;
    updateInfo: {
      version: string;
      releaseDate?: string;
      releaseNotes?: string | { version: string; note: string | null }[] | null;
    } | null;
  } | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [upToDate, setUpToDate] = useState(false);

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

  // Load app version and updater status
  useEffect(() => {
    window.electronAPI.updater.getVersion().then(setAppVersion);
    window.electronAPI.updater.getStatus().then(setUpdateStatus);
    const unsub = window.electronAPI.updater.onStatus(setUpdateStatus);
    return unsub;
  }, []);

  // Show "up to date" message when check completes with no update
  useEffect(() => {
    if (updateStatus && !updateStatus.checking && !updateStatus.available && !updateStatus.error) {
      setUpToDate(true);
    }
  }, [updateStatus]);

  const handleCheckForUpdates = useCallback(async () => {
    setUpToDate(false);
    try {
      await window.electronAPI.updater.checkForUpdates();
    } catch (err) {
      console.error('Update check failed:', err);
    }
  }, []);

  const handleDownloadUpdate = useCallback(async () => {
    try {
      await window.electronAPI.updater.downloadUpdate();
    } catch (err) {
      console.error('Update download failed:', err);
    }
  }, []);

  const handleInstallUpdate = useCallback(() => {
    window.electronAPI.updater.installUpdate();
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
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-accent/10 rounded-xl">
          <SettingsIcon className="w-8 h-8 text-accent" />
        </div>
        <div>
          <h1 className="text-3xl font-bold font-reaver tracking-wide">Settings</h1>
          <p className="text-text-secondary">Configure game paths, preferences, and maintenance tasks</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Game Configuration Section - Full Width */}
        <Card title="Game Configuration" icon={HardDrive} className="lg:col-span-2">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-text-primary">Deadlock Installation Path</label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">
                    {isValidPath === true && <span className="text-green-400 flex items-center gap-1"><Check className="w-3 h-3" /> Valid</span>}
                    {isValidPath === false && <span className="text-red-400 flex items-center gap-1"><X className="w-3 h-3" /> Invalid</span>}
                  </span>
                  {!isDevMode && (
                    <Button
                      onClick={handleAutoDetect}
                      disabled={isDetecting}
                      isLoading={isDetecting}
                      variant="secondary"
                      size="sm"
                      icon={RefreshCw}
                    >
                      Auto-detect
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={displayPath}
                    onChange={(e) => handlePathChange(e.target.value)}
                    placeholder="/path/to/Deadlock"
                    disabled={isDevMode}
                    className="w-full bg-bg-tertiary border border-white/5 rounded-lg px-4 py-2.5 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono text-sm"
                  />
                </div>
                <Button
                  onClick={handleBrowse}
                  disabled={isDevMode}
                  variant="secondary"
                  icon={FolderOpen}
                >
                  Browse
                </Button>
              </div>

              <p className="text-xs text-text-secondary mt-2 pl-1">
                {isDevMode
                  ? 'Dev mode is active. Deadlock path selection is disabled.'
                  : "Select your Deadlock game folder (contains the 'game' directory)"}
              </p>
            </div>

            <div className="h-px bg-white/5" />

            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div>
                <div className="font-medium flex items-center gap-2">
                  gameinfo.gi Status
                  {gameinfoConfigured ? (
                    <Badge variant="success">Configured</Badge>
                  ) : gameinfoConfigured === false ? (
                    <Badge variant="error" className="animate-pulse">Issues Found</Badge>
                  ) : (
                    <Badge variant="neutral">Checking...</Badge>
                  )}
                </div>
                <p className="text-xs text-text-secondary mt-1 max-w-md">
                  {gameinfoStatus ?? 'Checking gameinfo.gi status...'}
                </p>
              </div>
              <Button
                onClick={handleFixGameinfo}
                disabled={isFixingGameinfo || !activeDeadlockPath}
                isLoading={isFixingGameinfo}
                variant={gameinfoConfigured ? 'secondary' : 'primary'}
                icon={Wrench}
              >
                Fix Configuration
              </Button>
            </div>
          </div>
        </Card>

        {/* Updates */}
        <Card title="Updates" icon={Download}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Current Version</span>
                  <Badge variant="info">v{appVersion || '...'}</Badge>
                </div>
                {updateStatus?.error && (
                  <p className="text-xs text-red-400 mt-1">{updateStatus.error}</p>
                )}
                {updateStatus?.available && !updateStatus.downloaded && (
                  <p className="text-xs text-accent mt-1">
                    v{updateStatus.updateInfo?.version} available!
                  </p>
                )}
                {updateStatus?.downloaded && (
                  <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    v{updateStatus.updateInfo?.version} ready to install
                  </p>
                )}
                {upToDate && !updateStatus?.available && !updateStatus?.checking && (
                  <p className="text-xs text-green-400 mt-1">✓ You're up to date!</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {updateStatus?.downloaded ? (
                  <Button
                    onClick={handleInstallUpdate}
                    icon={ArrowDownCircle}
                  >
                    Install & Restart
                  </Button>
                ) : updateStatus?.available && !updateStatus.downloading ? (
                  <>
                    {updateStatus.updateInfo?.releaseNotes && (
                      <Button
                        onClick={() => setShowChangelog(true)}
                        variant="secondary"
                      >
                        View Changelog
                      </Button>
                    )}
                    <Button
                      onClick={handleDownloadUpdate}
                      icon={Download}
                    >
                      Download Update
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleCheckForUpdates}
                    disabled={updateStatus?.checking || updateStatus?.downloading}
                    isLoading={updateStatus?.checking}
                    variant="secondary"
                    icon={RefreshCw}
                  >
                    {updateStatus?.checking ? 'Checking...' : 'Check for Updates'}
                  </Button>
                )}
              </div>
            </div>

            {updateStatus?.downloading && (
              <div className="animate-fade-in">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>Downloading update...</span>
                  <span>{Math.round(updateStatus.progress)}%</span>
                </div>
                <div className="w-full bg-bg-tertiary rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${updateStatus.progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Preferences */}
        <Card title="Preferences" icon={Shield}>
          <div className="space-y-6">
            <Toggle
              checked={settings?.autoConfigureGameInfo ?? true}
              onChange={handleAutoConfigChange}
              label="Auto-configure gameinfo.gi"
              description="Automatically fix gameinfo.gi when launching or changing mods."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.hideNsfwPreviews ?? false}
              onChange={handleHideNsfwChange}
              label="Hide NSFW Content"
              description="Blur thumbnail images for mods marked as NSFW."
            />

            <div className="h-px bg-white/5" />

            <div>
              <Toggle
                checked={isDevMode}
                onChange={handleDevModeChange}
                disabled={isCreatingDevPath}
                label="Developer Mode"
                description="Use a dummy Deadlock directory for local testing without game files."
              />
              {isDevMode && settings?.devDeadlockPath && (
                <div className="mt-2 text-xs font-mono bg-black/30 p-2 rounded text-text-secondary break-all">
                  {settings.devDeadlockPath}
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Experimental Features */}
        <Card title="Experimental Features" icon={Beaker}>
          <div className="space-y-6">
            <p className="text-xs text-text-secondary -mt-2">
              These features are still in development and may be incomplete or buggy.
            </p>

            <Toggle
              checked={settings?.experimentalStats ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalStats: checked })}
              label="Stats Dashboard"
              description="Track your performance with data from the Deadlock Stats API."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalCrosshair ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalCrosshair: checked })}
              label="Crosshair Designer"
              description="Create custom crosshairs with a live preview."
            />
          </div>
        </Card>

        {/* Maintenance */}
        <Card title="Maintenance" icon={Wrench}>
          <div className="space-y-6">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="font-medium text-sm">Cleanup Addons Folder</h4>
                <p className="text-xs text-text-secondary mt-1">
                  Remove leftover archive downloads (zip, 7z) and normalize Mina files.
                </p>
                {cleanupResult && (
                  <p className="text-xs text-accent mt-2 animate-fade-in">{cleanupResult}</p>
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
                Cleanup
              </Button>
            </div>

            <div className="h-px bg-white/5" />

            <AutoexecSection gamePath={activeDeadlockPath} />
          </div>
        </Card>

        {/* Mod Database Cache - Full Width */}
        <Card title="Mod Database Cache" icon={Database} className="lg:col-span-2">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-4 mb-2">
                <div className="text-2xl font-bold font-valvepulp text-text-primary">
                  {syncStatus ? totalCachedMods.toLocaleString() : '---'}
                </div>
                <Badge variant="info">Cached Mods</Badge>
              </div>
              <p className="text-xs text-text-secondary">
                {lastSyncTime > 0
                  ? `Last synchronized: ${new Date(lastSyncTime * 1000).toLocaleString()}`
                  : 'Never synchronized'}
              </p>

              {syncProgress && (
                <div className="mt-4 animate-fade-in">
                  <div className="flex justify-between text-xs text-text-secondary mb-1">
                    <span>Syncing {syncProgress.section}...</span>
                    <span>{Math.round((syncProgress.modsProcessed / syncProgress.totalMods) * 100)}%</span>
                  </div>
                  <div className="w-full bg-bg-tertiary rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-accent h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden"
                      style={{ width: `${Math.min(100, (syncProgress.modsProcessed / syncProgress.totalMods) * 100)}%` }}
                    >
                      <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite]" />
                    </div>
                  </div>
                </div>
              )}

              {wipeResult && (
                <p className="text-xs text-text-secondary mt-2 animate-fade-in">{wipeResult}</p>
              )}
            </div>

            <div className="flex gap-3 shrink-0">
              <Button
                onClick={handleWipeCache}
                disabled={isWipingCache || isSyncing}
                isLoading={isWipingCache}
                variant="danger"
                icon={Trash2}
              >
                Wipe Cache
              </Button>
              <Button
                onClick={handleSyncDatabase}
                disabled={isSyncing || isWipingCache}
                isLoading={isSyncing}
                icon={RefreshCw}
              >
                Sync Database
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* Changelog Modal */}
      {showChangelog && updateStatus?.updateInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-scale-in">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">What's New in v{updateStatus.updateInfo.version}</h2>
                {updateStatus.updateInfo.releaseDate && (
                  <p className="text-sm text-text-secondary mt-1">
                    Released {new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString()}
                  </p>
                )}
              </div>
              <button
                onClick={() => setShowChangelog(false)}
                className="p-2 rounded-lg hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              {typeof updateStatus.updateInfo.releaseNotes === 'string' ? (
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: updateStatus.updateInfo.releaseNotes }}
                />
              ) : Array.isArray(updateStatus.updateInfo.releaseNotes) ? (
                <div className="space-y-4">
                  {updateStatus.updateInfo.releaseNotes.map((note, idx) => (
                    <div key={idx}>
                      <h3 className="font-semibold text-accent">v{note.version}</h3>
                      {note.note && (
                        <div
                          className="prose prose-invert prose-sm max-w-none mt-1"
                          dangerouslySetInnerHTML={{ __html: note.note }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-text-secondary">No release notes available.</p>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-white/10">
              <Button
                onClick={() => setShowChangelog(false)}
                variant="secondary"
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setShowChangelog(false);
                  handleDownloadUpdate();
                }}
                icon={Download}
              >
                Download Update
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Autoexec.cfg helper section
function AutoexecSection({ gamePath }: { gamePath: string | null }) {
  const [status, setStatus] = useState<{
    exists: boolean;
    path: string | null;
    hasCrosshairSettings: boolean;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    if (!gamePath) {
      setStatus(null);
      return;
    }
    window.electronAPI.getAutoexecStatus(gamePath).then(setStatus);
  }, [gamePath]);

  const handleCreate = async () => {
    if (!gamePath) return;
    setIsCreating(true);
    setResult(null);
    try {
      const res = await window.electronAPI.createAutoexec(gamePath);
      setResult(`Created: ${res.path}`);
      const newStatus = await window.electronAPI.getAutoexecStatus(gamePath);
      setStatus(newStatus);
    } catch (err) {
      setResult(String(err));
    } finally {
      setIsCreating(false);
    }
  };

  if (!gamePath) return null;

  return (
    <div>
      <div className="flex justify-between items-start gap-4">
        <div>
          <h4 className="font-medium text-sm flex items-center gap-2">
            Autoexec Configuration
            {status === null ? (
              <span className="text-xs text-text-secondary">Checking...</span>
            ) : status.exists ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="warning">Missing</Badge>
            )}
          </h4>
          <p className="text-xs text-text-secondary mt-1">
            Ensure autoexec.cfg exists for crosshairs and commands.
          </p>
          {result && <p className="text-xs text-accent mt-2">{result}</p>}
        </div>
        {status && !status.exists && (
          <Button
            onClick={handleCreate}
            disabled={isCreating}
            isLoading={isCreating}
            variant="primary"
            size="sm"
            icon={Loader2}
          >
            Create File
          </Button>
        )}
      </div>
    </div>
  );
}
