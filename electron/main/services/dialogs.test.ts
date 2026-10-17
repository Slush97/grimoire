import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    userData: '',
    downloads: '',
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
    app: { getPath: (name: string) => name === 'downloads' ? mocks.downloads : mocks.userData },
    dialog: {
        showOpenDialog: mocks.showOpenDialog,
        showSaveDialog: mocks.showSaveDialog,
    },
}));

import { showOpenDialog, showSaveDialog } from './dialogs';
import { loadSettings, saveSettings } from './settings';

describe('dialog directory memory', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.userData = mkdtempSync(join(tmpdir(), 'grimoire-dialogs-'));
        mocks.downloads = join(mocks.userData, 'Downloads');
        mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
        mocks.showSaveDialog.mockResolvedValue({ canceled: true });
    });

    afterEach(() => {
        rmSync(mocks.userData, { recursive: true, force: true });
    });

    it('starts in Downloads for settings without a remembered directory', async () => {
        writeFileSync(join(mocks.userData, 'settings.json'), '{}');

        await showOpenDialog({ properties: ['openFile'] });

        expect(mocks.showOpenDialog).toHaveBeenCalledWith({
            properties: ['openFile'],
            defaultPath: mocks.downloads,
        });
        expect(loadSettings().lastDialogDirectory).toBeNull();
    });

    it('keeps the suggested filename on the first save', async () => {
        await showSaveDialog({ defaultPath: 'My_Mod_dir.vpk' });

        expect(mocks.showSaveDialog).toHaveBeenCalledWith({
            defaultPath: join(mocks.downloads, 'My_Mod_dir.vpk'),
        });
    });

    it('falls back to Downloads when the remembered directory was deleted', async () => {
        writeFileSync(join(mocks.userData, 'settings.json'), JSON.stringify({ lastDialogDirectory: join(mocks.userData, 'Gone') }));

        await showSaveDialog({ defaultPath: 'mod_dir.vpk' });

        expect(mocks.showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(mocks.downloads, 'mod_dir.vpk') });
    });

    it('uses a directory persisted by an earlier process', async () => {
        const directory = join(mocks.userData, 'Mods');
        mkdirSync(directory);
        writeFileSync(join(mocks.userData, 'settings.json'), JSON.stringify({ lastDialogDirectory: directory }));

        await showOpenDialog({ properties: ['openDirectory'] });

        expect(mocks.showOpenDialog).toHaveBeenCalledWith({
            properties: ['openDirectory'],
            defaultPath: directory,
        });
    });

    it('preserves an explicit absolute default path', async () => {
        saveSettings({ ...loadSettings(), lastDialogDirectory: mocks.downloads });
        const explicit = join(mocks.userData, 'Deadlock');

        await showOpenDialog({ defaultPath: explicit, properties: ['openDirectory'] });
        await showSaveDialog({ defaultPath: join(explicit, 'mod_dir.vpk') });

        expect(mocks.showOpenDialog).toHaveBeenCalledWith({
            defaultPath: explicit,
            properties: ['openDirectory'],
        });
        expect(mocks.showSaveDialog).toHaveBeenCalledWith({ defaultPath: join(explicit, 'mod_dir.vpk') });
    });

    it('remembers a selected directory itself and joins the next suggested filename', async () => {
        const directory = join(mocks.userData, 'My Mods');
        mkdirSync(directory);
        mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [directory] });

        await showOpenDialog({ properties: ['openDirectory'] });
        await showSaveDialog({ defaultPath: 'crash.dmp', filters: [{ name: 'Dump', extensions: ['dmp'] }] });

        expect(loadSettings().lastDialogDirectory).toBe(directory);
        expect(mocks.showSaveDialog).toHaveBeenCalledWith({
            defaultPath: join(directory, 'crash.dmp'),
            filters: [{ name: 'Dump', extensions: ['dmp'] }],
        });
    });

    it('remembers a selected file parent for the next open dialog', async () => {
        const directory = join(mocks.userData, 'Imports');
        mkdirSync(directory);
        const result = { canceled: false, filePaths: [join(directory, 'mod.vpk')] };
        mocks.showOpenDialog.mockResolvedValueOnce(result);

        expect(await showOpenDialog({ properties: ['openFile'] })).toBe(result);
        await showOpenDialog({ properties: ['openFile'] });

        expect(loadSettings().lastDialogDirectory).toBe(directory);
        expect(mocks.showOpenDialog).toHaveBeenLastCalledWith({
            properties: ['openFile'],
            defaultPath: directory,
        });
    });

    it('remembers the first file parent in a multi-selection and returns all files', async () => {
        const directory = join(mocks.userData, 'Imports');
        const result = { canceled: false, filePaths: [join(directory, 'a.vpk'), join(directory, 'b.vpk')] };
        mocks.showOpenDialog.mockResolvedValue(result);

        expect(await showOpenDialog({ properties: ['openFile', 'multiSelections'] })).toBe(result);
        expect(loadSettings().lastDialogDirectory).toBe(directory);
    });

    it('remembers a save destination parent and preserves settings changed during the dialog', async () => {
        const directory = join(mocks.userData, 'Exports');
        mocks.showSaveDialog.mockImplementation(async () => {
            saveSettings({ ...loadSettings(), oledMode: true });
            return { canceled: false, filePath: join(directory, 'mod_dir.vpk') };
        });

        await showSaveDialog({ defaultPath: 'mod_dir.vpk' });

        expect(loadSettings()).toMatchObject({ lastDialogDirectory: directory, oledMode: true });
    });

    it('ignores canceled dialogs even when they return a path', async () => {
        saveSettings({ ...loadSettings(), lastDialogDirectory: mocks.downloads });
        mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [join(mocks.userData, 'Ignored')] });
        mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: join(mocks.userData, 'ignored.vpk') });

        await showOpenDialog({ properties: ['openDirectory'] });
        await showSaveDialog({});

        expect(loadSettings().lastDialogDirectory).toBe(mocks.downloads);
    });

    it('ignores empty selections', async () => {
        mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
        mocks.showSaveDialog.mockResolvedValue({ canceled: false });

        await showOpenDialog({});
        await showSaveDialog({});

        expect(loadSettings().lastDialogDirectory).toBeNull();
    });
});
