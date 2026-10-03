/**
 * The full interchange import the wizard runs: the chosen mods, then the
 * chosen profiles, then crosshairs. Each section is optional, so a source
 * without profiles (or an import that skips them) simply leaves them out.
 *
 * Grimoire profiles are snapshots of which installed VPKs are enabled, so a
 * profile can only point at mods Grimoire has. Mods a selected profile needs
 * are therefore imported too, disabled unless the library selection enables
 * them; a profile entry whose mod could not be imported is dropped, never
 * replaced by a guess.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';

import { getUserDataPath } from '../../utils/paths';
import { getModMetadata } from '../metadata';
import { addProfile, generateProfileId, loadProfiles } from '../profiles';
import {
  crosshairSettingsFromConvars,
  normalizeCrosshairSettings,
} from '../../../../src/lib/crosshair';
import type {
  InterchangeDocument,
  InterchangeImportReport,
  InterchangeImportSelection,
  InterchangeProgress,
} from '../../../../src/lib/modInterchange';
import type { CrosshairPreset, ProfileMod } from '../../../../src/types/electron';
import { importInterchange, type InterchangeImportOptions } from './importer';

export interface SelectionImportOptions
  extends Omit<InterchangeImportOptions, 'keys' | 'planOnly' | 'onProgress'> {
  onProgress?: (progress: InterchangeProgress) => void;
}

/** `name`, or `name (2)`, `name (3)` ... when a profile already uses it. */
export function uniqueName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  const base = name.trim() || 'Imported profile';
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

interface PresetsFile {
  presets: CrosshairPreset[];
  activePresetId: string | null;
}

function presetsPath(): string {
  return join(getUserDataPath(), 'crosshair-presets.json');
}

function loadPresets(): PresetsFile {
  try {
    if (existsSync(presetsPath())) {
      const parsed = JSON.parse(readFileSync(presetsPath(), 'utf-8')) as Partial<PresetsFile>;
      return {
        presets: Array.isArray(parsed.presets) ? parsed.presets : [],
        activePresetId: parsed.activePresetId ?? null,
      };
    }
  } catch (err) {
    console.warn('[Interchange] crosshair presets unreadable, starting fresh:', err);
  }
  return { presets: [], activePresetId: null };
}

export async function importInterchangeSelection(
  document: InterchangeDocument,
  selection: InterchangeImportSelection,
  opts: SelectionImportOptions
): Promise<InterchangeImportReport> {
  const profiles = document.profiles.filter((p) => selection.profileKeys.includes(p.key));
  const libraryKeys = new Set(selection.modKeys);
  const profileOnly = new Set(
    profiles.flatMap((p) => p.mods.map((m) => m.modKey)).filter((key) => !libraryKeys.has(key))
  );
  const scoped: InterchangeDocument = {
    ...document,
    mods: document.mods.map((mod) => (profileOnly.has(mod.key) ? { ...mod, enabled: false } : mod)),
  };

  const outcome = await importInterchange(scoped, {
    ...opts,
    keys: [...libraryKeys, ...profileOnly],
    onProgress: (current, total, name) =>
      opts.onProgress?.({ stage: 'mods', current, total, name }),
  });
  const installedAs = new Map(
    outcome.results
      .filter((r) => r.installedAs)
      .map((r) => [r.key, r.installedKeys?.length ? r.installedKeys : [r.installedAs as string]])
  );

  const report: InterchangeImportReport = {
    results: outcome.results,
    profiles: [],
    crosshairs: 0,
    warnings: [...outcome.warnings],
  };

  const crosshairsByKey = new Map(document.crosshairs.map((c) => [c.key, c]));
  const takenNames = loadProfiles().map((p) => p.name);
  for (const [index, profile] of profiles.entries()) {
    opts.onProgress?.({ stage: 'profiles', current: index, total: profiles.length, name: profile.name });
    const mods: ProfileMod[] = [];
    let dropped = 0;
    // Grimoire profiles list the files to turn on, in load order. Entries are
    // matched back by GameBanana ids, then by content hash (the only stable
    // identity a local mod has), so both are recorded with the file name.
    const ordered = [...profile.mods].sort((a, b) => a.order - b.order);
    for (const [position, entry] of ordered.entries()) {
      const metaKeys = installedAs.get(entry.modKey);
      if (!metaKeys) {
        dropped++;
        continue;
      }
      for (const metaKey of metaKeys) {
        const meta = getModMetadata(metaKey);
        mods.push({
          fileName: basename(metaKey),
          enabled: entry.enabled,
          priority: position,
          ...(meta?.gameBananaId !== undefined ? { gameBananaId: meta.gameBananaId } : {}),
          ...(meta?.gameBananaFileId !== undefined ? { gameBananaFileId: meta.gameBananaFileId } : {}),
          ...(meta?.sha256 ? { sha256: meta.sha256.toLowerCase() } : {}),
        });
      }
    }
    const name = uniqueName(profile.name, takenNames);
    takenNames.push(name);
    const crosshairConvars = profile.crosshairKey
      ? crosshairsByKey.get(profile.crosshairKey)?.convars
      : undefined;
    const crosshair = crosshairConvars ? crosshairSettingsFromConvars(crosshairConvars) : null;
    const now = new Date().toISOString();
    try {
      addProfile({
        id: generateProfileId(),
        name,
        mods,
        ...(crosshair ? { crosshair } : {}),
        ...(profile.autoexec?.length ? { autoexecCommands: profile.autoexec } : {}),
        createdAt: now,
        updatedAt: now,
      });
      report.profiles.push({
        name,
        created: true,
        mods: mods.length,
        reason: dropped > 0 ? `${dropped} mod(s) could not be imported and were left out` : undefined,
      });
    } catch (err) {
      report.profiles.push({
        name,
        created: false,
        mods: 0,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const crosshairs = document.crosshairs.filter((c) => selection.crosshairKeys.includes(c.key));
  if (crosshairs.length > 0) {
    const file = loadPresets();
    const existing = new Set(
      file.presets.map((p) => JSON.stringify(normalizeCrosshairSettings(p.settings)))
    );
    crosshairs.forEach((crosshair, index) => {
      opts.onProgress?.({
        stage: 'crosshairs',
        current: index,
        total: crosshairs.length,
        name: crosshair.name,
      });
      const settings = crosshairSettingsFromConvars(crosshair.convars);
      if (!settings) return;
      const fingerprint = JSON.stringify(settings);
      if (existing.has(fingerprint)) return;
      existing.add(fingerprint);
      file.presets.push({
        id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
        name: uniqueName(
          crosshair.name,
          file.presets.map((p) => p.name)
        ),
        settings,
        thumbnail: '',
        createdAt: new Date().toISOString(),
      });
      report.crosshairs++;
    });
    if (report.crosshairs > 0) writeFileSync(presetsPath(), JSON.stringify(file, null, 2));
  }

  return report;
}
