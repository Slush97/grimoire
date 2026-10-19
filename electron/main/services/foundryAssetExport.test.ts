import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    showSaveDialog: vi.fn<() => Promise<{ canceled: boolean; filePath?: string }>>(),
    texture: vi.fn<() => Promise<string | null>>(),
    sound: vi.fn<() => Promise<string | null>>(),
}));
vi.mock('./dialogs', () => ({ showSaveDialog: mocks.showSaveDialog }));
vi.mock('./foundryCatalog', () => ({
    ensureNativeTextureFile: mocks.texture,
    ensureVoiceclipFile: mocks.sound,
}));
import { exportFoundryAsset } from './foundryAssetExport';

describe('Foundry asset export', () => {
    let dir: string;
    let source: string;
    let destination: string;
    beforeEach(async () => {
        vi.resetAllMocks();
        dir = await fs.mkdtemp(join(tmpdir(), 'grimoire-asset-export-'));
        source = join(dir, 'cached-asset');
        destination = join(dir, 'saved-asset');
        await fs.writeFile(source, Buffer.from([0, 1, 127, 255]));
        mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination });
        mocks.texture.mockResolvedValue(source);
        mocks.sound.mockResolvedValue(source);
    });
    afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('copies native texture bytes and suggests a PNG filename', async () => {
        const result = await exportFoundryAsset('game', {
            kind: 'texture', category: 'hero-image', path: 'panorama/images/heroes/kali_card_psd.vtex_c',
        });
        expect(result).toEqual({ exported: true, path: destination });
        expect(await fs.readFile(destination)).toEqual(await fs.readFile(source));
        expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'kali_card_psd.png' }));
        expect(mocks.texture).toHaveBeenCalledWith('game', 'hero-image', 'panorama/images/heroes/kali_card_psd.vtex_c');
        expect(mocks.sound).not.toHaveBeenCalled();
    });

    it.each(['sounds/hero/clip.vsnd', 'sounds/hero/clip.vsnd_c'])('saves the selected sound %s', async (path) => {
        await exportFoundryAsset('game', { kind: 'sound', path });
        expect(await fs.readFile(destination)).toEqual(await fs.readFile(source));
        expect(mocks.showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'clip.mp3' }));
        expect(mocks.sound).toHaveBeenCalledWith('game', path);
    });

    it('cancels without decoding or writing anything', async () => {
        mocks.showSaveDialog.mockResolvedValue({ canceled: true });
        expect(await exportFoundryAsset('game', { kind: 'sound', path: 'sounds/clip.vsnd' })).toEqual({ exported: false });
        expect(mocks.sound).not.toHaveBeenCalled();
        expect(await fs.readdir(dir)).toEqual(['cached-asset']);
    });

    it('reports an unsupported sound without writing a fake MP3', async () => {
        mocks.sound.mockResolvedValue(null);
        await expect(exportFoundryAsset('game', { kind: 'sound', path: 'sounds/clip.vsnd' })).rejects.toThrow('could not be extracted as MP3');
        expect(await fs.readdir(dir)).toEqual(['cached-asset']);
    });

    it.each([
        { kind: 'sound', path: '../secrets.vsnd' },
        { kind: 'sound', path: 'sounds/../../secrets.vsnd' },
        { kind: 'sound', path: 'C:\\secrets.vsnd' },
        { kind: 'texture', category: 'other', path: 'scripts/heroes.vdata_c' },
        { kind: 'texture', category: 'bogus', path: 'test.vtex_c' },
    ])('rejects invalid asset requests before opening a dialog', async (request) => {
        await expect(exportFoundryAsset('game', request)).rejects.toThrow('Choose a valid');
        expect(mocks.showSaveDialog).not.toHaveBeenCalled();
    });
});
