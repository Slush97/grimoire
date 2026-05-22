import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FolderOpen, Check, X, Loader2, RefreshCw, Database, Trash2, Shield, Wrench, HardDrive, Beaker, Download, Sparkles, ArrowDownCircle, Palette, Pipette, LifeBuoy, Github, Globe, FileText, Bug, Copy } from 'lucide-react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import DOMPurify from 'dompurify';
import { useAppStore } from '../stores/appStore';
import {
  buildDiagnosticReport,
  cleanupAddons,
  createDevDeadlockPath,
  fixGameinfo,
  getGameinfoStatus,
  openGameFolder,
  validateDeadlockPath,
  showOpenDialog,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { Card, Badge, Toggle, Button } from '../components/common/ui';
import { PageHeader, ConfirmModal } from '../components/common/PageComponents';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, applyAccentColor } from '../lib/accentColor';
import SocialAccountSection from '../components/social/SocialAccountSection';

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
  const [gameinfoMissing, setGameinfoMissing] = useState(false);
  const [gameinfoCandidates, setGameinfoCandidates] = useState<string[]>([]);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  const [syncStatus, setSyncStatus] = useState<Record<string, { lastSync: number; count: number } | null> | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ section: string; modsProcessed: number; totalMods: number } | null>(null);
  const [isWipingCache, setIsWipingCache] = useState(false);
  const [wipeResult, setWipeResult] = useState<string | null>(null);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);

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
  const [installSource, setInstallSource] = useState<'managed' | 'appimage' | 'standard'>('standard');

  // Bug report form (copy-paste flow)
  const [bugDescription, setBugDescription] = useState('');
  const [bugReportText, setBugReportText] = useState<string | null>(null);
  const [isBuildingReport, setIsBuildingReport] = useState(false);
  const [bugReportError, setBugReportError] = useState<string | null>(null);
  const [bugCopyState, setBugCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [includeFullLog, setIncludeFullLog] = useState(false);

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
        setGameinfoMissing(false);
        setGameinfoCandidates([]);
        return;
      }
      try {
        const status = await getGameinfoStatus();
        if (!active) return;
        setGameinfoStatus(status.message);
        setGameinfoConfigured(status.configured);
        setGameinfoMissing(status.missing);
        setGameinfoCandidates(status.candidates);
      } catch (err) {
        if (!active) return;
        setGameinfoStatus(String(err));
        setGameinfoConfigured(false);
        setGameinfoMissing(false);
        setGameinfoCandidates([]);
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


  const handleAccentChange = async (color: string) => {
    // Apply optimistically so the UI re-themes the moment the swatch is
    // clicked, even before the settings round-trip finishes. The store push
    // in saveSettings re-triggers Layout's effect, but doing it here too
    // avoids a perceptible flash on slower disks.
    applyAccentColor(color);
    if (settings) {
      await saveSettings({ ...settings, accentColor: color });
    }
  };

  // Custom color picker state. While the modal is open, picker drags only
  // update CSS vars + draft locally; the settings file is written once on
  // commit (Done, backdrop click, Escape) so we don't hammer it 60x/sec
  // mid-drag.
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState<string | null>(null);

  const handleCustomDraft = (color: string) => {
    applyAccentColor(color);
    setCustomDraft(color);
  };

  const commitCustomDraft = useCallback(async () => {
    setCustomPickerOpen(false);
    if (customDraft && settings && customDraft.toLowerCase() !== settings.accentColor?.toLowerCase()) {
      await saveSettings({ ...settings, accentColor: customDraft });
    }
    setCustomDraft(null);
  }, [customDraft, settings, saveSettings]);

  const openCustomPicker = () => {
    setCustomDraft(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
    setCustomPickerOpen(true);
  };

  useEffect(() => {
    if (!customPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void commitCustomDraft();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [customPickerOpen, commitCustomDraft]);

  const handleHideNsfwChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, hideNsfwPreviews: checked });
    }
  };

  const handleHideOutdatedChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, hideOutdatedMods: checked });
    }
  };

  const handleAutoDisableSiblingsChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, autoDisableSiblingVariants: checked });
    }
  };

  const handleIgnoreConflictsByDefaultChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, ignoreConflictsByDefault: checked });
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
      setCleanupResult(`${result.removedArchives} archive file(s) removed.`);
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

  const handleGenerateBugReport = async () => {
    setIsBuildingReport(true);
    setBugReportError(null);
    setBugCopyState('idle');
    try {
      const text = await buildDiagnosticReport(bugDescription, { includeFullLog });
      setBugReportText(text);
    } catch (err) {
      setBugReportError(`Couldn't build report: ${String(err)}`);
    } finally {
      setIsBuildingReport(false);
    }
  };

  const handleCopyBugReport = async () => {
    if (!bugReportText) return;
    try {
      await navigator.clipboard.writeText(bugReportText);
      setBugCopyState('copied');
      window.setTimeout(() => setBugCopyState('idle'), 2000);
    } catch {
      setBugCopyState('failed');
    }
  };

  // Prefill the GitHub "new issue" URL with the user's description as the
  // title and a stub body that tells them to paste the diagnostic. We can't
  // jam the full sanitized report into the URL (GitHub caps issue-create
  // URLs around 8 KB and our log tail is up to 256 KB), so the contract is:
  // "copy the report, then click the button, then paste."
  const githubIssueUrl = useMemo(() => {
    const firstLine = bugDescription.split('\n').find((l) => l.trim().length > 0) ?? '';
    const title = firstLine.trim().slice(0, 100) || 'Bug report';
    const body = [
      bugDescription.trim() || '<!-- describe what happened -->',
      '',
      '---',
      '',
      'Diagnostic report (copied from Grimoire → Settings → Share a bug report):',
      '',
      '```',
      'paste the report here',
      '```',
    ].join('\n');
    const q = `?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
    return `https://github.com/Slush97/grimoire/issues/new${q}`;
  }, [bugDescription]);

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
    window.electronAPI.updater.getInstallSource().then(setInstallSource);
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
    setWipeConfirmOpen(false);
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

  const handleResetWizard = async () => {
    setResetConfirmOpen(false);
    if (!settings) return;
    try {
      await saveSettings({ ...settings, hasCompletedSetup: false });
      setResetResult('The setup wizard will appear on the next app launch.');
      setTimeout(() => setResetResult(null), 5000);
    } catch (err) {
      setResetResult(`Error: ${String(err)}`);
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
      <PageHeader
        title="Settings"
        description="Configure game paths, preferences, and maintenance tasks"
      />

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
                    className="w-full bg-bg-tertiary border border-white/5 rounded-sm px-4 py-2.5 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60 disabled:cursor-not-allowed font-mono text-sm"
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
                {gameinfoMissing && (
                  <div className="mt-2 max-w-md space-y-1">
                    <p className="text-xs text-text-secondary">
                      In Steam: right-click Deadlock {'>'} Properties {'>'} Installed Files {'>'} Verify integrity of game files.
                    </p>
                    {gameinfoCandidates.length > 0 && (
                      <p className="text-xs text-amber-300">
                        Found nearby: {gameinfoCandidates.join(', ')}. Rename one to gameinfo.gi to restore.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {gameinfoMissing ? (
                <Button
                  onClick={openGameFolder}
                  disabled={!activeDeadlockPath}
                  variant="primary"
                  icon={FolderOpen}
                >
                  Open Game Folder
                </Button>
              ) : (
                <Button
                  onClick={handleFixGameinfo}
                  disabled={isFixingGameinfo || !activeDeadlockPath}
                  isLoading={isFixingGameinfo}
                  variant={gameinfoConfigured ? 'secondary' : 'primary'}
                  icon={Wrench}
                >
                  Fix Configuration
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Updates */}
        <Card title="Updates" icon={Download} className="lg:col-span-2">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Current Version</span>
                  <Badge variant="info">v{appVersion || '...'}</Badge>
                </div>
                {updateStatus?.available && !updateStatus.downloaded && (
                  <span className="text-xs text-accent">
                    v{updateStatus.updateInfo?.version} available!
                  </span>
                )}
                {updateStatus?.downloaded && (
                  <span className="text-xs text-green-400 inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    v{updateStatus.updateInfo?.version} ready to install
                  </span>
                )}
                {upToDate && !updateStatus?.available && !updateStatus?.checking && (
                  <span className="text-xs text-green-400">✓ You're up to date!</span>
                )}
                {updateStatus?.error && (
                  <span className="text-xs text-red-400 basis-full">{updateStatus.error}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {installSource === 'managed' ? null : updateStatus?.downloaded ? (
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

            {installSource === 'managed' && (
              <div className="rounded-lg bg-bg-tertiary border border-white/10 p-3 text-sm text-text-secondary space-y-2">
                <p className="text-text-primary font-medium">Updates are managed by your package manager.</p>
                <p>
                  Grimoire was installed via a system package. Update with your distro's usual tools (for example{' '}
                  <code className="font-mono text-text-primary">yay -Syu grimoire-bin</code> on Arch). If you installed the{' '}
                  <code className="font-mono text-text-primary">.deb</code> directly, re-download the latest release.
                </p>
              </div>
            )}

            {updateStatus?.downloading && (
              <div className="animate-fade-in">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>Downloading update...</span>
                  <span>{Math.round(updateStatus.progress)}%</span>
                </div>
                <div className="w-full bg-bg-tertiary rounded-sm h-1.5 overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-sm transition-all duration-300 ease-out"
                    style={{ width: `${updateStatus.progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Appearance */}
        <Card
          title="Appearance"
          icon={Palette}
          className="lg:col-span-2"
          action={
            <div className="flex flex-wrap gap-2 items-center">
              {(() => {
                const current = (settings?.accentColor ?? DEFAULT_ACCENT_COLOR).toLowerCase();
                const isCustomActive = !ACCENT_PRESETS.some((p) => p.color.toLowerCase() === current);
                const customDisplay = customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR;
                const swatchBase = 'relative flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary';
                return (
                  <>
                    {ACCENT_PRESETS.map((preset) => {
                      const isActive = current === preset.color.toLowerCase();
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleAccentChange(preset.color)}
                          title={preset.name}
                          aria-label={`Accent: ${preset.name}`}
                          aria-pressed={isActive}
                          className={`${swatchBase} ${
                            isActive
                              ? 'border-white/40'
                              : 'border-white/10 hover:border-white/30'
                          }`}
                          style={{ backgroundColor: preset.color }}
                        >
                          {isActive && <Check className="w-4 h-4 text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" />}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={openCustomPicker}
                      title="Pick a custom color"
                      aria-label="Accent: Custom"
                      aria-pressed={isCustomActive}
                      aria-haspopup="dialog"
                      className={`${swatchBase} ${
                        isCustomActive
                          ? 'border-white/40'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                      style={
                        isCustomActive
                          ? { backgroundColor: customDisplay }
                          : { background: 'conic-gradient(from 0deg, #ef4444, #f59e0b, #10b981, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444)' }
                      }
                    >
                      <Pipette className="w-3.5 h-3.5 text-black/70 drop-shadow-[0_1px_0_rgba(255,255,255,0.5)]" />
                    </button>

                    {customPickerOpen && createPortal(
                      <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
                        onClick={() => void commitCustomDraft()}
                        role="presentation"
                      >
                        <div
                          className="bg-bg-secondary border border-white/10 rounded-sm p-6 w-full max-w-sm relative overflow-hidden shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                          role="dialog"
                          aria-modal="true"
                          aria-label="Custom accent color"
                        >
                          <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
                          <h3 className="text-lg font-semibold text-text-primary tracking-wide font-reaver mb-4 flex items-center gap-2">
                            <Pipette className="w-4 h-4 text-accent" />
                            Custom Accent
                          </h3>
                          <div className="space-y-4">
                            <HexColorPicker
                              color={customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR}
                              onChange={handleCustomDraft}
                              style={{ width: '100%' }}
                            />
                            <div className="flex items-center gap-2">
                              <span
                                className="block w-9 h-9 rounded-sm border border-white/10 shrink-0"
                                style={{ backgroundColor: customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR }}
                                aria-label="Selected color preview"
                              />
                              <span className="text-xs text-text-secondary font-mono">#</span>
                              <HexColorInput
                                color={customDraft ?? settings?.accentColor ?? DEFAULT_ACCENT_COLOR}
                                onChange={handleCustomDraft}
                                className="flex-1 bg-bg-tertiary border border-white/5 rounded-sm px-2 py-1.5 text-sm font-mono text-text-primary focus:outline-none focus:ring-1 focus:ring-accent uppercase"
                              />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  applyAccentColor(settings?.accentColor ?? DEFAULT_ACCENT_COLOR);
                                  setCustomDraft(null);
                                  setCustomPickerOpen(false);
                                }}
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void commitCustomDraft()}
                              >
                                Apply
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}
                  </>
                );
              })()}
            </div>
          }
        />

        {/* Grimoire Social */}
        {settings?.experimentalSocial && (
          <Card title="Grimoire Social" icon={Globe} className="lg:col-span-2">
            <SocialAccountSection />
          </Card>
        )}

        {/* Preferences */}
        <Card title="Preferences" icon={Shield}>
          <div className="space-y-6">
            <Toggle
              checked={settings?.hideNsfwPreviews ?? false}
              onChange={handleHideNsfwChange}
              label="Hide NSFW Content"
              description="Blur thumbnail images for mods marked as NSFW."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.hideOutdatedMods ?? false}
              onChange={handleHideOutdatedChange}
              label="Hide Outdated Mods"
              description="Hide mods in Browse that haven't been updated since the current game version cutoff."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.autoDisableSiblingVariants ?? true}
              onChange={handleAutoDisableSiblingsChange}
              label="Auto-disable older variants on re-download"
              description="When you re-download a GameBanana mod with a different file, automatically disable the previously installed variant. Disable this if you want to keep multiple variants enabled at once."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.ignoreConflictsByDefault ?? false}
              onChange={handleIgnoreConflictsByDefaultChange}
              label="Ignore conflicts by default"
              description="Hide every detected mod conflict instead of surfacing it in the Conflicts page. Turn off to bring them back."
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
                <div className="mt-2 text-xs font-mono bg-black/30 p-2 rounded-sm text-text-secondary break-all">
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

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalSocial ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalSocial: checked })}
              label="Grimoire Social"
              description="Sign in with Steam to publish profiles and browse uploads from other players in Discover."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalUnknownModMatching ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalUnknownModMatching: checked })}
              label="Fix Unknown Mods"
              description="Auto-match unknown local VPKs against GameBanana to recover their names and thumbnails. Currently hits rate limits on larger libraries while we rework it. The manual Custom Mod path stays available either way."
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalVpkMerger ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalVpkMerger: checked })}
              label="VPK Merger"
              description="Combine 2+ installed mods into one VPK from the Installed page bulk-select toolbar. Includes Unmerge recovery via the merged mod's contents view. Any merges you create remain interactive even if you turn this off later."
            />
          </div>
        </Card>

        {/* Support */}
        <Card title="Support" icon={LifeBuoy} className="lg:col-span-2">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-sm text-text-secondary">
                Found a bug or have a feature request? File an issue on GitHub or drop into our Discord.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href="https://github.com/Slush97/grimoire/issues"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60 whitespace-nowrap"
                >
                  <Github className="w-4 h-4" aria-hidden="true" />
                  GitHub Issues
                </a>
                <a
                  href="https://discord.gg/KgYGHEMq2P"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-[#5865F2]/40 bg-[#5865F2]/10 text-text-primary hover:bg-[#5865F2]/20 hover:border-[#5865F2]/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]/60 whitespace-nowrap"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-current"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  Join Discord
                </a>
              </div>
            </div>

            <div className="h-px bg-white/5" />

            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <Bug className="w-4 h-4 text-text-secondary" aria-hidden="true" />
                  Share a bug report
                </h4>
                <p className="text-xs text-text-secondary mt-1">
                  Describe what went wrong, generate a sanitized report, then paste it into Discord or a GitHub issue. The report bundles app and OS info plus the tail of your log; home paths, Steam IDs, bearer tokens, and emails are stripped before it leaves the app.
                </p>
              </div>

              <textarea
                value={bugDescription}
                onChange={(e) => setBugDescription(e.target.value)}
                placeholder="What were you doing when it broke? (Optional but helpful.)"
                rows={3}
                className="w-full px-3 py-2 text-sm bg-bg-tertiary border border-white/5 rounded-sm text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-y"
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button
                  onClick={handleGenerateBugReport}
                  isLoading={isBuildingReport}
                  size="sm"
                  variant="secondary"
                  icon={FileText}
                >
                  {bugReportText ? 'Regenerate report' : 'Generate report'}
                </Button>
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeFullLog}
                    onChange={(e) => setIncludeFullLog(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-sm border border-white/20 bg-bg-tertiary accent-accent focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  Include full log (up to 5 MB; Discord auto-attaches as a file)
                </label>
              </div>

              {bugReportError && (
                <p className="text-xs text-red-400 break-all">{bugReportError}</p>
              )}

              {bugReportText && (
                <div className="space-y-2 animate-fade-in">
                  <p className="text-[11px] text-text-secondary/70">
                    Review before sharing. Nothing is sent automatically.
                  </p>
                  <textarea
                    value={bugReportText}
                    readOnly
                    rows={10}
                    className="w-full px-3 py-2 text-[11px] font-mono leading-relaxed bg-bg-tertiary/60 border border-white/5 rounded-sm text-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={handleCopyBugReport}
                      size="sm"
                      icon={bugCopyState === 'copied' ? Check : Copy}
                    >
                      {bugCopyState === 'copied'
                        ? 'Copied'
                        : bugCopyState === 'failed'
                          ? 'Copy failed: select and Ctrl+C'
                          : 'Copy report'}
                    </Button>
                    <a
                      href="https://discord.gg/KgYGHEMq2P"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-[#5865F2]/40 bg-[#5865F2]/10 text-text-primary hover:bg-[#5865F2]/20 hover:border-[#5865F2]/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]/60"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                      Open Discord
                    </a>
                    <a
                      href={githubIssueUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60"
                    >
                      <Github className="w-4 h-4" aria-hidden="true" />
                      Open GitHub issue
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Maintenance */}
        <Card title="Maintenance" icon={Wrench} className="lg:col-span-2">
          <div className="space-y-6">
            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="font-medium text-sm">Cleanup Addons Folder</h4>
                <p className="text-xs text-text-secondary mt-1">
                  Remove leftover archive downloads (zip, 7z).
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

            <div className="flex justify-between items-start gap-4">
              <div>
                <h4 className="font-medium text-sm">Reset Setup Wizard</h4>
                <p className="text-xs text-text-secondary mt-1">
                  Show the first-run setup wizard again on next app launch.
                </p>
                {resetResult && (
                  <p className="text-xs text-accent mt-2 animate-fade-in">{resetResult}</p>
                )}
              </div>
              <Button
                onClick={() => setResetConfirmOpen(true)}
                variant="secondary"
                size="sm"
                icon={RefreshCw}
              >
                Reset
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
          <div className="bg-bg-secondary border border-white/10 rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-fade-in relative">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
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
                className="p-2 rounded-sm hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto max-h-[50vh]">
              {typeof updateStatus.updateInfo.releaseNotes === 'string' ? (
                <div
                  className="prose prose-invert prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(updateStatus.updateInfo.releaseNotes) }}
                />
              ) : Array.isArray(updateStatus.updateInfo.releaseNotes) ? (
                <div className="space-y-4">
                  {updateStatus.updateInfo.releaseNotes.map((note, idx) => (
                    <div key={idx}>
                      <h3 className="font-semibold text-accent">v{note.version}</h3>
                      {note.note && (
                        <div
                          className="prose prose-invert prose-sm max-w-none mt-1"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(note.note) }}
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

      <ConfirmModal
        isOpen={wipeConfirmOpen}
        onCancel={() => setWipeConfirmOpen(false)}
        onConfirm={handleWipeCache}
        title="Wipe mod cache?"
        message="This removes all cached mod metadata and sync state. The next Browse session will re-sync from GameBanana (a few minutes on first run). Your installed mods are not affected."
        confirmLabel="Wipe Cache"
        variant="danger"
      />

      <ConfirmModal
        isOpen={resetConfirmOpen}
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={handleResetWizard}
        title="Reset setup wizard?"
        message="The first-run setup wizard will appear the next time you launch the app. Your settings and installed mods are not affected."
        confirmLabel="Reset"
        variant="primary"
      />
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
