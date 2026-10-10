// Centralized logging + bug-report bundler.
//
// initLogger() wires electron-log as the destination for every console.* call
// in the main process so an installed user has a single rolling file
// (~/.config/grimoire/logs/main.log on Linux, %AppData%\grimoire\logs\main.log
// on Windows) we can ask them to attach when they file a bug. We deliberately
// do NOT auto-upload anything — every transfer is user-initiated, consistent
// with the zero-telemetry rule in the workspace CLAUDE.md.

import log from 'electron-log';
import { app } from 'electron';
import { promises as fs } from 'fs';
import os from 'os';
import { sanitize } from './diagnosticSanitize';
export { sanitize } from './diagnosticSanitize';
import { getInstallSource } from './updater';
// Static, not dynamic: ipc/modDatabase already imports both of these at
// startup, so a dynamic import saved nothing and only drew a rollup
// "dynamically imported but also statically imported" warning.
import { getSyncStatus, isSyncInProgress, needsSync } from './syncService';
import { getModCount } from './modDatabase';

// Tail size for the diagnostic report. 256 KB is ~3-5k log lines: plenty of
// context for the typical "I just hit a bug" report without ballooning the
// attachment past what Discord/GitHub accept inline.
const REPORT_TAIL_BYTES = 256 * 1024;

let loggerInitialized = false;

export function initLogger(): void {
    if (loggerInitialized) return;
    loggerInitialized = true;

    log.transports.file.level = 'info';
    // A packaged GUI app cannot assume its launcher's stdout/stderr pipes will
    // remain open. Writing a later log line to a closed pipe emits an
    // unhandled EPIPE and Electron shows it as a main-process crash dialog.
    // Development keeps terminal output; installed builds use the rolling
    // file below as their durable diagnostic destination.
    log.transports.console.level = app.isPackaged ? false : 'debug';
    // Rotate at ~5 MB. electron-log keeps one archived copy (main.old.log) by
    // default, so total log footprint is capped around 10 MB.
    log.transports.file.maxSize = 5 * 1024 * 1024;
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

    // Route every console.* in the main process through electron-log so the
    // existing 100+ console.log/warn/error call sites land in the rolling
    // file with zero per-site changes.
    Object.assign(console, log.functions);

    log.info(
        `[diagnostics] logger ready; version=${app.getVersion()} ` +
        `platform=${process.platform}/${process.arch} ` +
        `electron=${process.versions.electron} node=${process.versions.node}`
    );
}

function getLogFilePath(): string {
    return log.transports.file.getFile().path;
}

export interface BuildReportOptions {
    /** When true, include the entire current main.log instead of the 256 KB
     *  tail. The rotated main.old.log is never included either way. */
    includeFullLog?: boolean;
}

/** Build the full sanitized report body shared by the in-app copy-to-clipboard
 *  flow and the save-to-file flow. Description is what the user typed in the
 *  "what happened" textarea; pass '' when there isn't one. */
export async function buildReportText(
    description: string,
    options: BuildReportOptions = {},
): Promise<string> {
    const logPath = getLogFilePath();
    const includeFullLog = options.includeFullLog === true;
    const rawLog = includeFullLog
        ? await readFullLog(logPath)
        : await readLogTail(logPath, REPORT_TAIL_BYTES);
    const sanitizedLog = sanitize(rawLog);
    const sanitizedDesc = sanitize((description ?? '').trim());

    const headerLines = [
        '=== Grimoire diagnostic report ===',
        `Generated:    ${new Date().toISOString()}`,
        `App version:  ${app.getVersion()}`,
        `Install:      ${getInstallSource()}`,
        `Platform:     ${process.platform} ${process.arch}`,
        `OS release:   ${os.release()}`,
        `Electron:     ${process.versions.electron}`,
        `Chrome:       ${process.versions.chrome}`,
        `Node:         ${process.versions.node}`,
    ];

    const parts = [headerLines.join('\n')];
    if (sanitizedDesc) {
        parts.push('--- what happened ---', sanitizedDesc);
    }
    // Sanitized like every other body in the report: the failure path below
    // surfaces errno messages from initDatabase(), which carry the full
    // userData path (and therefore the OS username) on EACCES/ENOENT.
    parts.push('--- catalog ---', sanitize(buildCatalogSection()));
    const logLabel = includeFullLog
        ? '--- full main.log (sanitized) ---'
        : `--- last ${Math.round(REPORT_TAIL_BYTES / 1024)} KB of main.log (sanitized) ---`;
    parts.push(logLabel, sanitizedLog || '<log file empty>');
    return parts.join('\n\n');
}

/** State of the local catalog mirror.
 *
 *  Browse routes its content-rating, date-added, A-Z and full-text filters
 *  through this mirror and silently falls back to the (much less capable)
 *  remote API when it is thin or missing. Reports used to carry no trace of
 *  that at all, which made "my filters do nothing" undiagnosable. */
function buildCatalogSection(): string {
    try {
        const lines = [
            `Total cached mods: ${getModCount()}`,
            `Sync in progress:  ${isSyncInProgress()}`,
            `Needs sync:        ${needsSync()}`,
        ];
        for (const [section, state] of Object.entries(getSyncStatus())) {
            lines.push(
                state
                    ? `  ${section}: ${state.count} mods, last sync ${new Date(state.lastSync * 1000).toISOString()}`
                    : `  ${section}: never synced`
            );
        }
        return lines.join('\n');
    } catch (err) {
        return `<could not read catalog state: ${err instanceof Error ? err.message : String(err)}>`;
    }
}

async function readFullLog(path: string): Promise<string> {
    try {
        return await fs.readFile(path, 'utf8');
    } catch (err) {
        return `<could not read log file: ${err instanceof Error ? err.message : String(err)}>`;
    }
}

async function readLogTail(path: string, maxBytes: number): Promise<string> {
    try {
        const stat = await fs.stat(path);
        const start = Math.max(0, stat.size - maxBytes);
        const length = stat.size - start;
        if (length <= 0) return '';
        const fh = await fs.open(path, 'r');
        try {
            const buf = Buffer.alloc(length);
            await fh.read(buf, 0, length, start);
            return buf.toString('utf8');
        } finally {
            await fh.close();
        }
    } catch (err) {
        return `<could not read log file: ${err instanceof Error ? err.message : String(err)}>`;
    }
}
