import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Sidebar from './Sidebar';
import WelcomeModal from './WelcomeModal';
import { getSettings, setSettings } from '../lib/api';

export default function Layout() {
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkFirstRun = async () => {
      try {
        const settings = await getSettings();
        if (!settings.hasCompletedSetup) {
          setShowWelcome(true);
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
      {showWelcome && <WelcomeModal onComplete={handleSetupComplete} />}
    </div>
  );
}
