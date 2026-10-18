import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DownloadModArgs } from '../../../src/types/electron';
import type { Mod as FilesystemMod } from './mods';
import type { ModMetadata } from './metadata';
import type { DownloadInstallResult, ManagedDownloadHooks } from './download';

const state = vi.hoisted(() => ({
    mods: [] as FilesystemMod[],
    metadata: new Map<string, ModMetadata>(),
    settings: { devMode: false, experimentalVpkImprinting: false },
    path: '/game',
    locked: false,
    skipped: [] as string[],
    backups: [] as string[],
    events: [] as string[],
    jobs: [] as Array<{
        args: DownloadModArgs;
        hooks: ManagedDownloadHooks;
        resolve: (result: DownloadInstallResult) => void;
        reject: (error: unknown) => void;
    }>,
}));

const mocks = vi.hoisted(() => ({
    safety: vi.fn(),
    enable: vi.fn(),
    setGlobal: vi.fn(),
    delete: vi.fn(),
    imprint: vi.fn(),
}));

vi.mock('@grimoire/social-types/heroes', () => ({ inferHeroFromTitle: () => null }));
vi.mock('./settings', () => ({
    loadSettings: () => state.settings,
    getActiveDeadlockPath: () => state.path,
}));
vi.mock('./vpk', () => ({ GLOBAL_CLASSIFIER_VERSION: 4 }));
vi.mock('./metadata', () => ({
    getModMetadata: (key: string) => state.metadata.get(key),
    setModMetadata: (key: string, patch: ModMetadata) => {
        state.metadata.set(key, { ...state.metadata.get(key), ...patch });
    },
}));
vi.mock('./imprintMods', () => ({ hasAnyImprint: () => true, imprintOneMod: mocks.imprint }));
vi.mock('./download', () => ({
    enqueueManagedDownload: (_path: string, args: DownloadModArgs, _window: unknown, hooks: ManagedDownloadHooks) =>
        new Promise<DownloadInstallResult>((resolve, reject) => state.jobs.push({ args, hooks, resolve, reject })),
}));
vi.mock('./mods', () => ({
    scanMods: async () => state.mods.map((mod) => ({ ...mod })),
    runExclusiveModMutation: async (operation: () => Promise<unknown>) => {
        expect(state.locked).toBe(false);
        state.locked = true;
        state.events.push('lock');
        try {
            return await operation();
        } finally {
            state.locked = false;
            state.events.push('unlock');
        }
    },
    assertReplacementSafety: mocks.safety,
    enableModUnlocked: mocks.enable,
    setModPriorityFolderUnlocked: mocks.setGlobal,
    deleteModsUnlocked: mocks.delete,
}));

import { queueModReplacement as queueReplacementTask, readReplacementMods } from './modReplacement';

const args = { modId: 7, fileId: 20, fileName: 'fresh.zip' };
const mod = (id: string, options: Partial<FilesystemMod> = {}): FilesystemMod => ({
    id,
    metaKey: `${id}.vpk`,
    name: id,
    fileName: `${id}.vpk`,
    path: `/game/${id}.vpk`,
    enabled: false,
    size: 100,
    priority: 50,
    installedAt: '2026-10-18T00:00:00.000Z',
    ...options,
});

function queueModReplacement(
    path: string,
    download: DownloadModArgs,
    sourceIds: string[],
    window: null,
    options: { promoteExisting?: boolean } = {},
): Promise<DownloadInstallResult> {
    const expectedSources = state.mods.filter((candidate) => sourceIds.includes(candidate.id)).map((source) => ({
        ...source,
        ...state.metadata.get(source.metaKey),
    }));
    return queueReplacementTask(path, download, sourceIds, window, { ...options, expectedSources });
}

function add(id: string, metadata: ModMetadata = {}, options: Partial<FilesystemMod> = {}): FilesystemMod {
    const created = mod(id, options);
    state.mods.push(created);
    state.metadata.set(created.metaKey, { gameBananaId: 7, gameBananaFileId: 10, ...metadata });
    return created;
}

