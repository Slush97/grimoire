/**
 * Coverage for the adopted-thumbnail slot-identity guards: the fetch is
 * fire-and-forget, and metaKeys are just pakNN file names, so by the time the
 * network resolves the slot may hold a different mod (deleted + reimported),
 * point at a different submission, or already have art. None of those may be
 * stamped with the old occupant's thumbnail (same failure class as the
 * pose-cache bug).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fetchModDetails } = vi.hoisted(() => ({
    fetchModDetails: vi.fn<(id: number, section: string) => Promise<unknown>>(),
}));
vi.mock('./gamebanana', () => ({ fetchModDetails }));

const metadataStore = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const { setModMetadata } = vi.hoisted(() => ({
    setModMetadata: vi.fn((key: string, patch: Record<string, unknown>) => {
        metadataStore.set(key, { ...(metadataStore.get(key) ?? {}), ...patch });
    }),
}));
vi.mock('./metadata', () => ({
    getModMetadata: vi.fn((key: string) => metadataStore.get(key)),
    setModMetadata,
}));

import { fetchAdoptedThumbnail } from './adoptedThumbnail';

const SHA = 'a'.repeat(64);
const TARGET = {
    metaKey: 'pak05_dir.vpk',
    gameBananaId: 4242,
    section: 'Sound',
    expectedSha256: SHA,
};

function gbDetails(overrides: Record<string, unknown> = {}) {
    return {
        previewMedia: {
            images: [{ baseUrl: 'https://images.gb', file530: 'thumb_530.jpg', file: 'thumb.jpg' }],
            metadata: { audioUrl: 'https://files.gb/preview.mp3' },
        },
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    metadataStore.clear();
});

describe('fetchAdoptedThumbnail', () => {
    it('stamps thumbnail and audio on the still-matching row (happy path)', async () => {
        metadataStore.set('pak05_dir.vpk', { gameBananaId: 4242, sha256: SHA });
        fetchModDetails.mockResolvedValue(gbDetails());

        await fetchAdoptedThumbnail(TARGET);

        expect(setModMetadata).toHaveBeenCalledWith('pak05_dir.vpk', {
            thumbnailUrl: 'https://images.gb/thumb_530.jpg',
            audioUrl: 'https://files.gb/preview.mp3',
        });
    });

    it('does not write when the metadata row was deleted mid-fetch', async () => {
        fetchModDetails.mockResolvedValue(gbDetails());

        await fetchAdoptedThumbnail(TARGET);

        expect(setModMetadata).not.toHaveBeenCalled();
    });

    it('does not write when a different mod recycled the pakNN slot (sha mismatch)', async () => {
        metadataStore.set('pak05_dir.vpk', { gameBananaId: 4242, sha256: 'b'.repeat(64) });
        fetchModDetails.mockResolvedValue(gbDetails());

        await fetchAdoptedThumbnail(TARGET);

        expect(setModMetadata).not.toHaveBeenCalled();
    });

    it('does not write when the mod was re-associated to another submission mid-flight', async () => {
        metadataStore.set('pak05_dir.vpk', { gameBananaId: 9999, sha256: SHA });
        fetchModDetails.mockResolvedValue(gbDetails());

        await fetchAdoptedThumbnail(TARGET);

        expect(setModMetadata).not.toHaveBeenCalled();
    });

    it('does not clobber a thumbnail that appeared while in flight', async () => {
        metadataStore.set('pak05_dir.vpk', {
            gameBananaId: 4242,
            sha256: SHA,
            thumbnailUrl: 'https://user.set/art.png',
        });
        fetchModDetails.mockResolvedValue(gbDetails());

        await fetchAdoptedThumbnail(TARGET);

        expect(setModMetadata).not.toHaveBeenCalled();
    });

    it('swallows a fetch rejection without writing', async () => {
        metadataStore.set('pak05_dir.vpk', { gameBananaId: 4242, sha256: SHA });
        fetchModDetails.mockRejectedValue(new Error('offline'));

        await expect(fetchAdoptedThumbnail(TARGET)).resolves.toBeUndefined();
        expect(setModMetadata).not.toHaveBeenCalled();
    });
});
