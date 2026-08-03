import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LockerCardLink, LockerCardSelection } from '../../../src/types/mod';

const h = vi.hoisted(() => {
    const state: {
        links: unknown[];
        stored: unknown[];
        mods: unknown[];
        metadata: Record<string, Record<string, unknown>>;
    } = { links: [], stored: [], mods: [], metadata: {} };

    return {
        state,
        getCardLinks: vi.fn(() => state.links),
        saveCardLinks: vi.fn((links: unknown[]) => {
            state.links = links.map((link) => ({ ...(link as object) }));
        }),
        currentCardSelections: vi.fn(async () => state.stored),
        rebuildLockerCosmetics: vi.fn(async (_path: string, desired: unknown[]) => {
            state.stored = desired;
            return { fileName: desired.length > 0 ? 'locker.vpk' : null, missing: [] };
        }),
        heroCardPathsForHero: vi.fn(() => [
            'panorama/images/heroes/familiar_card_psd.vtex_c',
        ]),
        variantsForHeroPaths: vi.fn(() => ['card']),
        scanMods: vi.fn(async () => state.mods),
        getModMetadata: vi.fn((key: string) => state.metadata[key]),
        ensureGrimoireConfigured: vi.fn(),
        codenamesForHero: vi.fn(() => ['familiar']),
        resolveVpkIdentity: vi.fn(async () => ({ sha256: 'icon-sha' })),
        vpkmergeBinaryPath: vi.fn(() => '/vpkmerge'),
    };
});

vi.mock('./metadata', () => ({ getModMetadata: h.getModMetadata }));
vi.mock('./lockerVpk', () => ({ ensureGrimoireConfigured: h.ensureGrimoireConfigured }));
vi.mock('./lockerCardLinkStore', () => ({
    getCardLinks: h.getCardLinks,
    saveCardLinks: h.saveCardLinks,
}));
vi.mock('./heroCards', () => ({
    currentCardSelections: h.currentCardSelections,
    heroCardPathsForHero: h.heroCardPathsForHero,
    rebuildLockerCosmetics: h.rebuildLockerCosmetics,
    variantsForHeroPaths: h.variantsForHeroPaths,
}));
vi.mock('./heroPortraits', () => ({ codenamesForHero: h.codenamesForHero }));
vi.mock('./mods', () => ({ scanMods: h.scanMods }));
vi.mock('./vpkIdentity', () => ({ resolveVpkIdentity: h.resolveVpkIdentity }));
vi.mock('./modMerger', () => ({ vpkmergeBinaryPath: h.vpkmergeBinaryPath }));

import {
    reconcileLinkedCards,
    removeCardLink,
    setCardLink,
} from './lockerCardLinks';

const NOW = '2026-08-03T00:00:00.000Z';

function link(over: Partial<LockerCardLink> = {}): LockerCardLink {
    return {
        skinKey: 'gamebanana:111',
        skinName: 'Ralsei Rem',
        heroName: 'Rem',
        heroCodename: 'familiar',
        sourceKey: 'pak04_dir.vpk',
        sourceModName: 'Matching icons',
        sourceSha256: 'icon-sha',
        variants: ['card'],
        linkedAt: NOW,
        ...over,
    };
}

function appliedLink(over: Partial<LockerCardSelection> = {}): LockerCardSelection {
    return {
        heroCodename: 'familiar',
        heroName: 'Rem',
        variants: ['card'],
        source: {
            kind: 'mod',
            fileName: 'pak04_dir.vpk',
            modName: 'Matching icons',
            sha256AtApplyTime: 'icon-sha',
        },
        origin: 'link',
        linkedSkinKey: 'gamebanana:111',
        addedAt: NOW,
        ...over,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    h.state.links = [];
    h.state.stored = [];
    h.state.mods = [];
    h.state.metadata = {};
});

describe('reconcileLinkedCards lifecycle', () => {
    it('keeps the no-links hot path free of scans and manifest reads', async () => {
        await expect(reconcileLinkedCards('/game')).resolves.toEqual({
            rebuilt: false,
            missing: [],
        });
        expect(h.currentCardSelections).not.toHaveBeenCalled();
        expect(h.scanMods).not.toHaveBeenCalled();
    });

    it('removes the applied selection when the final link is unlinked', async () => {
        h.state.links = [link()];
        h.state.stored = [appliedLink()];

        await expect(removeCardLink('/game', 'gamebanana:111')).resolves.toEqual({
            rebuilt: true,
            missing: [],
        });

        expect(h.state.links).toEqual([]);
        expect(h.rebuildLockerCosmetics).toHaveBeenCalledWith('/game', []);
    });

    it('restores the binding when unlink could not rebuild the applied VPK', async () => {
        h.state.links = [link()];
        h.state.stored = [appliedLink()];
        h.rebuildLockerCosmetics.mockRejectedValueOnce(new Error('build failed'));

        await expect(removeCardLink('/game', 'gamebanana:111')).rejects.toThrow('build failed');
        expect(h.state.links).toEqual([link()]);
    });

    it('forces source validation after deletion even when the manifest is unchanged', async () => {
        h.state.links = [link()];
        h.state.stored = [appliedLink()];
        h.state.mods = [
            { id: 'skin-id', metaKey: 'pak01_dir.vpk', priority: 1, enabled: true },
        ];
        h.state.metadata['pak01_dir.vpk'] = { gameBananaId: 111 };

        await reconcileLinkedCards('/game', { forceRebuild: true });
        expect(h.rebuildLockerCosmetics).toHaveBeenCalledTimes(1);
    });
});

describe('setCardLink transaction', () => {
    it('restores the previous link set when the initial apply fails', async () => {
        const previous = link({
            skinKey: 'gamebanana:222',
            heroName: 'Lash',
            heroCodename: 'lash',
        });
        h.state.links = [previous];
        h.state.mods = [
            {
                id: 'icon-id',
                metaKey: 'pak04_dir.vpk',
                fileName: 'pak04_dir.vpk',
                path: '/game/pak04_dir.vpk',
                priority: 4,
                enabled: false,
            },
            { id: 'skin-id', metaKey: 'pak01_dir.vpk', priority: 1, enabled: true },
        ];
        h.state.metadata['pak01_dir.vpk'] = { gameBananaId: 111 };
        h.state.metadata['pak04_dir.vpk'] = { modName: 'Matching icons' };
        h.rebuildLockerCosmetics.mockRejectedValueOnce(new Error('build failed'));

        await expect(
            setCardLink('/game', {
                skinKey: 'gamebanana:111',
                skinName: 'Ralsei Rem',
                heroName: 'Rem',
                sourceKey: 'pak04_dir.vpk',
            })
        ).rejects.toThrow('build failed');

        expect(h.state.links).toEqual([previous]);
    });
});
