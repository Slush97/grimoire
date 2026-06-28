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

function getLogFilePath(): string {
    return log.transports.file.getFile().path;
}

// GPU + driver snapshot. This exists because a class of "black screen on a
// page" bugs (a transparent WebGL overlay compositing as opaque black) is
// driven entirely by the user's GPU / driver / hardware-acceleration path,
// which the rest of the report can't see. getGPUFeatureStatus() tells us
// whether gpu_compositing / webgl are accelerated, software, or disabled (the
// single most diagnostic signal for those reports); getGPUInfo('complete')
// adds the GPU name + driver version. None of this is PII.

/** Resolve a promise but give up after `ms`, so a wedged GPU process can never
 *  hang the whole report build. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } catch {
        return null;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Build the GPU/driver report lines. Always returns at least the feature
 *  status (synchronous); the device/driver detail is best-effort. Must be
 *  called after `app` is ready. */
export async function getGpuDiagnosticLines(): Promise<string[]> {
    const lines: string[] = [];

    // Feature status is synchronous and the most useful single signal: e.g.
    // `gpu_compositing: disabled_software` strongly implicates the black-screen
    // path. Surface the keys that bear on canvas compositing first.
    try {
        const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
        const keysOfInterest = ['gpu_compositing', 'webgl', 'webgl2', '2d_canvas'];
        const picked = keysOfInterest
            .filter((k) => k in status)
            .map((k) => `${k}=${status[k]}`);
        // Append any remaining keys so nothing is silently dropped.
        const rest = Object.keys(status)
            .filter((k) => !keysOfInterest.includes(k))
            .map((k) => `${k}=${status[k]}`);
        const all = [...picked, ...rest];
        if (all.length > 0) lines.push(`GPU features: ${all.join(', ')}`);
    } catch (err) {
        lines.push(`GPU features: <unavailable: ${err instanceof Error ? err.message : String(err)}>`);
    }

    // Device + driver detail. getGPUInfo can stall before the GPU process is
    // up, so cap it; a null result just omits these lines.
    try {
        const info = (await withTimeout(app.getGPUInfo('complete'), 2000)) as
            | {
                  gpuDevice?: Array<{
                      active?: boolean;
                      vendorId?: number;
                      deviceId?: number;
                      driverVendor?: string;
                      driverVersion?: string;
                  }>;
                  auxAttributes?: Record<string, unknown>;
              }
            | null;
        if (info) {
            const devices = info.gpuDevice ?? [];
            const primary = devices.find((d) => d.active) ?? devices[0];
            if (primary) {
                const vendor = primary.vendorId != null ? `0x${primary.vendorId.toString(16)}` : '?';
                const device = primary.deviceId != null ? `0x${primary.deviceId.toString(16)}` : '?';
                const driver = [primary.driverVendor, primary.driverVersion].filter(Boolean).join(' ');
                lines.push(`GPU device:   vendor=${vendor} device=${device}${driver ? ` driver=${driver}` : ''}`);
            }
            const aux = info.auxAttributes ?? {};
            const glRenderer = aux['glRenderer'];
            const glVendor = aux['glVendor'];
            if (typeof glRenderer === 'string' && glRenderer) {
                lines.push(`GPU renderer: ${typeof glVendor === 'string' && glVendor ? `${glVendor} ` : ''}${glRenderer}`);
            }
        }
    } catch (err) {
        lines.push(`GPU device:   <unavailable: ${err instanceof Error ? err.message : String(err)}>`);
    }

    return lines;
}

/** Log the GPU/driver snapshot to main.log once, so it's present even when a
 *  user never builds a report. Safe to call right after app ready. */
export async function logStartupGpuDiagnostics(): Promise<void> {
    try {
        const lines = await getGpuDiagnosticLines();
        if (lines.length > 0) log.info(`[diagnostics] ${lines.join(' | ')}`);
    } catch {
        // Diagnostics must never break startup.
    }
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

    const gpuLines = await getGpuDiagnosticLines();

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
        ...gpuLines,
    ];

    const parts = [headerLines.join('\n')];
    if (sanitizedDesc) {
        parts.push('--- what happened ---', sanitizedDesc);
    }
    const logLabel = includeFullLog
        ? '--- full main.log (sanitized) ---'
        : `--- last ${Math.round(REPORT_TAIL_BYTES / 1024)} KB of main.log (sanitized) ---`;
    parts.push(logLabel, sanitizedLog || '<log file empty>');
    return parts.join('\n\n');
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
