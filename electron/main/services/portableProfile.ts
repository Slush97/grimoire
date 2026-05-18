import { app } from 'electron';
import { gzipSync, gunzipSync, constants as zlibConstants } from 'zlib';
import { addProfile, generateProfileId, loadProfiles, type Profile, type ProfileMod } from './profiles';
import { scanMods } from './mods';
import { getModMetadata } from './metadata';
import { fetchModDetails } from './gamebanana';
import type {
    PortableProfile,
    PortableModEntry,
    PortableExportResult,
    PortableResolutionReport,
    PortableResolvedMod,
} from '../../../src/types/portableProfile';
import {
    PORTABLE_PROFILE_FORMAT,
    PORTABLE_PROFILE_SCHEMA_VERSION,
    PORTABLE_PROFILE_SHARE_PREFIX,
} from '../../../src/types/portableProfile';

const DEADLOCK_STEAM_APP_ID = 1422450;
const DEADLOCK_GAMEBANANA_GAME_ID = 20948;

function base64UrlEncode(buf: Buffer): string {
    return buf
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
    const padded = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4;
    return Buffer.from(pad ? padded + '='.repeat(4 - pad) : padded, 'base64');
}

export function encodeShareCode(json: string): string {
    const compressed = gzipSync(Buffer.from(json, 'utf8'));
    return PORTABLE_PROFILE_SHARE_PREFIX + base64UrlEncode(compressed);
}

// Mirror the server-side cap so a malicious / corrupted share code can't
// inflate into a multi-MB allocation in the Electron main process. The
// previous implementation called gunzipSync with no maxOutputLength, which
// let a 16 KB compressed payload expand up to ~16 MB before failing.
const MAX_INFLATED_SHARE_CODE_BYTES = 16 * 1024;

