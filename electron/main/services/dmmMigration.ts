/**
 * DMM -> Grimoire migration (Electron orchestration). Adopts a Deadlock Mod
 * Manager install's on-disk VPKs into Grimoire's own management: copies each
 * VPK into Grimoire's addons layout and writes the metadata sidecar so Grimoire
 * recognizes the mod natively. No re-download, no DMM cloud.
 *
 * The tiered decision logic is pure and unit tested in src/lib/dmmMigration.ts
 * (composeDmmAdoptionPlan). This file only reads the two DMM files off disk,
 * then for each planned mod calls Grimoire's existing install primitives:
 *   - allocateEnabledVpkPath  (enabled mods: a pakNN slot, overflow-aware)
 *   - makeDisabledFileName     (disabled mods: a free-form name in .disabled)
 *   - setModMetadataWithHash   (write the sidecar keyed by metaKey + sha256)
 * all wrapped in one runExclusiveModMutation batch so it's atomic vs UI toggles.
 *
 * Hero/global-type are intentionally left unset: Grimoire's enrichMod infers
 * them from the adopted VPK file tree on the next scan ("auto recognize").
 */

import { homedir } from 'os';
import { join, basename, dirname, resolve, isAbsolute } from 'path';
import { promises as fs, constants as fsConstants, existsSync } from 'fs';

import { getAddonsPath, getAddonFolderPaths, getDisabledPath, metaKeyFor } from './deadlock';
import {
  allocateEnabledVpkPath,
  makeDisabledFileName,
  runExclusiveModMutation,
} from './mods';
import {
  setModMetadataWithHash,
  getModMetadata,
  removeModMetadata,
  loadMetadata,
  hashFileSha256,
  backupMetadataSidecar,
  type ModMetadata,
} from './metadata';
import {
  composeDmmAdoptionPlan,
  planToPreview,
  submissionIdFromVpkName,
  type DmmAdoptionEntry,
  type DmmMigrationMode,
  type DmmMigrationReport,
  type DmmMigrationRequest,
} from '../../../src/lib/dmmMigration';

const DMM_TAURI_IDENTIFIER = 'dev.stormix.deadlock-mod-manager';
const DMM_MANIFEST_FILENAME = '.dmm.json';

export interface DmmMigrationOptions extends DmmMigrationRequest {
  /** Grimoire's Deadlock path (the migration target). Resolved from settings
   *  by the IPC layer. */
  deadlockPath: string;
  /** Dry run: build the plan + preview without copying anything. */
  planOnly?: boolean;
  /** Validates a submission id against Grimoire's local GameBanana catalog
   *  (mods-cache.db). Injected by the IPC layer so this service stays free of
   *  native sqlite imports (its tests run without Electron). Omitted = catalog
   *  unavailable, check skipped. Guards against stamping a bogus id (e.g. a
   *  digit-prefixed filename that isn't a GameBanana id) onto a real file:
   *  such ids render as arbitrary submissions from unrelated games. */
  isKnownSubmission?: (submissionId: number) => boolean;
}

/** Tolerance when comparing a VPK's mtime against the mtime of the DMM record
 *  that claims it (filesystems and DMM's deploy-then-save ordering can put
 *  them within the same second). */
const STALE_CLAIM_SLACK_MS = 2000;

/** Collapse a name to lowercase alphanumerics for fuzzy comparison. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Whether the on-disk filename resembles the DMM record's own name for the
 *  mod (display name or source archive stem). Rescues legitimate adoptions
 *  whose mtime corroboration fails because the files were copied to a new
 *  drive or machine (copies refresh mtimes). */
function nameCorroborates(fileName: string, entry: DmmAdoptionEntry): boolean {
  let stem = fileName.replace(/_dir\.vpk$/i, '').replace(/\.vpk$/i, '');
  stem = stem.replace(/^pak\d{2}_?/i, '');
  const normalizedStem = normalizeForMatch(stem);
  if (normalizedStem.length < 5) return false;
  for (const candidate of [entry.modName, entry.sourceFileName]) {
    if (!candidate) continue;
    const normalized = normalizeForMatch(candidate);
    if (normalized.length < 5) continue;
    if (normalizedStem.includes(normalized) || normalized.includes(normalizedStem)) return true;
  }
  return false;
}

