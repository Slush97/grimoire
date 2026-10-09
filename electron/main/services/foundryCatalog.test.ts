import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextureEntry, ThumbManifestEntry } from '../../../src/types/foundry';

const mocks = vi.hoisted(() => ({
    userData: '',
    runVpkmerge: vi.fn<(args: string[]) => Promise<void>>(),
    runVpkmergeStdout: vi.fn<(args: string[]) => Promise<string>>(),
}));

vi.mock('electron', () => ({
    app: { getPath: () => mocks.userData },
    protocol: { handle: vi.fn() },
    net: { fetch: vi.fn() },
}));
vi.mock('./modMerger', () => ({
    runVpkmerge: mocks.runVpkmerge,
    runVpkmergeStdout: mocks.runVpkmergeStdout,
    verifyVpkOutput: vi.fn(),
}));

import {
    ensureCategoryThumbnails,
    ensureFullImage,
    ensureVoiceclip,
    warmCache,
} from './foundryCatalog';

const texture = {
    path: 'panorama/images/items/test.vtex_c',
    category: 'item-icon',
    hero: null,
    label: 'Test item',
} satisfies TextureEntry;
const manifest = [{
    entry: texture.path,
    file: 'test.png',
    width: 128,
    height: 128,
    sourceWidth: 256,
    sourceHeight: 256,
    format: 'RGBA8888',
}] satisfies ThumbManifestEntry[];
const audio = Buffer.from('test MP3 payload');
const soundPath = 'sounds/vo/atlas/test.vsnd_c';

function flagValue(args: string[], flag: string): string {
    const index = args.indexOf(flag);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${flag}`);
    return args[index + 1];
}

describe('Foundry asset cache independence', () => {
    let fixture: string;
    let game: string;
    let pak: string;

    beforeEach(async () => {
        vi.resetAllMocks();
        fixture = await fs.mkdtemp(join(tmpdir(), 'grimoire-foundry-test-'));
        game = join(fixture, 'Deadlock');
        pak = join(game, 'game', 'citadel', 'pak01_dir.vpk');
        mocks.userData = join(fixture, 'userData');
        await fs.mkdir(dirname(pak), { recursive: true });
        await fs.writeFile(pak, Buffer.from('VPK fixture'));
        await fs.utimes(pak, 1_750_000_000, 1_750_000_000.1231);

        // Reproduce a game build lacking the optional caption index. Asset
        // commands work, but a catalog-wide warmup would fail.
        mocks.runVpkmergeStdout.mockImplementation(async (args) => {
            if (args[1] === 'cache') throw new Error('Missing VO caption file');
            if (args[1] === 'texture') return JSON.stringify([texture]);
            throw new Error(`Unexpected catalog command: ${args.join(' ')}`);
        });
        mocks.runVpkmerge.mockImplementation(async (args) => {
            expect(args.slice(0, 2)).not.toEqual(['catalog', 'cache']);
            expect(flagValue(args, '--vpk')).toBe(pak);
            if (args[1] === 'texture') {
                const out = flagValue(args, '--thumbs');
                await fs.writeFile(join(out, 'manifest.json'), JSON.stringify(manifest));
                await fs.writeFile(join(out, 'test.png'), Buffer.from('test PNG payload'));
            } else if (args[1] === 'voiceclip') {
                expect(flagValue(args, '--entry')).toBe(soundPath);
                await fs.writeFile(flagValue(args, '--out'), audio);
            } else {
                throw new Error(`Unexpected asset command: ${args.join(' ')}`);
            }
        });
    });

    afterEach(async () => {
        await fs.rm(fixture, { recursive: true, force: true });
    });

    it('decodes and reuses thumbnails without building the voice-line index', async () => {
        const first = await ensureCategoryThumbnails(game, 'item-icon');
        expect(first).toEqual([{
            ...texture,
            thumbUrl: expect.stringContaining('grimoire-foundry://t/'),
            sourceWidth: 256,
            sourceHeight: 256,
        }]);
        expect(await ensureCategoryThumbnails(game, 'item-icon')).toEqual(first);
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(1);
        expect(mocks.runVpkmergeStdout.mock.calls.map(([args]) => args[1])).toEqual([
            'texture', 'texture',
        ]);

        await fs.appendFile(pak, ' updated game');
        const updated = await ensureCategoryThumbnails(game, 'item-icon');
        expect(updated[0].thumbUrl).not.toBe(first[0].thumbUrl);
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(2);
        expect(await fs.readdir(join(mocks.userData, 'foundry-thumbs'))).toHaveLength(1);
    });

    it('keeps thumbnail directories compatible with the engine fingerprint', async () => {
        const stat = await fs.stat(pak, { bigint: true });
        const key = `${stat.size}-${stat.mtimeNs / 1_000_000_000n}-${stat.mtimeNs % 1_000_000_000n}`;
        const dir = join(mocks.userData, 'foundry-thumbs', key, 'item-icon');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));

        const items = await ensureCategoryThumbnails(game, 'item-icon');
        expect(items[0].thumbUrl).toBe(`grimoire-foundry://t/${key}/item-icon/test.png`);
        expect(mocks.runVpkmerge).not.toHaveBeenCalled();
    });

    it('decodes and reuses full images without any catalog-wide command', async () => {
        const first = await ensureFullImage(game, 'item-icon', texture.path);
        expect(first).toContain('/item-icon%40full/test.png');
        expect(await ensureFullImage(game, 'item-icon', texture.path)).toBe(first);
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(1);
        expect(mocks.runVpkmergeStdout).not.toHaveBeenCalled();

        await fs.utimes(pak, 1_750_000_000, 1_750_000_001);
        expect(await ensureFullImage(game, 'item-icon', texture.path)).not.toBe(first);
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(2);
    });

    it('extracts and reuses playable audio without reading the caption catalog', async () => {
        const expected = `data:audio/mpeg;base64,${audio.toString('base64')}`;
        expect(await ensureVoiceclip(game, soundPath)).toBe(expected);
        expect(await ensureVoiceclip(game, soundPath)).toBe(expected);
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(1);
        expect(mocks.runVpkmergeStdout).not.toHaveBeenCalled();
    });

    it.each(['size', 'nanosecond mtime'])('invalidates cached audio when VPK %s changes', async (change) => {
        await ensureVoiceclip(game, soundPath);
        const original = await fs.stat(pak, { bigint: true });
        if (change === 'size') {
            await fs.appendFile(pak, ' game update');
            // Isolate length invalidation from timestamp invalidation.
            await fs.utimes(pak, 1_750_000_000, 1_750_000_000.1231);
        } else {
            await fs.utimes(pak, 1_750_000_000, 1_750_000_000.1237);
            const changed = await fs.stat(pak, { bigint: true });
            expect(changed.size).toBe(original.size);
            expect(changed.mtimeNs / 1_000_000n).toBe(original.mtimeNs / 1_000_000n);
            expect(changed.mtimeNs).not.toBe(original.mtimeNs);
        }

        expect(await ensureVoiceclip(game, soundPath)).not.toBeNull();
        expect(mocks.runVpkmerge).toHaveBeenCalledTimes(2);
        expect(await fs.readdir(join(mocks.userData, 'foundry-voiceclips'))).toHaveLength(1);
    });

    it('keeps an explicit catalog warmup best-effort', async () => {
        await expect(warmCache(game)).resolves.toBeUndefined();
        expect(mocks.runVpkmergeStdout).toHaveBeenCalledWith([
            'catalog', 'cache', '--vpk', pak, '--dir',
            join(mocks.userData, 'foundry-catalog-cache'), '--json',
        ]);
    });
});
