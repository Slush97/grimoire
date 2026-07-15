import { fingerprintFile } from './fileMatch';
import { crc32File } from './archiveCrc';
import { parseVpkDirectoryCached, readVpkEntryBytes, type VpkEntryStat } from './vpk';
import type { OriginalIdentity } from './vpkIdentity';
import {
    MODINFO_FORMAT,
    MODINFO_SCHEMA_VERSION,
    type ModinfoRecord,
    type ModinfoModRecord,
    type ModinfoMergeRecord,
    type ModinfoIdentity,
    type ModinfoWrittenBy,
    type ModinfoGame,
    type ModinfoSource,
    type ModinfoPackaging,
    type ModinfoMergeSource,
} from '../../../src/types/modinfo';
import type { MergedModSource } from '../../../src/types/mod';

/**
 * The vpk-modinfo v1 format module. Every imprinted VPK carries BOTH root
 * entries, written together in one repack:
 *
 *   1. addoninfo.txt  - KV1 human summary (any VPK browser shows it).
 *   2. modinfo.json   - the complete machine record (ModinfoRecord).
 *
 * Grimoire owns ALL of this: it serializes both entries itself, computes the
 * original whole-file identity, and parses existing embeds back for identity
 * carry-forward. vpkmerge is a dumb byte-embedder: it gets these blobs via
 * `--extra-file` and never interprets them.
 */

export type {
    ModinfoRecord,
    ModinfoModRecord,
    ModinfoMergeRecord,
    ModinfoIdentity,
    ModinfoWrittenBy,
    ModinfoGame,
    ModinfoSource,
    ModinfoPackaging,
    ModinfoMergeSource,
};
export { MODINFO_FORMAT, MODINFO_SCHEMA_VERSION };

/** Root-level VPK entry that carries the embedded AddonInfo block. */
export const ADDONINFO_ENTRY = 'addoninfo.txt';

/** Root-level VPK entry that carries the modinfo.json machine record. */
export const MODINFO_ENTRY = 'modinfo.json';

/** The game block stamped into every modinfo.json Grimoire writes. */
export const MODINFO_GAME: ModinfoGame = {
    name: 'Deadlock',
    steamAppId: 1422450,
    gameBananaGameId: 20948,
};

/** Default `addonversion` when a caller does not supply one. */
const DEFAULT_ADDON_VERSION = '1.0';

const SHA256_RE = /^[0-9a-f]{64}$/i;

// --- addoninfo.txt -----------------------------------------------------------

/**
 * Fields for the embedded `addoninfo.txt` AddonInfo block. The `original*`
 * triple is the canonical-identity anchor resolveVpkIdentity reads back; the
 * GameBanana fields let an orphaned-but-imprinted file be identified offline.
 * Absent optionals are omitted from the output entirely. The schema marker
 * (`modinfoVersion "1"`) is appended automatically, always last.
 */
export interface AddonInfoFields {
    /** `addontitle`: the mod name, or a merge name. */
    title: string;
    /** `addonauthor`: the author when known, or "Multiple (merged)" for merges. */
    author?: string;
    /** `addonversion`. Defaults to "1.0" when omitted. */
    version?: string;
    /** `gamebananaId` (numeric submission id as a string). Omit if local. */
    gamebananaId?: string;
    /** `gamebananaFileId` (numeric file id as a string). Omit if local. */
    gamebananaFileId?: string;
    /** `sourceUrl` (GameBanana page url). Omit if local. */
    sourceUrl?: string;
    /** `buildDate` (ISO 8601). Equals the modinfo record's writtenAt. */
    buildDate: string;
    /** `originalSha256`: 64-hex original whole-file sha256, lowercased. */
    originalSha256: string;
    /** `originalSize`: original whole-file byte length. */
    originalSize?: number;
    /** `originalCrc32`: 8-hex original whole-file CRC-32, lowercased. */
    originalCrc32?: string;
}

/**
 * Serialize an `addoninfo.txt` KeyValues1 AddonInfo block. Matches the classic
 * Source-engine layout (4-space indent, unquoted keys, quoted values) so any
 * VPK browser shows it. KV1 values are SINGLE-LINE ONLY: control characters
 * are stripped before serialization (long text lives in modinfo.json only).
 * Embedded backslashes and double quotes are escaped (`\` -> `\\`, `"` ->
 * `\"`, backslash first). Absent optionals are omitted. The key order and the
 * trailing `modinfoVersion "1"` schema marker follow the vpk-modinfo v1
 * contract.
 */
