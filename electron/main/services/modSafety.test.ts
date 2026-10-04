import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModSafetyReport } from '../../../src/types/modSafety';

const h = vi.hoisted(() => ({ userData: '', reports: [] as ModSafetyReport[], messages: [] as Array<{ binary?: string }>, sent: vi.fn() }));
vi.mock('electron', () => ({
    app: { getPath: () => h.userData, getAppPath: () => h.userData, isPackaged: false },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: h.sent } }] },
}));
vi.mock('node:worker_threads', async () => {
    const { EventEmitter } = await import('node:events');
    return { Worker: class extends EventEmitter {
        postMessage(message: { binary?: string }) { h.messages.push(message); queueMicrotask(() => {
            const report = h.reports.shift();
            if (report) this.emit('message', report);
            else this.emit('error', new Error('decoder crashed'));
        }); }
        terminate() { return Promise.resolve(0); }
    } };
});
import { approveVpkSafety, assertVpkSafety, carryVpkSafety, getModSafetyPrompts, pruneModQuarantine, respondToModSafety } from './modSafety';

const script = (fingerprint = 'a'.repeat(64)): ModSafetyReport => ({
    policyVersion: 1, fingerprint, verdict: 'requires-trust', findings: [{ entry: 'test.js', reason: 'browser' }],
});
let candidate: string;
beforeEach(async () => {
    h.userData = await fs.mkdtemp(join(tmpdir(), 'safety-consent-test-'));
    candidate = join(h.userData, 'test.vpk');
    await fs.writeFile(candidate, 'inert');
    await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ experimentalModSafety: true }));
    h.reports = [];
    h.messages = [];
});
afterEach(async () => {
    vi.unstubAllEnvs();
    for (const p of getModSafetyPrompts()) respondToModSafety(p.id, false);
    await fs.rm(h.userData, { recursive: true, force: true });
});
async function prompt() {
    await vi.waitFor(() => expect(getModSafetyPrompts()).toHaveLength(1));
    return getModSafetyPrompts()[0];
}

