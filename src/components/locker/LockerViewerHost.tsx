import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '../common/ErrorBoundary';
import FloatingModelPanel from './FloatingModelPanel';
import { parkedViewerRequest, requestLockerViewer, useLockerViewer, type LockerViewerRequest } from '../../stores/lockerViewerStore';

// three.js viewer is heavy; only pull the chunk when the Locker first shows it.
const HeroPoseViewer = lazy(() => import('./HeroPoseViewer'));

/** How long a hidden viewer keeps its renderer, scene and loaded room before they are released. */
const PARKED_MS = 3 * 60_000;

// The viewer renders into one element for its whole life. Showing it moves that element into the
// Locker's panel; hiding it parks the element off screen at its last size, so the WebGL canvas, its
// renderer and the loaded scene survive closing the panel and leaving the Locker. A hero change does
// not move it at all: moving an element drops fullscreen and restarts its CSS animations.
let container: HTMLDivElement | null = null;
let parking: HTMLDivElement | null = null;

function viewerContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div');
    container.className = 'absolute inset-0';
  }
  return container;
}

function park(from: HTMLElement): void {
  if (!parking) {
    parking = document.createElement('div');
    parking.setAttribute('aria-hidden', 'true');
    parking.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:strict';
    document.body.appendChild(parking);
  }
  parking.style.width = `${from.clientWidth}px`;
  parking.style.height = `${from.clientHeight}px`;
  parking.appendChild(viewerContainer());
}

/** Where the Locker shows its viewer. The viewer outlives this element: it only moves in and out. */
function LockerViewerSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const slot = ref.current;
    if (!slot) return;
    slot.appendChild(viewerContainer());
    useLockerViewer.setState({ slot });
    return () => {
      park(slot);
      if (useLockerViewer.getState().slot === slot) useLockerViewer.setState({ slot: null });
    };
  }, []);
  return <div ref={ref} className="absolute inset-0" />;
}

/**
 * The app's hero viewer, shown in place for a page other than the Locker (Door Stuck's editors). The
 * page gets the same canvas, loaded room and recent hero models as the Locker and any page before
 * it, so coming back to a hero shows it at once. Leaving the page parks the viewer.
 */
export function SharedHeroViewer(request: LockerViewerRequest) {
  // Every render: the page's editing state and callbacks change with it.
  useLayoutEffect(() => { requestLockerViewer(request); });
  useLayoutEffect(() => () => {
    const { request: current } = useLockerViewer.getState();
    if (current) useLockerViewer.setState({ request: parkedViewerRequest(current) });
  }, []);
  return <LockerViewerSlot />;
}

/**
 * The Locker's floating 3D panel. It sits above the per-hero view, so a hero change keeps the panel,
 * its slot and the viewer element where they are. Titled with the hero on screen.
 */
export function LockerViewerPanel() {
  const { t } = useTranslation();
  const open = useLockerViewer((state) => state.open);
  const setOpen = useLockerViewer((state) => state.setOpen);
  const hero = useLockerViewer((state) => state.request ? state.shownHero ?? state.request.heroName : null);
  if (!open || hero === null) return null;
  return (
    <FloatingModelPanel title={t('locker.hero.hero3dModel', { hero })} onClose={() => setOpen(false)}>
      <LockerViewerSlot />
    </FloatingModelPanel>
  );
}

const showHero = (hero: string) => useLockerViewer.setState({ shownHero: hero });

/** Owns the app's one hero viewer, above the routes so leaving a page does not drop it. */
export function LockerViewerHost() {
  const request = useLockerViewer((state) => state.request);
  const shown = useLockerViewer((state) => state.slot !== null);
  useEffect(() => {
    if (shown || !request) return;
    const timer = setTimeout(() => useLockerViewer.setState({ request: null, shownHero: null }), PARKED_MS);
    return () => clearTimeout(timer);
  }, [shown, request]);
  if (!request) return null;
  return createPortal(
    // Without hardware WebGL the canvas throws; keep that inside the panel.
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/80" />
          </div>
        }
      >
        <HeroPoseViewer {...request} active={shown} onShownHeroChange={showHero} />
      </Suspense>
    </ErrorBoundary>,
    viewerContainer(),
  );
}