function rename(target: FilesystemMod, prefix: string): void {
    const metadata = state.metadata.get(target.metaKey)!;
    state.metadata.delete(target.metaKey);
    target.id = `${prefix}-${target.id}`;
    target.fileName = `${prefix}-${target.fileName}`;
    target.metaKey = target.fileName;
    target.path = `/game/${target.fileName}`;
    state.metadata.set(target.metaKey, metadata);
}

async function run(index = 0, install: () => void = () => { add('fresh', { gameBananaFileId: 20 }); }): Promise<void> {
    const job = state.jobs[index];
    try {
        await job.hooks.beforeStart?.();
        let result: DownloadInstallResult;
        if (job.hooks.execute) {
            result = await job.hooks.execute(new AbortController().signal);
        } else {
            install();
            result = { installedVpks: ['fresh.vpk'] };
        }
        await job.hooks.afterInstall(result);
        job.resolve(result);
    } catch (error) {
        job.reject(error);
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    state.mods = [];
    state.metadata.clear();
    state.jobs = [];
    state.path = '/game';
    state.settings = { devMode: false, experimentalVpkImprinting: false };
    state.locked = false;
    state.skipped = [];
    state.backups = [];
    state.events = [];
    mocks.safety.mockReset().mockImplementation(async () => {
        expect(state.locked).toBe(false);
        state.events.push('safety');
    });
    mocks.enable.mockReset().mockImplementation(async (_path: string, id: string) => {
        expect(state.locked).toBe(true);
        state.events.push('enable');
        const target = state.mods.find((candidate) => candidate.id === id)!;
        target.enabled = true;
        rename(target, 'enabled');
        return target;
    });
    mocks.setGlobal.mockReset().mockImplementation(async (_path: string, id: string) => {
        expect(state.locked).toBe(true);
        state.events.push('global');
        const target = state.mods.find((candidate) => candidate.id === id)!;
        state.metadata.set(target.metaKey, { ...state.metadata.get(target.metaKey), priorityMod: true });
        if (target.enabled) rename(target, 'global');
        return target;
    });
    mocks.delete.mockReset().mockImplementation(async (_path: string, targets: FilesystemMod[]) => {
        expect(state.locked).toBe(true);
        state.events.push('delete');
        for (const target of targets) {
            if (state.skipped.includes(target.id)) continue;
            state.backups.push(target.fileName);
            state.mods = state.mods.filter((candidate) => candidate.id !== target.id);
            state.metadata.delete(target.metaKey);
        }
        return { skipped: state.skipped };
    });
    mocks.imprint.mockReset().mockImplementation(async () => {
        expect(state.locked).toBe(false);
        state.events.push('imprint');
    });
});

