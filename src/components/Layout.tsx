import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Download, Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import SyncIndicator from './SyncIndicator';
import DownloadQueueIndicator from './DownloadQueueIndicator';
import { Button } from './common/ui';
import { getSettings, setSettings, getGameinfoStatus, fixGameinfo } from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gameinfoAlert, setGameinfoAlert] = useState<string | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);
  const [oneClickBanner, setOneClickBanner] = useState<{ message: string; isError: boolean } | null>(null);

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

  useEffect(() => {
    const unsubscribe = window.electronAPI.onOneClickInstall((data) => {
      if (data.error) {
        setOneClickBanner({ message: data.error, isError: true });
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
      setOneClickBanner({
        message: `Installing ${label} from GameBanana…`,
        isError: false,
      });
      navigate('/');
    });
    return unsubscribe;
  }, [navigate]);

  useEffect(() => {
    if (!oneClickBanner) return;
    const timeout = setTimeout(
      () => setOneClickBanner(null),
      oneClickBanner.isError ? 8000 : 4000
    );
    return () => clearTimeout(timeout);
  }, [oneClickBanner]);

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
      <main className="flex-1 overflow-auto bg-bg-primary">
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
        <div key={location.pathname} className="animate-fade-in h-full">
          <Outlet />
        </div>
      </main>
      {/* Status indicators - bottom-right corner */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <DownloadQueueIndicator />
        <SyncIndicator />
      </div>
      {oneClickBanner && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2">
          <div
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur-sm ${oneClickBanner.isError
              ? 'border-red-500/40 bg-red-500/15 text-red-200'
              : 'border-accent/40 bg-accent/15 text-accent-foreground'
              }`}
          >
            {oneClickBanner.isError ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span>{oneClickBanner.message}</span>
          </div>
        </div>
      )}
      {showWelcome && <WelcomeModal onComplete={handleSetupComplete} />}
    </div>
  );
}