export function decodeShareCode(code: string): string {
    if (!code.startsWith(PORTABLE_PROFILE_SHARE_PREFIX)) {
        throw new Error(`Share code missing "${PORTABLE_PROFILE_SHARE_PREFIX}" prefix`);
    }
    const body = code.slice(PORTABLE_PROFILE_SHARE_PREFIX.length).trim();
    let decompressed: Buffer;
    try {
        decompressed = gunzipSync(base64UrlDecode(body), {
            // Hard ceiling: zlib raises ERR_BUFFER_TOO_LARGE when an output
            // chunk would push the buffer past this. Caught below to surface
            // a friendly error instead of a Node-internal message.
            maxOutputLength: MAX_INFLATED_SHARE_CODE_BYTES,
            // Match the server-side stream cap so behavior is symmetric.
            finishFlush: zlibConstants.Z_FINISH,
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Invalid share code (gzip payload rejected: ${msg.slice(0, 120)})`
        );
    }
    return decompressed.toString('utf8');
}

/** Build a portable profile from the live installed mod set, without
 *  requiring a saved Grimoire profile. Used by the snapshot service so we can
 *  capture a recovery point even when no profile is selected. Local mods (no
 *  gameBananaFileId) are skipped and reported via warnings so the caller can
 *  log how many entries were dropped. */
export async function buildPortableProfileFromInstalled(
    deadlockPath: string,
    profileName: string
): Promise<PortableExportResult> {
    const installed = await scanMods(deadlockPath);

    const mods: PortableModEntry[] = [];
    const warnings: string[] = [];

    for (const installedMod of installed) {
        const metadata = getModMetadata(installedMod.fileName);
        const gbId = metadata?.gameBananaId ?? installedMod.gameBananaId;
        const fileId = metadata?.gameBananaFileId ?? installedMod.gameBananaFileId;

        if (!gbId || !fileId) {
            const label = metadata?.modName || installedMod.name || installedMod.fileName;
            warnings.push(`Skipped local mod: ${label}`);
            continue;
        }

        const fileLabel =
            metadata?.variantLabel ||
            metadata?.fileDescription ||
            metadata?.sourceFileName ||
            undefined;

        const vpkStem = vpkStemOf(installedMod.fileName);
        mods.push({
            source: 'gamebanana',
            ref: {
                submissionId: gbId,
                fileId,
                section: metadata?.sourceSection || 'Mod',
                ...(vpkStem !== null ? { vpkStem } : {}),
            },
            enabled: installedMod.enabled,
            priority: installedMod.priority,
            hint: {
                name: metadata?.modName || installedMod.name,
                category: metadata?.categoryName,
                fileLabel,
                originalFileName: metadata?.sourceFileName,
                thumbnailUrl: metadata?.thumbnailUrl,
                nsfw: metadata?.nsfw,
                isArchived: metadata?.isArchived,
            },
        });
    }

    const portable: PortableProfile = {
        format: PORTABLE_PROFILE_FORMAT,
        schemaVersion: PORTABLE_PROFILE_SCHEMA_VERSION,
        game: {
            steamAppId: DEADLOCK_STEAM_APP_ID,
            gameBananaGameId: DEADLOCK_GAMEBANANA_GAME_ID,
            name: 'Deadlock',
        },
        exportedAt: new Date().toISOString(),
        exportedBy: { tool: 'grimoire', version: app.getVersion() },
        profile: { name: profileName },
        mods,
    };

    const json = JSON.stringify(portable, null, 2);
    const shareCode = encodeShareCode(json);

    return { profile: portable, json, shareCode, warnings };
}

/** Build a portable profile from a stored Grimoire profile. Local mods (no
 *  gameBananaFileId) are skipped and reported via warnings so the UI can tell
 *  the user without scanning the file again. */
export async function buildPortableProfile(
    deadlockPath: string,
    profileId: string
): Promise<PortableExportResult> {
    const profiles = loadProfiles();
    const profile = profiles.find((p) => p.id === profileId);
    if (!profile) throw new Error(`Profile not found: ${profileId}`);

    const installed = await scanMods(deadlockPath);
    const modByFileName = new Map(installed.map((m) => [m.fileName, m]));

    const mods: PortableModEntry[] = [];
    const warnings: string[] = [];

    for (const profileMod of profile.mods) {
        const installedMod = modByFileName.get(profileMod.fileName);
        const metadata = getModMetadata(profileMod.fileName);
        const gbId = metadata?.gameBananaId ?? installedMod?.gameBananaId;
        const fileId = metadata?.gameBananaFileId ?? installedMod?.gameBananaFileId;

        if (!gbId || !fileId) {
            const label =
                metadata?.modName ||
                installedMod?.name ||
                profileMod.fileName;
            warnings.push(`Skipped local mod: ${label}`);
            continue;
        }

        const fileLabel =
            metadata?.variantLabel ||
            metadata?.fileDescription ||
            metadata?.sourceFileName ||
            undefined;

        const vpkStem = vpkStemOf(profileMod.fileName);
        mods.push({
            source: 'gamebanana',
            ref: {
                submissionId: gbId,
                fileId,
                section: metadata?.sourceSection || 'Mod',
                ...(vpkStem !== null ? { vpkStem } : {}),
            },
            enabled: profileMod.enabled,
            priority: profileMod.priority,
            hint: {
                name: metadata?.modName || installedMod?.name,
                category: metadata?.categoryName,
                fileLabel,
                originalFileName: metadata?.sourceFileName,
                thumbnailUrl: metadata?.thumbnailUrl,
                nsfw: metadata?.nsfw,
                isArchived: metadata?.isArchived,
            },
        });
    }

    const portable: PortableProfile = {
        format: PORTABLE_PROFILE_FORMAT,
        schemaVersion: PORTABLE_PROFILE_SCHEMA_VERSION,
        game: {
            steamAppId: DEADLOCK_STEAM_APP_ID,
            gameBananaGameId: DEADLOCK_GAMEBANANA_GAME_ID,
            name: 'Deadlock',
        },
        exportedAt: new Date().toISOString(),
        exportedBy: { tool: 'grimoire', version: app.getVersion() },
        profile: { name: profile.name },
        mods,
        extensions:
            profile.crosshair || (profile.autoexecCommands && profile.autoexecCommands.length > 0)
                ? {
                      grimoire: {
                          crosshair: profile.crosshair,
                          autoexecCommands: profile.autoexecCommands,
                      },
                  }
                : undefined,
    };

    const json = JSON.stringify(portable, null, 2);
    const shareCode = encodeShareCode(json);

    return { profile: portable, json, shareCode, warnings };
}

/** Validate a parsed object as a v1 portable profile. Throws with a useful
 *  message on failure so the import UI can show it verbatim. Untrusted input:
 *  we treat the entire payload as hostile until validated. */
function validatePortable(obj: unknown): PortableProfile {
    if (!obj || typeof obj !== 'object') throw new Error('Not a JSON object');
    const o = obj as Record<string, unknown>;

    if (o.format !== PORTABLE_PROFILE_FORMAT) {
        throw new Error(`Expected format "${PORTABLE_PROFILE_FORMAT}", got "${String(o.format)}"`);
    }
    if (typeof o.schemaVersion !== 'string') throw new Error('Missing schemaVersion');
    const major = o.schemaVersion.split('.')[0];
    if (major !== '1') throw new Error(`Unsupported schemaVersion: ${o.schemaVersion}`);

    if (!o.game || typeof o.game !== 'object') throw new Error('Missing game');
    if (!o.profile || typeof o.profile !== 'object') throw new Error('Missing profile');
    if (!Array.isArray(o.mods)) throw new Error('Missing mods array');

    const profileMeta = o.profile as Record<string, unknown>;
    if (typeof profileMeta.name !== 'string' || profileMeta.name.trim() === '') {
        throw new Error('Profile name required');
    }

    for (let i = 0; i < o.mods.length; i++) {
        const m = o.mods[i] as Record<string, unknown>;
        if (typeof m.source !== 'string') throw new Error(`mods[${i}].source missing`);
        if (!m.ref || typeof m.ref !== 'object') throw new Error(`mods[${i}].ref missing`);
        if (typeof m.enabled !== 'boolean') throw new Error(`mods[${i}].enabled missing`);
        if (typeof m.priority !== 'number') throw new Error(`mods[${i}].priority missing`);

        if (m.source === 'gamebanana') {
            const ref = m.ref as Record<string, unknown>;
            if (typeof ref.submissionId !== 'number') throw new Error(`mods[${i}].ref.submissionId missing`);
            if (typeof ref.fileId !== 'number') throw new Error(`mods[${i}].ref.fileId missing`);
            if (ref.vpkStem !== undefined && typeof ref.vpkStem !== 'string') {
                throw new Error(`mods[${i}].ref.vpkStem must be a string when present`);
            }
        }
    }

    return obj as PortableProfile;
}

/** Accept either a raw JSON string or a share code (mp1:...). */
export function parsePortableProfile(input: string): PortableProfile {
    const trimmed = input.trim();
    const json = trimmed.startsWith(PORTABLE_PROFILE_SHARE_PREFIX)
        ? decodeShareCode(trimmed)
        : trimmed;

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (err) {
        throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    return validatePortable(parsed);
}

/** Resolve each mod entry against its source. For GameBanana we pin the
 *  exact fileId, falling back to the newest non-archived file of the same
 *  submission when the pinned file is archived or missing. When `deadlockPath`
 *  is provided, the resolver also annotates each entry whose resolved file
 *  is already on disk so the dialog can skip those downloads. */
export async function resolvePortableProfile(
    profile: PortableProfile,
    deadlockPath?: string | null
): Promise<PortableResolutionReport> {
    const installedIndex = deadlockPath
        ? await buildInstalledIndex(deadlockPath)
        : null;

    const resolved: PortableResolvedMod[] = [];
    for (const entry of profile.mods) {
        const r = await resolveOne(entry);
        if (
            installedIndex &&
            r.status !== 'unresolvable' &&
            r.entry.source === 'gamebanana' &&
            r.resolvedFileId !== undefined
        ) {
            const ref = r.entry.ref as { submissionId: number; vpkStem?: string };
            const hit = lookupInstalled(installedIndex, ref.submissionId, r.resolvedFileId, ref.vpkStem);
            if (hit) r.alreadyInstalled = true;
        }
        resolved.push(r);
    }

    let exactCount = 0;
    let upgradedCount = 0;
    let unresolvableCount = 0;
    let alreadyInstalledCount = 0;
    for (const r of resolved) {
        if (r.status === 'exact') exactCount++;
        else if (r.status === 'upgraded') upgradedCount++;
        else unresolvableCount++;
        if (r.alreadyInstalled) alreadyInstalledCount++;
    }

    return {
        profile,
        resolved,
        exactCount,
        upgradedCount,
        unresolvableCount,
        alreadyInstalledCount,
    };
}

/** Strip the `pakNN_` priority prefix and `.vpk` (with optional `_dir`)
 *  suffix from an installed VPK filename to recover the body that originated
 *  inside the source archive. Returns null when the body would be the
 *  uninformative fallback `dir` that the install conflict-renamer assigns
 *  when it has to give up on the archive's original VPK name. */
function vpkStemOf(fileName: string): string | null {
    const m = fileName.match(/^pak\d{2}_(.+?)\.vpk$/i);
    if (!m) return null;
    const body = m[1].replace(/_dir$/i, '');
    if (!body || body.toLowerCase() === 'dir') return null;
    return body.toLowerCase();
}

interface InstalledIndex {
    /** Precise key `<gbId>:<fileId>:<vpkStem>`. Only populated for installed
     *  VPKs whose filename body survived (i.e. not renamed to `pakNN_dir.vpk`). */
    byVariant: Map<string, string>;
    /** Fallback key `<gbId>:<fileId>` → first matching installed fileName.
     *  Used when the portable ref lacks a vpkStem (single-VPK archives,
     *  pre-1.1 exports) or when no precise match is found. */
    byArchive: Map<string, string>;
}

/** Index installed mods by both precise (archive + variant stem) and fuzzy
 *  (archive only) keys. Shared between resolution (to flag already-installed
 *  entries) and finalize (to wire entries to existing local VPKs). */
async function buildInstalledIndex(deadlockPath: string): Promise<InstalledIndex> {
    const installed = await scanMods(deadlockPath);
    const byVariant = new Map<string, string>();
    const byArchive = new Map<string, string>();
    for (const mod of installed) {
        const meta = getModMetadata(mod.fileName);
        if (meta?.gameBananaId === undefined || meta?.gameBananaFileId === undefined) continue;
        const archiveKey = `${meta.gameBananaId}:${meta.gameBananaFileId}`;
        if (!byArchive.has(archiveKey)) byArchive.set(archiveKey, mod.fileName);
        const stem = vpkStemOf(mod.fileName);
        if (stem !== null) {
            byVariant.set(`${archiveKey}:${stem}`, mod.fileName);
        }
    }
    return { byVariant, byArchive };
}

/** Find the installed VPK that corresponds to a resolved portable entry.
 *  Prefers exact `(archive, variant)` match when both sides carry a stem;
 *  falls back to archive-only for single-VPK archives and pre-1.1 exports. */
function lookupInstalled(
    index: InstalledIndex,
    submissionId: number,
    fileId: number,
    vpkStem?: string
): string | null {
    if (vpkStem) {
        const hit = index.byVariant.get(`${submissionId}:${fileId}:${vpkStem.toLowerCase()}`);
        if (hit) return hit;
    }
    return index.byArchive.get(`${submissionId}:${fileId}`) ?? null;
}

async function resolveOne(entry: PortableModEntry): Promise<PortableResolvedMod> {
    if (entry.source !== 'gamebanana') {
        return {
            entry,
            status: 'unresolvable',
            reason: `Unknown source "${entry.source}"`,
        };
    }

    const ref = entry.ref as { submissionId: number; fileId: number; section?: string };
    const section = ref.section || 'Mod';

    let details;
    try {
        details = await fetchModDetails(ref.submissionId, section);
    } catch (err) {
        return {
            entry,
            status: 'unresolvable',
            reason: `Submission ${ref.submissionId} lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    }

    const files = details.files || [];
    if (files.length === 0) {
        return {
            entry,
            status: 'unresolvable',
            reason: `Submission ${ref.submissionId} has no downloadable files`,
        };
    }

    const pinned = files.find((f) => f.id === ref.fileId);
    if (pinned && !pinned.isArchived) {
        return {
            entry,
            status: 'exact',
            resolvedFileId: pinned.id,
            resolvedFileName: pinned.fileName,
        };
    }

    const live = files.filter((f) => !f.isArchived);
    if (live.length === 0) {
        return {
            entry,
            status: 'unresolvable',
            reason: 'All files on this submission are archived',
        };
    }
    let newest = live[0];
    for (const f of live) {
        if (f.downloadCount > newest.downloadCount) newest = f;
    }
    return {
        entry,
        status: 'upgraded',
        resolvedFileId: newest.id,
        resolvedFileName: newest.fileName,
    };
}

/** Build a local Grimoire Profile from a resolved portable import after the
 *  downloads have completed. Maps each accepted entry's (submissionId,
 *  resolvedFileId) back to the installed mod fileName via the metadata
 *  sidecar. Entries with no matching install on disk are silently dropped:
 *  the caller has already shown the user which downloads succeeded. */
export async function createProfileFromPortable(
    deadlockPath: string,
    portable: PortableProfile,
    resolved: PortableResolvedMod[]
): Promise<Profile> {
    const installedIndex = await buildInstalledIndex(deadlockPath);

    const profileMods: ProfileMod[] = [];
    const claimedVariants = new Set<string>();
    for (const r of resolved) {
        if (r.status === 'unresolvable') continue;
        if (r.entry.source !== 'gamebanana') continue;
        if (r.resolvedFileId === undefined) continue;
        const ref = r.entry.ref as { submissionId: number; vpkStem?: string };
        const fileName = lookupInstalled(installedIndex, ref.submissionId, r.resolvedFileId, ref.vpkStem);
        if (!fileName) continue;
        // Multi-VPK archives may produce several portable entries that all
        // resolve to the same file on disk when stems aren't carried. Skip
        // duplicate wirings so each local VPK is claimed at most once.
        if (claimedVariants.has(fileName)) continue;
        claimedVariants.add(fileName);

        profileMods.push({
            fileName,
            enabled: r.entry.enabled,
            priority: r.entry.priority,
        });
    }

    const now = new Date().toISOString();
    const profile: Profile = {
        id: generateProfileId(),
        name: portable.profile.name,
        mods: profileMods,
        crosshair: portable.extensions?.grimoire?.crosshair,
        autoexecCommands: portable.extensions?.grimoire?.autoexecCommands,
        createdAt: now,
        updatedAt: now,
    };

    return addProfile(profile);
}