/**
 * Staleness guard. DMM's records claim shared pakNN/.disabled slots by bare
 * path, and Grimoire reuses those exact slots, so a record written long ago
 * can now point at a completely different mod. Stamping DMM's identity onto
 * such a file hijacks it (wrong name/thumbnail/GameBanana id on a real mod).
 * A claim is trusted only when the file is provably the one DMM recorded:
 *  - the filename carries the submission-id prefix DMM mints (`<id>_*.vpk`), or
 *  - the file is not newer than the DMM record that claims it (a slot Grimoire
 *    reused was rewritten AFTER DMM last saved its bookkeeping), or
 *  - the filename matches the mod's recorded name.
 */
async function claimCorroborated(
  src: string,
  entry: DmmAdoptionEntry,
  claimMtimeMs: number
): Promise<boolean> {
  const name = basename(src);
  if (name.toLowerCase().startsWith(`${entry.submissionId}_`)) return true;
  if (claimMtimeMs > 0) {
    try {
      const stat = await fs.stat(src);
      if (stat.mtimeMs <= claimMtimeMs + STALE_CLAIM_SLACK_MS) return true;
    } catch {
      return false;
    }
  }
  return nameCorroborates(name, entry);
}

/** Candidate on-disk locations of DMM's state.json. Tauri's store-plugin base
 *  dir varies by version (appDataDir vs appConfigDir), so we probe both. In the
 *  wild (Linux) it lands in the XDG DATA dir (~/.local/share), not config. */
export function dmmStatePathCandidates(): string[] {
  const home = homedir();
  const id = DMM_TAURI_IDENTIFIER;
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    return [join(roaming, id, 'state.json'), join(local, id, 'state.json')];
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', id, 'state.json')];
  }
  const data = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return [join(data, id, 'state.json'), join(config, id, 'state.json')];
}

/** First state.json candidate that exists, else the first candidate (so error
 *  messages still name a concrete path). */
