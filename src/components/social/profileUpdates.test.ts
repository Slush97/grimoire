import { describe, expect, it } from 'vitest';
import type { SocialListProfilesResponse, SocialUpdateProfileResponse } from '../../lib/api';
import { applyProfileUpdate } from './profileUpdates';

type Summary = SocialListProfilesResponse['profiles'][number];

function profile(id: string, fields: Partial<Summary> = {}): Summary {
  return { id, title: id, has_nsfw: false, viewer_has_liked: true, ...fields } as Summary;
}

function updated(id: string, fields: Partial<SocialUpdateProfileResponse> = {}): SocialUpdateProfileResponse {
  return { id, title: `${id} v2`, has_nsfw: false, viewer_has_liked: null, ...fields } as SocialUpdateProfileResponse;
}

describe('applyProfileUpdate', () => {
  it('merges the updated row and keeps the known like state', () => {
    const next = applyProfileUpdate([profile('a'), profile('b')], updated('a', { mod_count: 3 }), false);
    expect(next.map((p) => p.title)).toEqual(['a v2', 'b']);
    expect(next[0]).toMatchObject({ mod_count: 3, viewer_has_liked: true });
  });

  it('drops a post that became NSFW from a list fetched with NSFW hidden', () => {
    const profiles = [profile('a'), profile('b')];
    expect(applyProfileUpdate(profiles, updated('a', { has_nsfw: true }), true).map((p) => p.id)).toEqual(['b']);
    expect(applyProfileUpdate(profiles, updated('a', { has_nsfw: true }), false)[0]).toMatchObject({ has_nsfw: true });
  });
});
