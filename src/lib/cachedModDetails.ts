import type { CachedMod } from '../types/electron';
import type { GameBananaModDetails } from '../types/gamebanana';

/**
 * Errors that mean live GameBanana details are temporarily unavailable and a
 * local fallback is preferable. Permanent HTTP failures (notably 404) and
 * unexpected renderer/main-process errors remain visible to the user.
 */
export function canUseCachedModDetails(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    /\bfetch failed\b/i.test(message) ||
    /\bnetwork(?: request)? (?:error|failed)\b/i.test(message) ||
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNABORTED|ECONNREFUSED|ECONNRESET|ENETUNREACH|ETIMEDOUT|UND_ERR_[A-Z_]+)\b/i.test(message) ||
    /\b(?:request )?timed out\b/i.test(message) ||
    /GameBanana API error:\s*(?:408|425|429|5\d\d)\b/i.test(message) ||
    /GameBanana API returned (?:an )?(?:empty response|invalid JSON)/i.test(message)
  );
}

/** Build the subset of details available from the local catalog mirror. */
export function buildCachedModDetails(
  gbId: number,
  cached: CachedMod | null,
  fallbackName?: string,
): GameBananaModDetails | null {
  const name = cached?.name ?? fallbackName;
  if (!name) return null;

  const thumbnailUrl = cached?.thumbnailUrl;
  const slash = thumbnailUrl?.lastIndexOf('/') ?? -1;

  return {
    id: gbId,
    name,
    nsfw: cached?.isNsfw ?? false,
    category: cached?.categoryName
      ? { id: cached.categoryId ?? undefined, name: cached.categoryName }
      : undefined,
    submitter:
      cached?.submitterName && cached.submitterId
        ? { id: cached.submitterId, name: cached.submitterName }
        : undefined,
    previewMedia:
      thumbnailUrl && slash > 0
        ? { images: [{ baseUrl: thumbnailUrl.slice(0, slash), file: thumbnailUrl.slice(slash + 1) }] }
        : undefined,
  };
}
