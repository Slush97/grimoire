/**
 * Coverage for the merge share-code hint payload: an NSFW source inside a
 * shared merge must carry hint.nsfw (ImportProfileDialog's skip filter and
 * thumbnail blur key off it), along with the category/fileLabel/
 * originalFileName/isArchived hints a plain export carries. Bare snapshots
 * (the DB-wipe reconstruction path) still project without the extras. Every
 * heavy modMerger dependency is stubbed inert; portableProfile stays REAL
 * (encodeShareCode is pure and unused here).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('./deadlock', () => ({ metaKeyFor: vi.fn((p: string) => p) }));
vi.mock('./settings', () => ({ loadSettings: vi.fn(() => ({})) }));
vi.mock('./mods', () => ({
    scanMods: vi.fn(),
    disableModUnlocked: vi.fn(),
    enableModUnlocked: vi.fn(),
    allocateEnabledVpkPath: vi.fn(),
    runExclusiveModMutation: vi.fn(),
}));
vi.mock('./metadata', () => ({
    getModMetadata: vi.fn(),
    setModMetadata: vi.fn(),
    removeModMetadata: vi.fn(),
}));
vi.mock('./vpkIdentity', () => ({ resolveVpkIdentity: vi.fn() }));
vi.mock('./modinfoFormat', () => ({
    computeOriginalIdentity: vi.fn(),
    serializeAddonInfo: vi.fn(),
    serializeModinfo: vi.fn(),
    hasLegacyGrimoireMergeMetaEntry: vi.fn(),
    findImprintRepackMismatch: vi.fn(),
    ADDONINFO_ENTRY: 'addoninfo.txt',
    MODINFO_ENTRY: 'modinfo.json',
    LEGACY_GRIMOIRE_META_ENTRY: 'grimoire_meta.json',
    MODINFO_FORMAT: 'vpk-modinfo',
    MODINFO_GAME: { name: 'Deadlock', steamAppId: 1422450, gameBananaGameId: 20948 },
    MODINFO_SCHEMA_VERSION: 1,
}));
vi.mock('./gameSessionMods', () => ({
    assertCanMoveLoadedGameMod: vi.fn(),
    assertCanMoveLoadedGameMods: vi.fn(),
    syncRunningGameModSnapshotFromMods: vi.fn(),
}));
vi.mock('./vpk', () => ({
    parseVpkDirectory: vi.fn(),
    parseVpkDirectoryCached: vi.fn(),
    parseVpkEntryStats: vi.fn(),
}));

import { buildPortableForMergeSources, type PortableMergeSourceEntry } from './modMerger';

const BASE: PortableMergeSourceEntry = {
    fileName: 'pak05_dir.vpk',
    modName: 'Spicy Skin',
    gameBananaId: 4242,
    gameBananaFileId: 9001,
    section: 'Mod',
    enabledAtMergeTime: true,
    priorityAtMergeTime: 5,
};

describe('buildPortableForMergeSources', () => {
    it('carries the full hint fields when the entry is enriched', () => {
        const portable = buildPortableForMergeSources(
            [
                {
                    ...BASE,
                    thumbnailUrl: 'https://images.example/thumb.jpg',
                    nsfw: true,
                    categoryName: 'Vindicta',
                    fileLabel: 'gold variant',
                    originalFileName: 'spicy_skin.zip',
                    isArchived: true,
                },
            ],
            'My Merge'
        );

        expect(portable.mods).toHaveLength(1);
        expect(portable.mods[0].hint).toEqual({
            name: 'Spicy Skin',
            category: 'Vindicta',
            fileLabel: 'gold variant',
            originalFileName: 'spicy_skin.zip',
            thumbnailUrl: 'https://images.example/thumb.jpg',
            nsfw: true,
            isArchived: true,
        });
    });

    it('projects a bare snapshot (DB-wipe reconstruction) with the extras simply absent', () => {
        const portable = buildPortableForMergeSources([BASE], 'My Merge');

        expect(portable.mods).toHaveLength(1);
        expect(portable.mods[0].ref).toEqual({ submissionId: 4242, fileId: 9001, section: 'Mod' });
        expect(portable.mods[0].hint?.name).toBe('Spicy Skin');
        expect(portable.mods[0].hint?.nsfw).toBeUndefined();
    });

    it('still omits local sources (no GameBanana ref)', () => {
        const portable = buildPortableForMergeSources(
            [{ ...BASE, gameBananaId: undefined, gameBananaFileId: undefined }],
            'My Merge'
        );
        expect(portable.mods).toHaveLength(0);
    });
});
