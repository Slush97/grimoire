// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MergedContentsModal from './MergedContentsModal';
import type { MergeSourceUpdateOutcome } from '../lib/mergeSourceUpdate';

vi.mock('./ModThumbnail', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count === undefined ? key : `${key}:${options.count}`),
  }),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
type Props = ComponentProps<typeof MergedContentsModal>;
let root: Root;
let host: HTMLDivElement;
const onClose = vi.fn(), onUnmerge = vi.fn(), onExtractSource = vi.fn(), onAddSources = vi.fn();
const mod: Props['mod'] = {
  id: 'merge', name: 'Celeste', fileName: 'pak01_dir.vpk', metaKey: 'pak01_dir.vpk', path: '/mods/pak01_dir.vpk',
  enabled: false, priority: 1, size: 100, installedAt: '',
  merged: { id: 'merge', createdAt: '', shareCode: '', sources: ['skin', 'sound'].map((name, i) => ({
    fileName: `${name}_dir.vpk`, modName: name, enabledAtMergeTime: true, priorityAtMergeTime: i,
    sha256AtMergeTime: 'a'.repeat(64),
  })) },
};
const button = (key: string) => [...document.querySelectorAll('button')].find(b => b.textContent === key);
const render = async (
  onUpdateSources: Props['onUpdateSources'],
  stale: string[] = ['skin_dir.vpk'],
  updatable: string[] = stale,
) => {
  await act(async () => root.render(<MergedContentsModal mod={mod} onClose={onClose}
    onUnmerge={onUnmerge} onExtractSource={onExtractSource} onAddSources={onAddSources}
    staleSourceFileNames={new Set(stale)} updatableSourceFileNames={new Set(updatable)}
    onUpdateSources={onUpdateSources} />));
};
const dismiss = () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const backdrop = document.querySelector('[role="dialog"]');
  backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  backdrop?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
};
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

it('blocks conflicting actions and dismissal until the update finishes, then reports success', async () => {
  let finish: (outcome: MergeSourceUpdateOutcome) => void = () => {};
  const update = vi.fn(() => new Promise<MergeSourceUpdateOutcome>(resolve => { finish = resolve; }));
  await render(update);
  await act(async () => button('mergedContents.updateSources:1')?.click());
  expect(update).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  expect(document.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async () => {
    dismiss();
    button('mergedContents.unmerge')?.click();
    document.querySelector<HTMLButtonElement>('[title="mergedContents.extractTitle"]')?.click();
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(onUnmerge).not.toHaveBeenCalled();
  expect(onExtractSource).not.toHaveBeenCalled();
  await act(async () => finish({ updated: 1, skipped: [] }));
  await render(update, []);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('mergedContents.updateComplete:1');
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
  expect(button('mergedContents.updateSources:1')).toBeUndefined();
  expect(button('mergedContents.unmerge')?.disabled).toBe(false);
});

it('reports skipped sources and failed rebuilds, and lets the user retry', async () => {
  const update = vi.fn<() => Promise<MergeSourceUpdateOutcome>>()
    .mockRejectedValueOnce(new Error('Rebuild failed'))
    .mockResolvedValueOnce({ updated: 1, skipped: [{ modName: 'skin', reason: 'no-match' }] });
  await render(update);
  await act(async () => button('mergedContents.updateSources:1')?.click());
  expect(document.body.textContent).toContain('Rebuild failed');
  expect(button('mergedContents.updateSources:1')?.disabled).toBe(false);
  await act(async () => button('mergedContents.updateSources:1')?.click());
  expect(document.body.textContent).not.toContain('Rebuild failed');
  expect(document.body.textContent).toContain('mergedContents.skipReason.no-match');
  expect(document.querySelector('[role="status"]')).not.toBeNull();
});

it('keeps showing progress and stays locked after the stale flag clears mid-update', async () => {
  let finish: (outcome: MergeSourceUpdateOutcome) => void = () => {};
  const update = vi.fn(() => new Promise<MergeSourceUpdateOutcome>(resolve => { finish = resolve; }));
  await render(update);
  await act(async () => button('mergedContents.updateSources:1')?.click());
  await render(update, []);
  expect(button('mergedContents.updateSources:1')).toBeUndefined();
  expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-label')).toBe('mergedContents.updating');
  await act(async () => dismiss());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => finish({ updated: 1, skipped: [] }));
  expect(document.querySelector('[role="progressbar"]')).toBeNull();
  expect(button('common.actions.close')?.disabled).toBe(false);
});

it('offers no update for outdated sources that cannot resolve', async () => {
  const update = vi.fn();
  await render(update, ['skin_dir.vpk'], []);
  expect(button('mergedContents.updateSources:1')).toBeUndefined();
  expect(document.body.textContent).toContain('mergedContents.staleSourcesNote:1');
  expect(document.querySelector('[title="mergedContents.sourceOutdatedTitle"]')).not.toBeNull();
  expect(document.querySelector('[title="mergedContents.sourceUpdatableTitle"]')).toBeNull();
});

it('counts only the sources an update can resolve when others are outdated too', async () => {
  const update = vi.fn<() => Promise<MergeSourceUpdateOutcome>>().mockResolvedValue({ updated: 1, skipped: [] });
  await render(update, ['skin_dir.vpk', 'sound_dir.vpk'], ['skin_dir.vpk']);
  expect(button('mergedContents.updateSources:1')).toBeDefined();
  expect(button('mergedContents.updateSources:2')).toBeUndefined();
  expect(document.body.textContent).toContain('mergedContents.staleSourcesUpdatable:1');
  expect(document.querySelectorAll('[title="mergedContents.sourceUpdatableTitle"]')).toHaveLength(1);
  expect(document.querySelectorAll('[title="mergedContents.sourceOutdatedTitle"]')).toHaveLength(1);
});

it('clears the previous update result when another action starts', async () => {
  const update = vi.fn<() => Promise<MergeSourceUpdateOutcome>>()
    .mockResolvedValue({ updated: 1, skipped: [{ modName: 'sound', reason: 'no-match' }] });
  await render(update, ['skin_dir.vpk', 'sound_dir.vpk'], ['skin_dir.vpk']);
  await act(async () => button('mergedContents.updateSources:1')?.click());
  expect(document.querySelector('[role="status"]')).not.toBeNull();
  expect(document.body.textContent).toContain('mergedContents.skipReason.no-match');
  await act(async () => document.querySelector<HTMLButtonElement>('[title="mergedContents.extractTitle"]')?.click());
  expect(onExtractSource).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.body.textContent).not.toContain('mergedContents.skipReason.no-match');
});