export function serializeAddonInfo(fields: AddonInfoFields): string {
    const lines: string[] = ['"AddonInfo"', '{'];

    const write = (key: string, value: string | undefined): void => {
        if (value === undefined || value === '') return;
        lines.push(`    ${key} "${escapeKvValue(toSingleLine(value))}"`);
    };

    write('addonversion', fields.version ?? DEFAULT_ADDON_VERSION);
    write('addontitle', fields.title);
    write('addonauthor', fields.author);
    write('gamebananaId', fields.gamebananaId);
    write('gamebananaFileId', fields.gamebananaFileId);
    write('sourceUrl', fields.sourceUrl);
    write('buildDate', fields.buildDate);
    write('originalSha256', fields.originalSha256);
    write(
        'originalSize',
        fields.originalSize === undefined ? undefined : String(fields.originalSize)
    );
    write('originalCrc32', fields.originalCrc32);
    write('modinfoVersion', String(MODINFO_SCHEMA_VERSION));

    lines.push('}', '');
    return lines.join('\n');
}

/** Collapse control characters (newlines, tabs, etc.) to spaces so a KV1
 *  value can never break out of its line, then squeeze runs and trim. */
function toSingleLine(value: string): string {
    let out = '';
    for (const ch of value) {
        const code = ch.codePointAt(0) ?? 0;
        out += code < 0x20 || code === 0x7f ? ' ' : ch;
    }
    return out.replace(/ {2,}/g, ' ').trim();
}

function escapeKvValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// --- modinfo.json ------------------------------------------------------------

/**
 * Serialize a modinfo.json record (pretty-printed, 2-space, key order fixed by
 * construction here so the on-disk document is stable and diffable). Optional
 * fields that are undefined are omitted by JSON.stringify.
 */
export function serializeModinfo(record: ModinfoRecord): string {
    const doc = {
        format: record.format,
        schemaVersion: record.schemaVersion,
        kind: record.kind,
        writtenBy: record.writtenBy,
        writtenAt: record.writtenAt,
        firstImprintedAt: record.firstImprintedAt,
        game: record.game,
        identity: record.identity,
        title: record.title,
        author: record.author,
        description: record.description,
        source: record.source,
        packaging: record.packaging,
        ...(record.kind === 'merge'
            ? { merge: record.merge, sources: record.sources }
            : {}),
    };
    return `${JSON.stringify(doc, null, 2)}\n`;
}

/**
 * Parse modinfo.json bytes into a fully-typed ModinfoRecord, or null when the
 * document is not valid vpk-modinfo v1 (wrong format marker, wrong schema
 * version, unknown kind, or any missing/mistyped required field). Parse,
 * don't validate: callers get a complete record or nothing, never a
 * half-trusted object.
 */
export function parseModinfo(bytes: Buffer | string): ModinfoRecord | null {
    let raw: unknown;
    try {
        raw = JSON.parse(typeof bytes === 'string' ? bytes : bytes.toString('utf-8'));
    } catch {
        return null;
    }
    if (!isRecord(raw)) return null;
    if (raw.format !== MODINFO_FORMAT) return null;
    if (raw.schemaVersion !== MODINFO_SCHEMA_VERSION) return null;
    if (raw.kind !== 'mod' && raw.kind !== 'merge') return null;

    const writtenBy = parseWrittenBy(raw.writtenBy);
    const writtenAt = asString(raw.writtenAt);
    const firstImprintedAt = asString(raw.firstImprintedAt);
    const game = parseGame(raw.game);
    const identity = parseIdentity(raw.identity);
    const title = asString(raw.title);
    if (!writtenBy || !writtenAt || !firstImprintedAt || !game || !identity || !title) {
        return null;
    }

    const common = {
        format: MODINFO_FORMAT,
        schemaVersion: MODINFO_SCHEMA_VERSION,
        writtenBy,
        writtenAt,
        firstImprintedAt,
        game,
        identity,
        title,
        author: asString(raw.author),
        description: asString(raw.description),
        source: parseSource(raw.source),
        packaging: parsePackaging(raw.packaging),
    } as const;

    if (raw.kind === 'mod') {
        return { ...common, kind: 'mod' };
    }

    const merge = parseMergeBlock(raw.merge);
    const sources = parseMergeSources(raw.sources);
    if (!merge || !sources) return null;
    return { ...common, kind: 'merge', merge, sources };
}

