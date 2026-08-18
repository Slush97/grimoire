/**
 * Resolve renderer-local batch grouping keys into main-process UUIDs.
 *
 * A normal import may contain unrelated mods, so grouping is opt-in per item.
 * Items carrying the same `localGroupBatchKey` receive one freshly minted
 * local group id. An explicit `localGroupId` wins: that is how a retry after a
 * partial batch failure rejoins the files that already landed.
 */
export interface ImportVariantGroupRequest {
    localGroupId?: string;
    localGroupBatchKey?: string;
}

export function resolveImportVariantGroupIds(
    items: readonly ImportVariantGroupRequest[],
    mintGroupId: () => string
): Array<string | undefined> {
    const batchGroups = new Map<string, string>();

    return items.map((item) => {
        const existing = item.localGroupId?.trim();
        if (existing) return existing;

        const batchKey = item.localGroupBatchKey?.trim();
        if (!batchKey) return undefined;

        const known = batchGroups.get(batchKey);
        if (known) return known;

        const minted = mintGroupId();
        batchGroups.set(batchKey, minted);
        return minted;
    });
}
