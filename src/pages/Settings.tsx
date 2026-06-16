import { useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Check, X, Loader2, RefreshCw, Database, Trash2, Shield, Wrench, HardDrive, Beaker, Download, Sparkles, ArrowDownCircle, Ban, Palette, Pipette, LifeBuoy, Github, Globe, FileText, Bug, Copy, ChevronDown } from 'lucide-react';
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
import { formatDateParts } from '../lib/dateFormat';
import { Card, Badge, Toggle, Button } from '../components/common/ui';
import { PageHeader, ConfirmModal } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import LanguageSelector from '../components/settings/LanguageSelector';
import { ACCENT_PRESETS, DEFAULT_ACCENT_COLOR, applyAccentColor } from '../lib/accentColor';
import { DEFAULT_SIDEBAR_HERO, HERO_NAMES_SORTED, getHeroChipIconPath } from '../lib/lockerUtils';
import SocialAccountSection from '../components/social/SocialAccountSection';
import PerformanceConfigCard from '../components/performance/PerformanceConfigCard';
import KofiSupportButton from '../components/KofiSupportButton';
import type { SaltIngestStatus } from '../types/electron';

// GitHub Releases is the source of truth for changelogs. When we have local
// release notes (an update is pending) we show them in-app; otherwise we link
// out to the release page so users can read "what's new" even when up to date.
const GITHUB_RELEASES_URL = 'https://github.com/Slush97/grimoire/releases';
const releaseTagUrl = (version?: string | null) =>
  version ? `${GITHUB_RELEASES_URL}/tag/v${version}` : GITHUB_RELEASES_URL;

// A version number that links to its GitHub release notes. Renders nothing when
// there's no version to point at.
function ReleaseVersionLink({ version, className = '' }: { version?: string | null; className?: string }) {
  const { t } = useTranslation();
  if (!version) return null;
  return (
    <a
      href={releaseTagUrl(version)}
      target="_blank"
      rel="noopener noreferrer"
      title={t('settings.updates.releaseNotesTitle', { version })}
      className={`underline decoration-dotted underline-offset-2 transition-colors hover:text-accent ${className}`}
    >
      v{version}
    </a>
  );
}