/**
 * Read and parse the embedded modinfo.json from a VPK, or null when the file
 * carries none, it cannot be read, or it is not a valid vpk-modinfo record.
 * Uses the cached directory parse to detect the entry cheaply (bulk callers
 * probe every installed mod), then pulls the bytes only when it is present.
 */
export function readEmbeddedModinfo(path: string): ModinfoRecord | null {
    try {
        const bytes = readRootEntryBytes(path, MODINFO_ENTRY);
        if (!bytes) return null;
        return parseModinfo(bytes);
    } catch (error) {
        console.warn(`[modinfoFormat] Failed to read embedded modinfo.json from ${path}:`, error);
        return null;
    }
}

/** Read a root-level entry's bytes, using the cached directory parse to skip
 *  files that do not carry the entry at all. */
function readRootEntryBytes(path: string, entryName: string): Buffer | null {
    const paths = parseVpkDirectoryCached(path);
    if (!paths) return null;
    const entry = paths.find((p) => p.replace(/\\/g, '/').toLowerCase() === entryName);
    if (!entry) return null;
    return readVpkEntryBytes(path, entry);
}

/** Does `path` carry a root-level entry named `entryName`? Cheap presence
 *  check via the cached directory parse; no entry bytes are read. Used to
 *  decide whether a re-embed needs a `--drop-entry` for a superseded sidecar
 *  (see hasLegacyGrimoireMergeMetaEntry) without paying for a read that would
 *  be thrown away. */
function hasRootEntry(path: string, entryName: string): boolean {
    const paths = parseVpkDirectoryCached(path);
    if (!paths) return false;
    return paths.some((p) => p.replace(/\\/g, '/').toLowerCase() === entryName);
}

/** Does `path` carry the legacy `grimoire_meta.json` companion? A writer that
 *  supersedes it (embedMergeIdentity, embedImprintInPlace) checks this before
 *  the repack so it can pass `--drop-entry grimoire_meta.json` and retire the
 *  residue in the same pass, rather than leaving a stale sidecar the new
 *  modinfo.json record has already superseded. */
export function hasLegacyGrimoireMergeMetaEntry(path: string): boolean {
    return hasRootEntry(path, LEGACY_GRIMOIRE_META_ENTRY);
}

// --- parse helpers (parse-don't-validate primitives) --------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseWrittenBy(value: unknown): ModinfoWrittenBy | null {
    if (!isRecord(value)) return null;
    const tool = asString(value.tool);
    const version = asString(value.version);
    return tool && version ? { tool, version } : null;
}

function parseGame(value: unknown): ModinfoGame | null {
    if (!isRecord(value)) return null;
    const name = asString(value.name);
    const steamAppId = asNumber(value.steamAppId);
    const gameBananaGameId = asNumber(value.gameBananaGameId);
    if (!name || steamAppId === undefined || gameBananaGameId === undefined) return null;
    return { name, steamAppId, gameBananaGameId };
}

function parseIdentity(value: unknown): ModinfoIdentity | null {
    if (!isRecord(value)) return null;
    const sha256 = asString(value.sha256);
    if (!sha256 || !SHA256_RE.test(sha256)) return null;
    return {
        sha256: sha256.toLowerCase(),
        size: asNumber(value.size),
        crc32: asString(value.crc32)?.toLowerCase(),
    };
}

function parseSource(value: unknown): ModinfoSource | undefined {
    if (!isRecord(value)) return undefined;
    return {
        gamebananaId: asNumber(value.gamebananaId),
        gamebananaFileId: asNumber(value.gamebananaFileId),
        url: asString(value.url),
        section: asString(value.section),
        categoryId: asNumber(value.categoryId),
        categoryName: asString(value.categoryName),
    };
}

function parsePackaging(value: unknown): ModinfoPackaging | undefined {
    if (!isRecord(value)) return undefined;
    return {
        vpkIndex: asNumber(value.vpkIndex),
        variantLabel: asString(value.variantLabel),
    };
}

function parseMergeBlock(value: unknown): { title: string } | null {
    if (!isRecord(value)) return null;
    const title = asString(value.title);
    return title ? { title } : null;
}

