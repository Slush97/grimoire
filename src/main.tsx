import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { hydrateDownloadedLocales } from './i18n'
import App from './App.tsx'
import { initAutoHideScrollbars } from './lib/autoHideScrollbars'

initAutoHideScrollbars()

// Register any downloaded language packs before first paint so a non-English
// user lands on their language without a flash. Best-effort: if it fails or is
// slow we render in the bundled/cached language anyway.
void hydrateDownloadedLocales()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
