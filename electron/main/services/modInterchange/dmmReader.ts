/**
 * Reader adapter: Deadlock Mod Manager's native on-disk data -> interchange
 * document. Works against every DMM version seen in the wild:
 *
 *  - `.dmm.json` v1 (no shards) through v3 (enabled VPKs spread over
 *    `citadel/addons<N>/<profile>` shards), in the addons root or a profile
 *    subfolder,
 *  - `state.json` in either Tauri store location, with `local-config` stored
 *    as a string or an object,
 *  - mod ids `123`, `snd-123` and `local-<uuid>`.
 *
 * Fallbacks, in order, per mod: the manifest's recorded files; the other list
 * (enabled vs disabled) when DMM left the expected one empty; `<id>_*.vpk`
 * files found on disk; DMM's own download cache (`<app data>/mods/<id>/files`)
 * when the addon files are gone entirely. Nothing is written.
 */

import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, resolve } from 'path';
import { existsSync, promises as fs } from 'fs';

import { getAddonFolderPaths, getAddonsPath, getDisabledPath } from '../deadlock';
import { hashFileSha256 } from '../metadata';
import {
  composeDmmAdoptionPlan,
  dmmIdFromVpkName,
  interchangeKeyForEntry,
  submissionIdFromVpkName,
  type DmmAdoptionEntry,
  type DmmAdoptionPlan,
  type DmmEnrichment,
  type DmmMigrationMode,
  type DmmMigrationRequest,
} from '../../../../src/lib/dmmMigration';
import {
  parseDmmState,
  selectDmmProfile,
  unwrapDmmStateEnvelope,
} from '../../../../src/lib/dmmState';
import {
  includeSection,
  newInterchangeDocument,
  type InterchangeDocument,
  type InterchangeMod,
  type InterchangeSourceInfo,
} from '../../../../src/lib/modInterchange';

export const DMM_TAURI_IDENTIFIER = 'dev.stormix.deadlock-mod-manager';
export const DMM_MANAGER_ID = 'deadlock-mod-manager';
const DMM_MANIFEST_FILENAME = '.dmm.json';

/** Per-mod data the importer needs to apply DMM-specific guards. */
export interface DmmModExtension {
  dmmId: string;
  shard: number;
  /** mtime of the DMM bookkeeping that claims this mod's files. */
  claimMtimeMs: number;
  /** Files taken from DMM's id-keyed download cache (always trustworthy). */
  storeFiles: string[];
}

/** Candidate on-disk locations of DMM's state.json. Tauri's store-plugin base
 *  dir varies by version (appDataDir vs appConfigDir), so we probe both. In the
 *  wild (Linux) it lands in the XDG DATA dir (~/.local/share), not config. */
export function dmmStatePathCandidates(): string[] {
  return dmmDataDirCandidates().map((dir) => join(dir, 'state.json'));
}

/** Folders DMM may use for its app data, most likely first. */
export function dmmDataDirCandidates(): string[] {
  const home = homedir();
  const id = DMM_TAURI_IDENTIFIER;
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [join(roaming, id), join(local, id)];
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', id)];
  }
  const data = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  const flatpak = join(home, '.var', 'app', id);
  return [
    join(data, id),
    join(config, id),
    join(flatpak, 'data', id),
    join(flatpak, 'config', id),
  ];
}

/** First state.json candidate that exists, else the first candidate (so error
 *  messages still name a concrete path). */
export function defaultDmmStatePath(): string {
  const candidates = dmmStatePathCandidates();
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** DMM's download cache (`app_local_data_dir/mods`), which holds every
 *  downloaded VPK under `<modId>/files`. Next to state.json on most systems,
 *  under LOCALAPPDATA on Windows. */
function dmmModStoreCandidates(statePath: string): string[] {
  const dirs = [dirname(statePath), ...dmmDataDirCandidates()].map((dir) => join(dir, 'mods'));
  return [...new Set(dirs.map((dir) => resolve(dir)))];
}

async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

interface ManifestHit {
  json: string;
  dir: string;
  path: string;
}

async function manifestIn(dir: string): Promise<ManifestHit | null> {
  const path = join(dir, DMM_MANIFEST_FILENAME);
  const json = await readTextOrNull(path);
  return json === null ? null : { json, dir, path };
}

/** Locate DMM's `.dmm.json`: the chosen profile's folder first, then the given
 *  dir, then one level of subfolders (DMM profile folders). */
async function findDmmManifest(
  searchDir: string,
  preferredFolder: string | null | undefined
): Promise<ManifestHit | null> {
  if (preferredFolder) {
    const hit = await manifestIn(join(searchDir, preferredFolder));
    if (hit) return hit;
  }
  const top = await manifestIn(searchDir);
  if (top) return top;
  const subdirs = await fs.readdir(searchDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of subdirs) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const hit = await manifestIn(join(searchDir, dirent.name));
    if (hit) return hit;
  }
  return null;
}

