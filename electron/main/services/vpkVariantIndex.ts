/**
 * Assigns a stable per-VPK index to the sibling VPKs of one multi-file
 * download, so a portable profile can bind each enabled sibling back to the
 * right file after a re-download (see profileResolver.ts, which consumes the
 * stamped `vpkIndex`). Split out of download.ts so it can be unit-tested
 * without dragging in the electron/fs graph (same rationale as profileResolver).
 */

export interface IndexableVpk {
    /** Final on-disk (disabled) filename; the key the returned map is keyed by. */
    fileName: string;
    /** Byte size, the primary sort key (ascending). */
    size: number;
    /**
     * A cross-machine-stable identity used to break size ties: the archive
     * origin of the file (variant folder + original basename inside the
     * archive). The final `fileName` is NOT stable for equal-basename siblings
     * because makeDisabledFileName appends a random hex suffix on collision, so
     * tiebreaking on it makes the stamped index differ across machines and a
     * shared profile then restores the wrong sibling. Falls back to `fileName`
     * only when no stable key is provided (legacy callers).
     */
    stableKey?: string;
}

/**
 * Order the siblings by ascending size, then by their stable archive identity,
 * and stamp each with its position. Returns an empty map for a lone VPK (a
 * single-file download carries no meaningful index). The comparator is
 * deterministic across machines given the same archive contents.
 */
export function buildVpkIndexBySize(vpks: IndexableVpk[]): Map<string, number> {
    if (vpks.length <= 1) return new Map();
    const tiebreak = (v: IndexableVpk): string => v.stableKey ?? v.fileName;
    return new Map(
        [...vpks]
            .sort((a, b) => a.size - b.size || tiebreak(a).localeCompare(tiebreak(b)))
            .map((v, index) => [v.fileName, index] as const)
    );
}
