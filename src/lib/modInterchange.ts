/**
 * The manager-neutral "Deadlock Mod Interchange" document (docs/mod-interchange.md).
 *
 * Grimoire and Deadlock Mod Manager (DMM) both speak it, so a transfer is
 * always reader -> interchange -> importer, and a third mod manager only has
 * to implement those same adapters to join. This module is the pure part
 * (types + lenient parsing), shared by the main process and the renderer.
 */

export const INTERCHANGE_FORMAT = 'deadlock-mod-interchange';
export const INTERCHANGE_VERSION = 1;
export const INTERCHANGE_MANIFEST = 'mod-interchange.json';

export interface InterchangeFile {
  /** Plain file name, `*.vpk`. */
  name: string;
  /** Relative to the manifest in a bundle; absolute in a live reader's output. */
  path: string;
  sha256?: string;
  size?: number;
  /** false = an alternative variant that is kept but not loaded. */
  selected?: boolean;
}

export type InterchangeOrigin =
  | {
      provider: 'gamebanana';
      submissionType: 'mod' | 'sound';
      submissionId: string;
      fileId?: number;
      fileName?: string;
    }
  | { provider: 'local'; localId?: string };

export interface InterchangeMod {
  key: string;
  name: string;
  enabled: boolean;
  order: number;
  origin: InterchangeOrigin;
  author?: string | null;
  description?: string | null;
  category?: string | null;
  hero?: string | null;
  thumbnailUrl?: string | null;
  link?: string | null;
  nsfw?: boolean | null;
  files: InterchangeFile[];
  extensions?: Record<string, Record<string, unknown>>;
}

export interface InterchangeProfileMod {
  modKey: string;
  enabled: boolean;
  order: number;
}

/** Optional section: only managers with profiles produce it. */
export interface InterchangeProfile {
  key: string;
  name: string;
  active: boolean;
  description?: string | null;
  mods: InterchangeProfileMod[];
  crosshairKey?: string | null;
  autoexec?: string[] | null;
}

/** Optional section: a crosshair as the game's own `citadel_crosshair_*`
 *  convars, so no manager-specific model leaks into the format. */
export interface InterchangeCrosshair {
  key: string;
  name: string;
  active: boolean;
  convars: Record<string, string>;
}

export type InterchangeSection = 'mods' | 'profiles' | 'crosshairs';

export interface InterchangeDocument {
  format: typeof INTERCHANGE_FORMAT;
  version: number;
  createdAt?: string;
  source: { manager: string; managerVersion?: string; profileName?: string };
  /** Sections the producer included. */
  contents: InterchangeSection[];
  mods: InterchangeMod[];
  profiles: InterchangeProfile[];
  crosshairs: InterchangeCrosshair[];
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const optString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

export function newInterchangeDocument(
  source: InterchangeDocument['source']
): InterchangeDocument {
  return {
    format: INTERCHANGE_FORMAT,
    version: INTERCHANGE_VERSION,
    createdAt: new Date().toISOString(),
    source,
    contents: ['mods'],
    mods: [],
    profiles: [],
    crosshairs: [],
    warnings: [],
  };
}

/** Mark a section as present (idempotent). */
export function includeSection(document: InterchangeDocument, section: InterchangeSection): void {
  if (!document.contents.includes(section)) document.contents.push(section);
}

/** A profile may only reference mods the document carries; dangling entries
 *  are dropped with a warning, never guessed. */
export function dropDanglingProfileEntries(document: InterchangeDocument): void {
  const keys = new Set(document.mods.map((m) => m.key));
  for (const profile of document.profiles) {
    const before = profile.mods.length;
    profile.mods = profile.mods.filter((entry) => keys.has(entry.modKey));
    const dropped = before - profile.mods.length;
    if (dropped > 0) {
      document.warnings.push(
        `Profile ${profile.name}: ${dropped} entry(s) point at mods that are not available`
      );
    }
  }
}

function parseProfile(raw: unknown): InterchangeProfile | string {
  if (!isObject(raw)) return 'not an object';
  const key = optString(raw.key);
  const name = optString(raw.name);
  if (!key) return 'it has no key';
  if (!name) return `${key} has no name`;
  const mods = (Array.isArray(raw.mods) ? raw.mods : [])
    .filter(isObject)
    .flatMap((entry, index) => {
      const modKey = optString(entry.modKey);
      if (!modKey) return [];
      return [
        {
          modKey,
          enabled: entry.enabled === true,
          order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : index,
        },
      ];
    });
  const autoexec = Array.isArray(raw.autoexec)
    ? raw.autoexec.filter((c): c is string => typeof c === 'string')
    : null;
  return {
    key,
    name,
    active: raw.active === true,
    description: optString(raw.description) ?? null,
    mods,
    crosshairKey: optString(raw.crosshairKey) ?? null,
    autoexec: autoexec && autoexec.length > 0 ? autoexec : null,
  };
}

function parseCrosshair(raw: unknown): InterchangeCrosshair | string {
  if (!isObject(raw)) return 'not an object';
  const key = optString(raw.key);
  if (!key) return 'it has no key';
  const convars: Record<string, string> = {};
  if (isObject(raw.convars)) {
    for (const [name, value] of Object.entries(raw.convars)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        convars[name] = String(value);
      }
    }
  }
  return { key, name: optString(raw.name) ?? key, active: raw.active === true, convars };
}

