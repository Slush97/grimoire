import { app, BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import { createReadStream, promises as fs, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ModSafetyReport, ModSafetyPrompt, ModSafetySnapshot } from '../../../src/types/modSafety';
import { MOD_SAFETY_POLICY_VERSION } from './modSafetyPolicy';
import { vpkmergeBinaryPath } from './modMerger';

const pending = new Map<string, { prompt: ModSafetyPrompt; finish: (accepted: boolean) => void }>();
// Presentation only. Permission decisions hash current bytes before reusing a report.
// Renames carry an entry along; the size and mtime of the inspected file drop
// it once its path holds other bytes, whichever writer put them there.
const snapshots = new Map<string, ModSafetySnapshot & { size: number; mtimeMs: number }>();
export function modSafetySnapshot(path: string): ModSafetySnapshot | undefined {
    const entry = snapshots.get(path);
    if (!entry) return undefined;
    const stat = statSync(path, { throwIfNoEntry: false });
    if (stat?.size === entry.size && stat.mtimeMs === entry.mtimeMs) return { report: entry.report, trusted: entry.trusted };
    snapshots.delete(path);
    return undefined;
}
export function moveSafetySnapshot(from: string, to: string): void {
    const value = snapshots.get(from);
    snapshots.delete(from);
    if (value) snapshots.set(to, value);
    else snapshots.delete(to);
}
export function forgetSafetySnapshot(path: string): void { snapshots.delete(path); }
let trustWrite: Promise<void> = Promise.resolve();
let scanQueue: Promise<unknown> = Promise.resolve();

export function notifyModSafetyChanged(): void {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('mod-safety-changed');
}

async function approvals(): Promise<Set<string>> {
    try {
        const data = JSON.parse(await fs.readFile(join(app.getPath('userData'), 'mod-safety-trust.json'), 'utf8'));
        return new Set(Array.isArray(data) ? data.filter((x: unknown) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)) : []);
    } catch { return new Set(); }
}

export async function isModSafetyTrusted(report: ModSafetyReport): Promise<boolean> {
    return report.verdict === 'no-findings' || (report.verdict === 'requires-trust'
        && !!report.fingerprint && (await approvals()).has(report.fingerprint));
}

/**
 * Settles every pending prompt for these bytes. Prompts are raised while the
 * caller holds the mod mutation lock, so a decision made anywhere else must
 * reach them. Returns whether an operation was waiting on the decision.
 */
function settlePrompts(fingerprint: string, accepted: boolean): boolean {
    let waiting = false;
    for (const request of [...pending.values()]) {
        if (!fingerprint || request.prompt.report.fingerprint !== fingerprint) continue;
        waiting ||= request.prompt.canTrust;
        request.finish(accepted && request.prompt.canTrust);
    }
    return waiting;
}

async function saveApproval(report: ModSafetyReport): Promise<boolean> {
    if (report.verdict !== 'requires-trust' || !report.fingerprint) throw new Error('MOD_SAFETY_BLOCKED');
    const write = trustWrite.then(async () => {
        const trusted = await approvals();
        trusted.add(report.fingerprint);
        const file = join(app.getPath('userData'), 'mod-safety-trust.json');
        const temp = `${file}.${randomUUID()}.tmp`;
        await fs.writeFile(temp, JSON.stringify([...trusted]), { mode: 0o600 });
        await fs.rename(temp, file);
        for (const value of snapshots.values()) {
            if (value.report.fingerprint === report.fingerprint) value.trusted = true;
        }
        notifyModSafetyChanged();
    });
    trustWrite = write.catch(() => {});
    await write;
    await fs.rm(join(quarantineRoot(), report.fingerprint), { recursive: true, force: true }).catch(() => {});
    return settlePrompts(report.fingerprint, true);
}

/**
 * Consent applies only to the exact report the user reviewed. Resolves true
 * when an operation was waiting on this version; that operation activates it.
 */
export async function approveVpkSafety(path: string, fingerprint: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid mod safety decision');
    const current = await inspectVpkSafety(path);
    if (current.fingerprint !== fingerprint) throw new Error('MOD_SAFETY_CHANGED');
    return saveApproval(current);
}

