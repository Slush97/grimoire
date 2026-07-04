import { fetchModDetails } from './gamebanana';
import { getModMetadata, setModMetadata } from './metadata';

/**
 * One queued best-effort thumbnail fetch for a mod whose gamebananaId was just
 * ADOPTED from its own embed at import time. Captured at queue time, while the
 * import handler still knows exactly which file occupies the slot.
 */
export interface AdoptedThumbnailTarget {
    metaKey: string;
    gameBananaId: number;
    section: string;
    /** The sha256 stamped on the metadata row at queue time. metaKeys are just
     *  file names (pakNN slots), so this is what identifies THIS file: a slot
     *  recycled by a different mod while the fetch was in flight must never be
     *  stamped with the old occupant's art. */
    expectedSha256?: string;
}

/**
 * Best-effort background fetch of a thumbnail (and audio preview, for Sound
 * mods) for a mod whose gamebananaId was just adopted from its own embed at
 * import time, but whose sidecar has no thumbnailUrl (the user imported a
 * bare VPK, not an archive with art, or the embed predates thumbnails).
 * Mirrors download.ts's own field mapping (thumbnail = file530 falling back to
 * file; audioUrl from previewMedia.metadata). Never throws: offline or a
 * revoked/renamed GameBanana submission just leaves the mod without a
 * thumbnail, exactly as if adoption had never found the id.
 *
 * Fire-and-forget by design, so every write is re-checked against the CURRENT
 * sidecar: the row must still exist (mod not deleted mid-fetch), still carry
 * the queue-time sha256 (pakNN slot not recycled by a different mod), still
 * point at the same submission (not re-associated mid-flight), and still have
 * no thumbnail (never clobber one the user set or another path fetched).
 */
export async function fetchAdoptedThumbnail(target: AdoptedThumbnailTarget): Promise<void> {
    try {
        const details = await fetchModDetails(target.gameBananaId, target.section);
        const thumbnail = details.previewMedia?.images?.[0];
        const thumbnailUrl = thumbnail
            ? `${thumbnail.baseUrl}/${thumbnail.file530 || thumbnail.file}`
            : undefined;
        const audioUrl = details.previewMedia?.metadata?.audioUrl;
        if (!thumbnailUrl && !audioUrl) return;

        const current = getModMetadata(target.metaKey);
        if (!current) return;
        if (target.expectedSha256 && current.sha256 !== target.expectedSha256) return;
        if (current.gameBananaId !== target.gameBananaId) return;
        if (current.thumbnailUrl) return;

        setModMetadata(target.metaKey, {
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
            ...(audioUrl ? { audioUrl } : {}),
        });
    } catch (err) {
        console.warn(
            `[adoptedThumbnail] Best-effort thumbnail fetch failed for ${target.metaKey}:`,
            err
        );
    }
}
