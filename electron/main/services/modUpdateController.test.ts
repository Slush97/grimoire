import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createModUpdateController } from './modUpdateController';
import type { Mod } from '../../../src/types/mod';
import type { GameBananaModDetails, GameBananaFile } from '../../../src/types/gamebanana';
import type { ModUpdateState } from '../../../src/types/modUpdates';

const mod = (id: string, fileId: number, description: string, modId = 1, extra: Partial<Mod> = {}): Mod => ({
    id, name: id, fileName: `${id}.vpk`, metaKey: `${id}.vpk`, path: id,
    enabled: false, priority: 0, size: 10, installedAt: '2026-01-01',
    gameBananaId: modId, gameBananaFileId: fileId, fileDescription: description, ...extra,
});
const file = (id: number, description: string): GameBananaFile => ({
    id, description, fileName: `archive${id}.zip`, isArchived: false, fileSize: 10, downloadCount: 0, downloadUrl: '',
});
const details = (id: number, files: GameBananaFile[]): GameBananaModDetails => ({ id, name: `Mod ${id}`, nsfw: false, files });
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup() {
    let installed = [mod('old', 10, 'Original')];
    let context = { deadlockPath: 'normal', devMode: false };
    const states: ModUpdateState[] = [];
    const work: ReturnType<typeof deferred>[] = [];
    const deps = {
        context: () => context,
        mods: vi.fn(async () => installed),
        details: vi.fn(async (id: number, _section: string) => details(id, [file(20, 'Original')])),
        autoMatchRemainingFiles: vi.fn(() => false),
        snapshot: vi.fn(async (_path: string): Promise<void> => {}),
        replace: vi.fn((_path: string, _args: unknown, _sources: string[], _promote: boolean, _expectedSources: Mod[]) => {
            const job = deferred();
            work.push(job);
            return job.promise;
        }),
        targetQueued: vi.fn(() => false),
        cancelled: (error: unknown) => error instanceof Error && error.message === 'CANCELLED',
        publish: (state: ModUpdateState) => { states.push(state); },
    };
    const controller = createModUpdateController(deps);
    return { controller, deps, work, states, setMods: (mods: Mod[]) => { installed = mods; }, setContext: (next: typeof context) => { context = next; } };
}

beforeEach(() => vi.restoreAllMocks());

