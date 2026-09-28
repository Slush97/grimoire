import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ModSafetyReport } from '../../../src/types/modSafety';

const h = vi.hoisted(() => ({ userData: '', reports: [] as ModSafetyReport[], sent: vi.fn() }));
vi.mock('electron', () => ({
    app: { getPath: () => h.userData, getAppPath: () => h.userData, isPackaged: false },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: h.sent } }] },
}));
vi.mock('node:worker_threads', async () => {
    const { EventEmitter } = await import('node:events');
    return { Worker: class extends EventEmitter {
        postMessage() { queueMicrotask(() => {
            const report = h.reports.shift();
            if (report) this.emit('message', report);
            else this.emit('error', new Error('decoder crashed'));
        }); }
        terminate() { return Promise.resolve(0); }
    } };
});
import { approveVpkSafety, assertVpkSafety, getModSafetyPrompts, respondToModSafety } from './modSafety';

const script = (fingerprint = 'a'.repeat(64)): ModSafetyReport => ({
    policyVersion: 1, fingerprint, verdict: 'requires-trust', findings: [{ entry: 'test.js', reason: 'executable' }],
});
let candidate: string;
beforeEach(async () => {
    h.userData = await fs.mkdtemp(join(tmpdir(), 'safety-consent-test-'));
    candidate = join(h.userData, 'test.vpk');
    await fs.writeFile(candidate, 'inert');
    h.reports = [];
});
afterEach(async () => {
    for (const p of getModSafetyPrompts()) respondToModSafety(p.id, false);
    await fs.rm(h.userData, { recursive: true, force: true });
});
async function prompt() {
    await vi.waitFor(() => expect(getModSafetyPrompts()).toHaveLength(1));
    return getModSafetyPrompts()[0];
}

describe('mod safety authorization', () => {
    it('approves the exact inline-reviewed version without a second prompt', async () => {
        h.reports.push(script(), script());
        await approveVpkSafety(candidate, 'a'.repeat(64));
        await assertVpkSafety(candidate, { prompt: false });
        expect(getModSafetyPrompts()).toHaveLength(0);
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
    it('keeps cancelled scripts unapproved and retains the candidate', async () => {
        h.reports.push(script());
        const result = assertVpkSafety(candidate).catch(e => String(e));
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
        await expect(assertVpkSafety(candidate, { prompt: false })).rejects.toThrow('MOD_SAFETY_BLOCKED');
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
});
