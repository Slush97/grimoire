import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, join, resolve } from 'path';
import { fatalResourceError, readCrashDiagnostics } from './crashEvidence';
import { sanitize } from './diagnosticSanitize';
import type { CrashHistoryPage, CrashReportDetail, CrashReportSummary } from '../../../src/types/crashHistory';

interface ReportFile {
    path: string;
    size: number;
    modified: number;
    source: 'game' | 'steam';
}
interface ReportGroup {
    summary: CrashReportSummary;
    diagnostics: string;
    files: ReportFile[];
}
type RecordedContext = Pick<CrashReportSummary, 'gameBuild' | 'suspectedMod' | 'attribution'>;
type ContextReader = (crashedAt: number, entry: string) => Promise<RecordedContext | null>;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

/** On-demand history. It never changes or removes game files. */
export class CrashHistory {
    private reports = new Map<string, ReportGroup>();
    private cache = new Map<string, { signature: string; report: ReportGroup }>();
    private gamePath: string;
    private steamRoots: string[];
    private context?: ContextReader;

    constructor(gamePath: string, steamRoots: string[], context?: ContextReader) {
        this.gamePath = gamePath;
        this.steamRoots = steamRoots;
        this.context = context;
    }

    private async discover(): Promise<ReportFile[]> {
        const roots = new Map(this.steamRoots.map(root => [join(root, 'dumps'), 'steam' as const]));
        const folders: { path: string; source: 'game' | 'steam' }[] = [...roots].map(([path, source]) => ({ path, source }));
        if (this.gamePath) folders.unshift({ path: join(this.gamePath, 'game/bin/win64'), source: 'game' });
        const files: ReportFile[] = [];
        for (const folder of folders) {
            try {
                for (const item of await fs.readdir(folder.path, { withFileTypes: true })) {
                    if (!item.isFile() || !/^crash_deadlock\.exe_.*\.dmp$/i.test(item.name) && !/^deadlock_.*\.mdmp$/i.test(item.name)) continue;
                    const path = join(folder.path, item.name);
                    try {
                        const stat = await fs.lstat(path);
                        if (stat.isFile()) files.push({ path, size: stat.size, modified: stat.mtimeMs, source: folder.source });
                    } catch { /* A report can disappear during Steam maintenance. */ }
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
        }
        return files.sort((a, b) => b.modified - a.modified);
    }

    private async read(file: ReportFile): Promise<ReportGroup> {
        const signature = `${file.size}:${file.modified}`;
        let cached = this.cache.get(file.path);
        if (!cached || cached.signature !== signature) {
            let summary: CrashReportSummary = { id: digest(file.path), crashedAt: file.modified, kind: 'unreadable', copies: 1 };
            let diagnostics = '';
            try {
                const data = await readCrashDiagnostics(file.path);
                const after = await fs.lstat(file.path);
                if (!after.isFile() || after.size !== file.size || after.mtimeMs !== file.modified) throw new Error('Crash report is still changing');
                if (data) {
                    const fatal = fatalResourceError(data.comments);
                    const error = fatal?.error ?? data.comments.split(/\r?\n/).find(line => line.includes('FATAL ERROR:'))?.slice(0, 1200);
                    summary = { id: data.pid !== undefined && data.createdAt > 0
                        ? digest(JSON.stringify([data.pid, data.createdAt, data.exceptionCode])) : digest(file.path),
                        crashedAt: data.createdAt > 0 ? data.createdAt : file.modified, exceptionCode: data.exceptionCode,
                        kind: fatal ? 'resource-error' : error ? 'fatal-error' : data.exceptionCode === '0xc0000005' ? 'access-violation'
                            : data.exceptionCode ? 'exception' : 'unknown',
                        error: error ? sanitize(error) : undefined, resource: fatal?.entry, copies: 1 };
                    diagnostics = sanitize(data.comments).slice(0, 64 * 1024);
                }
            } catch { /* Failed and incomplete dumps remain visible without an accusation. */ }
            cached = { signature, report: { summary, diagnostics, files: [file] } };
            if (summary.kind !== 'unreadable') this.cache.set(file.path, cached);
            if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
        }
        const summary = { ...cached.report.summary };
        if (summary.resource && this.context) {
            const context = await this.context(summary.crashedAt, summary.resource);
            if (context) Object.assign(summary, context, { suspectedMod: context.suspectedMod ? sanitize(context.suspectedMod) : undefined });
        }
        return { ...cached.report, summary, files: [file] };
    }

    async list(offset = 0): Promise<CrashHistoryPage> {
        const files = await this.discover();
        const groups = new Map<string, ReportGroup>();
        // Four concurrent bounded reads keep large folders off the UI thread.
        for (let start = 0; start < files.length; start += 4) {
            const reports = await Promise.all(files.slice(start, start + 4).map(file => this.read(file)));
            for (const report of reports) {
                const existing = groups.get(report.summary.id);
                if (!existing) groups.set(report.summary.id, report);
                else {
                    existing.files.push(...report.files);
                    if (report.diagnostics.length > existing.diagnostics.length) existing.diagnostics = report.diagnostics;
                    if (report.summary.error && !existing.summary.error) existing.summary = report.summary;
                    existing.summary.copies = existing.files.length;
                }
            }
        }
        const sorted = [...groups.values()].sort((a, b) => b.summary.crashedAt - a.summary.crashedAt || a.summary.id.localeCompare(b.summary.id));
        this.reports = new Map(sorted.map(report => [report.summary.id, report]));
        const page = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
        return { reports: sorted.slice(page, page + 50).map(report => report.summary), total: sorted.length };
    }

    private async file(id: string): Promise<{ report: ReportGroup; file: ReportFile }> {
        const report = this.reports.get(id);
        if (!report) throw new Error('Refresh crash history and try again');
        for (const file of report.files) {
            try {
                const stat = await fs.lstat(file.path);
                if (stat.isFile() && stat.size === file.size && stat.mtimeMs === file.modified) return { report, file };
            } catch { /* Try another copy of the same report. */ }
        }
        throw new Error('Crash report changed or was removed. Refresh crash history');
    }

    async detail(id: string): Promise<CrashReportDetail> {
        const { report } = await this.file(id);
        return { ...report.summary, diagnostics: report.diagnostics,
            files: report.files.map(file => ({ name: basename(file.path), size: file.size, source: file.source })) };
    }

    async sourcePath(id: string): Promise<string> { return (await this.file(id)).file.path; }

    async saveDump(id: string, destination: string): Promise<void> {
        const { report, file } = await this.file(id);
        const target = resolve(destination);
        const normalize = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
        if (report.files.some(source => normalize(source.path) === normalize(target))) throw new Error('Choose a different location for the copy');
        await fs.copyFile(file.path, target);
    }

    async reportText(ids: string[]): Promise<string> {
        const sections: string[] = [];
        for (const id of [...new Set(ids)].slice(0, 10)) {
            try {
                const report = await this.detail(id);
                sections.push([
                    `Crash: ${new Date(report.crashedAt).toISOString()}`,
                    `Type: ${report.kind}${report.exceptionCode ? ` (${report.exceptionCode})` : ''}`,
                    `Game build: ${report.gameBuild ?? 'unknown'}`,
                    `Possible mod: ${report.suspectedMod ?? 'unknown'}`,
                    ...(report.attribution ? [`Configuration: ${report.attribution}`] : []),
                    ...report.files.map(file => `File: ${file.source}/${file.name}`),
                    report.error ?? '', report.diagnostics || '<no diagnostic comments>',
                ].filter(Boolean).join('\n'));
            } catch { sections.push('Selected crash report is no longer available.'); }
        }
        return sanitize(sections.join('\n\n'));
    }
}
