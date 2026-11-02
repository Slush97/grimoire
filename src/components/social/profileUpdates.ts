import type { SocialListProfilesResponse, SocialUpdateProfileResponse } from '../../lib/api';

type Profiles = SocialListProfilesResponse['profiles'];

// A list fetched with NSFW hidden would no longer return a post whose new mods are NSFW.
export function applyProfileUpdate(profiles: Profiles, updated: SocialUpdateProfileResponse, hideNsfw: boolean): Profiles {
  if (hideNsfw && updated.has_nsfw) return profiles.filter((p) => p.id !== updated.id);
  return profiles.map((p) =>
    p.id === updated.id ? { ...p, ...updated, viewer_has_liked: updated.viewer_has_liked ?? p.viewer_has_liked } : p
  );
}