const GRIMOIRE_METADATA_ENTRIES = new Set(['addoninfo.txt', 'modinfo.json', 'grimoire_meta.json']);

/**
 * Trust for an archive Grimoire built from `inputs` alone: a merge, a rebuild
 * or an imprint repack. A finding none of the inputs has, outside Grimoire's
 * own metadata entries, means the output is not just their content
 * ('differs'). Otherwise it is exactly as trusted as they are, and when all of
 * them are, the user already allowed this content to run together, so the
 * approval carries to the new fingerprint. Fewer findings are fine: a merge
 * keeps only one input's copy of a colliding entry.
 */
export async function carryVpkSafety(inputs: string[], output: string): Promise<'trusted' | 'untrusted' | 'differs'> {
    const report = await inspectVpkSafety(output);
    if (await isModSafetyTrusted(report)) return 'trusted';
    if (report.verdict !== 'requires-trust') return 'differs';
    const covered = new Set<string>();
    let trusted = true;
    for (const input of inputs) {
        const source = await inspectVpkSafety(input);
        if (source.verdict === 'blocked' || source.verdict === 'incomplete') return 'differs';
        trusted &&= await isModSafetyTrusted(source);
        for (const finding of source.findings) covered.add(`${finding.reason}:${finding.entry}`);
    }
    if (!report.findings.every(finding => GRIMOIRE_METADATA_ENTRIES.has(finding.entry)
        || covered.has(`${finding.reason}:${finding.entry}`))) return 'differs';
    if (!trusted) return 'untrusted';
    await saveApproval(report);
    return 'trusted';
}

function inspectionFailure(path: string): ModSafetyReport {
    return { policyVersion: MOD_SAFETY_POLICY_VERSION, fingerprint: '', verdict: 'incomplete',
        findings: [{ entry: basename(path), reason: 'inspection-failed' }] };
}

/** Always hashes current bytes. UI snapshots are never authorization caches. */
export function inspectVpkSafety(path: string): Promise<ModSafetyReport> {
    // Taken before the worker reads, so bytes replaced mid-inspection never match.
    const inspected = fs.stat(path).catch(() => null);
    const task = scanQueue.then(async () => {
        let binary: string | undefined;
        // Without a decoder only archives with compiled layouts come back incomplete.
        try { binary = vpkmergeBinaryPath(); } catch { binary = undefined; }
        const report = await new Promise<ModSafetyReport>((resolve) => {
            let worker: Worker;
            try { worker = new Worker(join(__dirname, 'vpkSafetyWorker.js'), {
                resourceLimits: { maxOldGenerationSizeMb: 256, stackSizeMb: 8 },
            }); }
            catch { resolve(inspectionFailure(path)); return; }
            let done = false;
            const finish = (result: ModSafetyReport) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                void worker.terminate();
                resolve(result);
            };
            const timer = setTimeout(() => finish(inspectionFailure(path)), 120000);
            worker.once('message', finish);
            worker.once('error', () => finish(inspectionFailure(path)));
            worker.once('exit', () => finish(inspectionFailure(path)));
            worker.postMessage({ path, binary, cacheDir: join(app.getPath('userData'), 'mod-safety-reports') });
        });
        const stat = await inspected;
        if (stat) snapshots.set(path, { report, trusted: await isModSafetyTrusted(report), size: stat.size, mtimeMs: stat.mtimeMs });
        else snapshots.delete(path);
        return report;
    });
    scanQueue = task.catch(() => {});
    return task;
}

export function getModSafetyPrompts(): ModSafetyPrompt[] { return [...pending.values()].map(p => p.prompt); }
export function respondToModSafety(id: string, accepted: boolean): void {
    const request = pending.get(id);
    if (!request) return;
    if (!accepted) settlePrompts(request.prompt.report.fingerprint, false);
    request.finish(accepted === true && request.prompt.canTrust);
}

function ask(name: string, report: ModSafetyReport, canTrust: boolean, restartRequired = false,
    context: ModSafetyPrompt['context'] = 'activation'): Promise<boolean> {
    return new Promise(resolve => {
        const id = randomUUID();
        const timer = setTimeout(() => finish(false), 300000);
        function finish(accepted: boolean) {
            if (!pending.delete(id)) return;
            clearTimeout(timer);
            notifyModSafetyChanged();
            resolve(accepted);
        }
        pending.set(id, { prompt: { id, name, report, canTrust, restartRequired, context }, finish });
        notifyModSafetyChanged();
    });
}