function parseMergeSources(value: unknown): ModinfoMergeSource[] | null {
    if (!Array.isArray(value)) return null;
    const sources: ModinfoMergeSource[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) return null;
        const title = asString(entry.title);
        const fileNameAtMergeTime = asString(entry.fileNameAtMergeTime);
        const priorityAtMergeTime = asNumber(entry.priorityAtMergeTime);
        if (!title || !fileNameAtMergeTime || priorityAtMergeTime === undefined) return null;
        if (typeof entry.enabledAtMergeTime !== 'boolean') return null;
        const identitySha = isRecord(entry.identity) ? asString(entry.identity.sha256) : undefined;
        sources.push({
            title,
            identity: { sha256: identitySha?.toLowerCase() },
            gamebananaId: asNumber(entry.gamebananaId),
            gamebananaFileId: asNumber(entry.gamebananaFileId),
            section: asString(entry.section),
            priorityAtMergeTime,
            enabledAtMergeTime: entry.enabledAtMergeTime,
            fileNameAtMergeTime,
            vpkIndex: asNumber(entry.vpkIndex),
        });
    }
    return sources;
}

// --- imprint repack parity ----------------------------------------------------

/** Cap on entry names quoted per problem in a parity mismatch message. */
const PARITY_MESSAGE_CAP = 5;

function normalizeEntryPath(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
}

function quoteEntryList(paths: string[]): string {
    const shown = paths.slice(0, PARITY_MESSAGE_CAP).join(', ');
    const more = paths.length - PARITY_MESSAGE_CAP;
    return more > 0 ? `${shown}, +${more} more` : shown;
}

/**
 * Compare an imprint repack's output entry tree against its input's. Parity
 * means: every input entry is EITHER carried into the output with an
 * unchanged logical size OR named in `droppedEntries` (an expected removal,
 * e.g. a superseded legacy grimoire_meta.json passed to `--drop-entry`);
 * nothing appears beyond the two imprint entries; both imprint entries are
 * present in the output. The imprint entries themselves are exempt from the
 * size check (a re-imprint rewrites them in place). Returns a precise
 * mismatch description, or null on parity.
 *
 * Pure set/size comparison so it is unit-testable without VPK binaries; the
 * caller (embedImprintInPlace) feeds it parseVpkEntryStats of the real input
 * VPK (parsed before the repack) and the repacked temp output, plus whatever
 * entries it asked vpkmerge to drop.
 */
export function findImprintRepackMismatch(
    inputEntries: VpkEntryStat[],
    outputEntries: VpkEntryStat[],
    droppedEntries: string[] = []
): string | null {
    const imprintEntries = [ADDONINFO_ENTRY, MODINFO_ENTRY];
    const dropped = new Set(droppedEntries.map(normalizeEntryPath));
    const input = new Map(inputEntries.map((e) => [normalizeEntryPath(e.path), e.size]));
    const output = new Map(outputEntries.map((e) => [normalizeEntryPath(e.path), e.size]));

    const lost: string[] = [];
    const resized: string[] = [];
    for (const [path, size] of input) {
        if (imprintEntries.includes(path) || dropped.has(path)) continue;
        const outSize = output.get(path);
        if (outSize === undefined) {
            lost.push(path);
        } else if (outSize !== size) {
            resized.push(`${path} (${size} -> ${outSize} bytes)`);
        }
    }
    const gained: string[] = [];
    for (const path of output.keys()) {
        if (!input.has(path) && !imprintEntries.includes(path)) gained.push(path);
    }
    const absentImprint = imprintEntries.filter((path) => !output.has(path));

    const problems: string[] = [];
    if (lost.length > 0) {
        problems.push(`${lost.length} carried entries missing from the output (${quoteEntryList(lost)})`);
    }
    if (gained.length > 0) {
        problems.push(`${gained.length} unexpected entries added (${quoteEntryList(gained)})`);
    }
    if (resized.length > 0) {
        problems.push(`${resized.length} carried entries changed size (${quoteEntryList(resized)})`);
    }
    if (absentImprint.length > 0) {
        problems.push(`imprint entries missing from the output (${quoteEntryList(absentImprint)})`);
    }
    return problems.length > 0 ? problems.join('; ') : null;
}

// --- original identity -------------------------------------------------------

/**
 * Compute a VPK's original whole-file identity directly from its bytes. Use this
 * only on bytes that are still ORIGINAL (un-imprinted), e.g. the freshly-merged-
 * but-not-yet-embedded merge output, or a single mod being imprinted for the
 * first time. For a file that may already carry an embed, prefer
 * carryForwardOriginalIdentity (vpkIdentity.ts) so an existing original hash is
 * never recomputed from already-imprinted bytes.
 *
 * `includeCrc` (default true) controls whether the original CRC-32 is computed.
 * The merge path keeps the default so its embed carries the CRC; the imprint path
 * passes `{ includeCrc: false }` to skip a second full-file read, since nothing
 * ever reads the embedded/original CRC back for any decision (every consumer keys
 * on .sha256). When skipped, `crc32` is `undefined` and the serializers drop it.
 */
