import { afterEach, describe, expect, it, vi } from 'vitest';
import { heroPresentationStorageKey, initialHeroPreviewFlags } from './heroViewerDefaults';
import { resolveHeroPoseRenderFeatures } from './heroPoseRenderFeatures';

afterEach(() => vi.unstubAllGlobals());
describe('fresh and saved viewer presentation', () => {
  it('starts animation, physics, particles, bloom and shared material rendering enabled', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    const flags = initialHeroPreviewFlags();
    expect(flags).toMatchObject({ animated: true, cloth: true, effects: true, bloom: true, unified: true, autoRotate: false });
    expect(resolveHeroPoseRenderFeatures(flags, false)).toMatchObject({ riggedPreviewEnabled: true, clothPreviewEnabled: true, bloomEnabled: true });
  });
  it('retains explicit saved disabled choices independently on the next mount', () => {
    const saved = new Map(['animated', 'cloth', 'effects', 'bloom'].map((key) => [heroPresentationStorageKey(key), '0']));
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => saved.get(key) ?? null } });
    expect(initialHeroPreviewFlags()).toMatchObject({ animated: false, cloth: false, effects: false, bloom: false });
  });
  it('does not inherit old opt-in debug defaults into production presentation', () => {
    const saved = new Map(['animated', 'cloth', 'effects', 'bloom'].map((key) => [`grimoire.preview.${key}`, '0']));
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => saved.get(key) ?? null } });
    expect(initialHeroPreviewFlags()).toMatchObject({ animated: true, cloth: true, effects: true, bloom: true, autoRotate: false });
  });
  it('retains an explicitly enabled production turntable', () => {
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => key === heroPresentationStorageKey('autoRotate') ? '1' : null } });
    expect(initialHeroPreviewFlags().autoRotate).toBe(true);
  });
});