function parseSection<T extends { key: string }>(
  raw: unknown,
  label: string,
  parse: (entry: unknown) => T | string,
  warnings: string[]
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw) ? raw : []).forEach((entry, index) => {
    const parsed = parse(entry);
    if (typeof parsed === 'string') warnings.push(`Skipped ${label} #${index}: ${parsed}`);
    else if (seen.has(parsed.key)) warnings.push(`Skipped duplicate ${label} key ${parsed.key}`);
    else {
      seen.add(parsed.key);
      out.push(parsed);
    }
  });
  return out;
}

/** A value is usable as a file name only if it is one plain `*.vpk` component. */
export function isPlainVpkName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes('/') &&
    !name.includes('\\') &&
    name !== '.' &&
    name !== '..' &&
    name.toLowerCase().endsWith('.vpk')
  );
}

export function gameBananaKey(submissionType: 'mod' | 'sound', submissionId: string | number): string {
  return `gamebanana:${submissionType}:${submissionId}`;
}

function parseOrigin(raw: unknown): InterchangeOrigin | null {
  if (!isObject(raw)) return null;
  if (raw.provider === 'gamebanana') {
    const id = typeof raw.submissionId === 'number' ? String(raw.submissionId) : raw.submissionId;
    if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)) return null;
    const submissionType = raw.submissionType === 'sound' ? 'sound' : 'mod';
    const fileId =
      typeof raw.fileId === 'number' && Number.isSafeInteger(raw.fileId) && raw.fileId > 0
        ? raw.fileId
        : undefined;
    return { provider: 'gamebanana', submissionType, submissionId: id, fileId, fileName: optString(raw.fileName) };
  }
  if (raw.provider === 'local') {
    return { provider: 'local', localId: optString(raw.localId) };
  }
  return null;
}

function parseFile(raw: unknown): InterchangeFile | null {
  if (!isObject(raw)) return null;
  const name = optString(raw.name);
  const path = optString(raw.path);
  if (!name || !path) return null;
  return {
    name,
    path,
    sha256: optString(raw.sha256),
    size: typeof raw.size === 'number' && raw.size >= 0 ? raw.size : undefined,
    selected: typeof raw.selected === 'boolean' ? raw.selected : undefined,
  };
}

function parseMod(raw: unknown): InterchangeMod | string {
  if (!isObject(raw)) return 'not an object';
  const key = optString(raw.key);
  const name = optString(raw.name);
  if (!key) return 'it has no key';
  if (!name) return `${key} has no name`;
  const origin = parseOrigin(raw.origin);
  if (!origin) return `${name} has an unsupported origin`;
  const files = (Array.isArray(raw.files) ? raw.files : [])
    .map(parseFile)
    .filter((f): f is InterchangeFile => f !== null);
  const text = (field: string) => optString(raw[field]) ?? null;
  return {
    key,
    name,
    enabled: raw.enabled === true,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 0,
    origin,
    author: text('author'),
    description: text('description'),
    category: text('category'),
    hero: text('hero'),
    thumbnailUrl: text('thumbnailUrl'),
    link: text('link'),
    nsfw: typeof raw.nsfw === 'boolean' ? raw.nsfw : null,
    files,
    extensions: isObject(raw.extensions)
      ? (raw.extensions as Record<string, Record<string, unknown>>)
      : undefined,
  };
}

/**
 * Parse a document leniently: the envelope must be valid, but one broken mod
 * entry only costs that entry (as a warning), never the whole import.
 * Untrusted input: throws a message the import UI can show verbatim.
 */