export async function computeOriginalIdentity(
    path: string,
    { includeCrc = true }: { includeCrc?: boolean } = {}
): Promise<OriginalIdentity> {
    const [fingerprint, crc32] = await Promise.all([
        fingerprintFile(path),
        includeCrc ? crc32File(path) : Promise.resolve(undefined),
    ]);
    return {
        sha256: fingerprint.sha256.toLowerCase(),
        crc32: crc32?.toLowerCase(),
        size: fingerprint.size,
    };
}

// --- legacy embed shim ---------------------------------------------------------

// PRE-RELEASE SHIM: delete before first release. The ~131 files imprinted on
// this machine before the vpk-modinfo redo carry the old grimoire-branded
// embed: `grimoireOriginal*` keys in addoninfo.txt and, for merges, an old
// `grimoire_meta.json` companion. carryForwardOriginalIdentity (vpkIdentity.ts)
// reads the old addoninfo keys via ParsedAddonInfo.raw; this reader recovers a
// merge's original sha from the old JSON companion as the last fallback, so
// every legacy file migrates to the new format on its next re-imprint.

/** Old (pre-redo) merge companion entry name. Exported so a writer that
 *  supersedes it (embedMergeIdentity, embedImprintInPlace) can pass it to
 *  vpkmerge's `--drop-entry`, retiring the legacy sidecar in the same repack
 *  that writes its replacement instead of leaving residue behind. */
export const LEGACY_GRIMOIRE_META_ENTRY = 'grimoire_meta.json';

/** One source entry from an old grimoire_meta.json document. Same shape the
 *  pre-redo serializer wrote (see git history of embeddedMetadata.ts), read
 *  back tolerantly: every field but the two required by ModinfoMergeSource
 *  (priorityAtMergeTime, enabledAtMergeTime, fileNameAtMergeTime) is optional
 *  because a hand-edited or truncated legacy file should degrade gracefully,
 *  not refuse to migrate. */
export interface LegacyGrimoireMergeSource {
    modName?: string;
    originalSha256?: string;
    gameBananaId?: number;
    gameBananaFileId?: number;
    section?: string;
    priorityAtMergeTime: number;
    enabledAtMergeTime: boolean;
    fileNameAtMergeTime: string;
}

/** Full projection of an old grimoire_meta.json document: the identity used
 *  by carryForwardOriginalIdentity, PLUS the merge title and full source list
 *  needed to reconstruct a merge record when the DB-side manifest (meta.merged)
 *  is gone (see reconstructMergedModInfoFromLegacy below). `sources` is null
 *  when the array is missing or structurally broken (parse, don't
 *  half-trust): a reconstruction caller must treat that the same as "no
 *  legacy meta". */
export interface LegacyGrimoireMergeMeta {
    originalSha256?: string;
    title?: string;
    sources: LegacyGrimoireMergeSource[] | null;
}

/**
 * Read the old grimoire_meta.json merge companion, or null when the file
 * carries none / it is not an old Grimoire merge document. `sources` is the
 * DB-wipe recovery payload: a merge whose meta.merged manifest was lost can
 * still be reconstructed from this array (see the never-flatten guard in
 * imprintMods.ts).
 */
export function readLegacyGrimoireMergeMeta(path: string): LegacyGrimoireMergeMeta | null {
    try {
        const bytes = readRootEntryBytes(path, LEGACY_GRIMOIRE_META_ENTRY);
        if (!bytes) return null;
        const parsed: unknown = JSON.parse(bytes.toString('utf-8'));
        if (!isRecord(parsed) || parsed.format !== 'grimoire-embedded-merge') return null;
        const merge = isRecord(parsed.merge) ? parsed.merge : undefined;
        return {
            originalSha256: merge ? asString(merge.originalSha256) : undefined,
            title: merge ? asString(merge.title) : undefined,
            sources: parseLegacyGrimoireMergeSources(parsed.sources),
        };
    } catch (error) {
        console.warn(`[modinfoFormat] Failed to read legacy grimoire_meta.json from ${path}:`, error);
        return null;
    }
}

