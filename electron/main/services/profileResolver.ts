import type { Mod } from '../../../src/types/mod';
import type { ProfileMod } from '../../../src/types/electron';

/**
 * Pure profile <-> installed-mod matching logic, split out of profiles.ts so it
 * can be unit-tested without dragging in the main-process (fs / sqlite / IPC)
 * graph. The single dependency on the metadata sidecar is injected as `getMeta`
 * (profiles.ts binds the real getModMetadata; tests pass a plain map lookup).
 */

/** The subset of mod metadata the resolver reads. getModMetadata's ModMetadata
 *  is assignable to this (it carries these fields plus more), so callers pass it
 *  directly. */
export type VpkIndexMeta = {
    gameBananaId?: number;
    gameBananaFileId?: number;
    vpkIndex?: number;
};
export type MetaLookup = (metaKey: string) => VpkIndexMeta | undefined;

export function normalizeVpkIndex(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * For multi-VPK GameBanana files whose siblings never got a `vpkIndex` stamped
 * (installed before the field existed), reconstruct one by size-sorting the
 * group. Bails on a group of one, and on a group whose VPKs are all the same
 * size (the size tiebreak can't order them reliably once filenames are the
 * uninformative `pakNN_dir.vpk`), leaving those to fileName/positional matching.
 * Never overwrites an index that was actually stamped.
 */
export function inferMissingVpkIndexes<T extends { metaKey: string; fileName: string; size: number }>(
    mods: T[],
    getMeta: MetaLookup
): Map<string, number> {
    const groups = new Map<string, T[]>();
    for (const mod of mods) {
        const meta = getMeta(mod.metaKey);
        if (typeof meta?.gameBananaId !== 'number' || typeof meta?.gameBananaFileId !== 'number') continue;
        const key = `${meta.gameBananaId}:${meta.gameBananaFileId}`;
        const group = groups.get(key) ?? [];
        group.push(mod);
        groups.set(key, group);
    }

    const inferred = new Map<string, number>();
    for (const group of groups.values()) {
        if (group.length <= 1) continue;
        if (new Set(group.map((mod) => mod.size)).size <= 1) continue;
        [...group]
            .sort((a, b) => a.size - b.size || a.fileName.localeCompare(b.fileName))
            .forEach((mod, index) => {
                if (normalizeVpkIndex(getMeta(mod.metaKey)?.vpkIndex) === undefined) {
                    inferred.set(mod.metaKey, index);
                }
            });
    }
    return inferred;
}

function profileStableKey(gbId: number, fileId: number, vpkIndex: number | undefined): string {
    return vpkIndex === undefined ? `${gbId}:${fileId}` : `${gbId}:${fileId}:${vpkIndex}`;
}

/** Drop duplicate physical VPKs before they're written into a profile. */
export function dedupeEnabledForProfile<T extends { metaKey: string; fileName: string; priority: number; size: number }>(
    mods: T[],
    getMeta: MetaLookup
): T[] {
    const inferredVpkIndexes = inferMissingVpkIndexes(mods, getMeta);
    const byStableKey = new Map<string, T>();
    const out: T[] = [];
    for (const mod of mods) {
        const meta = getMeta(mod.metaKey);
        const gbId = meta?.gameBananaId;
        const fileId = meta?.gameBananaFileId;
        if (typeof gbId !== 'number' || typeof fileId !== 'number') {
            out.push(mod);
            continue;
        }
        const vpkIndex = normalizeVpkIndex(meta?.vpkIndex) ?? inferredVpkIndexes.get(mod.metaKey);
        const key = profileStableKey(gbId, fileId, vpkIndex);
        const existing = byStableKey.get(key);
        if (!existing) {
            byStableKey.set(key, mod);
            out.push(mod);
        } else if (mod.priority < existing.priority) {
            // Prefer the higher-load-order copy; swap it in place.
            const idx = out.indexOf(existing);
            if (idx !== -1) out[idx] = mod;
            byStableKey.set(key, mod);
            console.warn(
                `[profiles] dedupe: dropping duplicate VPK ${existing.fileName} ` +
                `(same GameBanana file/index as ${mod.fileName})`
            );
        } else {
            console.warn(
                `[profiles] dedupe: dropping duplicate VPK ${mod.fileName} ` +
                `(same GameBanana file/index as ${existing.fileName})`
            );
        }
    }
    return out;
}

/** Outcome of resolving one ProfileMod against the current scan. The `via`
 *  field lets callers (and the diagnostic log) distinguish a real stable-id
 *  match from a best-effort fileName fallback, and surfaces the refused
 *  fileName cross-match case that was the cause of the
 *  "Profile apply misrecognizing mods to turn on" bug. */
export type ResolvedMatch =
    | { mod: Mod; via: 'stable' | 'fileName' }
    | { mod: undefined; via: 'miss' | 'refused-crossmatch'; candidateFileName?: string };

/**
 * Build a resolver that maps a ProfileMod to one of the current scanned mods.
 *
 * Tries stable id first (`gameBananaId` + `gameBananaFileId` + optional
 * `vpkIndex`) so a mod can be found after a fileName change. Multi-VPK
 * siblings use the size-sorted index assigned at download time instead of a
 * content hash, so profile apply can still survive a redownload/update that
 * changes the VPK bytes but keeps the archive's relative VPK shape. Falls back
 * to fileName ONLY when neither the profile entry nor the candidate currentMod carry ids: this keeps
 * local-to-local fileName matching working for custom mods, while refusing to
 * cross-match a legacy stable-id-less profile entry to an unrelated
 * GameBanana mod that just happens to occupy the same pakNN_ slot today. The
 * unconditional fileName fallback used to silently enable the wrong mod after
 * any reorder rotated pakNN_ prefixes (Discord #bugs:
 * "Profile apply misrecognizing mods to turn on", 1.11.2).
 *
 * Matches are deduped on a first-come basis so duplicate profile entries can't
 * double-assign the same file.
 */
export function buildProfileModResolver(
    currentMods: Array<Mod>,
    getMeta: MetaLookup
): (pm: ProfileMod) => ResolvedMatch {
    const byFileName = new Map<string, typeof currentMods[number]>();
    const byGbFile = new Map<string, Array<typeof currentMods[number]>>();
    const byGbMod = new Map<number, Array<typeof currentMods[number]>>();
    const vpkIndexByModId = new Map<string, number | undefined>();
    const metaByFileName = new Map<string, VpkIndexMeta | undefined>();
    const inferredVpkIndexes = inferMissingVpkIndexes(currentMods, getMeta);
    for (const mod of currentMods) {
        byFileName.set(mod.fileName, mod);
        const meta = getMeta(mod.metaKey);
        metaByFileName.set(mod.fileName, meta);
        const gbId = meta?.gameBananaId;
        const fileId = meta?.gameBananaFileId;
        const vpkIndex = normalizeVpkIndex(meta?.vpkIndex) ?? inferredVpkIndexes.get(mod.metaKey);
        vpkIndexByModId.set(mod.id, vpkIndex);
        if (typeof gbId === 'number') {
            const modMatches = byGbMod.get(gbId);
            if (modMatches) {
                modMatches.push(mod);
            } else {
                byGbMod.set(gbId, [mod]);
            }
        }
        if (typeof gbId === 'number' && typeof fileId === 'number') {
            const key = `${gbId}:${fileId}`;
            const matches = byGbFile.get(key);
            if (matches) {
                matches.push(mod);
            } else {
                byGbFile.set(key, [mod]);
            }
        }
    }
    const claimed = new Set<string>();
    const take = (
        mod: typeof currentMods[number] | undefined,
        via: 'stable' | 'fileName'
    ): ResolvedMatch | undefined => {
        if (!mod || claimed.has(mod.id)) return undefined;
        claimed.add(mod.id);
        return { mod, via };
    };
    return (pm: ProfileMod): ResolvedMatch => {
        const profileGameBananaId = typeof pm.gameBananaId === 'number' ? pm.gameBananaId : undefined;
        const profileFileId = typeof pm.gameBananaFileId === 'number' ? pm.gameBananaFileId : undefined;
        const profileHasStableIds = profileGameBananaId !== undefined && profileFileId !== undefined;
        const profileVpkIndex = normalizeVpkIndex(pm.vpkIndex);
        const stableCandidates = profileHasStableIds
            ? byGbFile.get(`${profileGameBananaId}:${profileFileId}`) ?? []
            : [];
        if (profileHasStableIds) {
            const stable =
                profileVpkIndex !== undefined
                    ? stableCandidates.find(
                        (mod) => vpkIndexByModId.get(mod.id) === profileVpkIndex && !claimed.has(mod.id)
                    ) ??
                    stableCandidates.find(
                        (mod) =>
                            mod.fileName === pm.fileName &&
                            vpkIndexByModId.get(mod.id) === undefined &&
                            !claimed.has(mod.id)
                    )
                    : stableCandidates.find((mod) => mod.fileName === pm.fileName && !claimed.has(mod.id)) ??
                    stableCandidates.find(
                        (mod) => vpkIndexByModId.get(mod.id) === undefined && !claimed.has(mod.id)
                    ) ??
                    stableCandidates.find((mod) => !claimed.has(mod.id));
            const stableMatch = take(stable, 'stable');
            if (stableMatch) return stableMatch;

            // Update-tolerant fallback: the GameBanana file id may change when
            // an author replaces an upload. Use the VPK index only when it
            // points to one unclaimed installed candidate; otherwise a single
            // installed mod from the same page is safe for one-VPK archives.
            const modCandidates = profileGameBananaId !== undefined
                ? byGbMod.get(profileGameBananaId) ?? []
                : [];
            if (profileVpkIndex !== undefined) {
                const indexedCandidates = modCandidates.filter(
                    (mod) => vpkIndexByModId.get(mod.id) === profileVpkIndex && !claimed.has(mod.id)
                );
                if (indexedCandidates.length === 1) {
                    const indexedMatch = take(indexedCandidates[0], 'stable');
                    if (indexedMatch) return indexedMatch;
                }
            } else if (stableCandidates.length === 0) {
                const unclaimedCandidates = modCandidates.filter((mod) => !claimed.has(mod.id));
                if (unclaimedCandidates.length === 1) {
                    const modMatch = take(unclaimedCandidates[0], 'stable');
                    if (modMatch) return modMatch;
                }
            }
        }

        const fallback = byFileName.get(pm.fileName);
        if (!fallback || claimed.has(fallback.id)) {
            return { mod: undefined, via: 'miss' };
        }

        // Refuse the fileName fallback whenever either side carries GameBanana
        // ids that the stable-id lookup couldn't reconcile. If both sides have
        // ids that disagree (or the profile entry has ids but the candidate
        // doesn't, or vice versa), the fileName collision is almost certainly
        // a slot reuse after a reorder, not the same mod. Returning the
        // candidate anyway is the bug we're fixing.
        const candidateMeta = metaByFileName.get(fallback.fileName);
        const candidateHasStableIds =
            typeof candidateMeta?.gameBananaId === 'number' &&
            typeof candidateMeta?.gameBananaFileId === 'number';
        if (profileHasStableIds || candidateHasStableIds) {
            return {
                mod: undefined,
                via: 'refused-crossmatch',
                candidateFileName: fallback.fileName,
            };
        }

        return take(fallback, 'fileName') ?? { mod: undefined, via: 'miss' };
    };
}
