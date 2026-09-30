import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialHeroPreviewFlags } from './heroViewerDefaults';
import { resolveHeroPoseRenderFeatures } from './heroPoseRenderFeatures';

afterEach(() => vi.unstubAllGlobals());
describe('fresh and saved viewer presentation', () => {
  it('starts animation, physics, particles, bloom and shared material rendering enabled', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } });
    const flags = initialHeroPreviewFlags();
    expect(flags).toMatchObject({ animated: true, cloth: true, effects: true, bloom: true, unified: true });
    expect(resolveHeroPoseRenderFeatures(flags, false)).toMatchObject({ riggedPreviewEnabled: true, clothPreviewEnabled: true, bloomEnabled: true });
  });
  it('retains explicit saved disabled choices independently on the next mount', () => {
    const saved = new Map(['animated', 'cloth', 'effects', 'bloom'].map((key) => [`grimoire.preview.${key}`, '0']));
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => saved.get(key) ?? null } });
    expect(initialHeroPreviewFlags()).toMatchObject({ animated: false, cloth: false, effects: false, bloom: false });
  });
});