export function announceUnsafeMod(name: string, report: ModSafetyReport, restartRequired = false): void {
    void ask(name, report, false, restartRequired, 'startup');
}

function quarantineRoot(): string { return join(app.getPath('userData'), 'mod-quarantine'); }

/** One copy per rejected version. Unreadable archives have no fingerprint, so they are keyed by their bytes. */
async function retainRejectedPackage(path: string, report: ModSafetyReport): Promise<void> {
    let id = report.fingerprint;
    if (!id) {
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(path)) hash.update(chunk);
        id = hash.digest('hex');
    }
    const root = join(quarantineRoot(), id);
    if (await fs.access(root).then(() => true, () => false)) return;
    // Staged so an interrupted copy is never mistaken for a retained version.
    const temp = `${root}.${randomUUID()}.tmp`;
    try {
        await fs.mkdir(temp, { recursive: true });
        const name = basename(path);
        await fs.copyFile(path, join(temp, name));
        if (/_dir\.vpk$/i.test(name)) {
            const prefix = name.slice(0, -8).toLowerCase();
            for (const sibling of await fs.readdir(dirname(path))) {
                if (sibling.toLowerCase().startsWith(prefix + '_') && /^\d{3}\.vpk$/i.test(sibling.slice(prefix.length + 1))) {
                    await fs.copyFile(join(dirname(path), sibling), join(temp, sibling));
                }
            }
        }
        await fs.writeFile(join(temp, 'safety-report.json'), JSON.stringify(report, null, 2));
        await fs.rename(temp, root);
    } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

/** Startup: retained packages are diagnostic only, so keep the newest 30 days up to 2 GiB. */
export async function pruneModQuarantine(): Promise<void> {
    const root = quarantineRoot();
    const folders = await Promise.all((await fs.readdir(root).catch(() => [])).map(async name => {
        const path = join(root, name);
        const sizes = await Promise.all((await fs.readdir(path)).map(async file => (await fs.stat(join(path, file))).size));
        return { path, time: (await fs.stat(path)).mtimeMs, size: sizes.reduce((a, b) => a + b, 0) };
    }));
    let kept = 0;
    for (const folder of folders.sort((a, b) => b.time - a.time)) {
        if (Date.now() - folder.time > 30 * 24 * 60 * 60 * 1000 || kept + folder.size > 2 * 1024 ** 3) {
            await fs.rm(folder.path, { recursive: true, force: true });
        } else kept += folder.size;
    }
}

export async function assertVpkSafety(path: string, options: {
    prompt?: boolean; allowUntrusted?: boolean; context?: ModSafetyPrompt['context']; name?: string;
} = {}): Promise<void> {
    const report = await inspectVpkSafety(path);
    if (await isModSafetyTrusted(report)) return;
    if (report.verdict === 'requires-trust' && options.allowUntrusted) return;
    if (options.prompt !== false) {
        const accepted = await ask(options.name ?? basename(path), report, report.verdict === 'requires-trust', false, options.context);
        if (accepted) {
            const current = await inspectVpkSafety(path);
            if (current.fingerprint === report.fingerprint && current.verdict === 'requires-trust') {
                await saveApproval(current);
                return;
            }
            throw new Error('MOD_SAFETY_CHANGED: The mod changed during review. Retry the operation.');
        }
    }
    // Installation candidates may be discarded after a denial; library mods stay
    // where they are. Keep a copy for diagnosis without hiding the denial if the
    // disk is full or the candidate has already disappeared. An incomplete check
    // rejected nothing.
    if (options.context === 'installation' && report.verdict !== 'incomplete') {
        await retainRejectedPackage(path, report).catch(err => console.warn('[mod-safety] Could not retain package:', err));
    }
    throw new Error(report.verdict === 'blocked'
        ? 'MOD_SAFETY_BLOCKED: The archive could not be read or installed safely. Try a complete, valid copy.'
        : report.verdict === 'incomplete'
            ? 'MOD_SAFETY_INCOMPLETE: Grimoire could not finish checking this mod. Try again.'
            : 'MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');
}
