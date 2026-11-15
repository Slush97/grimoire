import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './appStore';
import { useInstalledTagsStore } from './installedTagsStore';
import { getInstallationScope } from '../lib/appSettings';
import type { AppSettings, Mod } from '../types/mod';
import type { ImportCustomModsBatchArgs } from '../types/electron';
import { importCustomMods as sendImport } from '../lib/api';

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

  it('assigns custom tags only to successful imported mods using their final ids', async () => {
    const settings = { deadlockPath: '/game', devMode: false } as AppSettings;
    useAppStore.setState({ settings });
    const scope = getInstallationScope(settings)!;
    useInstalledTagsStore.setState({ byScope: { [scope]: [{ id: 'favorite', name: 'Favorites', keys: [] }] } });
    const mod = { id: 'enabled-id', localGroupId: 'new-group', sha256: 'hash' } as Mod;
    const importCustomMods = vi.fn(async (_args: ImportCustomModsBatchArgs) => ({ mods: [mod], results: [
      { vpkPath: 'ok.vpk', ok: true, imported: 1, importedModIds: [mod.id] },
      { vpkPath: 'failed.vpk', ok: false, imported: 0 },
    ] }));
    vi.stubGlobal('window', { electronAPI: { platform: 'linux', importCustomMods } });
    await state().importCustomMods([
      { vpkPath: 'ok.vpk', name: 'Shared', customTagIds: ['favorite'] },
      { vpkPath: 'failed.vpk', name: 'Failed', customTagIds: ['favorite'] },
    ]);
    expect(useInstalledTagsStore.getState().byScope[scope][0].keys).toEqual(['localgroup:new-group']);
    expect(importCustomMods.mock.calls[0][0].items[0]).not.toHaveProperty('customTagIds');
  });

  it('compacts shared artwork without confusing an existing group with a new batch key', async () => {
    const importCustomMods = vi.fn(async (_args: ImportCustomModsBatchArgs) => ({ mods: [], results: [] }));
    vi.stubGlobal('window', { electronAPI: { platform: 'linux', importCustomMods } });
    await sendImport([
      { vpkPath: 'first.vpk', name: 'First', localGroupId: 'same', galleryImages: ['first'] },
      { vpkPath: 'second.vpk', name: 'Second', localGroupBatchKey: 'same', galleryImages: ['second'] },
      { vpkPath: 'third.vpk', name: 'Second', localGroupBatchKey: 'same', galleryImages: ['second'] },
    ]);
    expect(importCustomMods.mock.calls[0][0].items.map(item => item.galleryImages)).toEqual([['first'], ['second'], []]);
  });
});
