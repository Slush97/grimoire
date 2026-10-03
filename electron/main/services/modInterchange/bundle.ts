/**
 * Interchange bundles on disk: reading one produced by any mod manager, and
 * exporting Grimoire's own library as one (Grimoire -> interchange exporter).
 *
 * A bundle is a folder holding `mod-interchange.json` plus the VPKs it lists,
 * with paths relative to the manifest (docs/mod-interchange.md).
 */

import { app } from 'electron';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { existsSync, promises as fs, readFileSync, statSync } from 'fs';

import { scanMods } from '../mods';
import { loadProfiles } from '../profiles';
import { loadSettings } from '../settings';
import { getUserDataPath } from '../../utils/paths';
import { crosshairConvarsFromSettings } from '../../../../src/lib/crosshair';
import { hashFileSha256, loadMetadata, type ModMetadata } from '../metadata';
import { resolveVpkIdentity } from '../vpkIdentity';
import {
  INTERCHANGE_MANIFEST,
  dropDanglingProfileEntries,
  gameBananaKey,
  includeSection,
  isPlainVpkName,
  newInterchangeDocument,
  parseInterchangeDocument,
  type InterchangeDocument,
  type InterchangeExportReport,
  type InterchangeExportSelection,
  type InterchangeFile,
  type InterchangeMod,
  type InterchangeProgress,
} from '../../../../src/lib/modInterchange';

export const GRIMOIRE_MANAGER_ID = 'grimoire';

/** Accepts the bundle folder or the manifest path itself. */
export function manifestPathFor(path: string): string {
  try {
    if (statSync(path).isDirectory()) return join(path, INTERCHANGE_MANIFEST);
  } catch {
    // Not there: let the read below report it.
  }
  return path;
}

/** Read a bundle and rewrite its file paths to absolute ones. Paths that are
 *  absolute or leave the bundle folder are dropped with a warning, so a
 *  crafted manifest can never make the importer read files elsewhere. */
