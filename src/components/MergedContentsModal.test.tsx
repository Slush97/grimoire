// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MergedContentsModal from './MergedContentsModal';
import type { MergeSourceUpdateOutcome } from '../lib/mergeSourceUpdate';

vi.mock('./ModThumbnail', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key }),
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
const render = async (onUpdateSources: Props['onUpdateSources'], stale = true) => {
  await act(async () => root.render(<MergedContentsModal mod={mod} onClose={onClose}
    onUnmerge={onUnmerge} onExtractSource={onExtractSource} onAddSources={onAddSources}
    staleSourceFileNames={new Set(stale ? ['skin_dir.vpk'] : [])} onUpdateSources={onUpdateSources} />));
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
  await act(async () => button('mergedContents.updateSources')?.click());
  expect(update).toHaveBeenCalledOnce();
  expect([...document.querySelectorAll('button')].every(b => b.disabled)).toBe(true);
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const backdrop = document.querySelector('[role="dialog"]');
    backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    backdrop?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    button('mergedContents.unmerge')?.click();
    document.querySelector<HTMLButtonElement>('[title="mergedContents.extractTitle"]')?.click();
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(onUnmerge).not.toHaveBeenCalled();
  expect(onExtractSource).not.toHaveBeenCalled();
  await act(async () => finish({ updated: 1, skipped: [] }));
  await render(update, false);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('mergedContents.updateComplete');
  expect(button('mergedContents.updateSources')).toBeUndefined();
  expect(button('mergedContents.unmerge')?.disabled).toBe(false);
});

it('reports skipped sources and failed rebuilds, and lets the user retry', async () => {
  const update = vi.fn<() => Promise<MergeSourceUpdateOutcome>>()
    .mockRejectedValueOnce(new Error('Rebuild failed'))
    .mockResolvedValueOnce({ updated: 1, skipped: [{ modName: 'skin', reason: 'no-match' }] });
  await render(update);
  await act(async () => button('mergedContents.updateSources')?.click());
  expect(document.body.textContent).toContain('Rebuild failed');
  expect(button('mergedContents.updateSources')?.disabled).toBe(false);
  await act(async () => button('mergedContents.updateSources')?.click());
  expect(document.body.textContent).not.toContain('Rebuild failed');
  expect(document.body.textContent).toContain('mergedContents.skipReason.no-match');
  expect(document.querySelector('[role="status"]')).not.toBeNull();
});