/** Parse the old grimoire_meta.json `sources` array. Returns null (not a
 *  partial array) when the value is missing or any entry lacks the fields a
 *  ModinfoMergeSource requires, so a caller never reconstructs a merge from a
 *  half-broken source list. */
function parseLegacyGrimoireMergeSources(value: unknown): LegacyGrimoireMergeSource[] | null {
    if (!Array.isArray(value)) return null;
    const sources: LegacyGrimoireMergeSource[] = [];
    for (const entry of value) {
        if (!isRecord(entry)) return null;
        const fileNameAtMergeTime = asString(entry.fileNameAtMergeTime);
        const priorityAtMergeTime = asNumber(entry.priorityAtMergeTime);
        if (!fileNameAtMergeTime || priorityAtMergeTime === undefined) return null;
        if (typeof entry.enabledAtMergeTime !== 'boolean') return null;
        sources.push({
            modName: asString(entry.modName),
            originalSha256: asString(entry.originalSha256),
            gameBananaId: asNumber(entry.gameBananaId),
            gameBananaFileId: asNumber(entry.gameBananaFileId),
            section: asString(entry.section),
            priorityAtMergeTime,
            enabledAtMergeTime: entry.enabledAtMergeTime,
            fileNameAtMergeTime,
        });
    }
    return sources;
}

// --- never-flatten reconstruction ---------------------------------------------

/** A merge manifest rebuilt from an in-file record rather than the metadata
 *  sidecar, missing only `id` and `shareCode` (the caller mints a fresh id and
 *  regenerates the share code from `sources`, since neither travels inside
 *  the VPK). See reconstructMergedModInfoFromEmbed / ...FromLegacy. */
export interface ReconstructedMergeManifest {
    modName: string;
    createdAt: string;
    sources: MergedModSource[];
}

function mergeSourceFromModinfo(source: ModinfoMergeSource): MergedModSource {
    return {
        fileName: source.fileNameAtMergeTime,
        modName: source.title,
        gameBananaId: source.gamebananaId,
        gameBananaFileId: source.gamebananaFileId,
        section: source.section,
        enabledAtMergeTime: source.enabledAtMergeTime,
        priorityAtMergeTime: source.priorityAtMergeTime,
        sha256AtMergeTime: source.identity.sha256,
    };
}

/**
 * Reconstruct a merge manifest from a CURRENT-format embedded kind:"merge"
 * modinfo.json record. This is the primary never-flatten recovery path: a
 * merged VPK whose metadata.merged sidecar entry was lost (DB wipe, orphan
 * metadata prune) still carries its own full source list in the file, so the
 * manifest can be rebuilt without ever downgrading the file to kind:"mod".
 */
export function reconstructMergedModInfoFromEmbed(
    record: ModinfoMergeRecord
): ReconstructedMergeManifest {
    return {
        modName: record.merge.title || record.title,
        createdAt: record.firstImprintedAt,
        sources: record.sources.map(mergeSourceFromModinfo),
    };
}

function mergeSourceFromLegacy(source: LegacyGrimoireMergeSource): MergedModSource {
    return {
        fileName: source.fileNameAtMergeTime,
        modName: source.modName || source.fileNameAtMergeTime,
        gameBananaId: source.gameBananaId,
        gameBananaFileId: source.gameBananaFileId,
        section: source.section,
        enabledAtMergeTime: source.enabledAtMergeTime,
        priorityAtMergeTime: source.priorityAtMergeTime,
        sha256AtMergeTime: source.originalSha256,
    };
}

/**
 * Reconstruct a merge manifest from an old (pre-redo) grimoire_meta.json
 * companion. Fallback recovery path for a file imprinted before the
 * vpk-modinfo redo whose metadata.merged sidecar entry was lost: the legacy
 * companion still carries the full source list under the old key names.
 * `legacy.sources` must be non-null (see parseLegacyGrimoireMergeSources); a
 * null sources list means the legacy document itself is unusable for
 * reconstruction, and the caller falls through to the anomalous/orphan-merge
 * outcome rather than guessing at a partial source list.
 */
export function reconstructMergedModInfoFromLegacy(
    legacy: LegacyGrimoireMergeMeta & { sources: LegacyGrimoireMergeSource[] },
    fallbackTitle: string,
    fallbackCreatedAt: string
): ReconstructedMergeManifest {
    return {
        modName: legacy.title || fallbackTitle,
        createdAt: fallbackCreatedAt,
        sources: legacy.sources.map(mergeSourceFromLegacy),
    };
}
