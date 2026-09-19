/**
 * Importer: interchange document -> Grimoire.
 *
 * Every entry becomes one or more VPKs in Grimoire's own layout with a
 * metadata sidecar entry, exactly like a GameBanana download or a custom
 * import would leave it:
 *  - in place (metadata only, no file op) when the VPK already sits in a slot
 *    Grimoire scans: a `pakNN_dir.vpk` in an addon root for enabled mods, a
 *    `*_dir.vpk` in `.disabled` for disabled ones. That is the shared-folder
 *    case with DMM's default profile.
 *  - copied otherwise: into the next free pakNN slot (enabled) or `.disabled`
 *    (disabled). Source files are never moved or deleted.
 * Unselected variants (`selected: false`) are kept as disabled VPKs of the
 * same mod, so Grimoire's variant switching can pick them later.
 *
 * Guards carried over from the DMM migration incident (see
 * dmmMigration.guards.test.ts): already-managed submissions are skipped,
 * submission ids the local catalog does not know are never stamped, byte-
 * identical files are not duplicated, Grimoire-managed slots are never re-
 * tagged, DMM claims older than the file they point at are ignored, and the
 * sidecar is backed up lazily before the first write.
 */

import { basename, dirname, join, resolve } from 'path';
import { promises as fs, constants as fsConstants, existsSync } from 'fs';

import { getAddonFolderPaths, getDisabledPath, metaKeyFor } from '../deadlock';
import { assertVpkSafety } from '../modSafety';
import {
  allocateEnabledVpkPath,
  generateModId,
  makeDisabledFileName,
  runExclusiveModMutation,
} from '../mods';
import {
  backupMetadataSidecar,
  getModMetadata,
  hashFileSha256,
  loadMetadata,
  removeModMetadata,
  setModMetadataWithHash,
  type ModMetadata,
} from '../metadata';
import type {
  InterchangeDocument,
  InterchangeEntryStatus,
  InterchangeImportReport,
  InterchangeImportResult,
  InterchangeMod,
} from '../../../../src/lib/modInterchange';
import { dmmExtensionOf } from './dmmReader';

/** Tolerance when comparing a VPK's mtime against the mtime of the DMM record
 *  that claims it (filesystems and DMM's deploy-then-save ordering can put
 *  them within the same second). */
const STALE_CLAIM_SLACK_MS = 2000;

export interface InterchangeImportOptions {
  deadlockPath: string;
  /** Import only these keys; all when omitted. */
  keys?: string[];
  /** Dry run: decide what would happen, write nothing. */
  planOnly?: boolean;
  /** Validates a GameBanana submission id against the local catalog. Omitted
   *  = catalog unavailable, check skipped. */
  isKnownSubmission?: (submissionId: number) => boolean;
  /** Tag for the metadata sidecar backup. */
  backupTag?: string;
  /** Called before each mod is processed, and once more when done. */
  onProgress?: (current: number, total: number, name: string) => void;
}

export interface InterchangeImportOutcome
  extends Pick<InterchangeImportReport, 'results' | 'warnings'> {
  /** Entries that pass the identity filters, i.e. what the import will try. */
  adoptable: InterchangeMod[];
  /** Entry key -> filter decision, for previews. */
  status: Record<string, InterchangeEntryStatus>;
}

const gameBananaIdOf = (mod: InterchangeMod): number | undefined =>
  mod.origin.provider === 'gamebanana' ? Number(mod.origin.submissionId) : undefined;

function stripArchiveExt(name: string): string {
  return name.replace(/\.(zip|7z|rar|tar|gz|vpk)$/i, '');
}

