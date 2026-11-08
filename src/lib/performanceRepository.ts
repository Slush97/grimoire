import type { PerformanceRepositoryFile } from '../types/performanceCustom';

export function isPerformanceConfigPath(path: string): boolean {
  return /(?:\.gi|(?:^|\/)gameinfo[^/]*\.txt)$/i.test(path);
}

export function isPerformanceVideoPath(path: string): boolean {
  return /(?:^|\/)video[^/]*\.txt$/i.test(path);
}

/** Never pair a config with a different preset folder's video file. Prefer
 * the conventional filename, otherwise require a choice between variants. */
export function suggestedPerformanceVideoPath(configPath: string | null, videoPaths: string[]): string | null | undefined {
  const folder = configPath?.replace(/[^/]+$/, '');
  const candidates = folder === undefined ? videoPaths : videoPaths.filter((path) => {
    const parent = path.replace(/[^/]+$/, '');
    return parent === folder || parent === `${folder}cfg/`;
  });
  const conventional = candidates.filter((path) => /(?:^|\/)video\.txt$/i.test(path));
  if (conventional.length === 1) return conventional[0];
  if (candidates.length === 1) return candidates[0];
  return candidates.length ? undefined : null;
}

/** A directory VPK that needs numbered chunks cannot be imported on its own. */
export function standalonePerformanceAddons(files: PerformanceRepositoryFile[]): PerformanceRepositoryFile[] {
  const splitBases = new Set(files.filter((file) => /_\d{3}\.vpk$/i.test(file.path))
    .map((file) => file.path.toLowerCase().replace(/_\d{3}\.vpk$/, '')));
  return files.filter((file) => /\.vpk$/i.test(file.path) && !/_\d{3}\.vpk$/i.test(file.path) &&
    !(/_dir\.vpk$/i.test(file.path) && splitBases.has(file.path.toLowerCase().replace(/_dir\.vpk$/, ''))));
}
