import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const harness = vi.hoisted(() => ({
    settings: { autoDisableSiblingVariants: true, autoEnableDownloads: false } as Record<string, unknown>,
    metadata: new Map<string, { gameBananaId: number; gameBananaFileId: number }>(),
    installed: [] as Array<{ id: string; name: string; fileName: string; metaKey: string; enabled: boolean }>,
}));
const modMocks = vi.hoisted(() => ({
    scanMods: vi.fn(),
    enableMod: vi.fn(),
    disableMod: vi.fn(),
}));

vi.mock('electron', () => ({
    app: { getPath: () => '/tmp/grimoire-test-user-data', getVersion: () => 'test' },
    BrowserWindow: class BrowserWindow {
        static getAllWindows() { return []; }
    },
}));
vi.mock('@grimoire/social-types/heroes', () => ({ inferHeroFromTitle: () => null }));
vi.mock('./settings', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./settings')>()),
    loadSettings: () => harness.settings,
}));
vi.mock('./metadata', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./metadata')>()),
    getModMetadata: (metaKey: string) => harness.metadata.get(metaKey),
}));
vi.mock('./mods', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./mods')>()),
    scanMods: modMocks.scanMods,
    enableMod: modMocks.enableMod,
    disableMod: modMocks.disableMod,
}));

import { applyPostInstallEnableRules } from './download';

const QOL = 650634;
const HOTFIX = 1833534;

function installState(): void {
    // The old main and an announcer are enabled; the freshly downloaded hotfix
    // landed disabled.
    harness.installed = [
        { id: 'old-main', name: 'QOL Lock', fileName: 'pak02_dir.vpk', metaKey: 'pak02_dir.vpk', enabled: true },
        { id: 'announcer', name: 'QOL Lock announcer', fileName: 'pak03_dir.vpk', metaKey: 'pak03_dir.vpk', enabled: true },
        { id: 'hotfix', name: 'QOL Lock', fileName: 'hotfix_dir.vpk', metaKey: 'hotfix_dir.vpk', enabled: false },
    ];
    harness.metadata = new Map([
        ['pak02_dir.vpk', { gameBananaId: QOL, gameBananaFileId: 1832204 }],
        ['pak03_dir.vpk', { gameBananaId: QOL, gameBananaFileId: 1680726 }],
        ['hotfix_dir.vpk', { gameBananaId: QOL, gameBananaFileId: HOTFIX }],
    ]);
}

const target = (isReplacement = false) => ({
    modId: QOL,
    fileId: HOTFIX,
    eventModId: QOL,
    eventFileId: HOTFIX,
    isReplacement,
});

describe('applyPostInstallEnableRules', () => {
    const send = vi.fn();
    const mainWindow = { webContents: { send } } as unknown as BrowserWindow;

    beforeEach(() => {
        installState();
        harness.settings = { autoDisableSiblingVariants: true, autoEnableDownloads: false };
        modMocks.scanMods.mockReset().mockImplementation(async () => harness.installed);
        modMocks.enableMod.mockReset();
        modMocks.disableMod.mockReset();
        send.mockReset();
    });

    it('switches variants on a plain install: siblings off, the new file on', async () => {
        await applyPostInstallEnableRules('/game', ['hotfix_dir.vpk'], target(), mainWindow, '[test]');

        expect(modMocks.disableMod.mock.calls.map((call) => call[1])).toEqual(['old-main', 'announcer']);
        expect(modMocks.enableMod.mock.calls.map((call) => call[1])).toEqual(['hotfix']);
        expect(send).toHaveBeenCalledWith('mods-auto-disabled', expect.objectContaining({
            reason: 'sibling-variant',
            modId: QOL,
            fileId: HOTFIX,
        }));
    });

    it('leaves every sibling enabled when the install replaces specific files', async () => {
        await applyPostInstallEnableRules('/game', ['hotfix_dir.vpk'], target(true), mainWindow, '[test]');

        expect(modMocks.disableMod).not.toHaveBeenCalled();
        expect(modMocks.enableMod).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
    });

    it('still honours auto-enable for a replacing install', async () => {
        harness.settings = { autoDisableSiblingVariants: true, autoEnableDownloads: true };

        await applyPostInstallEnableRules('/game', ['hotfix_dir.vpk'], target(true), mainWindow, '[test]');

        expect(modMocks.disableMod).not.toHaveBeenCalled();
        expect(modMocks.enableMod.mock.calls.map((call) => call[1])).toEqual(['hotfix']);
    });

    it('keeps siblings enabled when the user turned sibling auto-disable off', async () => {
        harness.settings = { autoDisableSiblingVariants: false, autoEnableDownloads: false };

        await applyPostInstallEnableRules('/game', ['hotfix_dir.vpk'], target(), mainWindow, '[test]');

        expect(modMocks.disableMod).not.toHaveBeenCalled();
        expect(modMocks.enableMod).not.toHaveBeenCalled();
    });
});
