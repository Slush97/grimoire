// @vitest-environment jsdom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  IGNORE_OVERLAP_SETTING_ID,
  SETTINGS_HIGHLIGHT_DURATION_MS,
  useSettingsHighlight,
  type SettingsLocationState,
} from './settingsHighlight';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Harness({
  ready,
  activeSection,
  searching,
}: {
  ready: boolean;
  activeSection: string;
  searching: boolean;
}) {
  const location = useLocation();
  useSettingsHighlight({ ready, activeSection, searching });
  return (
    <div>
      <output data-testid="state">{JSON.stringify(location.state)}</output>
      {ready && activeSection === 'preferences' && (
        <label id={IGNORE_OVERLAP_SETTING_ID}>Ignore overlap by default</label>
      )}
    </div>
  );
}

describe('useSettingsHighlight', () => {
  let host: HTMLDivElement;
  let root: Root;
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    scrollIntoView.mockClear();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
    delete (window as Partial<Window>).matchMedia;
  });

  function renderAt(
    initialEntry: InitialEntry,
    props: { ready?: boolean; activeSection?: string; searching?: boolean } = {},
    strict = false,
  ) {
    const content = (
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/settings/:section"
            element={(
              <Harness
                ready={props.ready ?? true}
                activeSection={props.activeSection ?? 'preferences'}
                searching={props.searching ?? false}
              />
            )}
          />
        </Routes>
      </MemoryRouter>
    );
    act(() => root.render(strict ? <StrictMode>{content}</StrictMode> : content));
  }

  it('highlights and scrolls the target setting when navigated with highlight state, then clears it', () => {
    renderAt({
      pathname: '/settings/preferences',
      state: { highlightSettingId: IGNORE_OVERLAP_SETTING_ID } satisfies SettingsLocationState,
    }, {}, true);

    const target = host.querySelector<HTMLElement>(`#${IGNORE_OVERLAP_SETTING_ID}`);
    expect(target?.dataset.settingsHighlight).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(host.querySelector('[data-testid="state"]')?.textContent).toBe('null');

    act(() => {
      vi.advanceTimersByTime(SETTINGS_HIGHLIGHT_DURATION_MS - 1);
    });
    expect(target?.dataset.settingsHighlight).toBe('true');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(target?.dataset.settingsHighlight).toBeUndefined();
  });

  it('does not highlight when visiting settings without highlight state', () => {
    renderAt('/settings/preferences');

    const target = host.querySelector<HTMLElement>(`#${IGNORE_OVERLAP_SETTING_ID}`);
    expect(target?.dataset.settingsHighlight).toBeUndefined();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('waits until settings are ready before consuming state and highlighting', () => {
    const entry: InitialEntry = {
      pathname: '/settings/preferences',
      state: { highlightSettingId: IGNORE_OVERLAP_SETTING_ID } satisfies SettingsLocationState,
    };
    const renderWithReady = (ready: boolean) => {
      act(() => root.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/settings/:section"
              element={<Harness ready={ready} activeSection="preferences" searching={false} />}
            />
          </Routes>
        </MemoryRouter>,
      ));
    };

    renderWithReady(false);
    expect(host.querySelector(`#${IGNORE_OVERLAP_SETTING_ID}`)).toBeNull();
    expect(scrollIntoView).not.toHaveBeenCalled();

    renderWithReady(true);
    const target = host.querySelector<HTMLElement>(`#${IGNORE_OVERLAP_SETTING_ID}`);
    expect(target?.dataset.settingsHighlight).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth', block: 'center' });
  });

  it('clears the highlight immediately when searching starts', () => {
    const entry: InitialEntry = {
      pathname: '/settings/preferences',
      state: { highlightSettingId: IGNORE_OVERLAP_SETTING_ID } satisfies SettingsLocationState,
    };
    const renderSearch = (searching: boolean) => {
      act(() => root.render(
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route
              path="/settings/:section"
              element={<Harness ready activeSection="preferences" searching={searching} />}
            />
          </Routes>
        </MemoryRouter>,
      ));
    };

    renderSearch(false);
    const target = host.querySelector<HTMLElement>(`#${IGNORE_OVERLAP_SETTING_ID}`);
    expect(target?.dataset.settingsHighlight).toBe('true');

    renderSearch(true);
    expect(target?.dataset.settingsHighlight).toBeUndefined();
  });

  it('uses instant scrolling when prefers-reduced-motion is enabled', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    renderAt({
      pathname: '/settings/preferences',
      state: { highlightSettingId: IGNORE_OVERLAP_SETTING_ID } satisfies SettingsLocationState,
    });

    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto', block: 'center' });
  });
});
