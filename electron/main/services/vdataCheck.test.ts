import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const h = vi.hoisted(() => ({ send: vi.fn(), run: vi.fn(), trees: new Map<string, string[]>() }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ webContents: { send: h.send } }] } }));
vi.mock('./modMerger', () => ({ runVpkmergeStdout: h.run }));
vi.mock('./vpk', () => ({
    parseVpkDirectoriesAsync: async (paths: string[]) => new Map(paths.map((p) => [p, h.trees.get(p) ?? []])),
}));
vi.mock('./deadlock', () => ({ getCitadelPath: (deadlockPath: string) => deadlockPath }));

const HEROES = 'scripts/heroes.vdata_c';
const WEREWOLF = 'models/heroes_wip/werewolf/werewolf.vmdl_c';

let dir: string;
let vdata: typeof import('./vdataCheck');

async function vpk(name: string, entries: string[], bytes = 'vpk'): Promise<string> {
    const path = join(dir, 'addons', name);
    await fs.writeFile(path, bytes);
    h.trees.set(path, entries);
    return path;
}

function report(missing: string[], extra: string[] = []) {
    return { entry: HEROES, status: 'outdated', missing, extra, changed: [] };
}

function modelReport(status: string, stale: string[] = []) {
    return { entry: WEREWOLF, status, stale };
}

/** Answers every spawn with these reports per mod path (none for unlisted mods). */
function respond(
    vdataReports: Record<string, ReturnType<typeof report>[]>,
    modelReports: Record<string, ReturnType<typeof modelReport>[]> = {}
) {
    h.run.mockImplementation(async (args: string[]) => {
        const [reports, mods] = args[0] === 'attachments'
            ? [modelReports, args.slice(5)]
            : [vdataReports, args.slice(4)];
        return JSON.stringify(mods.map((mod) => ({ mod, reports: reports[mod] ?? [] })));
    });
}

beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'vdata-check-'));
    await fs.mkdir(join(dir, 'addons'));
    await fs.writeFile(join(dir, 'pak01_dir.vpk'), 'game');
    h.send.mockReset();
    h.run.mockReset();
    h.trees.clear();
    vi.resetModules();
    vdata = await import('./vdataCheck');
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
});

