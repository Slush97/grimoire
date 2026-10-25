import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export const movementFxCacheRoot = () => join(app.getPath('userData'), 'movement-fx');

/** The preview protocol serves decoded images only, never archives or caller paths. */
export function movementCacheFile(key: string, filename: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[A-Za-z0-9_]+\.png$/.test(filename)) return null;
  void fs.utimes(join(movementFxCacheRoot(), key, 'ready'), new Date(), new Date()).catch(() => {});
  return join(movementFxCacheRoot(), key, 'effect-tex', filename);
}
