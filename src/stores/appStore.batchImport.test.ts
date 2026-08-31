import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  default: { changeLanguage: vi.fn() },
  applyLanguagePreference: vi.fn(),
}));

// The store reads the host platform off the preload bridge to pick Windows
// (case-insensitive) vs POSIX path identity. Tests run in node, so there is no
// window to read until one is stubbed.
function setPlatform(platform: string): void {
  vi.stubGlobal('window', { electronAPI: { platform } });
}

const state = () => useAppStore.getState();

describe('appStore batch import handoff', () => {
  beforeEach(() => {
    setPlatform('linux');
    useAppStore.setState({
      batchImportOpen: false,
      batchImportPendingPaths: [],
      batchImportBusy: false,
      suppressGlobalModDrop: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the dialog and queues the dropped paths', () => {
    state().openBatchImport(['/mods/a.vpk', '/mods/b.zip']);

    expect(state().batchImportOpen).toBe(true);
    expect(state().batchImportPendingPaths).toEqual(['/mods/a.vpk', '/mods/b.zip']);
  });

  it('opens with nothing queued for the toolbar button', () => {
    state().openBatchImport();

    expect(state().batchImportOpen).toBe(true);
    expect(state().batchImportPendingPaths).toEqual([]);
  });

  it('appends a second drop to the queue in order', () => {
    state().openBatchImport(['/mods/a.vpk']);
    state().openBatchImport(['/mods/b.zip', '/mods/c.7z']);

    expect(state().batchImportPendingPaths).toEqual(['/mods/a.vpk', '/mods/b.zip', '/mods/c.7z']);
  });

  it('collapses duplicate Windows paths case-insensitively', () => {
    setPlatform('win32');
    state().openBatchImport(['C:\\Mods\\Skin.vpk']);
    state().openBatchImport(['c:\\mods\\skin.vpk', 'C:\\Mods\\Other.vpk']);

    expect(state().batchImportPendingPaths).toEqual(['C:\\Mods\\Skin.vpk', 'C:\\Mods\\Other.vpk']);
  });

  it('collapses duplicates within a single drop', () => {
    state().openBatchImport(['/mods/a.vpk', '/mods/a.vpk']);

    expect(state().batchImportPendingPaths).toEqual(['/mods/a.vpk']);
  });

  it('keeps POSIX paths that differ only in case', () => {
    state().openBatchImport(['/mods/Skin.vpk']);
    state().openBatchImport(['/mods/skin.vpk']);

    expect(state().batchImportPendingPaths).toEqual(['/mods/Skin.vpk', '/mods/skin.vpk']);
  });

  it('retains a concurrent newer drop when an earlier group is consumed', () => {
    state().openBatchImport(['/mods/a.vpk']);
    const staged = state().batchImportPendingPaths;

    // Second drop lands while the dialog is still turning `staged` into rows.
    state().openBatchImport(['/mods/b.zip']);
    state().consumeBatchImportPaths(staged);

    expect(state().batchImportPendingPaths).toEqual(['/mods/b.zip']);
  });

  it('consumes Windows paths regardless of the casing the dialog echoes back', () => {
    setPlatform('win32');
    state().openBatchImport(['C:\\Mods\\Skin.vpk']);
    state().consumeBatchImportPaths(['c:\\mods\\skin.vpk']);

    expect(state().batchImportPendingPaths).toEqual([]);
  });

  it('clears pending paths and busy state on close', () => {
    state().openBatchImport(['/mods/a.vpk']);
    state().setBatchImportBusy(true);
    state().closeBatchImport();

    expect(state().batchImportOpen).toBe(false);
    expect(state().batchImportPendingPaths).toEqual([]);
    expect(state().batchImportBusy).toBe(false);
  });

  it('round-trips the busy flag', () => {
    state().setBatchImportBusy(true);
    expect(state().batchImportBusy).toBe(true);

    state().setBatchImportBusy(false);
    expect(state().batchImportBusy).toBe(false);
  });

  it('round-trips the global drop suppression flag', () => {
    state().setSuppressGlobalModDrop(true);
    expect(state().suppressGlobalModDrop).toBe(true);

    state().setSuppressGlobalModDrop(false);
    expect(state().suppressGlobalModDrop).toBe(false);
  });
});
