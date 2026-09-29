import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { inspectModSource, MOD_SAFETY_POLICY_VERSION } from './modSafetyPolicy';
import type { ModSafetyFinding, ModSafetyReport } from '../../../src/types/modSafety';

// Bump for parser, decoder or finding changes, without invalidating user consent.
export const MOD_SAFETY_SCANNER_VERSION = 3;
const MAX_TREE = 16 * 1024 * 1024;
const MAX_SOURCE = 8 * 1024 * 1024;
const MAX_SOURCES = 64 * 1024 * 1024;
const MAX_ENTRIES = 100000;
const ASSETS = new Set(['vtex_c', 'vmat_c', 'vmdl_c', 'vmesh_c', 'vphys_c', 'vanim_c', 'vagrp_c',
    'vnmskel_c', 'vnmclip_c', 'vnmgraph_c', 'vnmvar_c', 'vnmikrig_c', 'vanmgrph_c', 'vmorf_c',
    'vseq_c', 'vsnd_c', 'vsndevts_c', 'vsndstck_c', 'vpcf_c', 'vpost_c', 'vfont', 'ttf', 'otf',
    'png', 'jpg', 'jpeg', 'webp', 'tga', 'dds', 'wav', 'mp3', 'ogg']);
const TEXT = new Set(['js', 'vjs', 'ts', 'vts', 'css', 'vcss', 'xml', 'vxml', 'html', 'htm', 'svg', 'vsvg', 'cfg', 'lua', 'nut']);
const COMPILED_TEXT = new Set(['vjs_c', 'vts_c', 'vcss_c', 'vsvg_c']);
const EXECUTABLE = new Set(['js', 'vjs', 'vjs_c', 'ts', 'vts', 'vts_c', 'lua', 'nut', 'cfg']);
const PROGRAMS = new Set(['exe', 'dll', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'lnk', 'msi', 'so', 'dylib', 'wasm']);
interface ScanBudget { archives: number; nestedBytes: number; entries: number; sourceBytes: number }
interface Entry { path: string; extension: string; preload: Buffer; file: string; offset: number; length: number }

function requireCondition(condition: unknown): asserts condition {
    if (!condition) throw new Error('Invalid or unsupported VPK resource');
}

/** The inspector itself could not run. Says nothing about the archive. */
class InspectionIncomplete extends Error {}

async function readExactly(file: FileHandle, size: number, offset: number): Promise<Buffer> {
    const buffer = Buffer.alloc(size);
    let n = 0;
    while (n < size) {
        const read = await file.read(buffer, n, size - n, offset + n);
        requireCondition(read.bytesRead > 0);
        n += read.bytesRead;
    }
    return buffer;
}

