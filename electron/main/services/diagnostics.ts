// Centralized logging + bug-report bundler.
//
// initLogger() wires electron-log as the destination for every console.* call
// in the main process so an installed user has a single rolling file
// (~/.config/grimoire/logs/main.log on Linux, %AppData%\grimoire\logs\main.log
// on Windows) we can ask them to attach when they file a bug. We deliberately
// do NOT auto-upload anything — every transfer is user-initiated, consistent
// with the zero-telemetry rule in the workspace CLAUDE.md.

import log from 'electron-log';
import { app, dialog, shell } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';
import os from 'os';
import { getInstallSource } from './updater';

// Tail size for the diagnostic report. 256 KB is ~3-5k log lines: plenty of
// context for the typical "I just hit a bug" report without ballooning the
// attachment past what Discord/GitHub accept inline.
const REPORT_TAIL_BYTES = 256 * 1024;

let loggerInitialized = false;

export function initLogger(): void {
    if (loggerInitialized) return;
    loggerInitialized = true;

    log.transports.file.level = 'info';
    log.transports.console.level = 'debug';
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

export function getLogFilePath(): string {
    return log.transports.file.getFile().path;
}

/** Highlight the log file in the user's file manager. Works on Windows
 *  Explorer, macOS Finder, and most freedesktop-compliant Linux DEs. */
export function openLogsFolder(): void {
    shell.showItemInFolder(getLogFilePath());
}

// Redaction rules applied to every report body and to the saved .txt file.
// Order matters: more-specific patterns (Authorization headers) run before
// generic ones (bearer tokens). All replacements use opaque placeholders so a
// reader can tell a value was redacted versus simply absent.
const SANITIZERS: Array<{ pattern: RegExp; replacement: string }> = [
    // Linux/macOS home paths: keep the path structure, drop the username.
    // The path after the home dir (a SteamLibrary mount, for example) isn't
    // PII; the username is.
    { pattern: /\/home\/[^/\s"'`]+/g, replacement: '/home/<user>' },
    { pattern: /\/Users\/[^/\s"'`]+/g, replacement: '/Users/<user>' },
    // Windows: `C:\Users\Alice\...` -> `C:\Users\<user>\...`.
    { pattern: /([A-Za-z]:\\Users\\)[^\\\s"'`]+/g, replacement: '$1<user>' },

    // SteamID64 — real Steam user IDs start 7656119 and are 17 digits.
    { pattern: /\b7656119\d{10}\b/g, replacement: '<steamid64>' },
    // 32-bit account id in deadlock-api / Steam URLs.
    { pattern: /(account_id=|\/players?\/)(\d{4,12})/g, replacement: '$1<accountid>' },

    // Authorization headers / bearer tokens / JWTs / Steam OpenID secrets.
    { pattern: /(Authorization:\s*Bearer\s+)\S+/gi, replacement: '$1<token>' },
    { pattern: /(Bearer\s+)[A-Za-z0-9._-]{10,}/g, replacement: '$1<token>' },
    { pattern: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, replacement: '<jwt>' },

    // Emails (in case a user pastes one into the description).
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: '<email>' },
];

/** Strip PII / secrets from a diagnostic-bound string. The patterns above
 *  cover the structured shapes; we also do a final pass that wipes any
 *  literal occurrence of the running user's home dir, which catches edge
 *  cases like a custom Windows username with spaces that the regex misses. */
export function sanitize(text: string): string {
    let out = text;
    for (const { pattern, replacement } of SANITIZERS) {
        out = out.replace(pattern, replacement);
    }
    const home = os.homedir();
    if (home && home.length > 3) {
        const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(escaped, 'g'), '<home>');
    }
    return out;
}

/** Build the full sanitized report body shared by the in-app copy-to-clipboard
 *  flow and the save-to-file flow. Description is what the user typed in the
 *  "what happened" textarea; pass '' when there isn't one. */
export async function buildReportText(description: string): Promise<string> {
    const logPath = getLogFilePath();
    const rawTail = await readLogTail(logPath, REPORT_TAIL_BYTES);
    const sanitizedTail = sanitize(rawTail);
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
    parts.push(
        `--- last ${Math.round(REPORT_TAIL_BYTES / 1024)} KB of main.log (sanitized) ---`,
        sanitizedTail || '<log file empty>',
    );
    return parts.join('\n\n');
}

export interface DiagnosticReport {
    path: string;
}

/** Bundle app version, OS info, and the tail of main.log into a single .txt
 *  the user can attach to a bug report. Prompts for save location, defaulting
 *  to the desktop. Returns the saved path, or null if the user cancelled. */
export async function saveDiagnosticReport(): Promise<DiagnosticReport | null> {
    const body = await buildReportText('');

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    const defaultName = `grimoire-diagnostic-${stamp}.txt`;
    const defaultDir = safeDesktopPath() ?? app.getPath('userData');

    const result = await dialog.showSaveDialog({
        title: 'Save diagnostic report',
        defaultPath: join(defaultDir, defaultName),
        filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return null;

    await fs.writeFile(result.filePath, body, 'utf8');
    log.info('[diagnostics] saved diagnostic report to', result.filePath);
    return { path: result.filePath };
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

function safeDesktopPath(): string | null {
    // app.getPath('desktop') throws if the OS has no resolved desktop dir
    // (rare on Linux with minimal XDG configs). Fall back gracefully.
    try {
        return app.getPath('desktop');
    } catch {
        return null;
    }
}
