import { ipcMain } from 'electron';
import { buildReportText } from '../services/diagnostics';

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
    (_, description: unknown, options: unknown): Promise<string> => {
        const includeFullLog =
            typeof options === 'object' &&
            options !== null &&
            (options as { includeFullLog?: unknown }).includeFullLog === true;
        return buildReportText(
            typeof description === 'string' ? description : '',
            { includeFullLog },
        );
    },
);
