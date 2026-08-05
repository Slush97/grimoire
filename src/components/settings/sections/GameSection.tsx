import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, FolderOpen, RefreshCw, Wrench, FileText, HardDrive, Loader2 } from 'lucide-react';
import { useAppStore } from '../../../stores/appStore';
import {
  fixGameinfo,
  getGameinfoStatus,
  openGameFolder,
  openPerformanceConfigFile,
  showOpenDialog,
  validateDeadlockPath,
} from '../../../lib/api';
import { getActiveDeadlockPath } from '../../../lib/appSettings';
import { showToast } from '../../../stores/toastStore';
import { Badge, Button, Card } from '../../common/ui';
import { Input } from '../../common/forms';
import { ConfirmModal } from '../../common/PageComponents';
import Tx from '../../translation/Tx';
import PerformanceConfigCard from '../../performance/PerformanceConfigCard';

// Game paths and the gameinfo.gi wiring that makes mods load at all.
export default function GameSection() {
  const { t } = useTranslation();
  const { settings, saveSettings, detectDeadlock } = useAppStore();
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [gameinfoStatus, setGameinfoStatus] = useState<string | null>(null);
  const [gameinfoConfigured, setGameinfoConfigured] = useState<boolean | null>(null);
  const [gameinfoMissing, setGameinfoMissing] = useState(false);
  const [gameinfoCandidates, setGameinfoCandidates] = useState<string[]>([]);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  const [openGameinfoConfirm, setOpenGameinfoConfirm] = useState(false);

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

  const handleOpenGameinfo = async () => {
    setOpenGameinfoConfirm(false);
    try {
      // Reuses the performance-config opener: same gameinfo.gi, opened in the
      // user's chosen editor (path read in the main process, never passed here).
      await openPerformanceConfigFile();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      showToast(
        t('settings.gameinfo.openFailed', {
          error: detail.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''),
        }),
        { tone: 'error' }
      );
    }
  };

  return (
    <>
      <Card title={<Tx k="settings.sections.gameConfiguration" fallback="Game Configuration" />} icon={HardDrive}>
        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium text-text-primary">
                <Tx k="settings.gamePath.label" fallback="Deadlock Installation Path" />
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-secondary">
                  {isValidPath === true && (
                    <span className="text-state-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      <Tx k="common.status.valid" fallback="Valid" />
                    </span>
                  )}
                  {isValidPath === false && (
                    <span className="text-state-danger flex items-center gap-1">
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
                <Input
                  type="text"
                  value={displayPath}
                  onChange={(e) => handlePathChange(e.target.value)}
                  placeholder={t('settings.gamePath.pathPlaceholder')}
                  disabled={isDevMode}
                  className="font-mono"
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

          <div className="h-px bg-hl/5" />

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
                    <p className="text-xs text-state-warning">
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
              <div className="flex flex-shrink-0 gap-2">
                <Button
                  onClick={() => setOpenGameinfoConfirm(true)}
                  disabled={!activeDeadlockPath}
                  variant="secondary"
                  icon={FileText}
                >
                  <Tx k="settings.gameinfo.openFile" fallback="Open gameinfo.gi" />
                </Button>
                <Button
                  onClick={handleFixGameinfo}
                  disabled={isFixingGameinfo || !activeDeadlockPath}
                  isLoading={isFixingGameinfo}
                  variant={gameinfoConfigured ? 'secondary' : 'primary'}
                  icon={Wrench}
                >
                  <Tx k="settings.gameinfo.fixConfiguration" fallback="Fix Configuration" />
                </Button>
              </div>
            )}
          </div>

          {activeDeadlockPath && (
            <>
              <div className="h-px bg-hl/5" />
              <AutoexecSection gamePath={activeDeadlockPath} />
            </>
          )}
        </div>
      </Card>

      {settings?.experimentalPerformanceConfig && <PerformanceConfigCard />}

      <ConfirmModal
        isOpen={openGameinfoConfirm}
        onCancel={() => setOpenGameinfoConfirm(false)}
        onConfirm={handleOpenGameinfo}
        title={<Tx k="settings.gameinfo.openConfirmTitle" fallback="Open gameinfo.gi?" />}
        message={
          <Tx
            k="settings.gameinfo.openConfirmMessage"
            fallback="This opens Deadlock's gameinfo.gi in your text editor. It controls how the game loads mods. Editing it by hand can break mod loading or stop the game from launching. If something goes wrong, use Fix Configuration to repair it. Only proceed if you know what you're changing."
          />
        }
        confirmLabel={<Tx k="settings.gameinfo.openFile" fallback="Open gameinfo.gi" />}
        variant="primary"
      />
    </>
  );
}

// Autoexec.cfg helper section
function AutoexecSection({ gamePath }: { gamePath: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<{
    exists: boolean;
    path: string | null;
    hasCrosshairSettings: boolean;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI.getAutoexecStatus(gamePath).then(setStatus);
  }, [gamePath]);

  const handleCreate = async () => {
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

  return (
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
        {result && <p className="text-xs text-accent-ink mt-2">{result}</p>}
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
  );
}