describe('main-process update coordination', () => {
    it('finishes matching every submission before enqueuing the full batch', async () => {
        const h = setup();
        h.setMods([mod('one', 10, 'Original'), mod('two', 11, 'Original', 2)]);
        const second = deferred();
        h.deps.details.mockImplementation(async (id) => {
            if (id === 2) await second.promise;
            return details(id, [file(id + 20, 'Original')]);
        });
        const running = h.controller.start(['one', 'two']);
        await flush();
        expect(h.controller.getState()).toMatchObject({ busy: true, preparing: true });
        expect(h.deps.replace).not.toHaveBeenCalled();
        second.resolve();
        await running;
        expect(h.deps.snapshot).toHaveBeenCalledExactlyOnceWith('normal');
        expect(h.deps.replace.mock.calls.map(call => call[2])).toEqual([['one'], ['two']]);
        expect(h.controller.getState()).toMatchObject({ busy: true, preparing: false });
        h.work.forEach(job => job.resolve());
        await flush();
        expect(h.controller.isBusy()).toBe(false);
    });

    it('combines VPK replacements from the same archive and rejects a second batch', async () => {
        const h = setup();
        h.setMods([mod('one', 10, 'Original'), mod('two', 10, 'Original')]);
        await h.controller.start(['one', 'two', 'one']);
        expect(h.deps.replace).toHaveBeenCalledOnce();
        expect(h.deps.replace.mock.calls[0][2]).toEqual(['one', 'two']);
        await expect(h.controller.start(['one'])).rejects.toThrow('already in progress');
        h.work[0].resolve();
        await flush();
    });

    it('groups multiple unresolved files per submission, after automatic classification', async () => {
        const h = setup();
        h.setMods([mod('auto', 10, 'Original'), mod('manual1', 11, 'X'), mod('manual2', 12, 'Y')]);
        h.deps.details.mockResolvedValue(details(1, [file(20, 'Original'), file(21, 'Other'), file(22, 'Another')]));
        await h.controller.start(['auto', 'manual1', 'manual2']);
        const state = h.controller.getState();
        expect(h.work).toHaveLength(1);
        expect(state.manualRequests).toHaveLength(1);
        expect(state.manualRequests[0].sourceFileIds).toEqual([11, 12]);
        const requestId = state.manualRequests[0].id;
        await h.controller.choose({ requestId, oldFileId: 11, newFileId: 21 });
        expect(h.controller.getState().manualRequests[0].sourceFileIds).toEqual([12]);
        await expect(h.controller.choose({ requestId, oldFileId: 11, newFileId: 22 })).rejects.toThrow('no longer pending');
        h.work.forEach(job => job.resolve());
        await flush();
        expect(h.controller.isBusy()).toBe(true);
        h.controller.remove(requestId);
        expect(h.controller.isBusy()).toBe(false);
    });

    it('uses the matching preference and promotes an installed successor without downloading', async () => {
        const h = setup();
        h.setMods([mod('old', 10, 'Original'), mod('installed', 20, 'Original')]);
        await h.controller.start(['old']);
        expect(h.deps.replace.mock.calls[0][3]).toBe(true);
        h.work[0].resolve();
        await flush();
        h.setMods([mod('old', 10, 'Renamed')]);
        h.deps.autoMatchRemainingFiles.mockReturnValue(true);
        await h.controller.start(['old']);
        expect(h.work).toHaveLength(2);
        expect(h.controller.getState().manualRequests).toEqual([]);
        h.work[1].resolve();
        await flush();
    });

    it('isolates sections even when GameBanana submission IDs overlap', async () => {
        const h = setup();
        h.setMods([mod('skin', 10, 'Original'), mod('sound', 11, 'Voice', 1, { sourceSection: 'Sound' })]);
        h.deps.details.mockImplementation(async (id, section) => details(id, [file(section === 'Sound' ? 21 : 20, section === 'Sound' ? 'Voice' : 'Original')]));
        await h.controller.start(['skin', 'sound']);
        expect(h.deps.details.mock.calls).toEqual([[1, 'Mod'], [1, 'Sound']]);
        expect(h.deps.replace.mock.calls.map(call => call[2])).toEqual([['skin'], ['sound']]);
        h.work.forEach(job => job.resolve());
        await flush();
    });

    it('continues independent jobs after failures and does not fail a batch for its snapshot', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const h = setup();
        h.setMods([mod('one', 10, 'Original'), mod('two', 11, 'Original', 2)]);
        h.deps.snapshot.mockRejectedValue(new Error('snapshot unavailable'));
        await h.controller.start(['one', 'two']);
        h.work[0].reject(new Error('network failed'));
        h.work[1].resolve();
        await flush();
        expect(h.controller.getState()).toMatchObject({ busy: false, errors: [{ modId: 1, message: 'network failed' }] });
    });

    it('skips an already queued destination without attaching destructive finalization', async () => {
        const h = setup();
        h.deps.targetQueued.mockReturnValue(true);
        await h.controller.start(['old']);
        expect(h.deps.replace).not.toHaveBeenCalled();
        expect(h.controller.getState().errors[0].message).toContain('already queued');
        expect(h.controller.isBusy()).toBe(false);
    });

    it('restores a failed manual choice for retry, but explicit cancellation excludes it', async () => {
        const h = setup();
        h.setMods([mod('old', 10, 'No match')]);
        await h.controller.start(['old']);
        const requestId = h.controller.getState().manualRequests[0].id;
        await h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 });
        h.work[0].reject(new Error('network failed'));
        await flush();
        expect(h.controller.getState().manualRequests[0].sourceFileIds).toEqual([10]);
        await h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 });
        h.work[1].reject(new Error('CANCELLED'));
        await flush();
        expect(h.controller.getState()).toMatchObject({ busy: false, manualRequests: [] });
    });

    it('removal during manual failure does not reintroduce pending work', async () => {
        const h = setup();
        h.setMods([mod('first', 10, 'No match'), mod('second', 11, 'Still no match')]);
        await h.controller.start(['first', 'second']);
        const requestId = h.controller.getState().manualRequests[0].id;
        await h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 });
        h.controller.remove(requestId);
        h.work[0].reject(new Error('failed'));
        await flush();
        expect(h.controller.getState()).toMatchObject({ busy: false, manualRequests: [] });
    });

    it('rejects installed destinations and reserves manual sources while awaiting validation', async () => {
        const h = setup();
        h.setMods([mod('old', 10, 'No match'), mod('current', 20, 'Original')]);
        await h.controller.start(['old']);
        const requestId = h.controller.getState().manualRequests[0].id;
        const first = h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 });
        await expect(h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 })).rejects.toThrow('no longer pending');
        await expect(first).rejects.toThrow('already installed');
        expect(h.controller.getState().manualRequests).toHaveLength(1);
        expect(h.work).toEqual([]);
    });

    it('stops manual submission if the active metadata mode changes', async () => {
        const h = setup();
        h.setMods([mod('old', 10, 'No match')]);
        await h.controller.start(['old']);
        h.setContext({ deadlockPath: 'sandbox', devMode: true });
        const requestId = h.controller.getState().manualRequests[0].id;
        await expect(h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 })).rejects.toThrow('installation changed');
        expect(h.deps.replace).not.toHaveBeenCalled();
    });

    it('routes details replacements through the same executor and keeps busy until finalization', async () => {
        const h = setup();
        const result = h.controller.replace({ modId: 1, fileId: 20, fileName: 'archive.zip', replacementModIds: ['old'] });
        await flush();
        expect(h.controller.isBusy()).toBe(true);
        expect(h.deps.snapshot).toHaveBeenCalledOnce();
        expect(h.deps.replace).toHaveBeenCalledOnce();
        h.work[0].resolve();
        await result;
        await flush();
        expect(h.controller.isBusy()).toBe(false);
    });

    it('holds standalone replacements until the bulk matching pass and recovery snapshot finish', async () => {
        const h = setup();
        h.setMods([mod('one', 10, 'Original'), mod('two', 11, 'Original', 2), mod('three', 12, 'Original', 3)]);
        const matching = deferred();
        const snapshot = deferred();
        h.deps.details.mockImplementation(async (id) => {
            if (id === 2) await matching.promise;
            return details(id, [file(id + 20, 'Original')]);
        });
        h.deps.snapshot.mockImplementation(() => snapshot.promise);
        const bulk = h.controller.start(['one', 'two']);
        await flush();
        const standalone = h.controller.replace({ modId: 3, fileId: 23, fileName: 'third.zip', replacementModIds: ['three'] });
        await flush();
        expect(h.deps.snapshot).not.toHaveBeenCalled();
        expect(h.deps.replace).not.toHaveBeenCalled();

        matching.resolve();
        await flush();
        expect(h.deps.snapshot).toHaveBeenCalledExactlyOnceWith('normal');
        expect(h.deps.replace).not.toHaveBeenCalled();
        snapshot.resolve();
        await bulk;
        await flush();
        expect(h.deps.replace.mock.calls.map(call => call[2])).toEqual([['one'], ['two'], ['three']]);
        expect(h.deps.replace.mock.calls[0][4]).toEqual([mod('one', 10, 'Original')]);
        h.work.forEach(job => job.resolve());
        await standalone;
        await flush();
        expect(h.controller.isBusy()).toBe(false);
    });

    it('makes concurrent standalone replacements share the initial recovery snapshot', async () => {
        const h = setup();
        h.setMods([mod('one', 10, 'Original'), mod('two', 11, 'Original', 2)]);
        const snapshot = deferred();
        h.deps.snapshot.mockImplementation(() => snapshot.promise);
        const first = h.controller.replace({ modId: 1, fileId: 20, fileName: 'first.zip', replacementModIds: ['one'] });
        await flush();
        const second = h.controller.replace({ modId: 2, fileId: 21, fileName: 'second.zip', replacementModIds: ['two'] });
        await flush();
        expect(h.deps.snapshot).toHaveBeenCalledOnce();
        expect(h.deps.replace).not.toHaveBeenCalled();
        snapshot.resolve();
        await flush();
        expect(h.deps.replace.mock.calls.map(call => call[2])).toEqual([['one'], ['two']]);
        h.work.forEach(job => job.resolve());
        await Promise.all([first, second]);
        await flush();
        expect(h.controller.isBusy()).toBe(false);
    });

    it('captures standalone source proof before waiting for a bulk matching pass', async () => {
        const h = setup();
        const original = mod('two', 11, 'Original', 2);
        h.setMods([mod('one', 10, 'Original'), original]);
        const matching = deferred();
        h.deps.details.mockImplementation(async id => {
            await matching.promise;
            return details(id, [file(20, 'Original')]);
        });
        const bulk = h.controller.start(['one']);
        await flush();
        const standalone = h.controller.replace({ modId: 2, fileId: 21, fileName: 'next.zip', replacementModIds: ['two'] });
        await flush();
        h.setMods([mod('one', 10, 'Original'), mod('two', 99, 'Different', 2)]);
        matching.resolve();
        await bulk;
        await flush();
        // The executor rejects a recycled source using this original proof.
        expect(h.deps.replace.mock.calls[1][4]).toEqual([original]);
        h.work.forEach(job => job.resolve());
        await standalone;
    });

    it('reserves a manual source before its scan so concurrent details replacement cannot leave stale pending work', async () => {
        const h = setup();
        const old = mod('old', 10, 'No match');
        h.setMods([old]);
        await h.controller.start(['old']);
        const requestId = h.controller.getState().manualRequests[0].id;
        const scan = deferred();
        h.deps.mods.mockImplementationOnce(async () => { await scan.promise; return [old]; });
        const choice = h.controller.choose({ requestId, oldFileId: 10, newFileId: 20 });
        const concurrent = h.controller.replace({ modId: 1, fileId: 21, fileName: 'other.zip', replacementModIds: ['old'] })
            .catch((error: unknown) => error);
        await flush();
        expect(h.deps.replace).not.toHaveBeenCalled();
        scan.resolve();
        await choice;
        expect(await concurrent).toEqual(new Error('This installed file is already being updated.'));
        expect(h.work).toHaveLength(1);
        expect(h.controller.getState().manualRequests).toEqual([]);
        h.setMods([mod('fresh', 20, 'Original')]);
        h.work[0].resolve();
        await flush();
        expect(h.controller.getState()).toMatchObject({ busy: false, manualRequests: [] });
    });
});
