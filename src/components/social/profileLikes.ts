import type { SocialListProfilesResponse } from '../../lib/api';

export function mergeProfileLikes(
  previous: Record<string, boolean>,
  profiles: SocialListProfilesResponse['profiles'],
): Record<string, boolean> {
  let next = previous;
  for (const profile of profiles) {
    const liked = profile.viewer_has_liked;
    if (typeof liked === 'boolean' && next[profile.id] !== liked) {
      if (next === previous) next = { ...previous };
      next[profile.id] = liked;
    }
  }
  return next;
}
