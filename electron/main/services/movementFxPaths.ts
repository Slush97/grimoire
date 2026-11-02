import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { BUNDLE_TEXTURE_FILE } from '../../../src/lib/particles/host/bundle';

export const movementFxCacheRoot = () => join(app.getPath('userData'), 'movement-fx');

/** A hero's directory name under a bake's engine previews. */
export function movementEngineHeroDir(heroName: string): string {
  return heroName.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 64) || 'hero';
}

/**
 * The engine preview bundle of a bake (`engine/<hero>/bundle.json`) or one of its decoded textures
 * (`engine/<hero>/tex/<name>.png`, or a stored mip `<name>.mip<n>.png`). Never archives or caller paths.
 */
export function movementEngineFile(key: string, parts: readonly string[]): string | null {
  if (!/^[a-f0-9]{64}$/.test(key) || parts[0] !== 'engine' || !/^[A-Za-z0-9_]{1,64}$/.test(parts[1] ?? '')) return null;
  const rest = parts.slice(2);
  const valid = (rest.length === 1 && rest[0] === 'bundle.json') || (rest.length === 2 && rest[0] === 'tex' && BUNDLE_TEXTURE_FILE.test(rest[1]));
  if (!valid) return null;
  void fs.utimes(join(movementFxCacheRoot(), key, 'ready'), new Date(), new Date()).catch(() => {});
  return join(movementFxCacheRoot(), key, 'engine', parts[1], ...rest);
}

/** The preview protocol serves decoded images only, never archives or caller paths. */
export function movementCacheFile(key: string, filename: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[A-Za-z0-9_]+\.png$/.test(filename)) return null;
  void fs.utimes(join(movementFxCacheRoot(), key, 'ready'), new Date(), new Date()).catch(() => {});
  return join(movementFxCacheRoot(), key, 'effect-tex', filename);
}
