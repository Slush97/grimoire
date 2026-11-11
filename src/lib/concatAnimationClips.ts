import * as THREE from 'three';

/** Pause between joined clips, so each one blends into the next over a frame instead of popping. */
const SEAM_SECONDS = 1 / 30;

/**
 * Joins clips end to end into one clip, for playing a list of actions back to back in a loop. A track a
 * clip lacks holds its last value through that clip.
 */
export function concatAnimationClips(clips: readonly THREE.AnimationClip[], name: string): THREE.AnimationClip {
  const joined = new Map<string, { track: THREE.KeyframeTrack; times: number[]; values: number[] }>();
  let offset = 0;
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const entry = joined.get(track.name) ?? { track, times: [], values: [] };
      joined.set(track.name, entry);
      for (const time of track.times) entry.times.push(time + offset);
      for (const value of track.values) entry.values.push(value);
    }
    offset += clip.duration + SEAM_SECONDS;
  }
  const tracks = [...joined.values()].map(({ track, times, values }) => {
    const Track = track.constructor as new (name: string, times: number[], values: number[], interpolation?: THREE.InterpolationModes) => THREE.KeyframeTrack;
    return new Track(track.name, times, values, track.getInterpolation());
  });
  return new THREE.AnimationClip(name, Math.max(0, offset - SEAM_SECONDS), tracks);
}
