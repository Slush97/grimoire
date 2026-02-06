import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import SyncIndicator from './SyncIndicator';
import DownloadQueueIndicator from './DownloadQueueIndicator';
import { Button } from './common/ui';
import { getSettings, setSettings, getGameinfoStatus, fixGameinfo } from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';

export default function Layout() {
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [gameinfoAlert, setGameinfoAlert] = useState<string | null>(null);
  const [isFixingGameinfo, setIsFixingGameinfo] = useState(false);

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
        <Outlet />
      </main>
      {/* Status indicators - bottom-right corner */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <DownloadQueueIndicator />
        <SyncIndicator />
      </div>
      {showWelcome && <WelcomeModal onComplete={handleSetupComplete} />}
    </div>
  );
}
