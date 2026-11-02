import { describe, expect, it } from 'vitest';
import { BUNDLE_TEXTURE_FILE, bundleTextureFile } from './bundle';

describe('bundle texture files', () => {
  it('serves every name the exporter writes, top image and stored mips alike', () => {
    const vtex = 'materials/particle/beam_fire_stylized.vtex_c';
    for (const name of [bundleTextureFile(vtex), bundleTextureFile(vtex, 0), bundleTextureFile(vtex, 12)]) {
      expect(BUNDLE_TEXTURE_FILE.test(name)).toBe(true);
    }
  });

  it('refuses paths and other file kinds', () => {
    for (const name of ['../settings.json', 'a/b.png', 'x.mip.png', 'x.mip1.jpg', 'x.png.exe', '.png']) {
      expect(BUNDLE_TEXTURE_FILE.test(name)).toBe(false);
    }
  });
});