describe('checkOutdatedVdata', () => {
    it('never spawns vpkmerge for a library without vdata or hero models', async () => {
        const prop = await vpk('pak01_dir.vpk', ['models/props/crate.vmdl_c', 'materials/crate.vmat_c']);
        await vdata.checkOutdatedVdata(dir, [prop]);
        expect(h.run).not.toHaveBeenCalled();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('flags a hero model that predates the camera change, once', async () => {
        const stale = await vpk('pak01_dir.vpk', [WEREWOLF]);
        const fixed = await vpk('pak02_dir.vpk', [WEREWOLF]);
        respond({}, { [stale]: [modelReport('stale', ['standing_pivot', 'aim'])], [fixed]: [modelReport('current')] });

        await vdata.checkOutdatedVdata(dir, [stale, fixed]);
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.run.mock.calls[0][0].slice(0, 2)).toEqual(['attachments', 'check']);
        expect(vdata.staleModelsSnapshot(stale)).toEqual([{ entry: WEREWOLF, attachments: ['standing_pivot', 'aim'] }]);
        expect(vdata.staleModelsSnapshot(fixed)).toBeUndefined();
        expect(h.send).toHaveBeenCalledTimes(1);

        await vdata.checkOutdatedVdata(dir, [stale, fixed]);
        expect(h.run).toHaveBeenCalledTimes(1);
    });

    it('runs both checks for a mod that ships vdata and a hero model', async () => {
        const mod = await vpk('pak01_dir.vpk', [HEROES, WEREWOLF]);
        respond({ [mod]: [report(['hero_ratking'])] }, { [mod]: [modelReport('stale', ['lean'])] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(2);
        expect(vdata.outdatedVdataSnapshot(mod)?.[0].missing).toBe(1);
        expect(vdata.staleModelsSnapshot(mod)?.[0].attachments).toEqual(['lean']);
    });

    it('checks a standalone cat form and flags missing camera data after an earlier fix', async () => {
        const entry = 'models/abilities/nano_catform_model.vmdl_c';
        const mod = await vpk('pak51_dir.vpk', [entry]);
        respond({}, { [mod]: [{ entry, status: 'stale', stale: ['standing_pivot', 'CitadelCameraSettings_t'] }] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(vdata.staleModelsSnapshot(mod)).toEqual([{ entry, attachments: ['standing_pivot', 'CitadelCameraSettings_t'] }]);
        expect(h.send).toHaveBeenCalledWith('mod-vdata-checked');
    });

    it('shows skipped wolf poses again and clears the warning after repair', async () => {
        const entry = 'models/heroes_wip/werewolf/transform/werewolf_transform.vmdl_c';
        const mod = await vpk('pak41_dir.vpk', [entry]);
        respond({}, { [mod]: [{ entry, status: 'stale', stale: ['far_01', 'far_02'] }] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(vdata.staleModelsSnapshot(mod)?.[0].attachments).toEqual(['far_01', 'far_02']);
        await fs.writeFile(mod, 'complete camera repair');
        respond({}, { [mod]: [{ entry, status: 'current', stale: [] }] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(vdata.staleModelsSnapshot(mod)).toBeUndefined();
    });

    it('drops a stale model flag once the mod is healed', async () => {
        const mod = await vpk('pak01_dir.vpk', [WEREWOLF]);
        respond({}, { [mod]: [modelReport('stale', ['standing_pivot'])] });
        await vdata.checkOutdatedVdata(dir, [mod]);

        await fs.writeFile(mod, 'healed vpk');
        expect(vdata.staleModelsSnapshot(mod)).toBeUndefined();
        respond({}, { [mod]: [modelReport('current')] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(2);
        expect(vdata.staleModelsSnapshot(mod)).toBeUndefined();
        // The flag went away with the file change, so the recheck shows nothing new.
        expect(h.send).toHaveBeenCalledTimes(1);
    });

    it('flags a mod that deletes game fields, once', async () => {
        const stale = await vpk('pak01_dir.vpk', [HEROES]);
        const current = await vpk('pak02_dir.vpk', [HEROES, 'panorama/image_compiler.vdata_c']);
        respond({ [stale]: [report(['hero_ratking', 'hero_base/m_vecStats[=EMaxHealth]'])] });

        await vdata.checkOutdatedVdata(dir, [stale, current]);
        expect(vdata.outdatedVdataSnapshot(stale)).toEqual([
            { entry: HEROES, missing: 2, sample: ['hero_ratking', 'hero_base/m_vecStats[=EMaxHealth]'] },
        ]);
        expect(vdata.outdatedVdataSnapshot(current)).toBeUndefined();
        expect(h.send).toHaveBeenCalledTimes(1);

        await vdata.checkOutdatedVdata(dir, [stale, current]);
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.send).toHaveBeenCalledTimes(1);
    });

    it('does not flag a mod that only has fields the game dropped', async () => {
        const mod = await vpk('pak01_dir.vpk', [HEROES]);
        respond({ [mod]: [report([], ['hero_base/m_bOld'])] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(vdata.outdatedVdataSnapshot(mod)).toBeUndefined();
        expect(h.send).not.toHaveBeenCalled();
    });

    it('ignores editor-only fields that community compilers strip', async () => {
        const rebuilt = await vpk('pak01_dir.vpk', [HEROES]);
        const stale = await vpk('pak02_dir.vpk', [HEROES]);
        const editorOnly = ['_include', 'hero_base/_editor', 'hero_atlas/_editor/folder_name'];
        respond({ [rebuilt]: [report(editorOnly)], [stale]: [report([...editorOnly, 'hero_ratking'])] });
        await vdata.checkOutdatedVdata(dir, [rebuilt, stale]);
        expect(vdata.outdatedVdataSnapshot(rebuilt)).toBeUndefined();
        expect(vdata.outdatedVdataSnapshot(stale)).toEqual([{ entry: HEROES, missing: 1, sample: ['hero_ratking'] }]);
    });

    it('keeps other results when one mod fails to open', async () => {
        const broken = await vpk('pak01_dir.vpk', [HEROES]);
        const stale = await vpk('pak02_dir.vpk', [HEROES]);
        h.run.mockResolvedValue(JSON.stringify([
            { mod: stale, reports: [report(['hero_ratking'])] },
            { mod: broken, error: 'opening mod: Failed to read VPK header' },
        ]));
        await vdata.checkOutdatedVdata(dir, [broken, stale]);
        expect(vdata.outdatedVdataSnapshot(stale)?.[0].missing).toBe(1);
        expect(vdata.outdatedVdataSnapshot(broken)).toBeUndefined();
    });

    it('does not respawn after a failed run until the file changes', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const mod = await vpk('pak01_dir.vpk', [HEROES]);
        h.run.mockRejectedValue(new Error("unrecognized subcommand 'vdata-check'"));
        await vdata.checkOutdatedVdata(dir, [mod]);
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(1);

        await fs.writeFile(mod, 'updated vpk');
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(2);
    });

    it('drops a warning as soon as the mod file changes', async () => {
        const mod = await vpk('pak01_dir.vpk', [HEROES]);
        respond({ [mod]: [report(['hero_ratking'])] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        await fs.writeFile(mod, 'rebuilt vpk');
        expect(vdata.outdatedVdataSnapshot(mod)).toBeUndefined();
    });

    it('keeps the warning through a rename without respawning', async () => {
        const from = await vpk('pak01_dir.vpk', [HEROES]);
        respond({ [from]: [report(['hero_ratking'])] });
        await vdata.checkOutdatedVdata(dir, [from]);

        const to = join(dir, 'addons', 'pak05_dir.vpk');
        await fs.rename(from, to);
        vdata.moveVdataSnapshot(from, to);
        h.trees.set(to, [HEROES]);
        expect(vdata.outdatedVdataSnapshot(to)?.[0].missing).toBe(1);

        await vdata.checkOutdatedVdata(dir, [to]);
        expect(h.run).toHaveBeenCalledTimes(1);
        expect(h.send).toHaveBeenCalledTimes(1);
    });

    it('rechecks after a game update and clears a warning that no longer applies', async () => {
        const mod = await vpk('pak01_dir.vpk', [HEROES]);
        respond({ [mod]: [report(['hero_ratking'])] });
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.send).toHaveBeenCalledTimes(1);

        await fs.writeFile(join(dir, 'pak01_dir.vpk'), 'game after update');
        respond({});
        await vdata.checkOutdatedVdata(dir, [mod]);
        expect(h.run).toHaveBeenCalledTimes(2);
        expect(vdata.outdatedVdataSnapshot(mod)).toBeUndefined();
        expect(h.send).toHaveBeenCalledTimes(2);
    });

    it('splits large libraries across spawns', async () => {
        const mods = await Promise.all(
            Array.from({ length: 60 }, (_, i) => vpk(`pak${String(i).padStart(2, '0')}_dir.vpk`, [HEROES]))
        );
        respond({});
        await vdata.checkOutdatedVdata(dir, mods);
        expect(h.run).toHaveBeenCalledTimes(2);
        expect(h.run.mock.calls.map(([args]) => (args as string[]).length - 4)).toEqual([50, 10]);
    });
});
