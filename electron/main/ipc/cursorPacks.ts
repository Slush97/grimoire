import { ipcMain, app } from 'electron';
import { promises as fs } from 'fs';
import { basename, dirname, extname, join } from 'path';
import type { CursorPacksState, CursorPreview } from '../../../src/types/electron';
import {
    deleteCursorPack,
    getCursorPacks,
    getCursorPreview,
    installCursorArchive,
    installCursorFiles,
    setActiveCursorPack,
} from '../services/cursorPacks';
import { isArchive } from '../services/extract';
import { getActiveDeadlockPath } from '../services/settings';

function requireDeadlockPath(): string {
    const deadlockPath = getActiveDeadlockPath();
    if (!deadlockPath) throw new Error('No Deadlock path configured');
    return deadlockPath;
}

ipcMain.handle('cursors:get', (): Promise<CursorPacksState> => getCursorPacks());

ipcMain.handle('cursors:set-active', (_, id: string | null): Promise<CursorPacksState> =>
    setActiveCursorPack(requireDeadlockPath(), id)
);

ipcMain.handle('cursors:delete', (_, id: string): Promise<CursorPacksState> =>
    deleteCursorPack(requireDeadlockPath(), id)
);

ipcMain.handle('cursors:preview', (_, id: string | null): Promise<CursorPreview> =>
    getCursorPreview(getActiveDeadlockPath(), id)
);

// One archive, or loose cursor files picked together. The first installed set
// is applied: importing is an explicit "use this".
ipcMain.handle('cursors:import-files', async (_, paths: string[]): Promise<CursorPacksState> => {
    const deadlockPath = requireDeadlockPath();
    const archive = paths.length === 1 && isArchive(paths[0]) ? paths[0] : null;
    let installed;
    if (archive) {
        const workDir = await fs.mkdtemp(join(app.getPath('temp'), 'grimoire-cursors-'));
        try {
            installed = await installCursorArchive(archive, workDir, {
                name: basename(archive, extname(archive)),
            });
        } finally {
            await fs.rm(workDir, { recursive: true, force: true });
        }
    } else {
        installed = await installCursorFiles(paths, basename(dirname(paths[0])));
    }
    if (installed.length === 0) {
        throw new Error('No cursor images were found. Cursor mods are BMP files named like cursor.bmp.');
    }
    return setActiveCursorPack(deadlockPath, installed[0].id);
});
