import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { hydrateDownloadedLocales } from './i18n'
import App from './App.tsx'
import { initAutoHideScrollbars } from './lib/autoHideScrollbars'
import { applyTheme } from './lib/applyTheme'
import { preloadPreviewLoader } from './components/common/previewLoaderArt'

initAutoHideScrollbars()

// Seed the theme before first paint. Main passes the saved setting through
// the preload's argv, so an OLED or light user never sees the default grey
// canvas while settings load over IPC.
applyTheme(window.electronAPI.initialTheme)

// Register any downloaded language packs before first paint so a non-English
// user lands on their language without a flash. Best-effort: if it fails or is
// slow we render in the bundled/cached language anyway.
void hydrateDownloadedLocales()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The 3D previews' loader is fetched and decoded once the app has drawn, so it is on hand before
// the first preview asks for it.
setTimeout(preloadPreviewLoader, 1500)
