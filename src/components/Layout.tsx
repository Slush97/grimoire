import { useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import SyncIndicator from './SyncIndicator';
import DownloadQueueIndicator from './DownloadQueueIndicator';
import AppUpdateBanner from './AppUpdateBanner';
import { Button } from './common/ui';
import { ConfirmModal } from './common/PageComponents';
import { ToastStack } from './common/ToastStack';
import { showToast } from '../stores/toastStore';
import { getSettings, setSettings, getGameinfoStatus, fixGameinfo } from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { applyAccentColor } from '../lib/accentColor';
import { useAppStore } from '../stores/appStore';
import type { OneClickSuspiciousFilesData, MultiVpkPickData } from '../types/electron';
import MultiVpkPickerModal from './MultiVpkPickerModal';
import DiscordPresence from './DiscordPresence';

export default function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const outletKey = location.pathname.startsWith('/locker') ? '/locker' : location.pathname;
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gameinfoAlert, setGameinfoAlert] = useState<string | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  // Normal one-click download progress is handled by DownloadQueueIndicator.
  // This only catches failures before a download can be queued.
  const [suspiciousPrompt, setSuspiciousPrompt] = useState<OneClickSuspiciousFilesData | null>(null);
  const [multiVpkPrompt, setMultiVpkPrompt] = useState<MultiVpkPickData | null>(null);
  // Shown when GameBanana starts returning 429s (the main process debounces the
  // event so a burst of rejected requests surfaces one warning, not a flood).

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
        showToast(`${data.modName ?? 'mod'}: ${data.error}`, { tone: 'error', duration: 8000 });
        return;
      }
      navigate('/');
    });
    return unsubscribe;
  }, [navigate]);

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

  // Surface GameBanana rate limiting app-wide. The heavy "Fix Unknown"
  // auto-detect is the usual trigger, but any tab can hit it, so the warning
  // lives here rather than inside one page.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onGameBananaRateLimited(() => {
      showToast(t('layout.rateLimited'), {
        tone: 'warning',
        duration: 8000,
        dismissable: true,
      });
    });
    return unsubscribe;
  }, [t]);

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
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
      {/* Headless: drives opt-in Discord Rich Presence from the active route. */}
      <DiscordPresence />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-bg-primary">
        {gameinfoAlert && (
          <div className="sticky top-0 z-40 border-b border-yellow-500/30 bg-yellow-500/10 backdrop-blur-sm">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 text-yellow-200">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <div className="flex-1 text-sm">
                <span className="font-semibold">{t('layout.gameinfoIssue')}</span> {gameinfoAlert}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="warning" size="sm" onClick={handleFixGameinfo} isLoading={isFixingGameinfo}>
                  {t('layout.fixNow')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
                  {t('layout.openSettings')}
                </Button>
              </div>
            </div>
          </div>
        )}
        <AppUpdateBanner />
        <div key={outletKey} className="min-h-0 flex-1 overflow-auto animate-fade-in">
          <Outlet />
        </div>
      </main>
      </div>
      {/* Status indicators stack in the bottom-right corner. */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        <DownloadQueueIndicator />
        <SyncIndicator />
      </div>
      <ToastStack />
      <ConfirmModal
        isOpen={!!suspiciousPrompt}
        title={t('layout.suspicious.title')}
        variant="danger"
        confirmLabel={t('layout.suspicious.installAnyway')}
        cancelLabel={t('common.actions.cancel')}
        onConfirm={() => respondToSuspicious(true)}
        onCancel={() => respondToSuspicious(false)}
        message={
          suspiciousPrompt ? (
            <div className="space-y-3">
              <p>
                <Trans
                  i18nKey="layout.suspicious.body"
                  values={{ modName: suspiciousPrompt.modName }}
                  components={{ name: <span className="font-semibold text-text-primary" /> }}
                />
              </p>
              <ul className="max-h-40 overflow-y-auto rounded-sm border border-border bg-bg-tertiary px-3 py-2 text-xs font-mono text-yellow-200">
                {suspiciousPrompt.files.slice(0, 30).map((f) => (
                  <li key={f}>{f}</li>
                ))}
                {suspiciousPrompt.files.length > 30 && (
                  <li className="text-text-secondary">
                    {t('layout.suspicious.andMore', { count: suspiciousPrompt.files.length - 30 })}
                  </li>
                )}
              </ul>
              <p className="text-xs">
                <Trans
                  i18nKey="layout.suspicious.extractsNote"
                  components={{ code: <code className="rounded bg-bg-tertiary px-1" /> }}
                />
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
