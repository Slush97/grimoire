/** One destination claimed by a single local-import source. The caller owns
 * the operations because this helper deliberately has no metadata/fs
 * dependencies and can therefore be tested without Electron. */
export interface LocalImportTransactionWrite {
    destPath: string;
    metaKey: string;
}

export interface LocalImportRollbackOperations {
    removeFile(path: string): Promise<void>;
    /** Remove whatever metadata the import wrote at this key. The allocator
     * only hands out free slots, so anything that was there before the claim
     * was orphan state the import path scrubs anyway; rollback restores the
     * slot to empty, never to a previous occupant. */
    clearMetadata(metaKey: string): void;
}

/** Roll back every durable effect made for one source archive. Cleanup runs in
 * reverse claim order and is best-effort across all destinations; callers get
 * every failure so they can report that atomicity could not be fully restored.
 * Queued post-commit work is truncated first and therefore never targets a
 * destination that this rollback removes. */
export async function rollbackLocalImport<TQueued>(
    writes: readonly LocalImportTransactionWrite[],
    queued: TQueued[],
    queuedStart: number,
    operations: LocalImportRollbackOperations
): Promise<string[]> {
    queued.splice(queuedStart);
    const failures: string[] = [];

    for (const write of [...writes].reverse()) {
        try {
            await operations.removeFile(write.destPath);
        } catch (err) {
            if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                failures.push(`remove ${write.destPath}: ${String(err)}`);
            }
        }
        try {
            operations.clearMetadata(write.metaKey);
        } catch (err) {
            failures.push(`restore metadata ${write.metaKey}: ${String(err)}`);
        }
    }

    return failures;
}
