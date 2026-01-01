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
import { ErrorBoundary } from './components/common/ErrorBoundary';

export default function App() {
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
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
}
