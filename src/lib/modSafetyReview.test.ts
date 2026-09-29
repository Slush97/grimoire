import { describe, expect, it } from 'vitest';
import type { Mod } from '../types/mod';
import type { ModSafetyPrompt, ModSafetyReport } from '../types/modSafety';
import { hasNewSafetyReview, pendingSafetyKeys, safetyReviewRows } from './modSafetyReview';

const report = (fingerprint = 'version-one'): ModSafetyReport => ({
    fingerprint, policyVersion: 2, verdict: 'requires-trust', findings: [{ entry: 'hud.js', reason: 'browser' }],
});
const mod = (overrides: Partial<Mod> = {}): Mod => ({
    id: 'one', name: 'HUD', path: 'hud.vpk', fileName: 'hud.vpk', metaKey: 'hud.vpk', enabled: false,
    priority: 0, size: 10, installedAt: '', safety: { trusted: false, report: report() }, ...overrides,
});
const keys = (mods: Mod[]) => pendingSafetyKeys(safetyReviewRows(mods, [], []));

describe('mod safety attention', () => {
    it('hides the notice and clears the count when all reviewed mods are allowed', () => {
        const allowed = mod({ safety: { trusted: true, report: report() } });
        expect(safetyReviewRows([allowed], [], [])).toHaveLength(1);
        expect(keys([allowed])).toEqual([]);
        expect(hasNewSafetyReview(keys([allowed]), [])).toBe(false);
    });
    it('keeps dismissed versions hidden across refresh, sorting and slot renames', () => {
        const first = mod();
        const second = mod({ id: 'two', name: 'Other HUD' });
        const dismissed = keys([first, second]);
        const refreshed = keys([second, { ...first, id: 'renamed', path: 'pak05.vpk', enabled: true }]);
        expect(hasNewSafetyReview(refreshed, dismissed)).toBe(false);
        expect(hasNewSafetyReview(keys([first]), dismissed)).toBe(false);
    });
    it('shows the notice for a new mod or changed version even if the count stays the same', () => {
        const dismissed = keys([mod()]);
        expect(hasNewSafetyReview(keys([mod({ name: 'New HUD' })]), dismissed)).toBe(true);
        expect(hasNewSafetyReview(keys([mod({ safety: { trusted: false, report: report('version-two') } })]), dismissed)).toBe(true);
        expect(hasNewSafetyReview(keys([mod(), mod({ id: 'duplicate' })]), dismissed)).toBe(true);
    });
    it('counts a matching prompt only once and includes an incoming update separately', () => {
        const request: ModSafetyPrompt = { id: 'request', name: 'HUD', report: report(), canTrust: true, restartRequired: false, context: 'installation' };
        expect(pendingSafetyKeys(safetyReviewRows([mod()], [], [request]))).toHaveLength(1);
        const changed = { ...request, report: report('version-two') };
        expect(pendingSafetyKeys(safetyReviewRows([mod()], [], [changed]))).toHaveLength(2);
    });
    it('puts a prompt on the mod row with the same bytes when the caller only knew the file name', () => {
        const request: ModSafetyPrompt = { id: 'request', name: 'pak05_dir.vpk', report: report(), canTrust: true, restartRequired: false, context: 'activation' };
        const rows = safetyReviewRows([mod({ enabled: true })], [], [request]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ name: 'HUD', mod: { id: 'one' }, request });
    });
    it('keeps the prompt an operation waits on when a startup notice for the same version arrives', () => {
        const waiting: ModSafetyPrompt = { id: 'waiting', name: 'HUD', report: report(), canTrust: true, restartRequired: false, context: 'activation' };
        const notice: ModSafetyPrompt = { ...waiting, id: 'notice', canTrust: false, restartRequired: true, context: 'startup' };
        expect(safetyReviewRows([mod()], [], [waiting, notice])[0].request).toBe(waiting);
        expect(safetyReviewRows([mod()], [], [notice, waiting])[0].request).toBe(waiting);
    });
    it('includes unmanaged archives and read errors, without counting passive assets', () => {
        const passive = mod({ safety: { trusted: false, report: { ...report(), verdict: 'no-findings', findings: [] } } });
        const rows = safetyReviewRows([passive], [{ modId: '', name: 'Broken archive', enabled: false, trusted: false,
            report: { ...report(''), verdict: 'blocked', findings: [{ entry: 'bad.vpk', reason: 'unreadable-archive' }] } }], []);
        expect(pendingSafetyKeys(rows)).toHaveLength(1);
        expect(hasNewSafetyReview(pendingSafetyKeys(rows), [])).toBe(true);
    });
});