/** Human-readable byte size (MB below a GB, GB above). */
function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export default function Settings() {
  const { t } = useTranslation();
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
  const [previewCacheBytes, setPreviewCacheBytes] = useState<number | null>(null);
  const [isClearingPreview, setIsClearingPreview] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewConfirmOpen, setPreviewConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [saltIngestStatus, setSaltIngestStatus] = useState<SaltIngestStatus | null>(null);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);

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
  const selectedSidebarHero = useMemo(() => {
    const configuredHero = settings?.sidebarHeroHighlight;
    if (configuredHero === null || configuredHero === '') return null;
    if (configuredHero && HERO_NAMES_SORTED.includes(configuredHero)) return configuredHero;
    return DEFAULT_SIDEBAR_HERO;
  }, [settings?.sidebarHeroHighlight]);

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
      title: t('settings.gamePath.selectFolder'),
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

  const handleSidebarHeroHighlightChange = async (heroName: string | null) => {
    setHeroPickerOpen(false);
    if (settings) {
      await saveSettings({ ...settings, sidebarHeroHighlight: heroName });
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

  useEffect(() => {
    if (!heroPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHeroPickerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [heroPickerOpen]);

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

  const handleLockerCardsExpandedByDefaultChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, lockerCardsExpandedByDefault: checked });
    }
  };

  const handleAutoDisableSiblingsChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, autoDisableSiblingVariants: checked });
    }
  };

  const handleAutoEnableDownloadsChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, autoEnableDownloads: checked });
    }
  };

  const handleIgnoreConflictsByDefaultChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, ignoreConflictsByDefault: checked });
    }
  };

  const handleDiscordRpcChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, discordRpcEnabled: checked });
    }
  };

  const refreshSaltIngestStatus = useCallback(async () => {
    try {
      setSaltIngestStatus(await window.electronAPI.saltIngest.getStatus());
    } catch {
      // The status line is cosmetic; the toggle stays usable without it.
    }
  }, []);

  useEffect(() => {
    if (settings?.contributeMatchSalts) {
      void refreshSaltIngestStatus();
    }
  }, [settings?.contributeMatchSalts, refreshSaltIngestStatus]);

  const handleContributeMatchSaltsChange = async (checked: boolean) => {
    if (!settings) return;
    await saveSettings({ ...settings, contributeMatchSalts: checked });
    await window.electronAPI.saltIngest.setEnabled(checked);
    if (checked) {
      // The first scan usually finishes within a couple seconds; pick up its
      // counters once it has.
      setTimeout(() => void refreshSaltIngestStatus(), 3000);
    }
  };

  const handleConfirmProfileUpdateChange = async (checked: boolean) => {
    if (settings) {
      await saveSettings({ ...settings, confirmProfileUpdate: checked });
    }
  };

  const handleDateFormatChange = async (format: 'MM/DD/YYYY' | 'DD/MM/YYYY') => {
    if (settings && settings.dateFormat !== format) {
      await saveSettings({ ...settings, dateFormat: format });
    }
  };

  const handleLanguageChange = async (language: string | null) => {
    if (settings && (settings.language ?? null) !== language) {
      await saveSettings({ ...settings, language });
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
      setCleanupResult(t('settings.maintenance.archivesRemoved', { count: result.removedArchives }));
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
      setBugReportError(t('settings.support.reportBuildFailed', { error: String(err) }));
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
    const title = firstLine.trim().slice(0, 100) || t('settings.support.bugReportTitle');
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
  }, [bugDescription, t]);

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

  // "What's New" entry point that works in every state. If an update is pending
  // we have its release notes locally, so open the in-app changelog. Otherwise
  // (up to date, or a package-managed install) send users to this build's
  // GitHub release page so they can always read the notes.
  const handleViewWhatsNew = useCallback(() => {
    if (updateStatus?.updateInfo?.releaseNotes) {
      setShowChangelog(true);
    } else {
      window.open(releaseTagUrl(appVersion), '_blank', 'noopener,noreferrer');
    }
  }, [updateStatus, appVersion]);

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

  useEffect(() => {
    window.electronAPI
      .getPreviewCacheSize()
      .then((r) => setPreviewCacheBytes(r.bytes))
      .catch(() => setPreviewCacheBytes(null));
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
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-fade-in">
      <PageHeader
        title={<Tx k="nav.settings" fallback="Settings" />}
        description={<Tx k="settings.header.description" fallback="Game paths, preferences, and maintenance" />}
        action={<KofiSupportButton />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Game Configuration Section - Full Width */}
        <Card title={<Tx k="settings.sections.gameConfiguration" fallback="Game Configuration" />} icon={HardDrive} className="lg:col-span-2">
          <div className="space-y-6">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-text-primary">
                  <Tx k="settings.gamePath.label" fallback="Deadlock Installation Path" />
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-secondary">
                    {isValidPath === true && (
                      <span className="text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        <Tx k="common.status.valid" fallback="Valid" />
                      </span>
                    )}
                    {isValidPath === false && (
                      <span className="text-red-400 flex items-center gap-1">
                        <X className="w-3 h-3" />
                        <Tx k="common.status.invalid" fallback="Invalid" />
                      </span>
                    )}
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
                      <Tx k="settings.gamePath.autoDetect" fallback="Auto-detect" />
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
                    placeholder={t('settings.gamePath.pathPlaceholder')}
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
                  <Tx k="common.actions.browse" fallback="Browse" />
                </Button>
              </div>

              <p className="text-xs text-text-secondary mt-2 pl-1">
                {isDevMode ? (
                  <Tx
                    k="settings.gamePath.devModeActive"
                    fallback="Dev mode is active. Deadlock path selection is disabled."
                  />
                ) : (
                  <Tx
                    k="settings.gamePath.selectHint"
                    fallback="Select your Deadlock game folder (contains the 'game' directory)"
                  />
                )}
              </p>
            </div>

            <div className="h-px bg-white/5" />

            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div>
                <div className="font-medium flex items-center gap-2">
                  <Tx k="settings.gameinfo.title" fallback="gameinfo.gi Status" />
                  {gameinfoConfigured ? (
                    <Badge variant="success">
                      <Tx k="common.status.configured" fallback="Configured" />
                    </Badge>
                  ) : gameinfoConfigured === false ? (
                    <Badge variant="error" className="animate-pulse">
                      <Tx k="settings.gameinfo.issuesFound" fallback="Issues Found" />
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <Tx k="common.status.checking" fallback="Checking..." />
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-text-secondary mt-1 max-w-md">
                  {gameinfoStatus ?? t('settings.gameinfo.checkingStatus')}
                </p>
                {gameinfoMissing && (
                  <div className="mt-2 max-w-md space-y-1">
                    <p className="text-xs text-text-secondary">
                      <Tx
                        k="settings.gameinfo.verifySteam"
                        fallback="In Steam: right-click Deadlock > Properties > Installed Files > Verify integrity of game files."
                      />
                    </p>
                    {gameinfoCandidates.length > 0 && (
                      <p className="text-xs text-amber-300">
                        <Tx
                          k="settings.gameinfo.foundNearby"
                          values={{ candidates: gameinfoCandidates.join(', ') }}
                          fallback={`Found nearby: ${gameinfoCandidates.join(', ')}. Rename one to gameinfo.gi to restore.`}
                        />
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
                  <Tx k="settings.gamePath.openGameFolder" fallback="Open Game Folder" />
                </Button>
              ) : (
                <Button
                  onClick={handleFixGameinfo}
                  disabled={isFixingGameinfo || !activeDeadlockPath}
                  isLoading={isFixingGameinfo}
                  variant={gameinfoConfigured ? 'secondary' : 'primary'}
                  icon={Wrench}
                >
                  <Tx k="settings.gameinfo.fixConfiguration" fallback="Fix Configuration" />
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Updates */}
        <Card title={<Tx k="settings.sections.updates" fallback="Updates" />} icon={Download} className="lg:col-span-2">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    <Tx k="settings.updates.currentVersion" fallback="Current Version" />
                  </span>
                  <Badge variant="info">v{appVersion || '...'}</Badge>
                </div>
                {updateStatus?.available && !updateStatus.downloaded && (
                  <span className="text-xs text-accent">
                    <ReleaseVersionLink version={updateStatus.updateInfo?.version} />{' '}
                    <Tx k="settings.updates.available" fallback="available!" />
                  </span>
                )}
                {updateStatus?.downloaded && (
                  <span className="text-xs text-green-400 inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <ReleaseVersionLink version={updateStatus.updateInfo?.version} />{' '}
                    <Tx k="settings.updates.readyToInstall" fallback="ready to install" />
                  </span>
                )}
                {upToDate && !updateStatus?.available && !updateStatus?.checking && (
                  <span className="text-xs text-green-400">
                    <Tx k="settings.updates.upToDate" fallback="✓ You're up to date!" />
                  </span>
                )}
                {updateStatus?.error && (
                  <span className="text-xs text-red-400 basis-full">{updateStatus.error}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Always present so release notes are reachable in any state,
                    including when up to date or on a package-managed install. */}
                <Button
                  onClick={handleViewWhatsNew}
                  variant="secondary"
                  icon={Sparkles}
                >
                  <Tx k="settings.updates.whatsNew" fallback="What's New" />
                </Button>
                {installSource === 'managed' ? null : updateStatus?.downloaded ? (
                  <Button
                    onClick={handleInstallUpdate}
                    icon={ArrowDownCircle}
                  >
                    <Tx k="settings.updates.installRestart" fallback="Install & Restart" />
                  </Button>
                ) : updateStatus?.available && !updateStatus.downloading ? (
                  <Button
                    onClick={handleDownloadUpdate}
                    icon={Download}
                  >
                    <Tx k="settings.updates.downloadUpdate" fallback="Download Update" />
                  </Button>
                ) : (
                  <Button
                    onClick={handleCheckForUpdates}
                    disabled={updateStatus?.checking || updateStatus?.downloading}
                    isLoading={updateStatus?.checking}
                    variant="secondary"
                    icon={RefreshCw}
                  >
                    {updateStatus?.checking ? (
                      <Tx k="common.status.checking" fallback="Checking..." />
                    ) : (
                      <Tx k="settings.updates.checkForUpdates" fallback="Check for Updates" />
                    )}
                  </Button>
                )}
              </div>
            </div>

            {installSource === 'managed' && (
              <div className="rounded-lg bg-bg-tertiary border border-white/10 p-3 text-sm text-text-secondary space-y-2">
                <p className="text-text-primary font-medium">
                  <Tx k="settings.updates.managed" fallback="Updates are managed by your package manager." />
                </p>
                <p>
                  <Tx k="settings.updates.managedPrefix" fallback="Grimoire was installed via a system package. Update with your distro's tools:" />{' '}
                  <code className="font-mono text-text-primary">yay -Syu grimoire-bin</code>{' '}
                  <Tx k="settings.updates.onArchOr" fallback="on Arch, or" />{' '}
                  <code className="font-mono text-text-primary">{'sudo apt update && sudo apt upgrade'}</code>{' '}
                  <Tx k="settings.updates.onDebianUbuntu" fallback="on Debian/Ubuntu." />
                </p>
                <p>
                  <Tx k="settings.updates.installedDebPrefix" fallback="Installed the" />{' '}
                  <code className="font-mono text-text-primary">.deb</code>{' '}
                  <Tx k="settings.updates.installedDebSuffix" fallback="manually? Add the apt repository for automatic updates (instructions at" />{' '}
                  <code className="font-mono text-text-primary">grimoiremods.com/download</code>).
                </p>
              </div>
            )}

            {updateStatus?.downloading && (
              <div className="animate-fade-in">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span><Tx k="settings.updates.downloading" fallback="Downloading update..." /></span>
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
          title={<Tx k="settings.sections.appearance" fallback="Appearance" />}
          icon={Palette}
          className="lg:col-span-2"
          action={
            <div className="flex flex-wrap gap-2 items-center justify-end">
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
                          aria-label={t('settings.appearance.accentNamed', { name: preset.name })}
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
                      title={t('settings.appearance.pickCustomColor')}
                      aria-label={t('settings.appearance.accentCustom')}
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

                    <span aria-hidden className="mx-1 h-9 w-px bg-white/10" />

                    <button
                      type="button"
                      onClick={() => {
                        setCustomPickerOpen(false);
                        setHeroPickerOpen(true);
                      }}
                      title={
                        selectedSidebarHero
                          ? t('settings.appearance.sidebarHighlightNamed', { hero: selectedSidebarHero })
                          : t('settings.appearance.sidebarHighlightNone')
                      }
                      aria-label={
                        selectedSidebarHero
                          ? t('settings.appearance.sidebarHighlightNamed', { hero: selectedSidebarHero })
                          : t('settings.appearance.sidebarHighlightNone')
                      }
                      aria-haspopup="dialog"
                      className={`${swatchBase} bg-bg-tertiary ${
                        selectedSidebarHero
                          ? 'border-white/40'
                          : 'border-accent/60 hover:border-accent/80'
                      }`}
                    >
                      {selectedSidebarHero ? (
                        <img
                          src={getHeroChipIconPath(selectedSidebarHero)}
                          alt=""
                          aria-hidden
                          className="h-7 w-7 object-contain"
                        />
                      ) : (
                        <Ban className="h-4 w-4 text-text-secondary" aria-hidden />
                      )}
                      <ChevronDown className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 text-text-primary/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]" aria-hidden />
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
                          aria-label={t('settings.appearance.customAccentColor')}
                        >
                          <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
                          <h3 className="text-lg font-semibold text-text-primary tracking-wide font-reaver mb-4 flex items-center gap-2">
                            <Pipette className="w-4 h-4 text-accent" />
                            <Tx k="settings.appearance.customAccent" fallback="Custom Accent" />
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
                                aria-label={t('settings.appearance.selectedColorPreview')}
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
                                <Tx k="common.actions.cancel" fallback="Cancel" />
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void commitCustomDraft()}
                              >
                                <Tx k="common.actions.apply" fallback="Apply" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>,
                      document.body
                    )}

                    {heroPickerOpen && createPortal(
                      <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
                        onClick={() => setHeroPickerOpen(false)}
                        role="presentation"
                      >
                        <div
                          className="relative w-full max-w-md overflow-hidden rounded-sm border border-white/10 bg-bg-secondary p-5 shadow-2xl"
                          onClick={(e) => e.stopPropagation()}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="sidebar-hero-picker-title"
                        >
                          <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
                          <div className="mb-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <h3 id="sidebar-hero-picker-title" className="text-lg font-semibold text-text-primary tracking-wide font-reaver">
                                <Tx k="settings.appearance.sidebarHighlight" fallback="Sidebar Highlight" />
                              </h3>
                              <p className="text-xs text-text-secondary">
                                {selectedSidebarHero ?? t('common.none')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setHeroPickerOpen(false)}
                              title={t('common.actions.close')}
                              aria-label={t('settings.appearance.closeSidebarHighlightPicker')}
                              className="flex h-8 w-8 items-center justify-center rounded-sm border border-white/10 text-text-secondary transition-colors hover:border-white/25 hover:bg-white/5 hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                          <div className="grid grid-cols-5 gap-2 sm:grid-cols-6">
                            <button
                              type="button"
                              onClick={() => void handleSidebarHeroHighlightChange(null)}
                              title={t('common.none')}
                              aria-label={t('settings.appearance.sidebarHighlightNone')}
                              aria-pressed={selectedSidebarHero === null}
                              className={`relative flex aspect-square items-center justify-center rounded-sm border transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                selectedSidebarHero === null
                                  ? 'border-accent/70 bg-accent/15'
                                  : 'border-white/10 bg-bg-tertiary hover:border-accent/50 hover:bg-accent/10'
                              }`}
                            >
                              <Ban className="h-5 w-5 text-text-secondary" aria-hidden />
                              {selectedSidebarHero === null && (
                                <span className="absolute right-0.5 top-0.5 rounded-sm bg-accent p-0.5 text-accent-foreground">
                                  <Check className="h-2.5 w-2.5" aria-hidden />
                                </span>
                              )}
                            </button>
                            {HERO_NAMES_SORTED.map((heroName) => {
                              const active = selectedSidebarHero === heroName;
                              return (
                                <button
                                  key={heroName}
                                  type="button"
                                  onClick={() => void handleSidebarHeroHighlightChange(heroName)}
                                  title={heroName}
                                  aria-label={t('settings.appearance.sidebarHighlightNamed', { hero: heroName })}
                                  aria-pressed={active}
                                  className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-sm border bg-bg-tertiary transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                    active
                                      ? 'border-accent/70 bg-accent/15'
                                      : 'border-white/10 hover:border-accent/50 hover:bg-accent/10'
                                  }`}
                                >
                                  <img
                                    src={getHeroChipIconPath(heroName)}
                                    alt=""
                                    aria-hidden
                                    className="h-8 w-8 object-contain"
                                    loading="lazy"
                                  />
                                  {active && (
                                    <span className="absolute right-0.5 top-0.5 rounded-sm bg-accent p-0.5 text-accent-foreground">
                                      <Check className="h-2.5 w-2.5" aria-hidden />
                                    </span>
                                  )}
                                </button>
                              );
                            })}
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
          <Card title={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />} icon={Globe} className="lg:col-span-2">
            <SocialAccountSection />
          </Card>
        )}

        {/* Preferences */}
        <Card title={<Tx k="settings.sections.preferences" fallback="Preferences" />} icon={Shield}>
          <div className="space-y-6">
            <Toggle
              checked={settings?.hideNsfwPreviews ?? true}
              onChange={handleHideNsfwChange}
              label={<Tx k="settings.preferences.hideNsfw" fallback="Hide NSFW Content" />}
              description={<Tx k="settings.preferences.hideNsfwDescription" fallback="Blur thumbnail images for mods marked as NSFW." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.hideOutdatedMods ?? false}
              onChange={handleHideOutdatedChange}
              label={<Tx k="settings.preferences.hideOutdated" fallback="Hide Outdated Mods" />}
              description={<Tx k="settings.toggles.hideOutdated" fallback="Hide Browse mods older than the current game version." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.lockerCardsExpandedByDefault ?? false}
              onChange={handleLockerCardsExpandedByDefaultChange}
              label={<Tx k="settings.preferences.expandLocker" fallback="Expand Locker cards by default" />}
              description={<Tx k="settings.toggles.expandLocker" fallback="Start Locker list view with hero cards expanded." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.autoDisableSiblingVariants ?? true}
              onChange={handleAutoDisableSiblingsChange}
              label={<Tx k="settings.preferences.switchVariants" fallback="Switch variants instead of stacking them" />}
              description={<Tx k="settings.toggles.switchVariants" fallback="Installing a new variant disables the old one. Off keeps both active. Updates always replace the old file." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.autoEnableDownloads ?? false}
              onChange={handleAutoEnableDownloadsChange}
              label={<Tx k="settings.preferences.enableAfterDownload" fallback="Enable mods after download" />}
              description={<Tx k="settings.toggles.enableAfterDownload" fallback="Enable mods as soon as they finish downloading. Stays disabled if no slot is free." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.confirmProfileUpdate ?? true}
              onChange={handleConfirmProfileUpdateChange}
              label={<Tx k="settings.preferences.confirmProfileUpdate" fallback="Confirm before updating a profile" />}
              description={<Tx k="settings.toggles.confirmProfileUpdate" fallback="Confirm before overwriting a profile's saved mods. Off overwrites immediately." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.ignoreConflictsByDefault ?? false}
              onChange={handleIgnoreConflictsByDefaultChange}
              label={<Tx k="settings.preferences.ignoreConflicts" fallback="Ignore conflicts by default" />}
              description={<Tx k="settings.toggles.ignoreConflicts" fallback="Hide all conflicts from the Conflicts page. Off shows them." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.discordRpcEnabled ?? false}
              onChange={handleDiscordRpcChange}
              label={<Tx k="settings.preferences.discordRpc" fallback="Discord Rich Presence" />}
              description={<Tx k="settings.toggles.discordRpc" fallback="Show your current Grimoire activity on your Discord profile. Talks only to your local Discord app and sends nothing to Grimoire." />}
            />

            <div className="h-px bg-white/5" />

            <div>
              <Toggle
                checked={settings?.contributeMatchSalts ?? false}
                onChange={handleContributeMatchSaltsChange}
                label={<Tx k="settings.preferences.contributeMatchData" fallback="Contribute match data to deadlock-api.com" />}
                description={<Tx k="settings.toggles.contributeSalts" fallback="Share the replay keys Steam already caches for matches you view in-game. Sends only the match id, server cluster, and two download keys: no account id, no username, nothing about you or your mods." />}
              />
              {settings?.contributeMatchSalts && saltIngestStatus && (
                <div className="mt-2 text-xs text-text-secondary">
                  {saltIngestStatus.totalSubmitted > 0
                    ? t('settings.preferences.saltsContributed', { count: saltIngestStatus.totalSubmitted })
                    : t('settings.preferences.noSaltsYet')}
                  {saltIngestStatus.lastError ? ` ${t('settings.preferences.lastSaltAttemptFailed', { error: saltIngestStatus.lastError })}` : ''}
                </div>
              )}
            </div>

            <div className="h-px bg-white/5" />

            <div>
              <Toggle
                checked={isDevMode}
                onChange={handleDevModeChange}
                disabled={isCreatingDevPath}
                label={<Tx k="settings.preferences.developerMode" fallback="Developer Mode" />}
                description={<Tx k="settings.preferences.developerModeDescription" fallback="Use a dummy Deadlock directory for local testing without game files." />}
              />
              {isDevMode && settings?.devDeadlockPath && (
                <div className="mt-2 text-xs font-mono bg-black/30 p-2 rounded-sm text-text-secondary break-all">
                  {settings.devDeadlockPath}
                </div>
              )}
            </div>

            <div className="h-px bg-white/5" />

            <div>
              <label className="text-sm font-medium text-text-primary block">
                <Tx k="settings.preferences.dateFormat" fallback="Date Format" />
              </label>
              <p className="text-xs text-text-secondary mt-0.5 mb-2">
                <Tx
                  k="settings.preferences.dateFormatDescription"
                  fallback="How upload and update dates are shown on mods and files."
                />
              </p>
              <div className="inline-flex rounded-md border border-white/10 overflow-hidden">
                {(['MM/DD/YYYY', 'DD/MM/YYYY'] as const).map((fmt, i) => {
                  const active = (settings?.dateFormat ?? 'MM/DD/YYYY') === fmt;
                  return (
                    <button
                      key={fmt}
                      onClick={() => handleDateFormatChange(fmt)}
                      className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                        i > 0 ? 'border-l border-white/10' : ''
                      } ${
                        active
                          ? 'bg-accent/20 text-text-primary'
                          : 'bg-bg-tertiary text-text-secondary hover:bg-white/5'
                      }`}
                    >
                      {fmt}
                      <span className="ml-2 text-xs text-text-tertiary">{formatDateParts(new Date(), fmt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-white/5" />

            <LanguageSelector
              value={settings?.language ?? null}
              onChange={handleLanguageChange}
            />
          </div>
        </Card>

        {/* Experimental Features */}
        <Card title={<Tx k="settings.sections.experimentalFeatures" fallback="Experimental Features" />} icon={Beaker}>
          <div className="space-y-6">
            <p className="text-xs text-text-secondary -mt-2">
              <Tx
                k="settings.experimental.description"
                fallback="These features are still in development and may be incomplete or buggy."
              />
            </p>

            <Toggle
              checked={settings?.experimentalStats ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalStats: checked })}
              label={<Tx k="settings.experimental.statsDashboard" fallback="Stats Dashboard" />}
              description={<Tx k="settings.experimental.statsDashboardDescription" fallback="Track your performance with data from the Deadlock Stats API." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalCrosshair ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalCrosshair: checked })}
              label={<Tx k="settings.experimental.crosshairDesigner" fallback="Crosshair Designer" />}
              description={<Tx k="settings.experimental.crosshairDesignerDescription" fallback="Create custom crosshairs with a live preview." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalSocial ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalSocial: checked })}
              label={<Tx k="settings.sections.grimoireSocial" fallback="Grimoire Social" />}
              description={<Tx k="settings.experimental.socialDescription" fallback="Sign in with Steam to publish profiles and browse uploads from other players in Discover." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalUnknownModMatching ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalUnknownModMatching: checked })}
              label={<Tx k="settings.experimental.fixUnknownMods" fallback="Fix Unknown Mods" />}
              description={<Tx k="settings.toggles.fixUnknown" fallback="Match unknown local VPKs against GameBanana to recover names and thumbnails. May hit rate limits on large libraries." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalDeadworksServers ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalDeadworksServers: checked })}
              label={<Tx k="settings.experimental.deadworksServers" fallback="Deadworks Servers" />}
              description={<Tx k="settings.toggles.deadworks" fallback="Add a Servers tab to browse and join Deadworks community servers. Required content downloads before connecting." />}
            />

            <div className="h-px bg-white/5" />

            <Toggle
              checked={settings?.experimentalPerformanceConfig ?? false}
              onChange={(checked) => settings && saveSettings({ ...settings, experimentalPerformanceConfig: checked })}
              label={<Tx k="settings.experimental.performanceConfig" fallback="Performance Config" />}
              description={<Tx k="settings.toggles.performanceConfig" fallback="One-click fps boost using Sqooky's community preset. Mods keep working. Remove any time." />}
            />
          </div>
        </Card>

        {settings?.experimentalPerformanceConfig && <PerformanceConfigCard />}

        {/* Support */}
        <Card title={<Tx k="settings.sections.support" fallback="Support" />} icon={LifeBuoy} className="lg:col-span-2">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <p className="text-sm text-text-secondary">
                <Tx
                  k="settings.support.description"
                  fallback="Found a bug or have a feature request? File an issue on GitHub or drop into our Discord."
                />
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <a
                  href="https://github.com/Slush97/grimoire/issues"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60 whitespace-nowrap"
                >
                  <Github className="w-4 h-4" aria-hidden="true" />
                  <Tx k="settings.support.githubIssues" fallback="GitHub Issues" />
                </a>
                <a
                  href="https://discord.gg/KgYGHEMq2P"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center justify-center gap-2 rounded-sm px-4 py-2 text-sm font-medium border border-brand-discord/40 bg-brand-discord/10 text-text-primary hover:bg-brand-discord/20 hover:border-brand-discord/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-discord/60 whitespace-nowrap"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="w-4 h-4 fill-current"
                  >
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                  </svg>
                  <Tx k="settings.support.joinDiscord" fallback="Join Discord" />
                </a>
              </div>
            </div>

            <div className="h-px bg-white/5" />

            <div className="space-y-3">
              <div>
                <h4 className="font-medium text-sm flex items-center gap-2">
                  <Bug className="w-4 h-4 text-text-secondary" aria-hidden="true" />
                  <Tx k="settings.support.shareBugReport" fallback="Share a bug report" />
                </h4>
                <p className="text-xs text-text-secondary mt-1">
                  <Tx
                    k="settings.support.bugReportDescription"
                    fallback="Describe what went wrong, generate a sanitized report, then paste it into Discord or a GitHub issue. The report bundles app and OS info plus the tail of your log; home paths, Steam IDs, bearer tokens, and emails are stripped before it leaves the app."
                  />
                </p>
              </div>

              <textarea
                value={bugDescription}
                onChange={(e) => setBugDescription(e.target.value)}
                placeholder={t('settings.support.bugPlaceholder')}
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
                  {bugReportText ? (
                    <Tx k="settings.support.regenerateReport" fallback="Regenerate report" />
                  ) : (
                    <Tx k="settings.support.generateReport" fallback="Generate report" />
                  )}
                </Button>
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeFullLog}
                    onChange={(e) => setIncludeFullLog(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-sm border border-white/20 bg-bg-tertiary accent-accent focus:outline-none focus:ring-2 focus:ring-accent"
                  />
                  <Tx
                    k="settings.support.includeFullLog"
                    fallback="Include full log (up to 5 MB; Discord auto-attaches as a file)"
                  />
                </label>
              </div>

              {bugReportError && (
                <p className="text-xs text-red-400 break-all">{bugReportError}</p>
              )}

              {bugReportText && (
                <div className="space-y-2 animate-fade-in">
                  <p className="text-[11px] text-text-secondary/70">
                    <Tx
                      k="settings.support.reviewBeforeSharing"
                      fallback="Review before sharing. Nothing is sent automatically."
                    />
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
                        ? <Tx k="common.status.copied" fallback="Copied" />
                        : bugCopyState === 'failed'
                          ? <Tx k="settings.support.copyFailed" fallback="Copy failed: select and Ctrl+C" />
                          : <Tx k="settings.support.copyReport" fallback="Copy report" />}
                    </Button>
                    <a
                      href="https://discord.gg/KgYGHEMq2P"
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-brand-discord/40 bg-brand-discord/10 text-text-primary hover:bg-brand-discord/20 hover:border-brand-discord/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-discord/60"
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                      <Tx k="settings.support.openDiscord" fallback="Open Discord" />
                    </a>
                    <a
                      href={githubIssueUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium border border-border bg-bg-tertiary/40 text-text-primary hover:bg-bg-tertiary/70 hover:border-text-secondary/60 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-text-secondary/60"
                    >
                      <Github className="w-4 h-4" aria-hidden="true" />
                      <Tx k="settings.support.openGithubIssue" fallback="Open GitHub issue" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Maintenance */}
        <Card title={<Tx k="settings.sections.maintenance" fallback="Maintenance" />} icon={Wrench} className="lg:col-span-2">
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
                <Tx k="settings.maintenance.cleanup" fallback="Cleanup" />
              </Button>
            </div>

            <div className="h-px bg-white/5" />

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
                  <p className="text-xs text-accent mt-2 animate-fade-in">{resetResult}</p>
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

            <div className="h-px bg-white/5" />

            <AutoexecSection gamePath={activeDeadlockPath} />
          </div>
        </Card>

        {/* Mod Database Cache - Full Width */}
        <Card title={<Tx k="settings.sections.modDatabaseCache" fallback="Mod Database Cache" />} icon={Database} className="lg:col-span-2">
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

        {/* Local preview cache - Full Width */}
        <Card title={<Tx k="settings.sections.localPreviewCache" fallback="Local preview cache" />} icon={HardDrive} className="lg:col-span-2">
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
      </div>

      {/* Changelog Modal */}
      {showChangelog && updateStatus?.updateInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-bg-secondary border border-white/10 rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden shadow-2xl animate-fade-in relative">
            <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[2px] bg-accent/60" />
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div>
                <h2 className="text-xl font-bold">
                  <Tx k="settings.updates.whatsNewIn" fallback="What's New in" />{' '}
                  <ReleaseVersionLink version={updateStatus.updateInfo.version} />
                </h2>
                {updateStatus.updateInfo.releaseDate && (
                  <p className="text-sm text-text-secondary mt-1">
                    <Tx
                      k="settings.updates.released"
                      values={{ date: new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString() }}
                      fallback={`Released ${new Date(updateStatus.updateInfo.releaseDate).toLocaleDateString()}`}
                    />
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
                      <h3 className="font-semibold text-accent">
                        <ReleaseVersionLink version={note.version} />
                      </h3>
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
                <p className="text-text-secondary">
                  <Tx k="settings.updates.noReleaseNotes" fallback="No release notes available." />
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 p-6 border-t border-white/10">
              <Button
                onClick={() => setShowChangelog(false)}
                variant="secondary"
              >
                <Tx k="common.actions.close" fallback="Close" />
              </Button>
              <Button
                onClick={() => {
                  setShowChangelog(false);
                  handleDownloadUpdate();
                }}
                icon={Download}
              >
                <Tx k="settings.updates.downloadUpdate" fallback="Download Update" />
              </Button>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}

// Autoexec.cfg helper section
function AutoexecSection({ gamePath }: { gamePath: string | null }) {
  const { t } = useTranslation();
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
      setResult(t('settings.autoexec.created', { path: res.path }));
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
            <Tx k="settings.autoexec.title" fallback="Autoexec Configuration" />
            {status === null ? (
              <span className="text-xs text-text-secondary">
                <Tx k="common.status.checking" fallback="Checking..." />
              </span>
            ) : status.exists ? (
              <Badge variant="success">
                <Tx k="common.status.active" fallback="Active" />
              </Badge>
            ) : (
              <Badge variant="warning">
                <Tx k="common.status.missing" fallback="Missing" />
              </Badge>
            )}
          </h4>
          <p className="text-xs text-text-secondary mt-1">
            <Tx
              k="settings.autoexec.description"
              fallback="Ensure autoexec.cfg exists for crosshairs and commands."
            />
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
            <Tx k="settings.autoexec.createFile" fallback="Create File" />
          </Button>
        )}
      </div>
    </div>
  );
}
