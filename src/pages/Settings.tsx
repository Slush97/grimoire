import { useEffect, useState, useMemo } from 'react';
import { Settings as SettingsIcon, FolderOpen, Check, X, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useAppStore } from '../stores/appStore';
import { cleanupAddons, fixGameinfo, getGameinfoStatus, validateDeadlockPath } from '../lib/api';

export default function Settings() {
  const { settings, settingsLoading, loadSettings, saveSettings, detectDeadlock } = useAppStore();
  const [localPath, setLocalPath] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<boolean | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [isCleaning, setIsCleaning] = useState(false);
  const [gameinfoStatus, setGameinfoStatus] = useState<string | null>(null);
  const [gameinfoConfigured, setGameinfoConfigured] = useState<boolean | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);

  // The displayed path: local override or settings value
  const displayPath = localPath ?? settings?.deadlockPath ?? '';

  // Compute isValidPath: if we have a saved path and no local override, it's valid
  // Otherwise use the validation result
  const isValidPath = useMemo(() => {
    if (localPath !== null) {
      return validationResult;
    }
    return settings?.deadlockPath ? true : null;
  }, [localPath, validationResult, settings?.deadlockPath]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      if (!settings?.deadlockPath) {
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
  }, [settings?.deadlockPath]);

  const handleBrowse = async () => {
    const selected = await open({
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
                className="w-full bg-bg-tertiary border border-border rounded-lg px-3 py-2 pr-10 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
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
              className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Browse
            </button>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-text-secondary">
              Select your Deadlock game folder (contains the 'game' directory)
            </p>
            <button
              onClick={handleAutoDetect}
              disabled={isDetecting}
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
              disabled={isFixingGameinfo || !settings?.deadlockPath}
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
              disabled={isCleaning || !settings?.deadlockPath}
              className="px-4 py-2 rounded-lg bg-bg-tertiary border border-border hover:border-accent/60 text-sm disabled:opacity-50"
            >
              {isCleaning ? 'Cleaning…' : 'Clean'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
