/**
 * Coverage for the import-resolution name carry (PR #295). resolvePortableProfile
 * runs each entry through resolveOne, which fetches the GameBanana submission to
 * pick the resolved file. Before the fix that live name was discarded, so
 * hint-less profiles (e.g. DMM-origin exports whose metadata sidecar lacked a
 * modName) collapsed every import row to "Submission #NNN". These tests pin the
 * name onto PortableResolvedMod.resolvedName for BOTH resolvable paths (exact +
 * upgraded) and assert unresolvable entries carry none. fetchModDetails is the
 * only live dependency; everything else portableProfile imports is stubbed inert.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0-test' } }));
vi.mock('./profiles', () => ({
    addProfile: vi.fn(),
    generateProfileId: vi.fn(),
    loadProfiles: vi.fn(),
}));
vi.mock('./mods', () => ({ scanMods: vi.fn() }));
vi.mock('./metadata', () => ({ getModMetadata: vi.fn() }));
vi.mock('./lockerVpk', () => ({ isLockerManaged: vi.fn() }));

const { fetchModDetails } = vi.hoisted(() => ({ fetchModDetails: vi.fn() }));
vi.mock('./gamebanana', () => ({ fetchModDetails }));

import { resolvePortableProfile } from './portableProfile';
import {
    PORTABLE_PROFILE_FORMAT,
    PORTABLE_PROFILE_SCHEMA_VERSION,
    type PortableModEntry,
    type PortableProfile,
} from '../../../src/types/portableProfile';

type GbFile = { id: number; fileName: string; isArchived?: boolean; downloadCount?: number };

function gbDetails(name: string, files: GbFile[]) {
    return {
        id: 1,
        name,
        description: '',
        nsfw: false,
        files: files.map((f) => ({
            id: f.id,
            fileName: f.fileName,
            fileSize: 0,
            downloadUrl: `https://gamebanana.example/dl/${f.id}`,
            downloadCount: f.downloadCount ?? 0,
            dateAdded: 0,
            isArchived: f.isArchived ?? false,
        })),
    };
}

/** A hint-less GameBanana entry: the exact case the fix targets. */
function entry(submissionId: number, fileId: number): PortableModEntry {
    return {
        source: 'gamebanana',
        ref: { submissionId, fileId, section: 'Mod' },
        enabled: true,
        priority: 0,
    };
}

function profileWith(mods: PortableModEntry[]): PortableProfile {
    return {
        format: PORTABLE_PROFILE_FORMAT,
        schemaVersion: PORTABLE_PROFILE_SCHEMA_VERSION,
        game: { steamAppId: 1422450, gameBananaGameId: 20948, name: 'Deadlock' },
        exportedAt: '2026-01-01T00:00:00Z',
        exportedBy: { tool: 'grimoire', version: '0.0.0-test' },
        profile: { name: 'Test Profile' },
        mods,
    };
}

describe('resolvePortableProfile: resolvedName carry', () => {
    beforeEach(() => {
        fetchModDetails.mockReset();
    });

    it('carries the live name on an exact match (pinned file still live)', async () => {
        fetchModDetails.mockResolvedValue(
            gbDetails('Neon Vindicta', [{ id: 900, fileName: 'neon.vpk' }])
        );

        const report = await resolvePortableProfile(profileWith([entry(4242, 900)]));

        expect(report.exactCount).toBe(1);
        expect(report.resolved[0].status).toBe('exact');
        expect(report.resolved[0].resolvedFileId).toBe(900);
        expect(report.resolved[0].resolvedName).toBe('Neon Vindicta');
    });

    it('carries the live name on an upgraded match (pinned file archived)', async () => {
        fetchModDetails.mockResolvedValue(
            gbDetails('Spicy Skin', [
                { id: 900, fileName: 'old.vpk', isArchived: true },
                { id: 901, fileName: 'newest.vpk', downloadCount: 50 },
            ])
        );

        const report = await resolvePortableProfile(profileWith([entry(4242, 900)]));

        expect(report.upgradedCount).toBe(1);
        expect(report.resolved[0].status).toBe('upgraded');
        expect(report.resolved[0].resolvedFileId).toBe(901);
        expect(report.resolved[0].resolvedName).toBe('Spicy Skin');
    });

    it('sets no resolvedName for an unresolvable entry (all files archived)', async () => {
        fetchModDetails.mockResolvedValue(
            gbDetails('Ghost Mod', [{ id: 900, fileName: 'old.vpk', isArchived: true }])
        );

        const report = await resolvePortableProfile(profileWith([entry(4242, 900)]));

        expect(report.unresolvableCount).toBe(1);
        expect(report.resolved[0].status).toBe('unresolvable');
        expect(report.resolved[0].resolvedName).toBeUndefined();
    });
});
