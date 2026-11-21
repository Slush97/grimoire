import { useEffect, useRef, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export const IGNORE_OVERLAP_SETTING_ID = 'settings-preferences-settings-preferences-ignoreOverlap-toggle';
export const SETTINGS_HIGHLIGHT_DURATION_MS = 3500;

export interface SettingsLocationState {
  highlightSettingId?: string;
}

interface ActiveHighlight {
  element: HTMLElement;
  section: string;
  timer: number;
}

function clearActiveHighlight(ref: RefObject<ActiveHighlight | null>): void {
  const active = ref.current;
  if (!active) return;
  window.clearTimeout(active.timer);
  delete active.element.dataset.settingsHighlight;
  ref.current = null;
}

export function useSettingsHighlight({
  ready,
  activeSection,
  searching,
}: {
  ready: boolean;
  activeSection: string;
  searching: boolean;
}): void {
  const location = useLocation();
  const navigate = useNavigate();
  const activeRef = useRef<ActiveHighlight | null>(null);
  const requestedId = (location.state as SettingsLocationState | null)?.highlightSettingId ?? null;

  useEffect(() => {
    if (!ready || !requestedId) return;
    const element = document.getElementById(requestedId);
    if (!element) return;

    const sameElement = activeRef.current?.element === element;
    clearActiveHighlight(activeRef);
    if (sameElement) void element.offsetWidth;
    element.dataset.settingsHighlight = 'true';

    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });

    const timer = window.setTimeout(() => {
      if (activeRef.current?.element === element) {
        delete element.dataset.settingsHighlight;
        activeRef.current = null;
      }
    }, SETTINGS_HIGHLIGHT_DURATION_MS);

    activeRef.current = { element, section: activeSection, timer };
    navigate(location.pathname, { replace: true, state: null });
  }, [ready, requestedId, activeSection, location.pathname, navigate]);

  useEffect(() => {
    const active = activeRef.current;
    if (!active) return;
    if (searching || active.section !== activeSection) {
      clearActiveHighlight(activeRef);
    }
  }, [activeSection, searching]);

  useEffect(() => () => clearActiveHighlight(activeRef), []);
}
