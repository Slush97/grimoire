/** Recorded on a skin-editor overlay so saving the same edit target again replaces it. */
export interface SkinEditTarget {
    hero: string;
    /** Canonical sha256 of each source VPK, sorted. Empty when editing the default skin. */
    sources: string[];
}

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
