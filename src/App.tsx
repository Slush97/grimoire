import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Installed from './pages/Installed';
import Browse from './pages/Browse';
import Locker from './pages/Locker';
import LockerHero from './pages/LockerHero';
import Conflicts from './pages/Conflicts';
import Profiles from './pages/Profiles';
import Settings from './pages/Settings';
import Crosshair from './pages/Crosshair';
import Autoexec from './pages/Autoexec';
import Stats from './pages/Stats';
import { ErrorBoundary } from './components/common/ErrorBoundary';

export default function App() {
  // Swallow stray file drops so Electron doesn't navigate the window to the
  // dropped file:// URL. Registered drop zones still handle their own events.
  useEffect(() => {
    const swallow = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  return (
    <HashRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Installed />} />
            <Route path="browse" element={<Browse />} />
            <Route path="locker" element={<Locker />} />
            <Route path="locker/hero/:heroId" element={<LockerHero />} />
            <Route path="conflicts" element={<Conflicts />} />
            <Route path="profiles" element={<Profiles />} />
            <Route path="crosshair" element={<Crosshair />} />
            <Route path="autoexec" element={<Autoexec />} />
            <Route path="stats" element={<Stats />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
