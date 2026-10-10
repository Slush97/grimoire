// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
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
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('crash badges on installed cards', () => {
  it.each(['grid', 'compact', 'list'] as const)('keeps the crash action independent across badge combinations in %s', async view => {
    for (const enabled of [true, false]) for (let mask = 0; mask < 32; mask++) {
      await act(async () => root.render(<ModCard {...props(mask, enabled, view)} />));
      const badge = host.querySelector<HTMLButtonElement>('[aria-label="crashAdvisory.viewForMod"]');
      expect(badge, `mask ${mask}, enabled ${enabled}`).not.toBeNull();
      expect(badge!.disabled).toBe(false);
      expect(badge!.closest('button')?.parentElement?.closest('button')).toBeNull();
      if (mask & 2) expect(host.textContent).toContain('installed.card.outdatedData');
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