/** The directory holding shard `shard` of a profile whose base is `baseDir`:
 *  shard 1 is the base itself, shard N is `citadel/addons<N>[/<profile>]`. */
export function dmmShardDir(baseDir: string, shard: number): string {
  if (shard <= 1) return baseDir;
  const parts: string[] = [];
  let cursor = resolve(baseDir);
  while (basename(cursor).toLowerCase() !== 'addons') {
    const parent = dirname(cursor);
    if (parent === cursor) return baseDir;
    parts.unshift(basename(cursor));
    cursor = parent;
  }
  return join(dirname(cursor), `addons${shard}`, ...parts);
}

/** Scan folders for DMM-parked `<dmmId>_*.vpk` files, grouped by DMM id and
 *  by numeric submission id (the latter for the planner's legacy option). */
async function scanIdPrefixedVpks(
  dirs: string[]
): Promise<{ byDmmId: Map<string, string[]>; bySubmission: Map<number, string[]> }> {
  const byDmmId = new Map<string, string[]>();
  const bySubmission = new Map<number, string[]>();
  const push = <K>(map: Map<K, string[]>, key: K, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const dir of dirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of entries) {
      if (!dirent.isFile()) continue;
      const full = join(dir, dirent.name);
      const dmmId = dmmIdFromVpkName(dirent.name);
      if (dmmId) push(byDmmId, dmmId, full);
      const submissionId = submissionIdFromVpkName(dirent.name);
      if (submissionId !== null) push(bySubmission, submissionId, full);
    }
  }
  return { byDmmId, bySubmission };
}

async function vpksUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const dirent of entries) {
      const full = join(current, dirent.name);
      if (dirent.isDirectory()) pending.push(full);
      else if (dirent.isFile() && /\.vpk$/i.test(dirent.name)) found.push(full);
    }
  }
  return found.sort();
}

const PAK_SLOT_RE = /^pak\d+_dir\.vpk$/i;

/** Resolve one recorded file name for a planned entry. A `pakNN_dir.vpk` slot
 *  name only means something in the folder DMM recorded it for: every folder
 *  (shard, profile) has its own pak01, so it is never looked up elsewhere. */
async function locateFile(
  name: string,
  entry: DmmAdoptionEntry,
  baseDir: string
): Promise<string | null> {
  if (isAbsolute(name)) return existsSync(name) ? name : null;
  if (PAK_SLOT_RE.test(name)) {
    const slot = join(entry.enabled ? dmmShardDir(baseDir, entry.shard) : baseDir, name);
    return existsSync(slot) ? slot : null;
  }
  const candidates = [
    entry.enabled ? join(dmmShardDir(baseDir, entry.shard), name) : null,
    join(baseDir, name),
  ].filter((p): p is string => p !== null);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // A parked `<dmmId>_<name>.vpk` is unique to its mod, so it may be found in
  // a nested folder; anything else could belong to another profile.
  if (dmmIdFromVpkName(name) !== entry.dmmId) return null;
  const subdirs = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of subdirs) {
    if (!dirent.isDirectory()) continue;
    const nested = join(baseDir, dirent.name, name);
    if (existsSync(nested)) return nested;
  }
  return null;
}