export async function readInterchangeBundle(path: string): Promise<InterchangeDocument> {
  const manifestPath = manifestPathFor(path);
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf-8');
  } catch (err) {
    throw new Error(
      `Could not read ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  const document = parseInterchangeDocument(text);
  const base = resolve(dirname(manifestPath));
  for (const mod of document.mods) {
    mod.files = mod.files.filter((file) => {
      const target = resolve(base, file.path);
      const rel = relative(base, target);
      if (isAbsolute(file.path) || rel.startsWith('..') || isAbsolute(rel)) {
        document.warnings.push(`${mod.name}: ignored file path outside the bundle (${file.path})`);
        return false;
      }
      file.path = target;
      return true;
    });
  }
  return document;
}

const GENERATED_FLAGS: Array<keyof ModMetadata> = [
  'lockerCosmetics',
  'lockerSounds',
  'lockerColors',
  'lockerTrippySkins',
];

function slugify(value: string, max = 40): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/, '');
}

function folderIndex(path: string): number {
  const match = basename(dirname(path)).match(/^addons(\d+)$/i);
  return match ? parseInt(match[1], 10) : 0;
}

interface ExportItem {
  path: string;
  metaKey: string;
  fileName: string;
  enabled: boolean;
  loadPosition: number;
  meta?: ModMetadata;
  sha256: string;
  size: number;
}

/** Export Grimoire's library (enabled and disabled mods) as a bundle inside
 *  `destinationDir`. Variants of one GameBanana submission stay together as
 *  one entry; Locker-generated VPKs are left out. */
export async function exportGrimoireLibrary(
  deadlockPath: string,
  destinationDir: string,
  selection: InterchangeExportSelection = { profiles: true, crosshairs: true },
  onProgress?: (progress: InterchangeProgress) => void
): Promise<InterchangeExportReport> {
  if (!existsSync(destinationDir) || !statSync(destinationDir).isDirectory()) {
    throw new Error(`Export folder does not exist: ${destinationDir}`);
  }
  const metadata = loadMetadata();
  const mods = await scanMods(deadlockPath);
  const skipped: InterchangeExportReport['skipped'] = [];

  const items: ExportItem[] = [];
  let stale = 0;
  for (const mod of mods) {
    let meta: ModMetadata | undefined = metadata[mod.metaKey];
    if (meta && GENERATED_FLAGS.some((flag) => meta?.[flag] !== undefined)) continue;
    try {
      // A sidecar entry whose fingerprint no longer matches the file belongs
      // to whatever used this slot before (another tool reused it). Export
      // the bytes as a local mod rather than under that stale identity.
      if (meta?.sha256) {
        const identity = await resolveVpkIdentity(mod.path);
        if (identity.sha256.toLowerCase() !== meta.sha256.toLowerCase()) {
          meta = undefined;
          stale++;
        }
      }
      items.push({
        path: mod.path,
        metaKey: mod.metaKey,
        fileName: mod.fileName,
        enabled: mod.enabled,
        loadPosition: mod.enabled
          ? folderIndex(mod.path) * 100 + mod.priority
          : 100_000 + (meta?.lastPriority ?? mod.priority),
        meta,
        sha256: (await hashFileSha256(mod.path)).toLowerCase(),
        size: mod.size,
      });
    } catch (err) {
      skipped.push({
        name: meta?.modName ?? mod.fileName,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const warnings: string[] = [];
  if (stale > 0) {
    warnings.push(
      `${stale} file(s) no longer match Grimoire's recorded fingerprint; exported as local mods`
    );
  }

  // Group into interchange entries: one per GameBanana submission, one per
  // distinct local file. Every file name / metaKey maps to its entry so
  // profiles (which store file names) can reference entries.
  const groups = new Map<string, ExportItem[]>();
  const keyByFile = new Map<string, string>();
  for (const item of items) {
    const gbId = item.meta?.gameBananaId;
    const key = gbId
      ? gameBananaKey(item.meta?.sourceSection === 'Sound' ? 'sound' : 'mod', gbId)
      : `local:sha256:${item.sha256}`;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
    keyByFile.set(item.metaKey.toLowerCase(), key);
    keyByFile.set(item.fileName.toLowerCase(), key);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let bundle = join(destinationDir, `grimoire-mods-export-${stamp}`);
  for (let n = 2; existsSync(bundle); n++) {
    bundle = join(destinationDir, `grimoire-mods-export-${stamp}-${n}`);
  }
  await fs.mkdir(join(bundle, 'files'), { recursive: true });

  const document = newInterchangeDocument({
    manager: GRIMOIRE_MANAGER_ID,
    managerVersion: app.getVersion(),
  });
  document.warnings.push(...warnings);

  const entries = [...groups.entries()]
    .map(([key, list]) => {
      list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.loadPosition - b.loadPosition);
      const seen = new Set<string>();
      return { key, list: list.filter((item) => !seen.has(item.sha256) && seen.add(item.sha256)) };
    })
    .sort((a, b) => a.list[0].loadPosition - b.list[0].loadPosition);

  for (const [index, { key, list }] of entries.entries()) {
    onProgress?.({ stage: 'mods', current: index, total: entries.length, name: key });
    const meta = list.find((item) => item.meta)?.meta;
    const first = list[0];
    const name =
      meta?.modName?.trim() ||
      meta?.sourceFileName ||
      first.fileName.replace(/_dir\.vpk$/i, '').replace(/\.vpk$/i, '');
    const enabled = list.some((item) => item.enabled);
    const slug = slugify(name) || 'mod';
    const folder = `${String(index).padStart(4, '0')}-${slug}`;

    const usedNames = new Set<string>();
    const files: InterchangeFile[] = [];
    for (const [fileIndex, item] of list.entries()) {
      let fileName =
        /^pak\d{2,3}_dir\.vpk$/i.test(item.fileName) || !isPlainVpkName(item.fileName)
          ? `${slug}_dir.vpk`
          : item.fileName;
      for (let n = 2; usedNames.has(fileName.toLowerCase()); n++) fileName = `${slug}_${n}_dir.vpk`;
      usedNames.add(fileName.toLowerCase());
      const relativePath = ['files', folder, fileName].join('/');
      await fs.mkdir(join(bundle, 'files', folder), { recursive: true });
      await fs.copyFile(item.path, join(bundle, ...relativePath.split('/')));
      files.push({
        name: fileName,
        path: relativePath,
        sha256: item.sha256,
        size: item.size,
        selected: enabled ? item.enabled : fileIndex === 0,
      });
    }

    const gbId = meta?.gameBananaId;
    const isSound = meta?.sourceSection === 'Sound';
    const mod: InterchangeMod = {
      key,
      name,
      enabled,
      order: index,
      origin: gbId
        ? {
            provider: 'gamebanana',
            submissionType: isSound ? 'sound' : 'mod',
            submissionId: String(gbId),
            fileId: meta?.gameBananaFileId,
            fileName: meta?.sourceFileName,
          }
        : { provider: 'local' },
      author: meta?.author ?? null,
      description: null,
      category: meta?.categoryName ?? null,
      hero: meta?.lockerHero ?? null,
      thumbnailUrl: meta?.thumbnailUrl ?? null,
      link: gbId ? `https://gamebanana.com/${isSound ? 'sounds' : 'mods'}/${gbId}` : null,
      nsfw: meta?.nsfw ?? null,
      files,
      extensions: { [GRIMOIRE_MANAGER_ID]: { metaKeys: list.map((item) => item.metaKey) } },
    };
    document.mods.push(mod);
  }

  onProgress?.({ stage: 'mods', current: entries.length, total: entries.length, name: '' });

  if (selection.profiles) exportProfiles(document, keyByFile);
  if (selection.crosshairs) exportCrosshairPresets(document);
  dropDanglingProfileEntries(document);

  await fs.writeFile(join(bundle, INTERCHANGE_MANIFEST), JSON.stringify(document, null, 2));
  return {
    bundlePath: bundle,
    exported: document.mods.length,
    profiles: document.profiles.length,
    crosshairs: document.crosshairs.length,
    skipped,
  };
}

