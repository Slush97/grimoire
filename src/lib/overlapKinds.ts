export type OverlapKind =
  | 'hud'
  | 'images'
  | 'models'
  | 'textures'
  | 'sounds'
  | 'effects'
  | 'gameData'
  | 'text'
  | 'maps'
  | 'other';

// First match wins, so panorama/images/ has to come before panorama/.
const PREFIXES: [string, OverlapKind][] = [
  ['panorama/images/', 'images'],
  ['panorama/', 'hud'],
  ['models/', 'models'],
  ['materials/', 'textures'],
  ['sounds/', 'sounds'],
  ['soundevents/', 'sounds'],
  ['particles/', 'effects'],
  ['scripts/', 'gameData'],
  ['resource/', 'text'],
  ['maps/', 'maps'],
];

export function overlapKind(path: string): OverlapKind {
  const lower = path.toLowerCase();
  return PREFIXES.find(([prefix]) => lower.startsWith(prefix))?.[1] ?? 'other';
}

/** Distinct kinds among `files`, most files first. */
export function overlapKinds(files: readonly string[]): OverlapKind[] {
  const counts = new Map<OverlapKind, number>();
  for (const file of files) {
    const kind = overlapKind(file);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([kind]) => kind);
}

/** Two mods replacing the same compiled model don't blend: only the one that
 *  loads first shows up in game. */
export function sharesModel(files: readonly string[]): boolean {
  return files.some((file) => file.toLowerCase().endsWith('.vmdl_c'));
}