function metadataFor(mod: InterchangeMod): ModMetadata {
  const gb = mod.origin.provider === 'gamebanana' ? mod.origin : null;
  const thumbnail = mod.thumbnailUrl && /^https?:\/\//i.test(mod.thumbnailUrl) ? mod.thumbnailUrl : undefined;
  return {
    modName: mod.name,
    author: mod.author ?? undefined,
    gameBananaId: gb ? Number(gb.submissionId) : undefined,
    gameBananaFileId: gb?.fileId,
    categoryName: mod.category ?? undefined,
    thumbnailUrl: thumbnail,
    sourceFileName: gb?.fileName ? stripArchiveExt(gb.fileName) : undefined,
    sourceSection: gb ? (gb.submissionType === 'sound' ? 'Sound' : 'Mod') : undefined,
    nsfw: mod.nsfw ?? undefined,
    // Stash the source load-order slot so a later enable (for disabled
    // adoptions) can try to restore the position. Harmless on enabled ones.
    lastPriority: mod.order,
    // Deliberately no lockerHero/globalType: enrichMod infers them from the VPK.
  };
}

/** Collapse a name to lowercase alphanumerics for fuzzy comparison. */
function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Whether the on-disk filename resembles the record's own name for the mod.
 *  Rescues legitimate adoptions whose mtime corroboration fails because the
 *  files were copied to a new drive or machine (copies refresh mtimes). */
function nameCorroborates(fileName: string, mod: InterchangeMod): boolean {
  let stem = fileName.replace(/_dir\.vpk$/i, '').replace(/\.vpk$/i, '');
  stem = stem.replace(/^pak\d{2}_?/i, '');
  const normalizedStem = normalizeForMatch(stem);
  if (normalizedStem.length < 5) return false;
  const sourceFileName = mod.origin.provider === 'gamebanana' ? mod.origin.fileName : undefined;
  for (const candidate of [mod.name, sourceFileName]) {
    if (!candidate) continue;
    const normalized = normalizeForMatch(stripArchiveExt(candidate));
    if (normalized.length < 5) continue;
    if (normalizedStem.includes(normalized) || normalized.includes(normalizedStem)) return true;
  }
  return false;
}

/**
 * Staleness guard for DMM claims. DMM's records claim shared pakNN/.disabled
 * slots by bare path, and Grimoire reuses those exact slots, so a record written
 * long ago can now point at a completely different mod. A claim is trusted only
 * when the file is provably the one DMM recorded: DMM's id prefix is on the
 * file, it came from DMM's id-keyed download cache, it is not newer than the
 * record, or its name matches the mod. Documents from other sources (bundles)
 * carry no claim and are always trusted.
 */
async function claimCorroborated(src: string, mod: InterchangeMod): Promise<boolean> {
  const dmm = dmmExtensionOf(mod);
  if (!dmm) return true;
  const name = basename(src);
  if (name.toLowerCase().startsWith(`${dmm.dmmId.toLowerCase()}_`)) return true;
  if (mod.origin.provider === 'gamebanana' && name.startsWith(`${mod.origin.submissionId}_`)) return true;
  if (dmm.storeFiles.some((p) => resolve(p) === resolve(src))) return true;
  if (dmm.claimMtimeMs > 0) {
    try {
      const stat = await fs.stat(src);
      if (stat.mtimeMs <= dmm.claimMtimeMs + STALE_CLAIM_SLACK_MS) return true;
    } catch {
      return false;
    }
  }
  return nameCorroborates(name, mod);
}

/** Whether `src` is already a live, engine-loadable enabled slot: a `*_dir.vpk`
 *  sitting directly in one of Grimoire's addon roots. Only such a file can be
 *  adopted in place as enabled; anything else is promoted into a real slot. */
function isLiveEnabledSlot(src: string, addonRoots: string[]): boolean {
  if (!/^pak\d{2,3}_dir\.vpk$/i.test(basename(src))) return false;
  const parent = resolve(dirname(src));
  return addonRoots.some((root) => resolve(root) === parent);
}

/** Whether `src` is already a valid disabled slot: a `*_dir.vpk` directly in
 *  Grimoire's `.disabled` folder. Adopted by metadata only, no move. */
function isLiveDisabledSlot(src: string, disabledPath: string): boolean {
  if (!basename(src).toLowerCase().endsWith('_dir.vpk')) return false;
  return resolve(dirname(src)) === resolve(disabledPath);
}

/** Whether a metadata entry shows Grimoire already manages this VPK. Adopting
 *  over such an entry in place would hijack a real mod's identity. */
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