export function defaultDmmStatePath(): string {
  const candidates = dmmStatePathCandidates();
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

/** Read a file's text, or null if it doesn't exist / can't be read. */
async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/** Locate DMM's `.dmm.json`, checking the given dir and one level of subfolders
 *  (DMM writes it into a profile subfolder, e.g. `addons/profile_default/`).
 *  Returns the parsed text + the folder that holds it (where its VPKs live). */
async function findDmmManifest(
  dmmAddonsDir: string
): Promise<{ json: string; dir: string; path: string } | null> {
  const top = join(dmmAddonsDir, DMM_MANIFEST_FILENAME);
  const topJson = await readTextOrNull(top);
  if (topJson !== null) return { json: topJson, dir: dmmAddonsDir, path: top };

  const subdirs = await fs.readdir(dmmAddonsDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of subdirs) {
    if (!dirent.isDirectory()) continue;
    const dir = join(dmmAddonsDir, dirent.name);
    const path = join(dir, DMM_MANIFEST_FILENAME);
    const json = await readTextOrNull(path);
    if (json !== null) return { json, dir, path };
  }
  return null;
}

/** Resolve a mod's VPK to an on-disk path. Candidates may be absolute paths
 *  (state.json records full paths in installedVpks) or basenames (.dmm.json).
 *  Absolute paths are used directly; basenames are looked up in the DMM addons
 *  dir and one level of subfolders (DMM profile subfolders). */
async function locateVpk(dmmAddonsDir: string, candidates: string[]): Promise<string | null> {
  for (const name of candidates) {
    if (isAbsolute(name)) {
      if (existsSync(name)) return name;
      continue;
    }
    const direct = join(dmmAddonsDir, name);
    if (existsSync(direct)) return direct;
  }
  const relative = candidates.filter((n) => !isAbsolute(n));
  if (relative.length === 0) return null;
  const subdirs = await fs.readdir(dmmAddonsDir, { withFileTypes: true }).catch(() => []);
  for (const dirent of subdirs) {
    if (!dirent.isDirectory()) continue;
    for (const name of relative) {
      const nested = join(dmmAddonsDir, dirent.name, name);
      if (existsSync(nested)) return nested;
    }
  }
  return null;
}

/** Scan Grimoire's addon folders (+ .disabled) for DMM-named `<id>_*.vpk`
 *  files, grouped by submission id. Feeds the planner's fallback for mods whose
 *  on-disk filename DMM's data didn't record. */
async function scanIdPrefixedVpks(dirs: string[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  for (const dir of dirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const dirent of entries) {
      if (!dirent.isFile()) continue;
      const id = submissionIdFromVpkName(dirent.name);
      if (id === null) continue;
      const full = join(dir, dirent.name);
      const arr = map.get(id);
      if (arr) arr.push(full);
      else map.set(id, [full]);
    }
  }
  return map;
}

/** Whether `src` is already a live, engine-loadable enabled slot: a `*_dir.vpk`
 *  sitting directly in one of Grimoire's addon roots (NOT `.disabled`, NOT a
 *  parked `<id>_name.vpk`). Only such a file can be adopted in place. Anything
 *  else (a parked name, a file the fallback found in `.disabled`) must be
 *  promoted into a real pakNN slot, or the mod would be reported enabled yet
 *  stay invisible to scanMods (which requires `_dir.vpk`) and unloaded by the
 *  game. */
function isLiveEnabledSlot(src: string, addonRoots: string[]): boolean {
  if (!basename(src).toLowerCase().endsWith('_dir.vpk')) return false;
  const parent = resolve(dirname(src));
  return addonRoots.some((root) => resolve(root) === parent);
}

/** Whether `src` is already a valid disabled slot Grimoire scans: a `*_dir.vpk`
 *  sitting directly in Grimoire's `.disabled` folder. DMM (at least the current
 *  Linux build) shares this exact folder and deploys its disabled mods into it
 *  with the same `*_dir.vpk` naming, so such a file is already a fully-formed
 *  Grimoire disabled slot. It is adopted by metadata only, with no move, so
 *  DMM's recorded absolute path stays valid and nothing on disk shifts. */
function isLiveDisabledSlot(src: string, disabledPath: string): boolean {
  if (!basename(src).toLowerCase().endsWith('_dir.vpk')) return false;
  return resolve(dirname(src)) === resolve(disabledPath);
}

/** Whether a metadata entry shows Grimoire already manages this VPK: a prior
 *  GameBanana install/import, a merged build, a Locker-managed surface, or a
 *  user-assigned hero. Adopting over such an entry in place would hijack a real
 *  mod's identity, so we skip it instead. */
function isGrimoireManaged(meta: ModMetadata): boolean {
  return (
    meta.gameBananaId !== undefined ||
    meta.merged !== undefined ||
    meta.lockerCosmetics !== undefined ||
    meta.lockerSounds !== undefined ||
    meta.lockerColors !== undefined ||
    meta.lockerTrippySkins !== undefined ||
    meta.soulImport !== undefined ||
    meta.urnImport !== undefined ||
    meta.lockerHero !== undefined
  );
}

function metadataFor(entry: DmmAdoptionEntry): ModMetadata {
  return {
    modName: entry.modName,
    gameBananaId: entry.submissionId,
    gameBananaFileId: entry.fileId,
    categoryName: entry.categoryName,
    thumbnailUrl: entry.thumbnailUrl,
    sourceFileName: entry.sourceFileName,
    sourceSection: 'Mod',
    // Stash the DMM load-order slot so a later enable (for disabled adoptions)
    // can try to restore the position. Harmless on enabled adoptions.
    lastPriority: entry.priority,
    // Deliberately no lockerHero/globalType: enrichMod infers them from the VPK.
  };
}

/**
 * Migrate (or, with planOnly, preview) a DMM install. Non-destructive: DMM's
 * files are never moved or deleted, so its install keeps working after import.
 * Adoption is decided per file by where it already lives:
 *  - in place (metadata only, no file op) when the VPK is already a `*_dir.vpk`
 *    in a folder Grimoire scans: enabled mods in citadel/addons, disabled mods
 *    in citadel/addons/.disabled (DMM shares both). This is the common case.
 *  - copy when DMM's file is outside those folders (a separate profile subfolder
 *    or a copy): a duplicate is brought into Grimoire's layout, leaving DMM's
 *    original untouched.
 * Returns a report; throws only when no DMM data is found at all.
 */
export async function migrateDmmInstall(opts: DmmMigrationOptions): Promise<DmmMigrationReport> {
  const grimoireAddons = getAddonsPath(opts.deadlockPath);
  // Default to the shared addons folder (DMM's default drop location), so the
  // common case needs no folder pick and runs in-place.
  const searchDir = opts.dmmAddonsDir ?? grimoireAddons;

  // DMM may keep `.dmm.json` in the addons root OR in a profile subfolder; find
  // it and use its containing folder as the VPK source.
  const manifestHit = await findDmmManifest(searchDir);
  const dmmAddonsDir = manifestHit?.dir ?? searchDir;
  const statePath = opts.dmmStatePath ?? defaultDmmStatePath();
  const stateJson = await readTextOrNull(statePath);

  // In-place only when the folder DMM's VPKs actually live in IS Grimoire's
  // addons root (a profile subfolder is a separate dir -> copy).
  const mode: DmmMigrationMode =
    resolve(dmmAddonsDir) === resolve(grimoireAddons) ? 'in-place' : 'copy';

  // Discover DMM's actively-loaded `<id>_*.vpk` files so mods whose path DMM
  // didn't record can still be adopted by their filename id prefix.
  const addonRoots = getAddonFolderPaths(opts.deadlockPath);
  const extraVpkBySubmission = await scanIdPrefixedVpks([
    ...addonRoots,
    getDisabledPath(opts.deadlockPath),
  ]);

  let composed;
  try {
    composed = composeDmmAdoptionPlan(manifestHit?.json ?? null, stateJson, {
      profileId: opts.profileId,
      profileName: opts.profileName,
      extraVpkBySubmission,
    });
  } catch {
    // No usable DMM data: turn the bare "No DMM data" into something the user
    // can act on, naming exactly where we looked.
    throw new Error(
      `No Deadlock Mod Manager data found.\n` +
        `Looked for a .dmm.json in: ${searchDir} (and its subfolders) -> ${manifestHit ? 'found' : 'not found'}.\n` +
        `Looked for DMM's state.json at: ${statePath} -> ${stateJson ? 'found' : 'not found'}.\n` +
        `If your DMM mods are elsewhere, click Browse and pick the folder that contains them ` +
        `(or DMM's profile subfolder).`
    );
  }
  const { plan, enrichment } = composed;

  const report: DmmMigrationReport = {
    profileName: plan.profileName,
    enrichment,
    mode,
    preview: [],
    adopted: [],
    skipped: [],
    warnings: [...plan.warnings],
  };

  // Idempotency + validity filters run BEFORE the preview is built, so scan
  // and execute agree on the same entry set and a re-run (another Fix Unknown
  // click) is a true no-op for everything adopted last time, instead of
  // minting duplicate slots/copies of it.
  const allMetadata = loadMetadata();
  const managedSubmissionIds = new Set<number>();
  const managedHashes = new Set<string>();
  for (const meta of Object.values(allMetadata)) {
    if (meta.gameBananaId !== undefined) managedSubmissionIds.add(meta.gameBananaId);
    if (meta.sha256) managedHashes.add(meta.sha256.toLowerCase());
  }

  const adoptableEntries: DmmAdoptionEntry[] = [];
  let unknownToCatalog = 0;
  for (const entry of plan.entries) {
    if (managedSubmissionIds.has(entry.submissionId)) {
      report.skipped.push({
        submissionId: entry.submissionId,
        reason: 'already managed by Grimoire (submission id present in metadata)',
      });
    } else if (opts.isKnownSubmission && !opts.isKnownSubmission(entry.submissionId)) {
      unknownToCatalog++;
      report.skipped.push({
        submissionId: entry.submissionId,
        reason:
          'submission id not found in the local GameBanana catalog (wrong id or catalog out of date); left for manual identification',
      });
    } else {
      adoptableEntries.push(entry);
    }
  }
  if (unknownToCatalog > 0) {
    report.warnings.push(
      `${unknownToCatalog} mod(s) skipped: their DMM submission id is not in the local GameBanana catalog.`
    );
  }
  report.preview = planToPreview({ ...plan, entries: adoptableEntries });

  if (opts.planOnly) return report;

  // Staleness reference: a file claim is only as fresh as the DMM bookkeeping
  // file that made it (the manifest when present, else state.json).
  let claimMtimeMs = 0;
  try {
    const claimFile = manifestHit ? manifestHit.path : statePath;
    claimMtimeMs = (await fs.stat(claimFile)).mtimeMs;
  } catch {
    claimMtimeMs = 0;
  }

  // Recoverability: back up the metadata sidecar before the first identity
  // write (lazily, inside the batch), so a bad import can be rolled back by
  // restoring one file. (The IPC layer additionally takes a mod snapshot.)
  // Lazy on purpose: an execute whose every file is skipped (e.g. a
  // perpetually stale entry re-clicked repeatedly) writes nothing and must
  // not mint a backup, or it would rotate the REAL pre-import backup out of
  // the pruned set. Non-fatal on failure.
  let sidecarBackedUp = false;
  const backupSidecarOnce = () => {
    if (sidecarBackedUp) return;
    sidecarBackedUp = true;
    const backupPath = backupMetadataSidecar('pre-dmm-import');
    if (backupPath) console.log(`[DMM] metadata sidecar backed up to ${backupPath}`);
  };

  // Adopt enabled mods first (ascending priority so sequential slot allocation
  // -> pak01, pak02, ... preserves load order in copy mode; harmless in-place),
  // then disabled mods.
  const ordered = [...adoptableEntries].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.priority - b.priority;
  });

  const disabledPath = getDisabledPath(opts.deadlockPath);

  await runExclusiveModMutation(async () => {
    // Seed the .disabled taken-set once; we add to it as we mint names.
    const disabledTaken = new Set<string>(
      existsSync(disabledPath)
        ? (await fs.readdir(disabledPath)).map((n) => n.toLowerCase())
        : []
    );

    for (const entry of ordered) {
      // A DMM mod may own several VPKs; adopt each one, tagging all with the
      // same submission id so the Installed page groups them into one card.
      const meta = metadataFor(entry);
      const adoptedKeys: string[] = [];
      const fileSkips: string[] = [];

      for (const vpkName of entry.vpkFiles) {
        const src = await locateVpk(dmmAddonsDir, [vpkName]);
        if (!src) {
          fileSkips.push(`${vpkName} (not found on disk)`);
          continue;
        }

        // Staleness guard: only adopt a file the DMM record provably still
        // describes; a shared slot Grimoire has since reused must stay
        // untouched (see claimCorroborated).
        if (!(await claimCorroborated(src, entry, claimMtimeMs))) {
          fileSkips.push(
            `${vpkName} (file is newer than the DMM record claiming it; possibly a reused slot, left for manual identification)`
          );
          continue;
        }

        // Content dedupe: if a byte-identical file is already managed (e.g. a
        // copy minted by an earlier import run whose metadata lost the id),
        // adopting another copy only duplicates the mod.
        let srcHash: string;
        try {
          srcHash = (await hashFileSha256(src)).toLowerCase();
        } catch (err) {
          fileSkips.push(`${vpkName} (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }
        if (managedHashes.has(srcHash)) {
          fileSkips.push(`${vpkName} (an identical file is already managed by Grimoire)`);
          continue;
        }

        try {
          let destPath: string;
          if (entry.enabled) {
            if (mode === 'in-place' && isLiveEnabledSlot(src, addonRoots)) {
              // Already a live pakNN_dir.vpk slot Grimoire scans: adopt by
              // metadata only, no copy.
              destPath = src;
              const existing = getModMetadata(metaKeyFor(destPath));
              // Skip anything Grimoire already manages (a prior import, or a
              // local/Locker VPK that happens to occupy this slot): re-tagging it
              // would hijack its identity. Only a truly unmanaged file is adopted.
              if (existing && isGrimoireManaged(existing)) {
                fileSkips.push(`${vpkName} (already managed by Grimoire)`);
                continue;
              }
            } else {
              // Not a live slot (copy mode, a parked `<id>_name.vpk`, or a file the
              // fallback found in .disabled): promote into a real pakNN slot so it
              // actually loads. Must write before the next allocation so the slot
              // scan sees it taken.
              destPath = await allocateEnabledVpkPath(opts.deadlockPath);
              await fs.copyFile(src, destPath, fsConstants.COPYFILE_EXCL);
            }
          } else if (isLiveDisabledSlot(src, disabledPath)) {
            // Already a valid disabled slot in Grimoire's .disabled folder (DMM
            // shares it): adopt by metadata only, no move. Non-destructive, so
            // DMM's recorded path keeps working and the file never shifts.
            destPath = src;
            const existing = getModMetadata(metaKeyFor(destPath));
            // Don't re-tag a file Grimoire already manages (a prior import or a
            // Locker/local surface parked here): that would hijack its identity.
            if (existing && isGrimoireManaged(existing)) {
              fileSkips.push(`${vpkName} (already managed by Grimoire)`);
              continue;
            }
          } else {
            // DMM's file lives outside Grimoire's scanned folders (a separate
            // profile subfolder or copy): bring a COPY into .disabled under a
            // free-form name. Always copy, never move, so DMM stays intact.
            const nameHint = entry.modName ?? entry.sourceFileName ?? basename(src);
            const disabledName = makeDisabledFileName(basename(src), disabledTaken, nameHint);
            disabledTaken.add(disabledName.toLowerCase());
            if (!existsSync(disabledPath)) await fs.mkdir(disabledPath, { recursive: true });
            destPath = join(disabledPath, disabledName);
            await fs.copyFile(src, destPath, fsConstants.COPYFILE_EXCL);
          }

          const metaKey = metaKeyFor(destPath);
          // Clear any orphaned sidecar entry at this key first: an allocated slot
          // is only guaranteed free on disk, so a stale entry from a deleted mod
          // could otherwise bleed its fields (lockerHero, merged, thumbnail) into
          // this one via setModMetadata's shallow merge.
          backupSidecarOnce();
          removeModMetadata(metaKey);
          await setModMetadataWithHash(metaKey, meta, destPath);
          managedHashes.add(srcHash);
          adoptedKeys.push(metaKey);
        } catch (err) {
          fileSkips.push(`${vpkName} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      if (adoptedKeys.length > 0) {
        report.adopted.push({
          submissionId: entry.submissionId,
          fileId: entry.fileId,
          modName: entry.modName,
          installedAs: adoptedKeys[0],
          enabled: entry.enabled,
          priority: entry.priority,
        });
      } else {
        report.skipped.push({
          submissionId: entry.submissionId,
          reason: fileSkips.length > 0 ? fileSkips.join('; ') : 'no VPK files to adopt',
        });
      }
    }
  });

  // Diagnostic summary (main-process log): the renderer only surfaces a count, so
  // this is where a "only N imported" report can be traced to its real cause.
  console.log(
    `[DMM] migrate: adopted ${report.adopted.length} mod(s), skipped ${report.skipped.length} ` +
      `(mode=${report.mode}, enrichment=${report.enrichment})`
  );
  for (const s of report.skipped) {
    console.log(`[DMM]   skipped ${s.submissionId}: ${s.reason}`);
  }

  return report;
}
