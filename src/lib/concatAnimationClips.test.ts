import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { concatAnimationClips } from './concatAnimationClips';

describe('concatAnimationClips', () => {
  it('plays clips back to back and holds a track a clip lacks', () => {
    const a = new THREE.AnimationClip('a', 1, [
      new THREE.VectorKeyframeTrack('hip.position', [0, 1], [0, 0, 0, 1, 0, 0]),
      new THREE.QuaternionKeyframeTrack('hip.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const b = new THREE.AnimationClip('b', 2, [new THREE.VectorKeyframeTrack('hip.position', [0, 2], [2, 0, 0, 3, 0, 0])]);
    const joined = concatAnimationClips([a, b], 'both');
    expect(joined.duration).toBeCloseTo(3 + 1 / 30);
    const position = joined.tracks.find(track => track.name === 'hip.position')!;
    [0, 1, 1 + 1 / 30, 3 + 1 / 30].forEach((time, i) => expect(position.times[i]).toBeCloseTo(time, 5));
    expect(position.times).toHaveLength(4);
    expect(Array.from(position.values)).toEqual([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0]);
    const rotation = joined.tracks.find(track => track.name === 'hip.quaternion')!;
    expect(rotation).toBeInstanceOf(THREE.QuaternionKeyframeTrack);
    expect(Array.from(rotation.times)).toEqual([0, 1]);
  });
});
