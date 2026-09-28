import { app, BrowserWindow } from 'electron';
import { Worker } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ModSafetyReport, ModSafetyPrompt, ModSafetySnapshot } from '../../../src/types/modSafety';
import { MOD_SAFETY_POLICY_VERSION } from './modSafetyPolicy';

const pending = new Map<string, { prompt: ModSafetyPrompt; finish: (accepted: boolean) => void }>();
// Presentation only. Permission decisions hash current bytes before reusing a report.
const snapshots = new Map<string, ModSafetySnapshot>();
export function modSafetySnapshot(path: string): ModSafetySnapshot | undefined { return snapshots.get(path); }
export function moveSafetySnapshot(from: string, to: string): void {
    const value = snapshots.get(from);
    snapshots.delete(from);
    if (value) snapshots.set(to, value);
}
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

async function saveApproval(report: ModSafetyReport): Promise<void> {
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
}

/** Consent applies only to the exact report the user reviewed. */
export async function approveVpkSafety(path: string, fingerprint: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Invalid mod safety decision');
    const current = await inspectVpkSafety(path);
    if (current.fingerprint !== fingerprint) throw new Error('MOD_SAFETY_CHANGED');
    await saveApproval(current);
}

function inspectionFailure(path: string): ModSafetyReport {
    return { policyVersion: MOD_SAFETY_POLICY_VERSION, fingerprint: '', verdict: 'blocked',
        findings: [{ entry: basename(path), reason: 'unreadable-archive' }] };
}

/** Always hashes current bytes. UI snapshots are never authorization caches. */
export function inspectVpkSafety(path: string): Promise<ModSafetyReport> {
    const task = scanQueue.then(async () => {
        const key = `${process.platform}-${process.arch}`;
        const binaries: Record<string, string> = { 'win32-x64': 'vpkmerge-windows-x86_64.exe',
            'linux-x64': 'vpkmerge-linux-x86_64', 'darwin-arm64': 'vpkmerge-macos-aarch64' };
        // Use the shipped, pinned decoder. Developer overrides are not a security dependency.
        const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources');
        const binary = join(base, 'vpkmerge', binaries[key] ?? 'unsupported');
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
        snapshots.set(path, { report, trusted: await isModSafetyTrusted(report) });
        return report;
    });
    scanQueue = task.catch(() => {});
    return task;
}

export function getModSafetyPrompts(): ModSafetyPrompt[] { return [...pending.values()].map(p => p.prompt); }
export function respondToModSafety(id: string, accepted: boolean): void {
    const request = pending.get(id);
    if (!request) return;
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

async function retainRejectedPackage(path: string, report: ModSafetyReport): Promise<void> {
    const root = join(app.getPath('userData'), 'mod-quarantine', report.fingerprint || randomUUID());
    await fs.mkdir(root, { recursive: true });
    const name = basename(path);
    await fs.copyFile(path, join(root, name));
    if (/_dir\.vpk$/i.test(name)) {
        const prefix = name.slice(0, -8).toLowerCase();
        for (const sibling of await fs.readdir(dirname(path))) {
            if (sibling.toLowerCase().startsWith(prefix + '_') && /^\d{3}\.vpk$/i.test(sibling.slice(prefix.length + 1))) {
                await fs.copyFile(join(dirname(path), sibling), join(root, sibling));
            }
        }
    }
    await fs.writeFile(join(root, 'safety-report.json'), JSON.stringify(report, null, 2));
}

export async function assertVpkSafety(path: string, options: {
    prompt?: boolean; allowUntrusted?: boolean; context?: ModSafetyPrompt['context']; name?: string;
} = {}): Promise<void> {
    const report = await inspectVpkSafety(path);
    if (await isModSafetyTrusted(report)) return;
    if (report.verdict === 'requires-trust' && options.allowUntrusted) return;
    // Keep a rejected download for diagnosis without hiding the original denial
    // if the disk is full or the candidate has already disappeared.
    await retainRejectedPackage(path, report).catch(err => console.warn('[mod-safety] Could not retain package:', err));
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
    throw new Error(report.verdict === 'blocked'
        ? 'MOD_SAFETY_BLOCKED: The archive could not be read or installed safely. Try a complete, valid copy.'
        : 'MOD_SAFETY_TRUST_REQUIRED: This version must be trusted before activation.');
}
