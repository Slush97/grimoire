// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashAdvisoryBadge, CrashAdvisoryHost, CrashLaunchIndicator } from './CrashAdvisories';
import { useCrashAdvisoryStore } from '../stores/crashAdvisoryStore';
import { useAppStore } from '../stores/appStore';
import type { CrashAdvisory } from '../types/crashAdvisory';
import type { Mod } from '../types/mod';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en', language: 'en' } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const finding: CrashAdvisory = { id: 'f'.repeat(64), modId: 'suspect', modName: 'Crash test mod',
  entry: 'panorama/layout/hud.vxml_c', error: 'FATAL ERROR: test', crashedAt: 1700000000000,
  gameBuild: '100', attribution: 'last-known', enabled: true };
let host: HTMLDivElement;
let root: Root;
let push: (findings: CrashAdvisory[]) => void;
let api: { getCrashAdvisories: ReturnType<typeof vi.fn<() => Promise<CrashAdvisory[]>>>; dismissCrashAdvisory: ReturnType<typeof vi.fn<() => Promise<CrashAdvisory[]>>>; onCrashAdvisoriesChanged: ReturnType<typeof vi.fn>; launchModded: ReturnType<typeof vi.fn<() => Promise<void>>> };

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api = { getCrashAdvisories: vi.fn(async () => []), dismissCrashAdvisory: vi.fn(async () => []),
    onCrashAdvisoriesChanged: vi.fn(callback => { push = callback; return vi.fn(); }), launchModded: vi.fn(async () => {}) };
  window.electronAPI = api as unknown as Window['electronAPI'];
  useCrashAdvisoryStore.setState({ findings: [], detailId: null, dismissed: [] });
  useAppStore.setState({ mods: [], modsLoaded: false });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function render(children = <CrashAdvisoryHost />) {
  await act(async () => { root.render(<MemoryRouter>{children}</MemoryRouter>); });
}

describe('advisory crash UI', () => {
  it('shows a local suspect on the Installed index route from another page', async () => {
    api.getCrashAdvisories.mockResolvedValue([finding]);
    function InstalledTarget() {
      const location = useLocation();
      return <div data-installed-mod={location.state?.crashSuspectId}>Installed</div>;
    }
    await act(async () => {
      root.render(<MemoryRouter initialEntries={['/browse']}>
        <CrashAdvisoryHost />
        <Routes>
          <Route path="/" element={<InstalledTarget />} />
          <Route path="/browse" element={<div>Browse</div>} />
        </Routes>
      </MemoryRouter>);
    });
    await act(async () => useCrashAdvisoryStore.getState().openDetail(finding.id));
    const showMod = [...document.querySelectorAll('button')].find(button => button.textContent === 'crashAdvisory.showMod');
    await act(async () => showMod?.click());
    expect(host.querySelector('[data-installed-mod="suspect"]')).not.toBeNull();
    expect(host.textContent).toContain('Installed');
    expect(useCrashAdvisoryStore.getState().detailId).toBeNull();
    expect(api.dismissCrashAdvisory).not.toHaveBeenCalled();
  });
  it('never opens a dialog automatically for findings arriving on startup or while open', async () => {
    api.getCrashAdvisories.mockResolvedValue([finding]);
    await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => push([{ ...finding, id: 'e'.repeat(64) }]));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens details only when the mod badge is clicked', async () => {
    api.getCrashAdvisories.mockResolvedValue([finding]);
    await render(<><CrashAdvisoryHost /><CrashAdvisoryBadge modIds={['suspect']} /></>);
    expect(host.textContent).toContain('crashAdvisory.badge');
    await act(async () => host.querySelector('button')?.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('crashAdvisory.lastKnown');
    expect(api.launchModded).not.toHaveBeenCalled();
  });

  it.each([{ compact: false }, { compact: false, unified: true }, { compact: true }])('keeps launching available with a separate warning target: %j', async props => {
    api.getCrashAdvisories.mockResolvedValue([finding]);
    await render(<><CrashAdvisoryHost /><button onClick={() => void api.launchModded()}>Launch Modded</button><CrashLaunchIndicator {...props} /></>);
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    expect(buttons[0].disabled).toBe(false);
    await act(async () => buttons[0].click());
    expect(api.launchModded).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => buttons[1].click());
    expect(api.launchModded).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('removes the launch marker immediately when the mod is disabled in the app', async () => {
    useAppStore.setState({ mods: [{ id: 'suspect', enabled: false } as Mod], modsLoaded: true });
    api.getCrashAdvisories.mockResolvedValue([finding]);
    await render(<><CrashAdvisoryHost /><CrashLaunchIndicator /><CrashAdvisoryBadge modIds={['suspect']} /></>);
    expect(host.querySelectorAll('button')).toHaveLength(1);
    expect(host.textContent).toContain('crashAdvisory.badge');
  });

  it('does not lose a new event when an older refresh response arrives afterward', async () => {
    let complete: (findings: CrashAdvisory[]) => void = () => {};
    api.getCrashAdvisories.mockImplementation(() => new Promise<CrashAdvisory[]>(resolve => { complete = resolve; }));
    await render();
    await act(async () => { push([finding]); complete([]); });
    expect(useCrashAdvisoryStore.getState().findings).toEqual([finding]);
  });

  it('retains session dismissal even when IPC fails and a stale event arrives', async () => {
    api.dismissCrashAdvisory.mockRejectedValue(new Error('IPC unavailable'));
    useCrashAdvisoryStore.setState({ findings: [finding] });
    await act(async () => { await useCrashAdvisoryStore.getState().dismiss(finding.id); });
    useCrashAdvisoryStore.getState().receiveFindings([finding]);
    expect(useCrashAdvisoryStore.getState().findings).toEqual([]);
    expect(api.launchModded).not.toHaveBeenCalled();
  });

  it('keeps ordinary actions available when reading diagnostics fails', async () => {
    api.getCrashAdvisories.mockRejectedValue(new Error('unreadable diagnostics'));
    await render(<><CrashAdvisoryHost /><button onClick={() => void api.launchModded()}>Launch Modded</button><CrashLaunchIndicator /></>);
    await act(async () => host.querySelector('button')?.click());
    expect(api.launchModded).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
