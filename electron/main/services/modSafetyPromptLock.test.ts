/**
 * A safety prompt raised inside runExclusiveModMutation holds the mod lock
 * until someone answers it. These drive the real lock, gate and review IPC to
 * pin that the review page answers such a prompt instead of queueing behind it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ModSafetyReport } from '../../../src/types/modSafety';

const h = vi.hoisted(() => ({
    userData: '', dl: '', fingerprint: '', sender: {},
    handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
}));
vi.mock('electron', () => ({
    app: { getPath: () => h.userData, getAppPath: () => h.userData, isPackaged: false },
    BrowserWindow: { getAllWindows: () => [] },
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => h.handlers.set(name, handler) },
}));
vi.mock('node:worker_threads', async () => {
    const { EventEmitter } = await import('node:events');
    return { Worker: class extends EventEmitter {
        postMessage() {
            const report: ModSafetyReport = { policyVersion: 1, fingerprint: h.fingerprint, verdict: 'requires-trust',
                findings: [{ entry: 'panorama/scripts/hud.js', reason: 'browser' }] };
            queueMicrotask(() => this.emit('message', report));
        }
        terminate() { return Promise.resolve(0); }
    } };
});
vi.mock('./launch', () => ({ isDeadlockRunning: async () => false, readStash: async () => null }));
vi.mock('../index', () => ({ getMainWindow: () => ({ webContents: h.sender }) }));
vi.mock('./settings', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./settings')>()), getActiveDeadlockPath: () => h.dl,
}));

import { scanMods } from './mods';
import { setModMetadata } from './metadata';
import { addProfile, applyProfile } from './profiles';
import { getModSafetyPrompts } from './modSafety';
import '../ipc/modSafety';

function writeVpk(path: string): void {
    const header = Buffer.alloc(4096);
    header.writeUInt32LE(0x55aa1234, 0);
    header.writeUInt32LE(2, 4);
    writeFileSync(path, header);
}

async function waitingPrompt() {
    await vi.waitFor(() => expect(getModSafetyPrompts()).toHaveLength(1));
    return getModSafetyPrompts()[0];
}

describe('safety prompts raised under the mod lock', () => {
    beforeAll(() => {
        const root = mkdtempSync(join(tmpdir(), 'safety-lock-'));
        h.dl = join(root, 'dl');
        h.userData = join(root, 'userdata');
        const addons = join(h.dl, 'game', 'citadel', 'addons');
        for (const dir of [join(addons, '.disabled'), join(h.dl, 'game', 'citadel', 'grimoire'), h.userData]) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(join(h.userData, 'settings.json'), JSON.stringify({ experimentalModSafety: true }));
        writeFileSync(join(h.dl, 'game', 'citadel', 'gameinfo.gi'), 'GameInfo {}\n');
        writeVpk(join(addons, '.disabled', 'hud_timer_dir.vpk'));
        setModMetadata('hud_timer_dir.vpk', { modName: 'HUD Timer' });
        const now = new Date().toISOString();
        addProfile({ id: 'scrims', name: 'Scrims', mods: [{ fileName: 'hud_timer_dir.vpk', enabled: true, priority: 1 }],
            createdAt: now, updatedAt: now });
    });

    it('lets Keep disabled release a profile apply waiting on the mod', async () => {
        h.fingerprint = 'b'.repeat(64);
        const applying = applyProfile(h.dl, 'scrims').catch(e => String(e));
        const prompt = await waitingPrompt();
        await h.handlers.get('respond-mod-safety')!({ sender: h.sender }, prompt.id, false);
        expect(await applying).toContain('MOD_SAFETY_TRUST_REQUIRED');
        expect((await scanMods(h.dl)).map(m => m.enabled)).toEqual([false]);
    });

    it('lets the mod row approve a mod a profile apply is waiting on, without waiting on its lock', async () => {
        h.fingerprint = 'a'.repeat(64);
        const applying = applyProfile(h.dl, 'scrims');
        const prompt = await waitingPrompt();
        expect(prompt.name).toBe('HUD Timer');
        const [mod] = await scanMods(h.dl);
        const reviewed = await h.handlers.get('review-mod-safety')!({ sender: h.sender }, mod.id, h.fingerprint);
        expect(reviewed).toMatchObject({ id: mod.id, safety: { trusted: true } });
        expect((await applying).failures).toEqual([]);
        expect((await scanMods(h.dl)).map(m => m.enabled)).toEqual([true]);
        expect(getModSafetyPrompts()).toHaveLength(0);
    });
});