/** Grimoire profiles reference installed files by GameBanana id (stable) or
 *  file name; both resolve to the exported entry keys. */
function exportProfiles(document: InterchangeDocument, keyByFile: Map<string, string>): void {
  const exported = new Set(document.mods.map((m) => m.key));
  const activeId = loadSettings().activeProfileId;
  for (const profile of loadProfiles()) {
    const mods: InterchangeDocument['profiles'][number]['mods'] = [];
    for (const [index, entry] of profile.mods.entries()) {
      const byId =
        entry.gameBananaId !== undefined
          ? [gameBananaKey('mod', entry.gameBananaId), gameBananaKey('sound', entry.gameBananaId)].find(
              (key) => exported.has(key)
            )
          : undefined;
      const modKey = byId ?? keyByFile.get(entry.fileName.toLowerCase());
      if (!modKey || mods.some((m) => m.modKey === modKey)) continue;
      mods.push({ modKey, enabled: entry.enabled, order: entry.priority ?? index });
    }
    let crosshairKey: string | null = null;
    if (profile.crosshair) {
      crosshairKey = `crosshair:profile:${profile.id}`;
      document.crosshairs.push({
        key: crosshairKey,
        name: `${profile.name} crosshair`,
        active: false,
        convars: crosshairConvarsFromSettings(profile.crosshair),
      });
      includeSection(document, 'crosshairs');
    }
    document.profiles.push({
      key: `profile:${profile.id}`,
      name: profile.name,
      active: profile.id === activeId,
      description: null,
      mods: mods.sort((a, b) => a.order - b.order),
      crosshairKey,
      autoexec: profile.autoexecCommands?.length ? profile.autoexecCommands : null,
    });
  }
  if (document.profiles.length > 0) includeSection(document, 'profiles');
}

function exportCrosshairPresets(document: InterchangeDocument): void {
  const path = join(getUserDataPath(), 'crosshair-presets.json');
  if (!existsSync(path)) return;
  try {
    const file = JSON.parse(readFileSync(path, 'utf-8')) as {
      presets?: Array<{ id: string; name: string; settings: Record<string, unknown> }>;
      activePresetId?: string | null;
    };
    for (const preset of file.presets ?? []) {
      document.crosshairs.push({
        key: `crosshair:preset:${preset.id}`,
        name: preset.name,
        active: preset.id === file.activePresetId,
        convars: crosshairConvarsFromSettings(preset.settings),
      });
    }
    if (document.crosshairs.length > 0) includeSection(document, 'crosshairs');
  } catch (err) {
    document.warnings.push(
      `Crosshair presets could not be read: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