async function resolveFromStore(
  entry: DmmAdoptionEntry,
  storeDirs: string[]
): Promise<string[]> {
  for (const store of storeDirs) {
    const files = await vpksUnder(join(store, entry.dmmId, 'files'));
    if (files.length === 0) continue;
    const wanted = new Set(
      [...(entry.selectedVpkNames ?? []), ...entry.vpkFiles]
        .filter((n) => !isAbsolute(n))
        .map((n) => n.toLowerCase())
    );
    const picked = files.filter((f) => wanted.has(basename(f).toLowerCase()));
    return picked.length > 0 ? picked : files;
  }
  return [];
}

export interface DmmReadOptions extends DmmMigrationRequest {
  deadlockPath: string;
  /** Read exactly this folder's `.dmm.json` (a known profile's own folder)
   *  instead of searching for one. */
  manifestDir?: string;
}

export interface DmmReadResult {
  document: InterchangeDocument;
  plan: DmmAdoptionPlan;
  enrichment: DmmEnrichment;
  mode: DmmMigrationMode;
}

/** Is DMM installed? Found when its state.json or a `.dmm.json` exists. */
export async function detectDmm(deadlockPath: string | null): Promise<InterchangeSourceInfo> {
  const statePath = defaultDmmStatePath();
  const stateJson = await readTextOrNull(statePath);
  const searched = [...dmmStatePathCandidates()];
  let manifestPath: string | null = null;
  if (deadlockPath) {
    const addons = getAddonsPath(deadlockPath);
    searched.push(join(addons, DMM_MANIFEST_FILENAME));
    manifestPath = (await findDmmManifest(addons, null))?.path ?? null;
  }
  return {
    id: DMM_MANAGER_ID,
    name: 'Deadlock Mod Manager',
    found: stateJson !== null || manifestPath !== null,
    location: stateJson !== null ? dirname(statePath) : manifestPath ? dirname(manifestPath) : null,
    sections: ['mods', 'profiles', 'crosshairs'],
    searched,
  };
}

/** Read one DMM profile as an interchange document with absolute paths. */
export async function readDmmLibrary(opts: DmmReadOptions): Promise<DmmReadResult> {
  const grimoireAddons = getAddonsPath(opts.deadlockPath);
  const searchDir = opts.dmmAddonsDir ?? grimoireAddons;
  const statePath = opts.dmmStatePath ?? defaultDmmStatePath();
  const stateJson = await readTextOrNull(statePath);

  let preferredFolder: string | null = null;
  if (stateJson) {
    try {
      preferredFolder = selectDmmProfile(parseDmmState(stateJson), opts.profileId)?.folderName ?? null;
    } catch {
      preferredFolder = null;
    }
  }
  // A known profile reads only its own folder: falling back to another
  // folder's manifest would hand this profile someone else's mods.
  const manifestHit = opts.manifestDir
    ? await manifestIn(opts.manifestDir)
    : await findDmmManifest(searchDir, preferredFolder);
  const baseDir =
    opts.manifestDir ??
    manifestHit?.dir ??
    (preferredFolder ? join(searchDir, preferredFolder) : searchDir);

  const mode: DmmMigrationMode =
    resolve(baseDir) === resolve(grimoireAddons) ? 'in-place' : 'copy';

  const scanDirs = [
    ...getAddonFolderPaths(opts.deadlockPath),
    getDisabledPath(opts.deadlockPath),
    ...(resolve(baseDir) === resolve(grimoireAddons) ? [] : [baseDir]),
  ];
  const extra = await scanIdPrefixedVpks(scanDirs);

  let composed;
  try {
    composed = composeDmmAdoptionPlan(manifestHit?.json ?? null, stateJson, {
      profileId: opts.profileId,
      profileName: opts.profileName,
      extraVpkBySubmission: extra.bySubmission,
      extraVpkByDmmId: extra.byDmmId,
    });
  } catch {
    throw new Error(
      `No Deadlock Mod Manager data found.\n` +
        `Looked for a .dmm.json in: ${searchDir} (and its subfolders) -> ${manifestHit ? 'found' : 'not found'}.\n` +
        `Looked for DMM's state.json at: ${statePath} -> ${stateJson ? 'found' : 'not found'}.\n` +
        `If your DMM mods are elsewhere, click Browse and pick the folder that contains them ` +
        `(or DMM's profile subfolder).`
    );
  }
  const { plan, enrichment } = composed;
  const claimMtimeMs = await mtimeOf(manifestHit ? manifestHit.path : statePath);
  const storeDirs = dmmModStoreCandidates(statePath);

  const document = newInterchangeDocument({
    manager: DMM_MANAGER_ID,
    profileName: plan.profileName,
  });
  document.warnings.push(...plan.warnings);

  let restoredFromStore = 0;
  for (const entry of plan.entries) {
    const files: string[] = [];
    const missing: string[] = [];
    for (const name of entry.storeOnly ? [] : entry.vpkFiles) {
      const found = await locateFile(name, entry, baseDir);
      if (found) files.push(found);
      else missing.push(name);
    }
    let storeFiles: string[] = [];
    if (files.length === 0) {
      storeFiles = await resolveFromStore(entry, storeDirs);
      if (storeFiles.length > 0) restoredFromStore++;
    }
    const allFiles = [...files, ...storeFiles];
    if (allFiles.length === 0) {
      document.warnings.push(
        `Skipped ${entry.modName ?? entry.dmmId}: its VPK file(s) are gone (${(entry.storeOnly ? entry.vpkFiles : missing).join(', ')})`
      );
      continue;
    }
    document.mods.push(entryToInterchange(entry, allFiles, { claimMtimeMs, storeFiles }));
  }
  // Object key order puts numeric DMM ids first; the document follows load order.
  document.mods.sort((a, b) => a.order - b.order);
  if (restoredFromStore > 0) {
    document.warnings.push(
      `${restoredFromStore} mod(s) were missing from the addons folder and come from DMM's download cache`
    );
  }

  return { document, plan, enrichment, mode };
}

