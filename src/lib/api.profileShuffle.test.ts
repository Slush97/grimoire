import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../types/electron';
import { createProfile, updateProfile, applyProfile } from './api';
import { useAppStore } from '../stores/appStore';
import { SHUFFLE_INCLUDED_KEY, SHUFFLE_ON_LAUNCH_KEY, SHUFFLE_VARIANT_KEY } from './lockerRandomizer';
import type { ProfileShuffle } from './profileShuffle';

vi.mock('../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));

const poolA: ProfileShuffle = { onLaunch: true, included: ['gamebanana:1'], variants: [['gamebanana:1', 'random']] };
const poolB: ProfileShuffle = { onLaunch: false, included: ['gamebanana:2'], variants: [['gamebanana:2', { fileId: 8 }]] };
const profile = (shuffle?: ProfileShuffle): Profile => ({ id: 'p', name: 'Loadout', mods: [], createdAt: '', updatedAt: '', shuffle });
let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
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
    useAppStore.getState().restoreProfileShuffle({ onLaunch: false, included: [], variants: [] });
    expect(useAppStore.getState().captureProfileShuffle()).toEqual({ onLaunch: false, included: [], variants: [] });
  });
});