describe('mod safety authorization', () => {
    it('lets every archive through unread while the review is off', async () => {
        await fs.writeFile(join(h.userData, 'settings.json'), JSON.stringify({ experimentalModSafety: false }));
        h.reports.push(script());
        await assertVpkSafety(candidate);
        expect(await carryVpkSafety([candidate], candidate)).toBe('trusted');
        expect(h.messages).toHaveLength(0);
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
    it('approves the exact inline-reviewed version without a second prompt', async () => {
        h.reports.push(script(), script());
        expect(await approveVpkSafety(candidate, 'a'.repeat(64))).toBe(false);
        await assertVpkSafety(candidate, { prompt: false });
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
    it('lets an inline approval answer the operation already waiting on that version', async () => {
        h.reports.push(script(), script(), script());
        const waiting = assertVpkSafety(candidate, { name: 'HUD Timer' });
        expect((await prompt()).name).toBe('HUD Timer');
        expect(await approveVpkSafety(candidate, 'a'.repeat(64))).toBe(true);
        await waiting;
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
    it('rejects every operation waiting on a version the user kept disabled', async () => {
        h.reports.push(script(), script(), script('b'.repeat(64)));
        const first = assertVpkSafety(candidate).catch(e => String(e));
        await prompt();
        const second = assertVpkSafety(candidate).catch(e => String(e));
        const other = assertVpkSafety(candidate).catch(e => String(e));
        await vi.waitFor(() => expect(getModSafetyPrompts()).toHaveLength(3));
        respondToModSafety(getModSafetyPrompts()[0].id, false);
        expect(await first).toContain('MOD_SAFETY_TRUST_REQUIRED');
        expect(await second).toContain('MOD_SAFETY_TRUST_REQUIRED');
        expect(getModSafetyPrompts().map(p => p.report.fingerprint)).toEqual(['b'.repeat(64)]);
        respondToModSafety(getModSafetyPrompts()[0].id, false);
        expect(await other).toContain('MOD_SAFETY_TRUST_REQUIRED');
    });
    it('does not apply inline consent to changed bytes', async () => {
        h.reports.push(script('b'.repeat(64)));
        await expect(approveVpkSafety(candidate, 'a'.repeat(64))).rejects.toThrow('MOD_SAFETY_CHANGED');
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
    });
    it('cannot approve an unreadable archive inline', async () => {
        h.reports.push({ ...script(), verdict: 'blocked' });
        await expect(approveVpkSafety(candidate, 'a'.repeat(64))).rejects.toThrow('MOD_SAFETY_BLOCKED');
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
    });
    it('persists explicit consent and scans again before using it', async () => {
        h.reports.push(script(), script(), script());
        const request = assertVpkSafety(candidate);
        const p = await prompt();
        expect(p.canTrust).toBe(true);
        respondToModSafety(p.id, true);
        await request;
        expect(JSON.parse(await fs.readFile(join(h.userData, 'mod-safety-trust.json'), 'utf8'))).toEqual(['a'.repeat(64)]);
        await assertVpkSafety(candidate, { prompt: false });
        expect(h.reports).toHaveLength(0);
    });
    it('keeps cancelled downloads unapproved and retains the candidate', async () => {
        h.reports.push(script());
        const result = assertVpkSafety(candidate, { context: 'installation' }).catch(e => String(e));
        respondToModSafety((await prompt()).id, false);
        expect(await result).toContain('MOD_SAFETY_TRUST_REQUIRED');
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
        expect(await fs.readFile(candidate, 'utf8')).toBe('inert');
        expect(await fs.readFile(join(h.userData, 'mod-quarantine', 'a'.repeat(64), 'test.vpk'), 'utf8')).toBe('inert');
    });
    it('rejects a file changed during the confirmation instead of approving the new bytes', async () => {
        h.reports.push(script(), script('b'.repeat(64)));
        const result = assertVpkSafety(candidate).catch(e => String(e));
        respondToModSafety((await prompt()).id, true);
        expect(await result).toContain('MOD_SAFETY_CHANGED');
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
    });
    it('cannot override an unreadable archive with a forged positive response', async () => {
        h.reports.push({ ...script(), verdict: 'blocked', findings: [{ entry: 'test.vpk', reason: 'unreadable-archive' }] });
        const result = assertVpkSafety(candidate).catch(e => String(e));
        const p = await prompt();
        expect(p.canTrust).toBe(false);
        respondToModSafety(p.id, true);
        expect(await result).toContain('MOD_SAFETY_BLOCKED');
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
    });
    it('does not let persisted trust override an archive read error', async () => {
        await fs.writeFile(join(h.userData, 'mod-safety-trust.json'), JSON.stringify(['a'.repeat(64)]));
        h.reports.push({ ...script(), verdict: 'blocked' });
        await expect(assertVpkSafety(candidate, { prompt: false })).rejects.toThrow('MOD_SAFETY_BLOCKED');
    });
    it('fails closed on worker crashes', async () => {
        await expect(assertVpkSafety(candidate, { prompt: false })).rejects.toThrow('MOD_SAFETY_INCOMPLETE');
    });
    it('treats a worker failure as a retryable incomplete check rather than a rejection', async () => {
        const result = assertVpkSafety(candidate).catch(e => String(e));
        const p = await prompt();
        expect(p.canTrust).toBe(false);
        expect(p.report).toMatchObject({ verdict: 'incomplete', findings: [{ entry: 'test.vpk', reason: 'inspection-failed' }] });
        respondToModSafety(p.id, true);
        expect(await result).toContain('MOD_SAFETY_INCOMPLETE');
        await expect(fs.stat(join(h.userData, 'mod-quarantine'))).rejects.toThrow();
        await expect(fs.stat(join(h.userData, 'mod-safety-trust.json'))).rejects.toThrow();
        h.reports.push({ ...script(), verdict: 'no-findings', findings: [] });
        await assertVpkSafety(candidate, { prompt: false });
    });
    it.each(['local-file', 'browser', 'remote-code', 'dynamic-code', 'native-code', 'uninspectable'] as const)(
        'accepts informed consent for %s and remembers the version', async reason => {
            const report = { ...script(), findings: [{ entry: 'test.js', reason }] };
            h.reports.push(report, report, report);
            const result = assertVpkSafety(candidate);
            const p = await prompt();
            expect(p.canTrust).toBe(true);
            expect(p.report.findings[0].reason).toBe(reason);
            respondToModSafety(p.id, true);
            await result;
            await assertVpkSafety(candidate, { prompt: false });
            expect(getModSafetyPrompts()).toHaveLength(0);
        });
    it('asks again when an approved package is replaced with changed executable bytes', async () => {
        await fs.writeFile(join(h.userData, 'mod-safety-trust.json'), JSON.stringify(['a'.repeat(64)]));
        h.reports.push(script('b'.repeat(64)));
        const result = assertVpkSafety(candidate).catch(e => String(e));
        const p = await prompt();
        expect(p.canTrust).toBe(true);
        respondToModSafety(p.id, false);
        expect(await result).toContain('MOD_SAFETY_TRUST_REQUIRED');
    });
    it('hands the worker the shared vpkmerge resolver path, VPKMERGE_BINARY included', async () => {
        vi.stubEnv('VPKMERGE_BINARY', candidate);
        h.reports.push({ ...script(), verdict: 'no-findings', findings: [] });
        await assertVpkSafety(candidate, { prompt: false });
        vi.stubEnv('VPKMERGE_BINARY', join(h.userData, 'missing'));
        h.reports.push({ ...script(), verdict: 'no-findings', findings: [] });
        await assertVpkSafety(candidate, { prompt: false });
        expect(h.messages.map(m => m.binary)).toEqual([candidate, undefined]);
    });
});

describe('rejected package retention', () => {
    const quarantine = () => join(h.userData, 'mod-quarantine');
    const retained = async () => (await fs.readdir(quarantine()).catch(() => [])).sort();
    it('does not copy a download the user approves', async () => {
        h.reports.push(script(), script());
        const result = assertVpkSafety(candidate, { context: 'installation' });
        respondToModSafety((await prompt()).id, true);
        await result;
        expect(await retained()).toEqual([]);
    });
    it('does not copy library mods, which stay in place when refused', async () => {
        h.reports.push(script());
        const result = assertVpkSafety(candidate).catch(e => String(e));
        respondToModSafety((await prompt()).id, false);
        expect(await result).toContain('MOD_SAFETY_TRUST_REQUIRED');
        expect(await retained()).toEqual([]);
    });
    it('keeps one copy per rejected version, keying unreadable archives by their bytes', async () => {
        const blocked: ModSafetyReport = { ...script(''), verdict: 'blocked', findings: [{ entry: 'test.vpk', reason: 'unreadable-archive' }] };
        h.reports.push(script(), script(), blocked, blocked);
        for (let i = 0; i < 4; i++) {
            await expect(assertVpkSafety(candidate, { prompt: false, context: 'installation' })).rejects.toThrow();
        }
        expect(await retained()).toEqual(['a'.repeat(64), createHash('sha256').update('inert').digest('hex')].sort());
    });
    it('drops the retained copy once that version is approved', async () => {
        h.reports.push(script(), script());
        await expect(assertVpkSafety(candidate, { prompt: false, context: 'installation' })).rejects.toThrow();
        expect(await retained()).toEqual(['a'.repeat(64)]);
        await approveVpkSafety(candidate, 'a'.repeat(64));
        expect(await retained()).toEqual([]);
    });
    it('prunes retained copies by age and total size at startup', async () => {
        const hour = 60 * 60 * 1000;
        const folders = { 'newest-huge': [hour, 3 * 1024 ** 3], 'recent-small': [2 * hour, 5], 'older-1g': [3 * hour, 1024 ** 3],
            'older-1.5g': [4 * hour, 1.5 * 1024 ** 3], 'expired': [40 * 24 * hour, 5] };
        for (const [name, [age, size]] of Object.entries(folders)) {
            const folder = join(quarantine(), name);
            await fs.mkdir(folder, { recursive: true });
            await fs.writeFile(join(folder, 'test.vpk'), '');
            await fs.truncate(join(folder, 'test.vpk'), size);
            const time = new Date(Date.now() - age);
            await fs.utimes(folder, time, time);
        }
        await pruneModQuarantine();
        expect(await retained()).toEqual(['older-1g', 'recent-small']);
    });
});

describe("approval for Grimoire's own repacks and merges", () => {
    const trustFile = () => join(h.userData, 'mod-safety-trust.json');
    const trust = (...fingerprints: string[]) => fs.writeFile(trustFile(), JSON.stringify(fingerprints));
    const trusted = async () => JSON.parse(await fs.readFile(trustFile(), 'utf8'));
    const hud = { entry: 'panorama/scripts/hud.vjs_c', reason: 'local-file' } as const;
    const report = (fingerprint: string, findings: ModSafetyReport['findings']): ModSafetyReport => ({ ...script(fingerprint), findings });

    it('carries an approved script mod to its imprinted repack without a prompt', async () => {
        await trust('a'.repeat(64));
        h.reports.push(report('b'.repeat(64), [{ entry: 'addoninfo.txt', reason: 'local-file' }, hud]), report('a'.repeat(64), [hud]));
        expect(await carryVpkSafety(['mod'], 'repack')).toBe('trusted');
        expect(await trusted()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
    it('carries approval to a merge of approved sources that keeps one copy of a colliding script', async () => {
        await trust('a'.repeat(64), 'c'.repeat(64));
        h.reports.push(report('d'.repeat(64), [hud]), report('a'.repeat(64), [hud]),
            report('c'.repeat(64), [hud, { entry: hud.entry, reason: 'browser' }]));
        expect(await carryVpkSafety(['one', 'two'], 'merged')).toBe('trusted');
        expect(await trusted()).toContain('d'.repeat(64));
    });
    it('leaves a repack of an unreviewed mod unreviewed, without approving or asking', async () => {
        h.reports.push(report('b'.repeat(64), [hud]), report('a'.repeat(64), [hud]));
        expect(await carryVpkSafety(['mod'], 'repack')).toBe('untrusted');
        await expect(fs.stat(trustFile())).rejects.toThrow();
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
    it('never carries approval to a finding no input had', async () => {
        await trust('a'.repeat(64));
        h.reports.push(report('b'.repeat(64), [hud, { entry: hud.entry, reason: 'remote-code' }]), report('a'.repeat(64), [hud]));
        expect(await carryVpkSafety(['mod'], 'repack')).toBe('differs');
        expect(await trusted()).toEqual(['a'.repeat(64)]);
    });
    it('does not vouch for a merge when one source could not be read', async () => {
        await trust('a'.repeat(64));
        h.reports.push(report('b'.repeat(64), [hud]), report('a'.repeat(64), [hud]), { ...script('c'.repeat(64)), verdict: 'blocked' });
        expect(await carryVpkSafety(['one', 'two'], 'merged')).toBe('differs');
        expect(await trusted()).toEqual(['a'.repeat(64)]);
    });
});
