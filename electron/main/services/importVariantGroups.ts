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

/**
 * Retry handles are decided after the whole batch, not when each row fails.
 * An early source can fail before a later source with the same batch key
 * creates the group; looking only at failure-time state would make the retry
 * mint a second group and split the user's variants.
 */
export function resolvePersistedImportVariantGroupIds(
    resolvedGroupIds: readonly (string | undefined)[],
    persistedGroupIds: ReadonlySet<string>
): Array<string | undefined> {
    return resolvedGroupIds.map((groupId) =>
        groupId && persistedGroupIds.has(groupId) ? groupId : undefined
    );
}
