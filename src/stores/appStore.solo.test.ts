import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../types/mod';
import * as api from '../lib/api';
import { modRestoreKey } from '../lib/soloRestore';
import { useAppStore } from './appStore';

vi.mock('../i18n', () => ({
  applyLanguagePreference: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  applyModToggleBatch: vi.fn(),
  // soloMod's error path re-scans via loadMods; keep it a no-op so the catch
  // branch under test isn't derailed by an unmocked api call.
  getMods: vi.fn(async () => []),
}));

function mod(over: Partial<Mod> & { id: string }): Mod {
  return {
    name: over.id,
    fileName: `${over.id}.vpk`,
    path: `/addons/${over.id}.vpk`,
    metaKey: `${over.id}.vpk`,
    enabled: false,
    priority: 1,
    size: 0,
    installedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const applyModToggleBatch = vi.mocked(api.applyModToggleBatch);

describe('appStore solo restore', () => {
  beforeEach(() => {
    applyModToggleBatch.mockReset();
    useAppStore.setState({
      mods: [],
      modsError: null,
      modsNotice: null,
      soloRestore: null,
    });
  });

  it('keeps the restore snapshot when restore partially fails', async () => {
    const a = mod({ id: 'a', enabled: true, sha256: 'aa' });
    const b = mod({ id: 'b-renamed', enabled: false, sha256: 'bb' });
    const snap = { keys: [modRestoreKey(a), modRestoreKey(b)], label: 'A' };
    useAppStore.setState({ mods: [a, b], soloRestore: snap });
    applyModToggleBatch.mockResolvedValueOnce({ mods: [a, b], failures: ['enable b failed'] });

    const result = await useAppStore.getState().restoreSoloMods();

    expect(result).toEqual({ failures: 1 });
    expect(applyModToggleBatch).toHaveBeenCalledWith(['b-renamed'], []);
    expect(useAppStore.getState().soloRestore).toBe(snap);
  });

  it('clears the restore snapshot when restore fully succeeds', async () => {
    const a = mod({ id: 'a', enabled: true, sha256: 'aa' });
    const b = mod({ id: 'b-renamed', enabled: false, sha256: 'bb' });
    useAppStore.setState({
      mods: [a, b],
      soloRestore: { keys: [modRestoreKey(a), modRestoreKey(b)], label: 'A' },
    });
    applyModToggleBatch.mockResolvedValueOnce({
      mods: [a, { ...b, enabled: true }],
      failures: [],
    });

    const result = await useAppStore.getState().restoreSoloMods();

    expect(result).toEqual({ failures: 0 });
    expect(useAppStore.getState().soloRestore).toBeNull();
  });

  it('preserves the first restore snapshot across nested solos', async () => {
    const a = mod({ id: 'a', enabled: true, sha256: 'aa' });
    const b = mod({ id: 'b', enabled: true, sha256: 'bb' });
    const c = mod({ id: 'c', enabled: false, sha256: 'cc' });
    const originalKeys = [modRestoreKey(a), modRestoreKey(b)];
    useAppStore.setState({ mods: [a, b, c] });
    applyModToggleBatch
      .mockResolvedValueOnce({
        mods: [a, { ...b, enabled: false }, c],
        failures: [],
      })
      .mockResolvedValueOnce({
        mods: [{ ...a, enabled: false }, { ...b, enabled: false }, { ...c, enabled: true }],
        failures: [],
      });

    await useAppStore.getState().soloMod([modRestoreKey(a)], 'A');
    await useAppStore.getState().soloMod([modRestoreKey(c)], 'C');

    expect(useAppStore.getState().soloRestore).toEqual({ keys: originalKeys, label: 'C' });
  });

  it('aborts solo when no target key resolves', async () => {
    useAppStore.setState({ mods: [mod({ id: 'a', enabled: true, sha256: 'aa' })] });

    const result = await useAppStore.getState().soloMod(['sha:ghost'], 'Ghost');

    expect(result).toEqual({ applied: false, failures: 0, reason: 'missing' });
    expect(applyModToggleBatch).not.toHaveBeenCalled();
    expect(useAppStore.getState().mods.map((m) => m.id)).toEqual(['a']);
  });

  it('reports the game-running lock as a distinct reason so the caller can warn', async () => {
    const a = mod({ id: 'a', enabled: true, sha256: 'aa' });
    const b = mod({ id: 'b', enabled: true, sha256: 'bb' });
    useAppStore.setState({ mods: [a, b] });
    applyModToggleBatch.mockRejectedValueOnce(new Error('Game is running; refusing to modify mods.'));

    const result = await useAppStore.getState().soloMod([modRestoreKey(a)], 'A');

    expect(result).toEqual({ applied: false, failures: 0, reason: 'gameRunning' });
    // Expected, recoverable lock: it must not snapshot a restore set (nothing changed).
    expect(useAppStore.getState().soloRestore).toBeNull();
  });
});