function entryToInterchange(
  entry: DmmAdoptionEntry,
  files: string[],
  guard: { claimMtimeMs: number; storeFiles: string[] }
): InterchangeMod {
  const isLocal = entry.kind === 'local';
  const section = entry.kind === 'sound' ? 'sounds' : 'mods';
  const extension: DmmModExtension = {
    dmmId: entry.dmmId,
    shard: entry.shard,
    claimMtimeMs: guard.claimMtimeMs,
    storeFiles: guard.storeFiles,
  };
  return {
    key: interchangeKeyForEntry(entry),
    name:
      entry.modName?.trim() ||
      entry.sourceFileName ||
      (isLocal ? 'DMM local mod' : `GameBanana ${entry.kind} ${entry.submissionId}`),
    enabled: entry.enabled,
    order: entry.priority,
    origin: isLocal
      ? { provider: 'local', localId: entry.localId }
      : {
          provider: 'gamebanana',
          submissionType: entry.kind === 'sound' ? 'sound' : 'mod',
          submissionId: String(entry.submissionId),
          fileId: entry.fileId,
          fileName: entry.sourceFileName,
        },
    author: entry.author ?? null,
    description: entry.description ?? null,
    category: entry.categoryName ?? null,
    hero: null,
    thumbnailUrl: entry.thumbnailUrl ?? null,
    link: isLocal ? null : `https://gamebanana.com/${section}/${entry.submissionId}`,
    nsfw: null,
    files: files.map((path) => ({ name: basename(path), path, selected: true })),
    extensions: { [DMM_MANAGER_ID]: { ...extension } },
  };
}

/** The DMM guard data an importer should honor for one entry, if any. */
export function dmmExtensionOf(mod: InterchangeMod): DmmModExtension | null {
  const ext = mod.extensions?.[DMM_MANAGER_ID];
  if (!ext || typeof ext.claimMtimeMs !== 'number' || typeof ext.dmmId !== 'string') return null;
  return {
    dmmId: ext.dmmId,
    shard: typeof ext.shard === 'number' ? ext.shard : 1,
    claimMtimeMs: ext.claimMtimeMs,
    storeFiles: Array.isArray(ext.storeFiles)
      ? ext.storeFiles.filter((p): p is string => typeof p === 'string')
      : [],
  };
}

