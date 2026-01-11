import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import SyncIndicator from './SyncIndicator';
import DownloadQueueIndicator from './DownloadQueueIndicator';
import { getSettings, setSettings } from '../lib/api';

export default function Layout() {
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const settings = await getSettings();
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
