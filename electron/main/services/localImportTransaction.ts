/** One destination claimed by a single local-import source. The caller owns
 * the snapshot type because this helper deliberately has no metadata/fs
 * dependencies and can therefore be tested without Electron. */
export interface LocalImportTransactionWrite<TMetadata> {
    destPath: string;
    metaKey: string;
    previousMetadata?: TMetadata;
}

export interface LocalImportRollbackOperations<TMetadata> {
    removeFile(path: string): Promise<void>;
    restoreMetadata(metaKey: string, previous: TMetadata | undefined): void;
}

/** Roll back every durable effect made for one source archive. Cleanup runs in
 * reverse claim order and is best-effort across all destinations; callers get
 * every failure so they can report that atomicity could not be fully restored.
 * Queued post-commit work is truncated first and therefore never targets a
 * destination that this rollback removes. */
export async function rollbackLocalImport<TMetadata, TQueued>(
    writes: readonly LocalImportTransactionWrite<TMetadata>[],
    queued: TQueued[],
    queuedStart: number,
    operations: LocalImportRollbackOperations<TMetadata>
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
            operations.restoreMetadata(write.metaKey, write.previousMetadata);
        } catch (err) {
            failures.push(`restore metadata ${write.metaKey}: ${String(err)}`);
        }
    }

    return failures;
}
