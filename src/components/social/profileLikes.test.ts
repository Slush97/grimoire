import { describe, expect, it } from 'vitest';
import type { SocialListProfilesResponse } from '../../lib/api';
import { mergeProfileLikes } from './profileLikes';

// Only the id and optional viewer flag are read by the merge.
function profile(id: string, viewer_has_liked?: boolean): SocialListProfilesResponse['profiles'][number] {
  return { id, viewer_has_liked } as SocialListProfilesResponse['profiles'][number];
}

describe('mergeProfileLikes', () => {
  it('keeps the current map for anonymous, empty and unchanged responses', () => {
    const previous = { liked: true, unliked: false };
    expect(mergeProfileLikes(previous, [])).toBe(previous);
    expect(mergeProfileLikes(previous, [profile('anonymous')])).toBe(previous);
    expect(mergeProfileLikes(previous, [profile('liked', true), profile('unliked', false)])).toBe(previous);
  });

  it('merges explicit true and false flags without mutating previous state', () => {
    const previous = Object.freeze({ kept: true, changed: true });
    const next = mergeProfileLikes(previous, [
      profile('changed', false), profile('new', true), profile('unliked', false), profile('kept'),
    ]);
    expect(next).toEqual({ kept: true, changed: false, new: true, unliked: false });
    expect(previous).toEqual({ kept: true, changed: true });
  });

  it('uses the last explicit flag when duplicate ids are returned', () => {
    expect(mergeProfileLikes({ duplicate: true }, [
      profile('duplicate', false), profile('duplicate', true), profile('duplicate'),
    ])).toEqual({ duplicate: true });
    expect(mergeProfileLikes({}, [profile('duplicate', true), profile('duplicate', false)]))
      .toEqual({ duplicate: false });
  });
});