export function parseInterchangeDocument(text: string): InterchangeDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${INTERCHANGE_MANIFEST} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!isObject(raw)) throw new Error(`${INTERCHANGE_MANIFEST} must be a JSON object`);
  if (raw.format !== INTERCHANGE_FORMAT) {
    throw new Error(
      `Not a mod interchange document (format is "${String(raw.format)}", expected "${INTERCHANGE_FORMAT}")`
    );
  }
  if (typeof raw.version !== 'number' || raw.version < 1 || raw.version > INTERCHANGE_VERSION) {
    throw new Error(
      `Unsupported interchange version ${String(raw.version)} (this build understands ${INTERCHANGE_VERSION})`
    );
  }

  const warnings = (Array.isArray(raw.warnings) ? raw.warnings : []).filter(
    (w): w is string => typeof w === 'string'
  );
  const mods: InterchangeMod[] = [];
  const seen = new Set<string>();
  (Array.isArray(raw.mods) ? raw.mods : []).forEach((entry, index) => {
    const parsed = parseMod(entry);
    if (typeof parsed === 'string') {
      warnings.push(`Skipped mod #${index}: ${parsed}`);
    } else if (seen.has(parsed.key)) {
      warnings.push(`Skipped duplicate mod key ${parsed.key}`);
    } else {
      seen.add(parsed.key);
      mods.push(parsed);
    }
  });

  const source = isObject(raw.source) ? raw.source : {};
  const document: InterchangeDocument = {
    format: INTERCHANGE_FORMAT,
    version: raw.version,
    createdAt: optString(raw.createdAt),
    source: {
      manager: optString(source.manager) ?? 'unknown',
      managerVersion: optString(source.managerVersion),
      profileName: optString(source.profileName),
    },
    contents: ['mods'],
    mods,
    profiles: parseSection(raw.profiles, 'profile', parseProfile, warnings),
    crosshairs: parseSection(raw.crosshairs, 'crosshair', parseCrosshair, warnings),
    warnings,
  };
  dropDanglingProfileEntries(document);
  if (document.profiles.length > 0) includeSection(document, 'profiles');
  if (document.crosshairs.length > 0) includeSection(document, 'crosshairs');
  return document;
}

// --- Wire types for the renderer <-> main IPC -------------------------------

export type InterchangeSourceRequest =
  | {
      kind: 'manager';
      /** Registry id of the mod manager, e.g. `deadlock-mod-manager`. */
      id: string;
      /** A folder the user picked when auto-detection failed. */
      location?: string;
    }
  | { kind: 'bundle'; path: string };

/** A mod manager Grimoire can read directly from disk. */
export interface InterchangeSourceInfo {
  id: string;
  name: string;
  found: boolean;
  location: string | null;
  sections: InterchangeSection[];
  searched: string[];
}

export type InterchangeEntryStatus = 'new' | 'managed' | 'unknown-catalog';

export interface InterchangePreview {
  document: InterchangeDocument;
  /** Per key: whether Grimoire already has it or would reject it. */
  status: Record<string, InterchangeEntryStatus>;
}

export interface InterchangeImportSelection {
  modKeys: string[];
  profileKeys: string[];
  crosshairKeys: string[];
}

export interface InterchangeImportResult {
  key: string;
  name: string;
  status: 'imported' | 'skipped' | 'failed';
  reason?: string;
  installedAs?: string;
  /** Every adopted VPK a profile loads for this mod (multi-VPK mods have
   *  several); unselected variants are left out. */
  installedKeys?: string[];
  /** Grimoire mod id of the (first) adopted VPK. */
  modId?: string;
  /** True when the mod arrived without a GameBanana identity. */
  local?: boolean;
}

export interface InterchangeImportReport {
  results: InterchangeImportResult[];
  profiles: Array<{ name: string; created: boolean; mods: number; reason?: string }>;
  crosshairs: number;
  warnings: string[];
}

export interface InterchangeProgress {
  stage: 'mods' | 'profiles' | 'crosshairs';
  current: number;
  total: number;
  name: string;
}

export interface InterchangeExportSelection {
  profiles: boolean;
  crosshairs: boolean;
}

export interface InterchangeExportReport {
  bundlePath: string;
  exported: number;
  profiles: number;
  crosshairs: number;
  skipped: Array<{ name: string; reason: string }>;
}