/** DMM's crosshair model -> game convars. */
function dmmCrosshairConvars(raw: unknown): Record<string, string> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  const color = (typeof c.color === 'object' && c.color !== null ? c.color : {}) as Record<
    string,
    unknown
  >;
  const convars: Record<string, string> = {};
  const put = (convar: string, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) convars[convar] = String(value);
    else if (typeof value === 'boolean') convars[convar] = String(value);
  };
  put('citadel_crosshair_pip_gap', c.gap);
  put('citadel_crosshair_pip_width', c.width);
  put('citadel_crosshair_pip_height', c.height);
  put('citadel_crosshair_pip_opacity', c.pipOpacity);
  put('citadel_crosshair_dot_opacity', c.dotOpacity);
  put('citadel_crosshair_dot_outline_opacity', c.dotOutlineOpacity);
  put('citadel_crosshair_color_r', color.r);
  put('citadel_crosshair_color_g', color.g);
  put('citadel_crosshair_color_b', color.b);
  put('citadel_crosshair_pip_border', c.pipBorder);
  put('citadel_crosshair_pip_gap_static', c.pipGapStatic);
  return Object.keys(convars).length > 0 ? convars : null;
}

function readDmmCrosshairs(stateJson: string | null, document: InterchangeDocument): void {
  if (!stateJson) return;
  let state: Record<string, unknown>;
  try {
    state = unwrapDmmStateEnvelope(stateJson);
  } catch {
    return;
  }
  const seen = new Set<string>();
  const add = (raw: unknown, name: string, active: boolean) => {
    const convars = dmmCrosshairConvars(raw);
    if (!convars) return;
    const fingerprint = JSON.stringify(convars);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    document.crosshairs.push({ key: `crosshair:dmm:${seen.size}`, name, active, convars });
  };
  add(state.activeCrosshair, 'DMM active crosshair', true);
  const history = Array.isArray(state.activeCrosshairHistory) ? state.activeCrosshairHistory : [];
  history.forEach((raw, index) => add(raw, `DMM crosshair ${index + 1}`, false));
  if (document.crosshairs.length > 0) includeSection(document, 'crosshairs');
}

/** DMM names a profile folder `<profileId>_<sanitized name>` with a
 *  `profile_<timestamp>_<random>` id. Recover a readable name from it. */
export function dmmProfileNameFromFolder(folder: string): string {
  const name = folder.replace(/^profile_\d+_[a-z0-9]+_/i, '').replace(/[-_]+/g, ' ').trim();
  return name || folder;
}

interface DmmProfileSource {
  id: string;
  name: string;
  manifestDir: string;
}

/** Without state.json (DMM uninstalled with its data, or a picked folder) the
 *  profiles are still on disk: the folder itself, then every subfolder that
 *  holds a `.dmm.json`. */
async function discoverDmmProfiles(searchDir: string): Promise<DmmProfileSource[]> {
  const found: DmmProfileSource[] = [];
  if (existsSync(join(searchDir, DMM_MANIFEST_FILENAME))) {
    found.push({ id: 'default', name: 'Default Profile', manifestDir: searchDir });
  }
  const subdirs = await fs.readdir(searchDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of subdirs) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue;
    const dir = join(searchDir, dirent.name);
    if (!existsSync(join(dir, DMM_MANIFEST_FILENAME))) continue;
    found.push({ id: `folder:${dirent.name}`, name: dmmProfileNameFromFolder(dirent.name), manifestDir: dir });
  }
  return found;
}

/**
 * Read DMM completely: every profile (each is its own addons folder), the
 * union of their mods as the library, and the crosshairs. The library's
 * enabled/order is the active profile's state; mods only other profiles use
 * come after it, disabled. A profile that cannot be read costs only itself.
 *
 * DMM's default profile lives in the folders Grimoire scans, so its files are
 * Grimoire mods the moment Grimoire looks. Every such file is therefore part
 * of the library (as the mod's source, or as a kept variant), so the import
 * consumes it instead of leaving a stray copy for the game to load.
 */