function validPath(path: string): boolean {
    return path.length <= 2048 && !/[\\:<>"|?*]/.test(path) && ![...path].some(c => c.charCodeAt(0) < 32)
        && path.split('/').every(p => p !== '' && p !== '.' && p !== '..' && !/[. ]$/.test(p)
            && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}

async function directory(path: string): Promise<{ entries: Entry[]; files: string[] }> {
    const handle = await fs.open(path, 'r');
    try {
        const header = await readExactly(handle, 12, 0);
        requireCondition(header.readUInt32LE(0) === 0x55aa1234);
        const version = header.readUInt32LE(4);
        requireCondition(version === 1 || version === 2);
        const headerSize = version === 2 ? 28 : 12;
        const treeSize = header.readUInt32LE(8);
        const stat = await handle.stat();
        requireCondition(treeSize > 0 && treeSize <= MAX_TREE && headerSize + treeSize <= stat.size);
        const tree = await readExactly(handle, treeSize, headerSize);
        const entries: Entry[] = [];
        const seen = new Set<string>();
        const sizes = new Map<string, number>([[path, stat.size]]);
        let cursor = 0;
        const string = () => {
            const end = tree.indexOf(0, cursor);
            requireCondition(end >= cursor && end - cursor <= 2048);
            const text = new TextDecoder('utf-8', { fatal: true }).decode(tree.subarray(cursor, end));
            cursor = end + 1;
            return text;
        };
        for (let extension = string(); extension !== ''; extension = string()) {
            // Like the root folder, a missing extension is stored as a single space.
            requireCondition(extension === ' ' || /^[a-z0-9_+.-]+$/i.test(extension));
            for (let folder = string(); folder !== ''; folder = string()) {
                for (let name = string(); name !== ''; name = string()) {
                    const entryPath = `${folder === ' ' ? '' : folder + '/'}${name}${extension === ' ' ? '' : '.' + extension}`;
                    requireCondition(validPath(entryPath) && !seen.has(entryPath.toLowerCase()));
                    requireCondition(cursor + 18 <= tree.length && entries.length < MAX_ENTRIES);
                    seen.add(entryPath.toLowerCase());
                    const preloadSize = tree.readUInt16LE(cursor + 4);
                    const archive = tree.readUInt16LE(cursor + 6);
                    let offset = tree.readUInt32LE(cursor + 8);
                    const length = tree.readUInt32LE(cursor + 12);
                    requireCondition(tree.readUInt16LE(cursor + 16) === 0xffff);
                    cursor += 18;
                    requireCondition(cursor + preloadSize <= tree.length);
                    const preload = tree.subarray(cursor, cursor + preloadSize);
                    cursor += preloadSize;
                    let file = path;
                    if (archive === 0x7fff) offset += headerSize + treeSize;
                    else if (length > 0) {
                        requireCondition(/_dir\.vpk$/i.test(path));
                        file = path.replace(/_dir\.vpk$/i, `_${String(archive).padStart(3, '0')}.vpk`);
                    }
                    if (length > 0) {
                        if (!sizes.has(file)) sizes.set(file, (await fs.stat(file)).size);
                        requireCondition(offset + length <= sizes.get(file)!);
                    }
                    entries.push({ path: entryPath, extension: extension.trim().toLowerCase(), preload, file, offset, length });
                }
            }
        }
        requireCondition(cursor === tree.length && entries.length > 0);
        return { entries, files: [...sizes.keys()] };
    } finally { await handle.close(); }
}

async function hashFiles(files: string[]): Promise<string> {
    const hash = createHash('sha256').update(`grimoire-safety:${MOD_SAFETY_POLICY_VERSION}\0`);
    for (const file of files) {
        const stat = await fs.stat(file);
        hash.update(`${stat.size}:`);
        for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
    return hash.digest('hex');
}

function resourceData(bytes: Buffer, extension: string): Buffer {
    requireCondition(bytes.length >= 16 && bytes.readUInt16LE(4) === 12 && bytes.readUInt32LE(0) === bytes.length);
    const table = 8 + bytes.readUInt32LE(8);
    const count = bytes.readUInt32LE(12);
    requireCondition(count <= 64 && table >= 16 && table + count * 12 <= bytes.length);
    const tags = new Set<string>();
    let source: Buffer | undefined;
    for (let i = 0; i < count; i++) {
        const start = table + i * 12;
        const offset = start + 4 + bytes.readUInt32LE(start + 4);
        const length = bytes.readUInt32LE(start + 8);
        requireCondition(offset >= table + count * 12 && offset + length <= bytes.length);
        const tag = bytes.toString('ascii', start, start + 4);
        requireCondition(!tags.has(tag));
        tags.add(tag);
        if (tag !== 'DATA') continue;
        const data = bytes.subarray(offset, offset + length);
        if (extension === 'vjs_c' || extension === 'vts_c') { source = data; continue; }
        // Panorama styles/SVG carry a CRC and an image-name table before text.
        requireCondition(data.length >= 6);
        const names = data.readUInt16LE(4);
        let p = 6;
        const references: Buffer[] = [];
        for (let j = 0; j < names; j++) {
            const end = data.indexOf(0, p);
            requireCondition(end >= p);
            references.push(data.subarray(p, end), Buffer.from('\n'));
            p = end + 1 + 8;
            requireCondition(p <= data.length);
        }
        source = Buffer.concat([...references, data.subarray(p)]);
    }
    requireCondition(source);
    return source;
}

async function decodeLayouts(vpk: string, entries: Entry[], binary: string): Promise<Map<string, string>> {
    const staging = await fs.mkdtemp(join(tmpdir(), 'grimoire-safety-'));
    try {
        // Paths and sizes have been validated before invoking the bundled decoder.
        const args = ['panorama', 'dump', '--vpk', vpk, '--out-dir', staging, '--no-raw'];
        for (const entry of entries) args.push('--prefix', entry.path);
        await new Promise<void>((done, fail) => {
            const child = spawn(binary, args, { stdio: 'ignore', timeout: 30000, windowsHide: true });
            child.once('error', (err: NodeJS.ErrnoException) => fail(err.syscall?.startsWith('spawn') ? new InspectionIncomplete() : err));
            child.once('close', code => code === 0 ? done() : fail(new Error('Layout decoder failed')));
        });
        // The report lists every archive entry, filtered ones included, so it
        // grows with the archive: read it from disk rather than a capped pipe.
        const report = JSON.parse(await fs.readFile(join(staging, '_manifest.json'), 'utf8'));
        requireCondition(Array.isArray(report.entries));
        const result = new Map<string, string>();
        for (const entry of entries) {
            const decoded = report.entries.find((r: { entry: string }) => r.entry === entry.path);
            requireCondition(decoded?.mode === 'layout-xml' && typeof decoded.source_path === 'string');
            const source = resolve(staging, decoded.source_path);
            requireCondition(source.startsWith(resolve(staging) + sep) && (await fs.stat(source)).size <= MAX_SOURCE);
            result.set(entry.path, await fs.readFile(source, 'utf8'));
        }
        return result;
    } finally { await fs.rm(staging, { recursive: true, force: true }); }
}

async function readCachedReport(cacheDir: string, fingerprint: string): Promise<ModSafetyReport | undefined> {
    try {
        const file = join(cacheDir, `${fingerprint}.json`);
        requireCondition((await fs.stat(file)).size <= 1024 * 1024);
        const cached = JSON.parse(await fs.readFile(file, 'utf8'));
        const report = cached.report;
        requireCondition(cached.scannerVersion === MOD_SAFETY_SCANNER_VERSION
            && report.policyVersion === MOD_SAFETY_POLICY_VERSION && report.fingerprint === fingerprint
            && Array.isArray(report.findings) && report.findings.length <= 200);
        const reasons = new Set(['local-file', 'browser', 'remote-code', 'dynamic-code', 'executable', 'uninspectable', 'native-code']);
        requireCondition(report.findings.every((f: ModSafetyFinding) => f && typeof f.entry === 'string'
            && f.entry.length <= 16384 && reasons.has(f.reason)));
        requireCondition(report.verdict === (report.findings.length ? 'requires-trust' : 'no-findings'));
        return report;
    } catch { return undefined; }
}

async function scanArchive(path: string, binary: string | undefined, budget: ScanBudget, depth: number, cacheDir?: string): Promise<ModSafetyReport> {
    const findings: ModSafetyFinding[] = [];
    let fingerprint = '';
    let blocked = false;
    let incomplete = false;
    const add = (finding: ModSafetyFinding) => {
        if (finding.reason === 'unreadable-archive') blocked = true;
        if (finding.reason === 'inspection-failed') incomplete = true;
        if (findings.length < 200) findings.push(finding);
        else if (finding.reason === 'unreadable-archive' || (finding.reason !== 'executable'
            && findings[199].reason !== 'unreadable-archive')) findings[199] = finding;
    };
    try {
        const initial = await fs.stat(path);
        const { entries, files } = await directory(path);
        budget.entries += entries.length;
        requireCondition(budget.entries <= MAX_ENTRIES);
        const before = await Promise.all(files.map(async f => { const s = await fs.stat(f); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }));
        requireCondition(before[0] === `${initial.size}:${initial.mtimeMs}:${initial.ctimeMs}`);
        fingerprint = await hashFiles(files);
        if (cacheDir) {
            const cached = await readCachedReport(cacheDir, fingerprint);
            if (cached) {
                const after = await Promise.all(files.map(async f => { const s = await fs.stat(f); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }));
                requireCondition(before.every((s, i) => s === after[i]));
                return cached;
            }
        }
        const layouts: Entry[] = [];
        for (const entry of entries) {
            const ext = entry.extension;
            if (ASSETS.has(ext) || /\.vnmgraph\.\+[a-z0-9_-]+_c$/i.test(entry.path)) continue;
            if (ext === 'vpk') {
                const size = entry.preload.length + entry.length;
                budget.nestedBytes += size;
                requireCondition(depth < 4 && ++budget.archives <= 64 && size <= 128 * 1024 * 1024
                    && budget.nestedBytes <= 256 * 1024 * 1024);
                const staging = await fs.mkdtemp(join(tmpdir(), 'grimoire-nested-safety-'));
                try {
                    const handle = await fs.open(entry.file, 'r');
                    const nested = join(staging, 'nested_dir.vpk');
                    try { await fs.writeFile(nested, Buffer.concat([entry.preload, await readExactly(handle, entry.length, entry.offset)])); }
                    finally { await handle.close(); }
                    const report = await scanArchive(nested, binary, budget, depth + 1);
                    for (const finding of report.findings) add({ ...finding, entry: `${entry.path} > ${finding.entry}` });
                } finally { await fs.rm(staging, { recursive: true, force: true }); }
                continue;
            }
            if (PROGRAMS.has(ext)) { add({ entry: entry.path, reason: 'native-code' }); continue; }
            if (ext !== 'vxml_c' && !TEXT.has(ext) && !COMPILED_TEXT.has(ext)) {
                continue;
            }
            budget.sourceBytes += entry.preload.length + entry.length;
            requireCondition(entry.length + entry.preload.length <= MAX_SOURCE && budget.sourceBytes <= MAX_SOURCES);
            if (ext === 'vxml_c') {
                layouts.push(entry); continue;
            }
            const handle = await fs.open(entry.file, 'r');
            let bytes: Buffer;
            try { bytes = Buffer.concat([entry.preload, await readExactly(handle, entry.length, entry.offset)]); }
            finally { await handle.close(); }
            if (COMPILED_TEXT.has(ext)) bytes = resourceData(bytes, ext);
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0$/, '');
            requireCondition(!text.includes('\0'));
            const isJs = ['js', 'vjs', 'vjs_c', 'vts_c'].includes(ext);
            const sourceFindings = inspectModSource(entry.path, text, isJs);
            if (EXECUTABLE.has(ext) || sourceFindings.some(f => f.reason === 'executable' || f.reason === 'browser'
                || f.reason === 'dynamic-code' || f.reason === 'remote-code')) {
                for (const finding of sourceFindings) add(finding);
            }
            if (EXECUTABLE.has(ext) && !isJs) add({ entry: entry.path, reason: 'executable' });
        }
        if (layouts.length) {
            requireCondition(layouts.length <= 128);
            if (!binary) throw new InspectionIncomplete();
            const decoded = await decodeLayouts(path, layouts, binary);
            for (const [entry, text] of decoded) {
                const sourceFindings = inspectModSource(entry, text, false);
                if (sourceFindings.some(f => f.reason === 'executable' || f.reason === 'browser'
                    || f.reason === 'dynamic-code' || f.reason === 'remote-code')) {
                    for (const finding of sourceFindings) add(finding);
                }
            }
        }
        const after = await Promise.all(files.map(async f => { const s = await fs.stat(f); return `${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }));
        requireCondition(before.every((s, i) => s === after[i]));
    } catch (err) {
        add({ entry: basename(path), reason: err instanceof InspectionIncomplete ? 'inspection-failed' : 'unreadable-archive' });
    }
    return {
        policyVersion: MOD_SAFETY_POLICY_VERSION, fingerprint,
        verdict: blocked ? 'blocked' : incomplete ? 'incomplete' : findings.length ? 'requires-trust' : 'no-findings',
        findings,
    };
}

export async function scanModSafety(path: string, binary?: string, cacheDir?: string): Promise<ModSafetyReport> {
    const report = await scanArchive(path, binary, { archives: 0, nestedBytes: 0, entries: 0, sourceBytes: 0 }, 0, cacheDir);
    if (cacheDir && (report.verdict === 'no-findings' || report.verdict === 'requires-trust')) {
        const temp = join(cacheDir, `${randomUUID()}.tmp`);
        try {
            await fs.mkdir(cacheDir, { recursive: true });
            // Keep an existing valid report untouched on cache hits.
            if (!await readCachedReport(cacheDir, report.fingerprint)) {
                await fs.writeFile(temp, JSON.stringify({ scannerVersion: MOD_SAFETY_SCANNER_VERSION, report }));
                await fs.rename(temp, join(cacheDir, `${report.fingerprint}.json`));
            }
        } catch { /* Cache failures do not change the scan result. */ }
        finally { await fs.unlink(temp).catch(() => {}); }
    }
    return report;
}
