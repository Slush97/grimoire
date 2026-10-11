import { ipcMain, dialog, shell } from 'electron';
import { basename } from 'path';
import { buildReportText } from '../services/diagnostics';
import { crashHistory } from '../services/crashHistoryService';

// Renderer-side trace bridge.
//
// initLogger() only hooks console.* in the MAIN process, so nothing the
// renderer logs has ever reached main.log. That is why a Browse page that
// silently drops filters produced a diagnostic report with zero evidence in
// it: every decision that matters happens renderer-side. Routing a handful of
// deliberate trace points through here makes them show up in bug reports.
//
// Fire-and-forget (ipcMain.on, not handle) so tracing can never block a render,
// and both fields are clamped so a runaway caller cannot flood the log file.
ipcMain.on('diagnostics:trace', (_, scope: unknown, message: unknown) => {
    const safeScope = typeof scope === 'string' && scope ? scope.slice(0, 32) : 'renderer';
    const safeMessage = typeof message === 'string' ? message.slice(0, 512) : String(message);
    console.log(`[${safeScope}] ${safeMessage}`);
});

ipcMain.handle(
    'diagnostics:buildReport',
    async (_, description: unknown, options: unknown): Promise<string> => {
        const includeFullLog =
            typeof options === 'object' &&
            options !== null &&
            (options as { includeFullLog?: unknown }).includeFullLog === true;
        const report = await buildReportText(
            typeof description === 'string' ? description : '',
            { includeFullLog },
        );
        const ids = typeof options === 'object' && options !== null ? (options as { crashReportIds?: unknown }).crashReportIds : undefined;
        const selected = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)).slice(0, 10) : [];
        return selected.length ? `${report}\n\n--- selected Deadlock crashes ---\n\n${await crashHistory().reportText(selected)}` : report;
    },
);

ipcMain.handle('diagnostics:listCrashes', (_, offset: unknown) => crashHistory().list(typeof offset === 'number' ? offset : 0));
ipcMain.handle('diagnostics:crashDetail', (_, id: string) => crashHistory().detail(id));
ipcMain.handle('diagnostics:revealCrash', async (_, id: string) => shell.showItemInFolder(await crashHistory().sourcePath(id)));
ipcMain.handle('diagnostics:saveCrashDump', async (_, id: string): Promise<boolean> => {
    const history = crashHistory();
    const source = await history.sourcePath(id);
    const result = await dialog.showSaveDialog({ defaultPath: basename(source) });
    if (result.canceled || !result.filePath) return false;
    await history.saveDump(id, result.filePath);
    return true;
});