export async function importInterchange(
  document: InterchangeDocument,
  opts: InterchangeImportOptions
): Promise<InterchangeImportOutcome> {
  const wanted = opts.keys ? new Set(opts.keys) : null;
  const selected = document.mods.filter((mod) => !wanted || wanted.has(mod.key));
  const results: InterchangeImportResult[] = [];
  const warnings: string[] = [];
  const status: Record<string, InterchangeEntryStatus> = {};

  // Idempotency + validity filters run BEFORE anything is written, so a
  // preview and the real import agree, and a re-run is a no-op for
  // everything imported last time.
  const allMetadata = loadMetadata();
  // Existing file per identity, so skipped entries can still be resolved to
  // the VPK Grimoire already has (profiles reference them).
  const managedSubmissionIds = new Map<number, string>();
  const managedHashes = new Map<string, string>();
  for (const [metaKey, meta] of Object.entries(allMetadata)) {
    if (meta.gameBananaId !== undefined && !managedSubmissionIds.has(meta.gameBananaId)) {
      managedSubmissionIds.set(meta.gameBananaId, metaKey);
    }
    if (meta.sha256) managedHashes.set(meta.sha256.toLowerCase(), metaKey);
  }

  const adoptable: InterchangeMod[] = [];
  let unknownToCatalog = 0;
  for (const mod of selected) {
    const gbId = gameBananaIdOf(mod);
    if (gbId !== undefined && managedSubmissionIds.has(gbId)) {
      status[mod.key] = 'managed';
      const existing = managedSubmissionIds.get(gbId)!;
      results.push({
        key: mod.key,
        name: mod.name,
        status: 'skipped',
        reason: 'already managed by Grimoire (submission id present in metadata)',
        installedAs: existing,
        modId: generateModId(existing),
      });
    } else if (gbId !== undefined && opts.isKnownSubmission && !opts.isKnownSubmission(gbId)) {
      status[mod.key] = 'unknown-catalog';
      unknownToCatalog++;
      results.push({
        key: mod.key,
        name: mod.name,
        status: 'skipped',
        reason:
          'submission id not found in the local GameBanana catalog (wrong id or catalog out of date); left for manual identification',
      });
    } else {
      status[mod.key] = 'new';
      adoptable.push(mod);
    }
  }
  if (unknownToCatalog > 0) {
    warnings.push(
      `${unknownToCatalog} mod(s) skipped: their submission id is not in the local GameBanana catalog.`
    );
  }
  if (opts.planOnly) return { results, warnings, adoptable, status };

  // Recoverability: back up the metadata sidecar lazily, right before the
  // first identity write, so a run that only hits skips never rotates the
  // real pre-import backup out of the kept set.
  let sidecarBackedUp = false;
  const backupSidecarOnce = () => {
    if (sidecarBackedUp) return;
    sidecarBackedUp = true;
    const backupPath = backupMetadataSidecar(opts.backupTag ?? 'pre-interchange-import');
    if (backupPath) console.log(`[Interchange] metadata sidecar backed up to ${backupPath}`);
  };

  // Enabled mods first, ascending load order, so sequential slot allocation
  // (pak01, pak02, ...) preserves the source order; then disabled mods.
  const ordered = [...adoptable].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return a.order - b.order;
  });

  const addonRoots = getAddonFolderPaths(opts.deadlockPath);
  const disabledPath = getDisabledPath(opts.deadlockPath);

  await runExclusiveModMutation(async () => {
    const disabledTaken = new Set<string>(
      existsSync(disabledPath) ? (await fs.readdir(disabledPath)).map((n) => n.toLowerCase()) : []
    );

    for (const [index, mod] of ordered.entries()) {
      opts.onProgress?.(index, ordered.length, mod.name);
      let alreadyHave: string | undefined;
      const meta = metadataFor(mod);
      const adoptedKeys: string[] = [];
      const fileSkips: string[] = [];
      const hasSelection = mod.files.some((f) => f.selected !== false);

      for (const file of mod.files) {
        const src = file.path;
        const label = file.name || basename(src);
        // Unselected variants are kept, but never loaded.
        const wantEnabled = mod.enabled && (file.selected !== false || !hasSelection);
        if (!existsSync(src)) {
          fileSkips.push(`${label} (not found on disk)`);
          continue;
        }
        if (!(await claimCorroborated(src, mod))) {
          fileSkips.push(
            `${label} (file is newer than the DMM record claiming it; possibly a reused slot, left for manual identification)`
          );
          continue;
        }

        let srcHash: string;
        try {
          srcHash = (await hashFileSha256(src)).toLowerCase();
        } catch (err) {
          fileSkips.push(`${label} (${err instanceof Error ? err.message : String(err)})`);
          continue;
        }
        if (managedHashes.has(srcHash)) {
          alreadyHave ??= managedHashes.get(srcHash);
          fileSkips.push(`${label} (an identical file is already managed by Grimoire)`);
          continue;
        }

        try {
          await assertVpkSafety(src, { context: 'installation', name: mod.name });
          let destPath: string;
          if (wantEnabled && isLiveEnabledSlot(src, addonRoots)) {
            destPath = src;
            const existing = getModMetadata(metaKeyFor(destPath));
            if (existing && isGrimoireManaged(existing)) {
              fileSkips.push(`${label} (already managed by Grimoire)`);
              continue;
            }
          } else if (wantEnabled) {
            // Must write before the next allocation so the slot scan sees it taken.
            destPath = await allocateEnabledVpkPath(opts.deadlockPath);
            await fs.copyFile(src, destPath, fsConstants.COPYFILE_EXCL);
          } else if (isLiveDisabledSlot(src, disabledPath)) {
            destPath = src;
            const existing = getModMetadata(metaKeyFor(destPath));
            if (existing && isGrimoireManaged(existing)) {
              fileSkips.push(`${label} (already managed by Grimoire)`);
              continue;
            }
          } else {
            const disabledName = makeDisabledFileName(basename(src), disabledTaken, mod.name);
            disabledTaken.add(disabledName.toLowerCase());
            if (!existsSync(disabledPath)) await fs.mkdir(disabledPath, { recursive: true });
            destPath = join(disabledPath, disabledName);
            await fs.copyFile(src, destPath, fsConstants.COPYFILE_EXCL);
          }

          const metaKey = metaKeyFor(destPath);
          // Clear any orphaned sidecar entry at this key first: an allocated slot
          // is only guaranteed free on disk, so a stale entry from a deleted mod
          // could otherwise bleed its fields into this one.
          backupSidecarOnce();
          removeModMetadata(metaKey);
          await setModMetadataWithHash(metaKey, meta, destPath);
          managedHashes.set(srcHash, metaKey);
          adoptedKeys.push(metaKey);
        } catch (err) {
          fileSkips.push(`${label} (${err instanceof Error ? err.message : String(err)})`);
        }
      }

      const local = mod.origin.provider === 'local';
      if (adoptedKeys.length > 0) {
        results.push({
          key: mod.key,
          name: mod.name,
          status: 'imported',
          installedAs: adoptedKeys[0],
          modId: generateModId(adoptedKeys[0]),
          local,
          reason: fileSkips.length > 0 ? fileSkips.join('; ') : undefined,
        });
      } else {
        results.push({
          key: mod.key,
          name: mod.name,
          status: 'skipped',
          reason: fileSkips.length > 0 ? fileSkips.join('; ') : 'no usable VPK files',
          installedAs: alreadyHave,
          modId: alreadyHave ? generateModId(alreadyHave) : undefined,
        });
      }
    }
  });

  opts.onProgress?.(ordered.length, ordered.length, '');
  const adopted = results.filter((r) => r.status === 'imported').length;
  console.log(
    `[Interchange] ${document.source.manager} -> Grimoire: ${adopted} adopted, ` +
      `${results.length - adopted} skipped`
  );
  for (const r of results.filter((r) => r.status !== 'imported')) {
    console.log(`[Interchange]   skipped ${r.key}: ${r.reason}`);
  }
  return { results, warnings, adoptable, status };
}
