// @vitest-environment jsdom
import { act, Profiler, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModCard } from './ModCard';
import { useCrashAdvisoryStore } from '../../stores/crashAdvisoryStore';
import { useAppStore } from '../../stores/appStore';
import type { CrashAdvisory } from '../../types/crashAdvisory';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = ComponentProps<typeof ModCard>;
const finding: CrashAdvisory = { id: 'f'.repeat(64), modId: 'suspect', modName: 'Crash test',
  entry: 'panorama/layout/hud.vxml_c', error: 'FATAL ERROR: test', crashedAt: 1700000000000,
  gameBuild: '100', attribution: 'recorded', enabled: true };
let host: HTMLDivElement;
let root: Root;
const onToggle = vi.fn(), onOpenDetails = vi.fn(), onSelectToggle = vi.fn();

function props(mask: number, enabled: boolean, viewMode: Props['viewMode']): Props {
  return { mod: { id: 'suspect', name: 'Crash test', fileName: 'pak01_dir.vpk', enabled,
    priority: 3, size: 100, installedAt: '2026-10-10T10:00:00Z',
    nsfw: !!(mask & 1), outdatedVdata: mask & 2 ? [{ entry: 'scripts/heroes.vdata_c', missing: 1, sample: ['new_hero'] }] : undefined,
    safety: mask & 4 ? { trusted: false, report: { verdict: 'requires-trust', fingerprint: 'safety', policyVersion: 1, findings: [] } } : undefined,
    staleModels: mask & 32 ? [{ entry: 'models/heroes_wip/werewolf/werewolf.vmdl_c', attachments: ['standing_pivot'] }] : undefined,
  }, viewMode, hideNsfwPreviews: true, soundVolume: 0,
    conflicts: mask & 8 ? [{ modA: 'suspect', modAName: 'Crash test', modB: 'other', modBName: 'Other mod',
      modAIdentity: 'suspect', modBIdentity: 'other', ignoreKey: 'test', conflictType: 'file', details: 'Same file' }] : [],
    updateAvailable: !!(mask & 16), onToggle, onOpenDetails, onDelete: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useAppStore.setState({ settings: { ...useAppStore.getState().settings!, experimentalModSafety: true } });
  useCrashAdvisoryStore.setState({ findings: [finding], detailId: null, dismissed: [] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('crash badges on installed cards', () => {
  it('skips ordinary hover renders and preserves Shift preview over a stationary pointer', async () => {
    const onRender = vi.fn();
    const input = { ...props(0, true, 'grid'), onSelectToggle };
    const render = async (shiftHeld: boolean, selectMode = false) => {
      await act(async () => root.render(
        <Profiler id="card" onRender={onRender}>
          <ModCard {...input} shiftHeld={shiftHeld} selectMode={selectMode} />
        </Profiler>
      ));
    };
    const preview = () => host.querySelector('[aria-label="installed.card.selectNamed"]');
    const pointer = async (type: string) => {
      await act(async () => host.querySelector('[data-mod-entry-key]')?.dispatchEvent(new MouseEvent(type, { bubbles: true })));
    };
    // Use a real entry key to identify the card root.
    input.entryKey = 'entry';
    await render(false);
    onRender.mockClear();
    await pointer('pointerover');
    expect(onRender).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    await render(true);
    expect(preview()).not.toBeNull();
    await pointer('pointerout');
    expect(preview()).toBeNull();
    await pointer('pointerover');
    expect(preview()).not.toBeNull();
    await render(false);
    expect(preview()).toBeNull();
    await render(false, true);
    expect(preview()).not.toBeNull();
  });

  it.each(['grid', 'compact', 'list'] as const)('keeps the crash action independent across badge combinations in %s', async view => {
    for (const enabled of [true, false]) for (let mask = 0; mask < 64; mask++) {
      await act(async () => root.render(<ModCard {...props(mask, enabled, view)} />));
      const badge = host.querySelector<HTMLButtonElement>('[aria-label="crashAdvisory.viewForMod"]');
      expect(badge, `mask ${mask}, enabled ${enabled}`).not.toBeNull();
      expect(badge!.disabled).toBe(false);
      expect(badge!.closest('button')?.parentElement?.closest('button')).toBeNull();
      if (mask & 2) expect(host.textContent).toContain('installed.card.outdatedData');
      expect(host.textContent?.includes('installed.card.staleModel'), `mask ${mask}`).toBe(!!(mask & 32));
      if (mask & 4) expect(host.querySelector('[title="modSafety.viewFindings"]') ?? host.querySelector('[aria-label^="modSafety.needsReview"]')).not.toBeNull();
      await act(async () => badge!.click());
      expect(useCrashAdvisoryStore.getState().detailId).toBe(finding.id);
      expect(onToggle).not.toHaveBeenCalled();
      expect(onOpenDetails).not.toHaveBeenCalled();
    }
  });

  it.each(['grid', 'compact', 'list'] as const)('finds a suspect variant on a grouped, merged sound card in %s', async view => {
    const input = props(31, true, view);
    input.mod = { ...input.mod, id: 'group', crashModIds: ['other', 'suspect'], priorityMod: true,
      isUnknown: true, sourceSection: 'Sound', audioUrl: 'data:audio/wav;base64,',
      merged: { id: 'merge', createdAt: '', shareCode: '', sources: [] } };
    await act(async () => root.render(<ModCard {...input} staleSourceCount={2} favorite
      group={{ variantCount: 3, enabledCount: 1, enabledLabels: ['suspect'], onOpenPicker: onOpenDetails }} />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="crashAdvisory.viewForMod"]')!.click());
    expect(useCrashAdvisoryStore.getState().detailId).toBe(finding.id);
    expect(onOpenDetails).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it.each(['grid', 'compact'] as const)('does not steal selection clicks in %s', async view => {
    await act(async () => root.render(<ModCard {...props(31, true, view)} selectMode selected onSelectToggle={onSelectToggle} />));
    expect(host.querySelector('[aria-label="crashAdvisory.viewForMod"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-pressed]')!.click());
    expect(onSelectToggle).toHaveBeenCalledOnce();
    expect(useCrashAdvisoryStore.getState().detailId).toBeNull();
  });
});

describe('blocked mod toggles', () => {
  it.each([
    { enabled: true, toggled: false, reducedMotion: false, shakes: true },
    { enabled: true, toggled: true, reducedMotion: false, shakes: false },
    { enabled: false, toggled: false, reducedMotion: false, shakes: false },
    { enabled: true, toggled: false, reducedMotion: true, shakes: false },
  ])('gives feedback only for a blocked disable: %j', async ({ enabled, toggled, reducedMotion, shakes }) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reducedMotion })));
    onToggle.mockResolvedValueOnce(toggled);
    await act(async () => root.render(<ModCard {...props(0, enabled, 'grid')} entryKey="test" />));
    const card = host.querySelector<HTMLElement>('[data-mod-entry-key="test"]')!;
    const animate = vi.fn();
    Object.defineProperties(card, {
      animate: { value: animate },
      getAnimations: { value: () => [] },
    });

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="installed.card.disableMod"], [aria-label="installed.card.enableMod"]')!.click());

    expect(onToggle).toHaveBeenCalledOnce();
    expect(animate).toHaveBeenCalledTimes(shakes ? 1 : 0);
  });

  it('restarts repeated feedback without cancelling other card animations', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    onToggle.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await act(async () => root.render(<ModCard {...props(0, true, 'list')} entryKey="test" />));
    const card = host.querySelector<HTMLElement>('[data-mod-entry-key="test"]')!;
    const animate = vi.fn();
    const cancelShake = vi.fn();
    const cancelOther = vi.fn();
    Object.defineProperties(card, {
      animate: { value: animate },
      getAnimations: { value: () => [
        { id: 'blocked-action-shake', cancel: cancelShake },
        { id: 'other', cancel: cancelOther },
      ] },
    });
    const toggle = host.querySelector<HTMLButtonElement>('[aria-label="installed.card.disableMod"]')!;
    await act(async () => toggle.click());
    await act(async () => toggle.click());

    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancelShake).toHaveBeenCalledTimes(2);
    expect(cancelOther).not.toHaveBeenCalled();
  });
});
