import { ipcMain } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { getActiveDeadlockPath } from '../services/settings';
import { isDeadlockRunning } from '../services/launch';
import { getModById, getModCount } from '../services/modDatabase';
import { writeSnapshot } from '../services/snapshots';
import { detectDmm, readDmmDocument } from '../services/modInterchange/dmmReader';
import { importInterchange } from '../services/modInterchange/importer';
import { importInterchangeSelection } from '../services/modInterchange/selectionImport';
import { exportGrimoireLibrary, readInterchangeBundle } from '../services/modInterchange/bundle';
import type {
  InterchangeDocument,
  InterchangeExportReport,
  InterchangeExportSelection,
  InterchangeImportReport,
  InterchangeImportSelection,
  InterchangePreview,
  InterchangeSourceInfo,
  InterchangeSourceRequest,
} from '../../../src/lib/modInterchange';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) {
        throw new Error('No Deadlock path configured. Set it in Settings first.');
    }
    return deadlockPath;
}

// Submission-id validator backed by the local GameBanana catalog
// (mods-cache.db). Returns undefined when the catalog is empty or unavailable
// (fresh install, sync disabled): an empty catalog can't distinguish a wrong
// id from an unsynced one, so the import then skips the check rather than
// rejecting everything.
function catalogSubmissionLookup(): ((id: number) => boolean) | undefined {
    try {
        if (getModCount() === 0) return undefined;
    } catch {
        return undefined;
    }
    return (id: number) => {
        try {
            return getModById(id) !== null;
        } catch {
            // A lookup failure must not reject a legitimate mod: fail open.
            return true;
        }
    };
}

/** Mod managers Grimoire can read from disk. Supporting another one means a
 *  reader plus an entry here; the renderer lists whatever this returns. */
const SOURCES: Array<{
    id: string;
    detect: (deadlockPath: string | null) => Promise<InterchangeSourceInfo>;
    read: (deadlockPath: string, location?: string) => Promise<InterchangeDocument>;
}> = [
    {
        id: 'deadlock-mod-manager',
        detect: detectDmm,
        // A picked folder is either DMM's data folder (holds state.json) or the
        // folder with its mods (holds .dmm.json).
        read: (deadlockPath, location) =>
            readDmmDocument({
                deadlockPath,
                ...(location && existsSync(join(location, 'state.json'))
                    ? { dmmStatePath: join(location, 'state.json') }
                    : location
                      ? { dmmAddonsDir: location }
                      : {}),
            }),
    },
];

async function readSource(req: InterchangeSourceRequest): Promise<InterchangeDocument> {
    if (req.kind === 'bundle') return readInterchangeBundle(req.path);
    const source = SOURCES.find((s) => s.id === req.id);
    if (!source) throw new Error(`Unknown mod manager: ${req.id}`);
    return source.read(requireDeadlockPath(), req.location);
}

ipcMain.handle('interchange:sources', (): Promise<InterchangeSourceInfo[]> => {
    const deadlockPath = getActiveDeadlockPath();
    return Promise.all(SOURCES.map((s) => s.detect(deadlockPath)));
});

// Read a source into the neutral format and mark what Grimoire already has,
// using the same filters as the import so the preview never promises more.
ipcMain.handle(
    'interchange:read',
    async (_, req: InterchangeSourceRequest): Promise<InterchangePreview> => {
        const document = await readSource(req);
        const dryRun = await importInterchange(document, {
            deadlockPath: requireDeadlockPath(),
            planOnly: true,
            isKnownSubmission: catalogSubmissionLookup(),
        });
        return { document, status: dryRun.status };
    }
);

// Import the chosen sections. A recovery snapshot is taken first, like the
// update path; its failure is non-fatal. Progress goes to the calling window.
ipcMain.handle(
    'interchange:import',
    async (
        event,
        req: { document: InterchangeDocument; selection: InterchangeImportSelection }
    ): Promise<InterchangeImportReport> => {
        const deadlockPath = requireDeadlockPath();
        // The import moves and renames files in the addons folder the running
        // game has open; Grimoire never touches loaded mods mid-session.
        if (await isDeadlockRunning()) {
            throw new Error('Close Deadlock before importing mods.');
        }
        const fromDmm = req.document.source.manager === 'deadlock-mod-manager';
        try {
            await writeSnapshot(deadlockPath, fromDmm ? 'pre-dmm-import' : 'pre-mod-import');
        } catch (err) {
            console.warn('[Interchange] pre-import snapshot failed (continuing):', err);
        }
        return importInterchangeSelection(req.document, req.selection, {
            deadlockPath,
            isKnownSubmission: catalogSubmissionLookup(),
            backupTag: fromDmm ? 'pre-dmm-import' : 'pre-mod-import',
            onProgress: (progress) => {
                if (!event.sender.isDestroyed()) event.sender.send('interchange:progress', progress);
            },
        });
    }
);

// Export Grimoire's library as a bundle other mod managers can import.
ipcMain.handle(
    'interchange:export',
    (
        event,
        req: { destinationDir: string; selection: InterchangeExportSelection }
    ): Promise<InterchangeExportReport> => {
        return exportGrimoireLibrary(requireDeadlockPath(), req.destinationDir, req.selection, (progress) => {
            if (!event.sender.isDestroyed()) event.sender.send('interchange:progress', progress);
        });
    }
);
