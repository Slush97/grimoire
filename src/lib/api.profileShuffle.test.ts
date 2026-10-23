import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../types/electron';
import type { Mod } from '../types/mod';
import { createProfile, updateProfile, applyProfile } from './api';
import { useAppStore } from '../stores/appStore';
import { SHUFFLE_INCLUDED_KEY, SHUFFLE_ON_LAUNCH_KEY, SHUFFLE_VARIANT_KEY } from './lockerRandomizer';
import type { ProfileShuffle } from './profileShuffle';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));

const poolA: ProfileShuffle = { onLaunch: true, included: ['gamebanana:1'], variants: [['gamebanana:1', 'random']] };
const poolB: ProfileShuffle = { onLaunch: false, included: ['gamebanana:2'], variants: [['gamebanana:2', { fileId: 8 }]] };
const emptyOff: ProfileShuffle = { onLaunch: false, included: [], variants: [] };
const profile = (shuffle?: ProfileShuffle): Profile => ({ id: 'p', name: 'Loadout', mods: [], createdAt: '', updatedAt: '', shuffle });
const mod = (id: string, over: Partial<Mod> = {}): Mod => ({
  id, name: id, fileName: `${id}.vpk`, path: `/addons/${id}.vpk`, metaKey: `${id}.vpk`,
  enabled: true, priority: 1, size: 0, installedAt: '2026-01-01T00:00:00Z', ...over,
});
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  useAppStore.setState({ mods: [] });
  useAppStore.getState().restoreProfileShuffle(poolA);
});
afterEach(() => vi.unstubAllGlobals());

describe('profile shuffle through the renderer API', () => {
  it('captures the pool for create and update from every profile entry point', async () => {
    const create = vi.fn(async () => profile(poolA));
    const update = vi.fn(async () => profile(poolB));
    vi.stubGlobal('window', { electronAPI: { createProfile: create, updateProfile: update } });
    await createProfile('Loadout');
    expect(create).toHaveBeenCalledWith('Loadout', undefined, poolA);
    useAppStore.getState().restoreProfileShuffle(poolB);
    await updateProfile('p');
    expect(update).toHaveBeenCalledWith('p', undefined, poolB);
  });

  it('switches pools, including an off switch and pinned variants, and persists for restart', async () => {
    const apply = vi.fn(async () => ({ profile: profile(poolB), failures: [] }));
    vi.stubGlobal('window', { electronAPI: { applyProfile: apply } });
    await applyProfile('p');
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(poolB);
    expect(storage.get(SHUFFLE_ON_LAUNCH_KEY)).toBe('false');
    expect(JSON.parse(storage.get(SHUFFLE_INCLUDED_KEY) ?? '')).toEqual(poolB.included);
    expect(JSON.parse(storage.get(SHUFFLE_VARIANT_KEY) ?? '')).toEqual(Object.fromEntries(poolB.variants));
  });

  it('leaves the current pool alone for legacy profiles and failed applies', async () => {
    const apply = vi.fn(async () => ({ profile: profile(), failures: [] }));
    vi.stubGlobal('window', { electronAPI: { applyProfile: apply } });
    await applyProfile('p');
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(poolA);
    apply.mockRejectedValueOnce(new Error('unavailable'));
    await expect(applyProfile('p')).rejects.toThrow('unavailable');
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(poolA);
    useAppStore.getState().restoreProfileShuffle({ ...poolB, variants: [['x', { fileId: -1 }]] });
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(poolA);
  });

  it('restores an empty pool without retaining choices from the previous profile', () => {
    useAppStore.getState().restoreProfileShuffle(emptyOff);
    const state = useAppStore.getState();
    expect(state.shuffleOnLaunch).toBe(false);
    expect(state.shuffleIncluded.size).toBe(0);
    expect(state.shuffleVariants.size).toBe(0);
  });

  it('saves no snapshot while shuffle is off and the pool is empty', async () => {
    const create = vi.fn(async () => profile());
    const update = vi.fn(async () => profile());
    vi.stubGlobal('window', { electronAPI: { createProfile: create, updateProfile: update } });
    useAppStore.getState().restoreProfileShuffle(emptyOff);
    expect(useAppStore.getState().captureProfileShuffle()).toBeUndefined();
    await createProfile('Loadout');
    expect(create).toHaveBeenCalledWith('Loadout', undefined, undefined);
    await updateProfile('p');
    expect(update).toHaveBeenCalledWith('p', undefined, undefined);
  });

  it('still saves an armed switch with an empty pool, and a pool with the switch off', () => {
    const armed: ProfileShuffle = { onLaunch: true, included: [], variants: [] };
    useAppStore.getState().restoreProfileShuffle(armed);
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(armed);
    useAppStore.getState().restoreProfileShuffle({ ...poolA, onLaunch: false });
    expect(useAppStore.getState().captureProfileShuffle()).toEqual({ ...poolA, onLaunch: false });
  });

  it('keeps a pool built after saving an empty profile when that profile is applied', async () => {
    let saved: ProfileShuffle | undefined = poolA;
    const create = vi.fn(async (_name: string, _crosshair: unknown, shuffle?: ProfileShuffle) => {
      saved = shuffle;
      return profile(shuffle);
    });
    const apply = vi.fn(async () => ({ profile: profile(saved), failures: [] }));
    vi.stubGlobal('window', { electronAPI: { createProfile: create, applyProfile: apply } });
    useAppStore.getState().restoreProfileShuffle(emptyOff);
    await createProfile('Loadout');
    useAppStore.getState().restoreProfileShuffle(poolB);
    await applyProfile('p');
    expect(useAppStore.getState().captureProfileShuffle()).toEqual(poolB);
    expect(storage.get(SHUFFLE_ON_LAUNCH_KEY)).toBe('false');
    expect(JSON.parse(storage.get(SHUFFLE_INCLUDED_KEY) ?? '')).toEqual(poolB.included);
  });

  it('drops pool keys of mods that are pinned Global when restoring', () => {
    const pinned = mod('pinned', { gameBananaId: 1, priorityMod: true });
    const loose = mod('loose', { gameBananaId: 2 });
    useAppStore.setState({ mods: [pinned, loose] });
    useAppStore.getState().restoreProfileShuffle({ onLaunch: true, included: ['gamebanana:1', 'gamebanana:2'], variants: [] });
    expect([...useAppStore.getState().shuffleIncluded]).toEqual(['gamebanana:2']);
    expect(JSON.parse(storage.get(SHUFFLE_INCLUDED_KEY) ?? '')).toEqual(['gamebanana:2']);
  });

  it('keeps a pinned mod\'s key when an unpinned sibling still claims it', () => {
    const pinned = mod('pinned', { gameBananaId: 1, priorityMod: true });
    const sibling = mod('sibling', { gameBananaId: 1 });
    useAppStore.setState({ mods: [pinned, sibling] });
    useAppStore.getState().restoreProfileShuffle({ onLaunch: true, included: ['gamebanana:1'], variants: [] });
    expect([...useAppStore.getState().shuffleIncluded]).toEqual(['gamebanana:1']);
  });
});
