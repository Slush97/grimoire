import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
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
import { useGlobalModFileDrop } from './lib/useGlobalModFileDrop';
import { ModSafetySync } from './components/ModSafety';

const GASSY_SOUND = getAssetPath('/sounds/gassy.mp3');

export default function App() {
  const { t } = useTranslation();
  // Owns every external file drop: claims VPKs and archives for the batch
  // importer, and swallows the rest so Electron never navigates the window to
  // a dropped file:// URL. Registered zones still handle their own file types.
  const fileDragOver = useGlobalModFileDrop();

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
    <>
      <HashRouter>
        <ModSafetySync />
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
              <Route path="settings/:section?" element={<Settings />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </HashRouter>
      {/* Shows for any external file drag: the extension is only knowable at
          drop time, so the copy offers the import rather than promising it. */}
      {fileDragOver && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center animate-fade-in">
          <div className="absolute inset-3 rounded-xl border-2 border-dashed border-accent/60 bg-bg-primary/30" aria-hidden />
          <div
            role="status"
            className="relative flex items-center gap-2.5 rounded-lg border border-border bg-bg-secondary/95 px-5 py-3 text-sm font-medium text-text-primary shadow-lg shadow-black/40 backdrop-blur-sm"
          >
            <UploadCloud className="h-5 w-5 text-accent" aria-hidden />
            {t('layout.modDrop.indicator')}
          </div>
        </div>
      )}
    </>
  );
}
