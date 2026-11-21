import { expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import { installedPropTarget } from './installedPropPreview';
import { generalPropModel } from './categoryPaths';

const mod: Mod = { id: 'vault', name: 'Golden vault', metaKey: 'pak20_dir.vpk', path: '/addons/pak20_dir.vpk',
  fileName: 'pak20_dir.vpk', priority: 20, enabled: true, size: 100, installedAt: '', sha256: 'a'.repeat(64),
  sourceSection: 'Mod', gameBananaId: 1, categoryName: "Other > Sinner’s Sacrifice" };

it('previews a prop only from the models the file itself contains', () => {
  expect(installedPropTarget(mod)).toBeNull();
  expect(installedPropTarget({ ...mod, propTypes: ['sinner'] }))
    .toEqual({ metaKey: mod.metaKey, cacheKey: `${mod.sha256}-animated`, entry: generalPropModel('sinner') });
  expect(installedPropTarget({ ...mod, propTypes: ['sinner'], sha256: undefined })).toBeNull();
});