export async function readDmmDocument(opts: DmmReadOptions): Promise<InterchangeDocument> {
  const statePath = opts.dmmStatePath ?? defaultDmmStatePath();
  const stateJson = await readTextOrNull(statePath);
  const addons = getAddonsPath(opts.deadlockPath);
  let sources: DmmProfileSource[] = [];
  let activeId: string | undefined;
  let fromState = false;
  if (stateJson && !opts.dmmAddonsDir) {
    try {
      const state = parseDmmState(stateJson);
      sources = state.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        manifestDir: profile.folderName ? join(addons, profile.folderName) : addons,
      }));
      activeId = selectDmmProfile(state, opts.profileId)?.id;
      fromState = sources.length > 0;
    } catch {
      sources = [];
    }
  }
  if (sources.length === 0) {
    sources = await discoverDmmProfiles(opts.dmmAddonsDir ?? addons);
    activeId = sources[0]?.id;
  }

  if (sources.length === 0) {
    // Nothing on disk but maybe a state.json: one unnamed profile.
    const single = await readDmmLibrary(opts);
    readDmmCrosshairs(stateJson, single.document);
    return single.document;
  }

  const ordered = [...sources].sort(
    (a, b) => Number(b.id === activeId) - Number(a.id === activeId)
  );
  const document = newInterchangeDocument({
    manager: DMM_MANAGER_ID,
    profileName: ordered[0].name,
  });
  const scanned = [...getAddonFolderPaths(opts.deadlockPath), getDisabledPath(opts.deadlockPath)].map(
    (dir) => resolve(dir).toLowerCase()
  );
  const inGrimoireScan = (path: string) => scanned.includes(resolve(dirname(path)).toLowerCase());
  const library = new Map<string, InterchangeMod>();
  const warnings = new Set<string>();
  for (const source of ordered) {
    const isActive = source.id === activeId;
    let read: DmmReadResult;
    try {
      read = await readDmmLibrary({
        ...opts,
        profileId: fromState ? source.id : undefined,
        profileName: source.name,
        manifestDir: source.manifestDir,
      });
    } catch (err) {
      document.warnings.push(
        `Profile ${source.name} could not be read: ${
          err instanceof Error ? err.message.split('\n')[0] : String(err)
        }`
      );
      continue;
    }
    for (const w of read.document.warnings) warnings.add(isActive ? w : `${source.name}: ${w}`);
    for (const mod of read.document.mods) {
      const existing = library.get(mod.key);
      if (!existing) {
        library.set(mod.key, { ...mod, enabled: isActive ? mod.enabled : false, files: [...mod.files] });
        document.mods.push(library.get(mod.key)!);
        continue;
      }
      await mergeScannedFiles(existing, mod, inGrimoireScan);
    }
    document.profiles.push({
      key: `profile:${source.id}`,
      name: source.name,
      active: isActive,
      description: null,
      mods: read.document.mods.map((mod) => ({
        modKey: mod.key,
        enabled: mod.enabled,
        order: mod.order,
      })),
      crosshairKey: null,
      autoexec: null,
    });
  }
  document.mods.forEach((mod, index) => {
    mod.order = index;
  });
  document.warnings.push(...warnings);
  includeSection(document, 'profiles');
  readDmmCrosshairs(stateJson, document);
  return document;
}

/** Another profile's copy of a library mod. When that copy sits where
 *  Grimoire scans, it must be consumed by the import: an identical copy
 *  becomes the source (so it is adopted, not left behind), a different one is
 *  kept as an unselected variant of the same mod. */
async function mergeScannedFiles(
  library: InterchangeMod,
  other: InterchangeMod,
  inGrimoireScan: (path: string) => boolean
): Promise<void> {
  const known = new Set(library.files.map((f) => resolve(f.path).toLowerCase()));
  for (const file of other.files) {
    if (!inGrimoireScan(file.path) || known.has(resolve(file.path).toLowerCase())) continue;
    const hash = await hashFileSha256(file.path).catch(() => null);
    if (!hash) continue;
    let replaced = false;
    for (const current of library.files) {
      if (inGrimoireScan(current.path)) continue;
      const currentHash = await hashFileSha256(current.path).catch(() => null);
      if (currentHash && currentHash.toLowerCase() === hash.toLowerCase()) {
        current.path = file.path;
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      const taken = new Set(library.files.map((f) => f.name.toLowerCase()));
      let name = file.name;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = file.name.replace(/(_dir)?\.vpk$/i, `_${n}$1.vpk`);
      library.files.push({ ...file, name, selected: false });
    }
    known.add(resolve(file.path).toLowerCase());
  }
}
