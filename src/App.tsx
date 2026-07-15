import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Installed from './pages/Installed';
import Browse from './pages/Browse';
import Discover from './pages/Discover';
import Servers from './pages/Servers';
import Locker from './pages/Locker';
import Foundry from './pages/Foundry';
import Conflicts from './pages/Conflicts';
import Profiles from './pages/Profiles';
import Settings from './pages/Settings';
import Crosshair from './pages/Crosshair';
import Autoexec from './pages/Autoexec';
import Stats from './pages/Stats';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { useSocialStore } from './stores/socialStore';
import { useAppStore } from './stores/appStore';
import { getAssetPath } from './lib/assetPath';
import { rollMemeAppTitle } from './lib/easterEggs';

const GASSY_SOUND = getAssetPath('/sounds/gassy.mp3');

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

  // Easter egg: typing "gassy" anywhere plays the gassy sound.
  useEffect(() => {
    let buffer = '';
    let audio: HTMLAudioElement | null = null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      buffer = (buffer + e.key.toLowerCase()).slice(-5);
      if (buffer !== 'gassy') return;
      buffer = '';
      audio?.pause();
      audio = new Audio(GASSY_SOUND);
      audio.volume = useAppStore.getState().soundVolume;
      void audio.play().catch(() => {});
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Easter egg: rarely boot under his "DeadGame" alias.
  useEffect(() => {
    const memeTitle = rollMemeAppTitle();
    if (memeTitle) document.title = memeTitle;
  }, []);

  // Pull the persisted social-session state into the renderer once at boot.
  // Idempotent: subsequent callers are no-ops. The Profiles page's "Publish"
  // button gate depends on this so it doesn't appear stale on first paint.
  useEffect(() => {
    void useSocialStore.getState().hydrate();
  }, []);

  return (
    <HashRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Installed />} />
            <Route path="browse" element={<Browse />} />
            <Route path="discover" element={<Discover />} />
            <Route path="servers" element={<Servers />} />
            <Route path="locker/*" element={<Locker />} />
            <Route path="foundry" element={<Foundry />} />
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