describe('queued mod replacements', () => {
    it('adds every replacement to the FIFO synchronously before reading its sources', () => {
        const sources = ['old'];
        void queueModReplacement('/game', { ...args, replacementModIds: ['stale'] }, sources, null);
        void queueModReplacement('/game', { ...args, fileId: 21 }, ['other'], null);
        expect(state.jobs.map((job) => job.args.fileId)).toEqual([20, 21]);
        expect(state.jobs.map((job) => job.args.replacementModIds)).toEqual([['old'], ['other']]);
        expect(state.jobs[0].args.replacementModIds).not.toBe(sources);
        expect(state.events).toEqual([]);
    });

    it('projects stored identity without running UI classification or changing metadata', async () => {
        add('old', { modName: 'My mod', localGroupId: 'group', gameBananaFileId: 12, priorityMod: true, fileDescription: 'Blue' });
        expect(await readReplacementMods('/game')).toMatchObject([{
            id: 'old', name: 'My mod', localGroupId: 'group', gameBananaFileId: 12, priorityMod: true, fileDescription: 'Blue',
        }]);
        expect(state.events).toEqual([]);
    });

    it('backs up the predecessor and restores Global then enabled state under one mutation lock', async () => {
        add('old', { priorityMod: true }, { enabled: true });
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await expect(queued).resolves.toEqual({ installedVpks: ['fresh.vpk'] });
        expect(state.backups).toEqual(['old.vpk']);
        expect(state.events).toEqual(['lock', 'delete', 'global', 'enable', 'unlock']);
        expect(state.mods).toMatchObject([{ id: 'enabled-fresh', enabled: true }]);
        expect(state.metadata.get('enabled-fresh.vpk')?.priorityMod).toBe(true);
    });

    it('keeps a replacement disabled when the old version was disabled', async () => {
        add('old');
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await queued;
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(state.mods).toMatchObject([{ id: 'fresh', enabled: false }]);
    });

    it('promotes an installed successor only after its safety gate passes', async () => {
        add('old', {}, { enabled: true });
        add('fresh', { gameBananaFileId: 20 });
        const queued = queueModReplacement('/game', args, ['old'], null, { promoteExisting: true });
        await run();
        await queued;
        expect(mocks.safety).toHaveBeenCalledWith('/game', ['fresh'], expect.any(AbortSignal));
        expect(state.events).toEqual(['safety', 'lock', 'delete', 'enable', 'unlock']);
        expect(state.mods).toHaveLength(1);
    });

    it('retains an already enabled successor when promotion moves it into Global and changes its id', async () => {
        add('old', { priorityMod: true }, { enabled: true });
        add('fresh', { gameBananaFileId: 20 }, { enabled: true });
        const queued = queueModReplacement('/game', args, ['old'], null, { promoteExisting: true });
        await run();
        await queued;
        expect(state.mods).toMatchObject([{ id: 'global-fresh', enabled: true }]);
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(state.metadata.get('global-fresh.vpk')?.priorityMod).toBe(true);
    });

    it('preserves the source if a promoted successor fails its safety gate', async () => {
        add('old');
        add('fresh', { gameBananaFileId: 20 });
        mocks.safety.mockRejectedValueOnce(new Error('unsafe'));
        const queued = queueModReplacement('/game', args, ['old'], null, { promoteExisting: true });
        const check = expect(queued).rejects.toThrow('unsafe');
        await run();
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
        expect(state.backups).toEqual([]);
    });

    it('does not delete anything if the replacement was not installed', async () => {
        add('old');
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('was not installed');
        await run(0, () => undefined);
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it('rejects a source from a different GameBanana section with the same submission id', async () => {
        add('old', { sourceSection: 'Sound' });
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('no longer available');
        await run();
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it('leaves a Sound submission untouched when its numeric ids overlap the updated Mod', async () => {
        add('old', {}, { enabled: true });
        add('sound', { sourceSection: 'Sound', gameBananaFileId: 20 });
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await queued;
        expect(state.mods).toMatchObject([{ id: 'sound', enabled: false }, { id: 'enabled-fresh', enabled: true }]);
        expect(mocks.enable).toHaveBeenCalledWith('/game', 'fresh');
    });

    it('reinstalls one archive without deleting the newly downloaded copy', async () => {
        add('old', { gameBananaFileId: 20 });
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await queued;
        expect(state.backups).toEqual(['old.vpk']);
        expect(state.mods.map((item) => item.id)).toEqual(['fresh']);
    });

    it('rejects a source whose slot was reused or whose bytes changed during the download', async () => {
        const old = add('old', { sha256: 'original' });
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('changed before');
        await run(0, () => {
            old.size += 1;
            state.metadata.set(old.metaKey, { gameBananaId: 7, gameBananaFileId: 10, sha256: 'changed' });
            add('fresh', { gameBananaFileId: 20 });
        });
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
        expect(state.mods).toHaveLength(2);
    });

    it('refuses a same-submission slot reused by another archive before the queued update begins', async () => {
        const old = add('old');
        const queued = queueModReplacement('/game', args, ['old'], null);
        state.metadata.set(old.metaKey, { gameBananaId: 7, gameBananaFileId: 11 });
        const check = expect(queued).rejects.toThrow('no longer available');
        await run();
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
        expect(state.backups).toEqual([]);
    });

    it('finds a predecessor renamed while downloading without losing the original identity proof', async () => {
        const old = add('old', { sha256: 'original', vpkIndex: 0 });
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run(0, () => {
            rename(old, 'moved');
            add('fresh', { gameBananaFileId: 20 });
        });
        await queued;
        expect(state.backups).toEqual(['moved-old.vpk']);
        expect(state.mods).toHaveLength(1);
    });

    it('does not continue restoration when guarded deletion skipped a changed predecessor', async () => {
        add('old', {}, { enabled: true });
        state.skipped = ['old'];
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('before it could be replaced');
        await run();
        await check;
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(state.mods).toHaveLength(2);
    });

    it('stops without enabling the new version when retaining the old backup fails', async () => {
        add('old', {}, { enabled: true });
        mocks.delete.mockRejectedValueOnce(new Error('backup failed'));
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('backup failed');
        await run();
        await check;
        expect(mocks.enable).not.toHaveBeenCalled();
        expect(state.mods).toHaveLength(2);
    });

    it('restores local group identity before deleting its source and refreshes the embed after unlocking', async () => {
        add('old', { localGroupId: 'group', modName: 'My variants', lockerHero: 'Ivy', lockerHeroSource: 'manual' });
        state.settings.experimentalVpkImprinting = true;
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await queued;
        expect(state.metadata.get('fresh.vpk')).toMatchObject({ localGroupId: 'group', modName: 'My variants', lockerHero: 'Ivy' });
        expect(state.events).toEqual(['lock', 'delete', 'unlock', 'imprint']);
    });

    it('restores a Global local group before joining the replacement to it', async () => {
        add('old', { localGroupId: 'group', modName: 'My variants', priorityMod: true }, { enabled: true });
        const queued = queueModReplacement('/game', args, ['old'], null);
        await run();
        await queued;
        expect(state.metadata.get('enabled-fresh.vpk')).toMatchObject({ localGroupId: 'group', priorityMod: true });
        expect(state.events).toEqual(['lock', 'global', 'delete', 'enable', 'unlock']);
    });

    it('refuses to replace multiple local groups with a single archive', async () => {
        add('one', { localGroupId: 'one' });
        add('two', { localGroupId: 'two' });
        const queued = queueModReplacement('/game', args, ['one', 'two'], null);
        const check = expect(queued).rejects.toThrow('local variant group');
        await run();
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it('reports a state restore failure after the update was safely installed', async () => {
        add('old', {}, { enabled: true });
        mocks.enable.mockRejectedValueOnce(new Error('game is running'));
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('update was installed');
        await run();
        await check;
        expect(state.mods.map((item) => item.id)).toEqual(['fresh']);
        expect(state.backups).toEqual(['old.vpk']);
    });

    it.each(['path', 'mode'] as const)('rejects a changed %s before starting a queued update', async (change) => {
        add('old');
        const queued = queueModReplacement('/game', args, ['old'], null);
        if (change === 'path') state.path = '/other';
        else state.settings.devMode = true;
        const check = expect(queued).rejects.toThrow('active mod folder changed');
        await run();
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
    });

    it('rejects a developer mode switch during transfer before deleting the previous version', async () => {
        add('old');
        const queued = queueModReplacement('/game', args, ['old'], null);
        const check = expect(queued).rejects.toThrow('active mod folder changed');
        await run(0, () => {
            state.settings.devMode = true;
            add('fresh', { gameBananaFileId: 20 });
        });
        await check;
        expect(mocks.delete).not.toHaveBeenCalled();
    });

});
