import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Download, Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import SyncIndicator from './SyncIndicator';
import DownloadQueueIndicator from './DownloadQueueIndicator';
import { Button } from './common/ui';
import { ConfirmModal } from './common/PageComponents';
import { getSettings, setSettings, getGameinfoStatus, fixGameinfo } from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { applyAccentColor } from '../lib/accentColor';
import { useAppStore } from '../stores/appStore';
import type { OneClickSuspiciousFilesData, MultiVpkPickData } from '../types/electron';
import MultiVpkPickerModal from './MultiVpkPickerModal';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const outletKey = location.pathname.startsWith('/locker') ? '/locker' : location.pathname;
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gameinfoAlert, setGameinfoAlert] = useState<string | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  // Toast state for 1-click installs. Lives through the full install
  // lifecycle: starting → downloading (with %) → extracting → success/error.
  // modId is the GB mod id from the protocol URL — used to filter download
  // events so we don't react to unrelated downloads from the Browse tab.
  type OneClickToast =
    | { phase: 'starting'; modId: number | undefined; label: string }
    | {
        phase: 'downloading';
        modId: number | undefined;
        label: string;
        progress: { downloaded: number; total: number };
      }
    | { phase: 'extracting'; modId: number | undefined; label: string }
    | { phase: 'success'; modId: number | undefined; label: string }
    | { phase: 'error'; modId: number | undefined; label: string; message: string };
  const [oneClickBanner, setOneClickBanner] = useState<OneClickToast | null>(null);
  const [suspiciousPrompt, setSuspiciousPrompt] = useState<OneClickSuspiciousFilesData | null>(null);
  const [multiVpkPrompt, setMultiVpkPrompt] = useState<MultiVpkPickData | null>(null);

  // Re-theme the app whenever the stored accent color changes. We pull
  // settings into the global store on mount so the value is available before
  // any page renders — otherwise the first paint flashes the default orange
  // even when the user has picked a different accent.
  const accentColor = useAppStore((s) => s.settings?.accentColor);
  const loadStoreSettings = useAppStore((s) => s.loadSettings);
  useEffect(() => {
    loadStoreSettings();
  }, [loadStoreSettings]);
  useEffect(() => {
    applyAccentColor(accentColor);
  }, [accentColor]);

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const settings = await getSettings();
        const activePath = getActiveDeadlockPath(settings);
        if (activePath) {
          try {
            const status = await getGameinfoStatus();
            setGameinfoAlert(status.configured ? null : status.message);
          } catch (err) {
            setGameinfoAlert(`Failed to check gameinfo.gi: ${err}`);
          }
        }
        if (!settings.hasCompletedSetup) {
          setShowWelcome(true);
        } else {
          // Auto-sync if database needs it (first launch or stale data)
          const needsSync = await window.electronAPI.needsSync();
          if (needsSync) {
            console.log('[Layout] Database needs sync, starting in background...');
            window.electronAPI.syncAllMods().catch(err => {
              console.error('[Layout] Background sync failed:', err);
            });
          }
        }
      } catch (err) {
        console.error('Failed to check first-run status:', err);
      } finally {
        setLoading(false);
      }
    };

    checkFirstRun();
  }, []);

  // Silent mod refresh when the window regains focus. Covers the case where
  // the user drops a VPK into addons/ from a file manager while Grimoire is
  // in the background — alt-tabbing back triggers a re-scan so the new file
  // shows up without forcing a navigation. Throttled so rapid focus/blur
  // (some WMs flicker on tooltip hover) doesn't spam the backend.
  useEffect(() => {
    let lastRun = 0;
    const onFocus = () => {
      const state = useAppStore.getState();
      if (!getActiveDeadlockPath(state.settings)) return;
      if (state.modsLoading) return;
      const now = Date.now();
      if (now - lastRun < 1500) return;
      lastRun = now;
      state.loadMods({ silent: true });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onOneClickInstall((data) => {
      if (data.error) {
        setOneClickBanner({
          phase: 'error',
          modId: data.modId,
          label: data.modName ?? 'mod',
          message: data.error,
        });
        return;
      }
      const label = data.modName ?? (() => {
        try {
          const u = new URL(data.archiveUrl);
          const last = u.pathname.split('/').filter(Boolean).pop();
          // Fall back to the archive filename only when it looks like one
          // (has a recognized extension); otherwise just say "mod" — bare
          // numeric paths like /dl/12345 aren't user-facing.
          if (last && /\.(zip|7z|rar|vpk)$/i.test(last)) return decodeURIComponent(last);
          return 'mod';
        } catch {
          return 'mod';
        }
      })();
      setOneClickBanner({ phase: 'starting', modId: data.modId, label });
      navigate('/');
    });
    return unsubscribe;
  }, [navigate]);

  // Mirror the download lifecycle into the 1-click toast. We use the modId
  // from the protocol URL as the join key so unrelated downloads from the
  // Browse tab don't hijack the banner.
  useEffect(() => {
    const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
      setOneClickBanner((prev) => {
        if (!prev || prev.modId === undefined || prev.modId !== data.modId) return prev;
        if (prev.phase === 'success' || prev.phase === 'error') return prev;
        return {
          phase: 'downloading',
          modId: prev.modId,
          label: prev.label,
          progress: { downloaded: data.downloaded, total: data.total },
        };
      });
    });
    const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
      setOneClickBanner((prev) => {
        if (!prev || prev.modId === undefined || prev.modId !== data.modId) return prev;
        return { phase: 'extracting', modId: prev.modId, label: prev.label };
      });
    });
    const completeUnsub = window.electronAPI.onDownloadComplete((data) => {
      setOneClickBanner((prev) => {
        if (!prev || prev.modId === undefined || prev.modId !== data.modId) return prev;
        return { phase: 'success', modId: prev.modId, label: prev.label };
      });
    });
    const errorUnsub = window.electronAPI.onDownloadError((data) => {
      setOneClickBanner((prev) => {
        if (!prev || prev.modId === undefined || prev.modId !== data.modId) return prev;
        return { phase: 'error', modId: prev.modId, label: prev.label, message: data.message };
      });
    });
    return () => {
      progressUnsub();
      extractingUnsub();
      completeUnsub();
      errorUnsub();
    };
  }, []);

  // Auto-dismiss only at terminal states. While in flight (starting,
  // downloading, extracting) the toast stays put so the user can watch
  // the percentage tick up.
  useEffect(() => {
    if (!oneClickBanner) return;
    if (oneClickBanner.phase === 'success') {
      const t = setTimeout(() => setOneClickBanner(null), 2500);
      return () => clearTimeout(t);
    }
    if (oneClickBanner.phase === 'error') {
      const t = setTimeout(() => setOneClickBanner(null), 8000);
      return () => clearTimeout(t);
    }
  }, [oneClickBanner]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onOneClickSuspiciousFiles((data) => {
      setSuspiciousPrompt(data);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMultiVpkPick((data) => {
      setMultiVpkPrompt(data);
    });
    return unsubscribe;
  }, []);

  const respondToSuspicious = async (accepted: boolean) => {
    if (!suspiciousPrompt) return;
    await window.electronAPI.respondToOneClickSuspiciousFiles(
      suspiciousPrompt.requestId,
      accepted
    );
    setSuspiciousPrompt(null);
  };

  const respondToMultiVpk = async (selected: string[] | null) => {
    if (!multiVpkPrompt) return;
    await window.electronAPI.respondToMultiVpkPick(multiVpkPrompt.requestId, selected);
    setMultiVpkPrompt(null);
  };

  const handleFixGameinfo = async () => {
    setIsFixingGameinfo(true);
    try {
      const result = await fixGameinfo();
      setGameinfoAlert(result.configured ? null : result.message);
    } catch (err) {
      setGameinfoAlert(`Failed to fix gameinfo.gi: ${err}`);
    } finally {
      setIsFixingGameinfo(false);
    }
  };

  const handleSetupComplete = async () => {
    try {
      const settings = await getSettings();
      await setSettings({ ...settings, hasCompletedSetup: true });
      setShowWelcome(false);
      // Navigate to Browse tab after first-time setup
      navigate('/browse');
      // Start initial database sync in background
      console.log('[Layout] First setup complete, starting initial sync...');
      window.electronAPI.syncAllMods().catch(err => {
        console.error('[Layout] Initial sync failed:', err);
      });
    } catch (err) {
      console.error('Failed to save setup completion:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-primary">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-bg-primary">
        {gameinfoAlert && (
          <div className="sticky top-0 z-40 border-b border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 text-yellow-200">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <div className="flex-1 text-sm">
                <span className="font-semibold">gameinfo.gi issue:</span> {gameinfoAlert}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="warning" size="sm" onClick={handleFixGameinfo} isLoading={isFixingGameinfo}>
                  Fix now
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
                  Open settings
                </Button>
              </div>
            </div>
          </div>
        )}
        <div key={outletKey} className="min-h-0 flex-1 animate-fade-in">
          <Outlet />
        </div>
      </main>
      {/* Status indicators stack in the bottom-right corner. */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        <DownloadQueueIndicator />
        <SyncIndicator />
      </div>
      {oneClickBanner && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
          {(() => {
            const isError = oneClickBanner.phase === 'error';
            const isSuccess = oneClickBanner.phase === 'success';
            const pct =
              oneClickBanner.phase === 'downloading' && oneClickBanner.progress.total > 0
                ? Math.min(
                    100,
                    Math.round(
                      (oneClickBanner.progress.downloaded / oneClickBanner.progress.total) * 100
                    )
                  )
                : null;
            const message =
              oneClickBanner.phase === 'error'
                ? oneClickBanner.message
                : oneClickBanner.phase === 'success'
                ? `Installed ${oneClickBanner.label}`
                : oneClickBanner.phase === 'extracting'
                ? `Extracting ${oneClickBanner.label}…`
                : oneClickBanner.phase === 'downloading'
                ? `Downloading ${oneClickBanner.label}${pct !== null ? ` — ${pct}%` : ''}`
                : `Installing ${oneClickBanner.label} from GameBanana…`;
            const icon = isError ? (
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            ) : isSuccess ? (
              <Check className="h-4 w-4 flex-shrink-0" />
            ) : oneClickBanner.phase === 'extracting' ||
              oneClickBanner.phase === 'starting' ? (
              <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
            ) : (
              <Download className="h-4 w-4 flex-shrink-0" />
            );
            return (
              <div
                className={`flex flex-col gap-1.5 overflow-hidden rounded-sm border text-sm shadow-lg backdrop-blur-sm min-w-[260px] max-w-[420px] ${
                  isError
                    ? 'border-red-500/40 bg-red-500/15 text-red-200'
                    : isSuccess
                    ? 'border-green-500/40 bg-green-500/15 text-green-200'
                    : 'border-accent/40 bg-accent/15 text-accent-foreground'
                }`}
              >
                <div className="flex items-center gap-2 px-4 py-2">
                  {icon}
                  <span className="truncate">{message}</span>
                </div>
                {pct !== null && (
                  <div className="h-1 w-full bg-bg-secondary/40">
                    <div
                      className="h-full bg-accent transition-all duration-200"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      <ConfirmModal
        isOpen={!!suspiciousPrompt}
        title="Suspicious files detected"
        variant="danger"
        confirmLabel="Install anyway"
        cancelLabel="Cancel"
        onConfirm={() => respondToSuspicious(true)}
        onCancel={() => respondToSuspicious(false)}
        message={
          suspiciousPrompt ? (
            <div className="space-y-3">
              <p>
                <span className="font-semibold text-text-primary">{suspiciousPrompt.modName}</span>{' '}
                contains files that aren&apos;t typical for a Deadlock mod:
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-sm border border-border bg-bg-tertiary px-3 py-2 text-xs font-mono text-yellow-200">
                {suspiciousPrompt.files.slice(0, 30).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {suspiciousPrompt.files.length > 30 && (
                  <li className="text-text-secondary">
                    …and {suspiciousPrompt.files.length - 30} more
                  </li>
                )}
              </ul>
              <p className="text-xs">
                Grimoire only extracts <code className="rounded bg-bg-tertiary px-1">.vpk</code> files
                — these won&apos;t be installed even if you continue. Review the mod&apos;s GameBanana
                page if anything looks off.
              </p>
            </div>
          ) : null
        }
      />
      {multiVpkPrompt && (
        <MultiVpkPickerModal
          key={multiVpkPrompt.requestId}
          data={multiVpkPrompt}
          onConfirm={(selected) => respondToMultiVpk(selected)}
          onCancel={() => respondToMultiVpk(null)}
        />
      )}
      {showWelcome && <WelcomeModal onComplete={handleSetupComplete} />}
    </div>
  );
}
