import type { HeroPoseSkinSource } from '../../../src/types/portrait';
import type { SkinEditRecord, SkinEditTarget, SkinPartEdit } from '../../../src/types/skinEditor';

export function skinEditTarget(hero: string, sourceHashes: string[]): SkinEditTarget {
    return { hero, sources: [...sourceHashes].sort() };
}

const targetKey = (target: SkinEditTarget) => JSON.stringify([target.hero, [...target.sources].sort()]);

export function sameSkinEditTarget(a: SkinEditTarget | undefined, b: SkinEditTarget): boolean {
    return !!a && targetKey(a) === targetKey(b);
}

/**
 * The enabled load order (ids, highest priority first) with the overlay directly
 * ahead of its highest-priority source, or first when it edits the default skin.
 * Replaced overlays are left out so they keep their slots until they are deleted.
 */
export function skinOverlayLoadOrder(
    enabledIds: string[],
    overlayId: string,
    sourceIds: ReadonlySet<string>,
    replacedIds: ReadonlySet<string> = new Set(),
): string[] {
    const order = enabledIds.filter((id) => id !== overlayId && !replacedIds.has(id));
    order.splice(Math.max(0, order.findIndex((id) => sourceIds.has(id))), 0, overlayId);
    return order;
}

export interface SkinSourceCandidate {
    metaKey: string;
    priority: number;
    enabled: boolean;
    sha256?: string;
    skinEdit?: SkinEditRecord;
}

export type SkinEditOverlay = SkinSourceCandidate & { skinEdit: SkinEditRecord };

const isOverlay = (mod: SkinSourceCandidate): mod is SkinEditOverlay => !!mod.skinEdit;

export interface ResolvedSkinEditSources {
    skinSources: HeroPoseSkinSource[];
    /** The overlay being resumed: its edits start the session and saving replaces it. */
    overlay?: SkinEditOverlay;
    edits: SkinPartEdit[];
    /** Recorded source hashes that no installed mod has. */
    missing: string[];
}

/**
 * A skin-editor overlay is never an edit source. Each one in `requested` is swapped
 * for the installed mods its `skinEdit` recorded, and the highest-priority one is
 * resumed. `installed` is in load order, highest priority first.
 */
export function resolveSkinEditSources(requested: HeroPoseSkinSource[], installed: SkinSourceCandidate[]): ResolvedSkinEditSources {
    const overlays = installed.filter(isOverlay).filter((mod) => requested.some((source) => source.metaKey === mod.metaKey));
    if (!overlays.length) return { skinSources: requested, edits: [], missing: [] };
    const skinSources = requested.filter((source) => !overlays.some((mod) => mod.metaKey === source.metaKey));
    const listed = (mod: SkinSourceCandidate) => skinSources.some((source) => source.metaKey === mod.metaKey);
    const missing: string[] = [];
    const seen = new Set<string>();
    const queue = [...overlays];
    for (const overlay of queue) {
        for (const hash of overlay.skinEdit.sources) {
            if (seen.has(hash)) continue;
            seen.add(hash);
            const matches = installed.filter((mod) => mod.sha256 === hash);
            const sources = matches.filter((mod) => !isOverlay(mod));
            const match = sources.find(listed) ?? sources.find((mod) => mod.enabled) ?? sources[0];
            // An overlay saved from another overlay, before that was prevented, stands for that overlay's sources.
            const nested = matches.find(isOverlay);
            if (match) {
                if (!listed(match)) skinSources.push({ metaKey: match.metaKey, priority: match.priority });
            } else if (nested) {
                if (!queue.includes(nested)) queue.push(nested);
            } else missing.push(hash);
        }
    }
    const [overlay] = overlays;
    return { skinSources, overlay, edits: overlay.skinEdit.edits ?? [], missing };
}
