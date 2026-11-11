import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { matchingClipTime } from './clipPoseMatch';

/** A one-bone clip turning about Z from 0 to `degrees` over one second. */
function turn(name: string, from: number, to: number): THREE.AnimationClip {
  const q = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(deg)).toArray();
  return new THREE.AnimationClip(name, 1, [new THREE.QuaternionKeyframeTrack('arm.quaternion', [0, 1], [...q(from), ...q(to)])]);
}

describe('matchingClipTime', () => {
  it('enters a clip that repeats the motion where the motion has got to', () => {
    expect(matchingClipTime(turn('parry', 0, 90), 0.3, turn('success', 0, 90))).toBeCloseTo(0.3, 1);
  });

  it('enters a clip that starts from the held pose at its start', () => {
    expect(matchingClipTime(turn('parry', 0, 90), 1, turn('success', 90, 0))).toBe(0);
  });

  it('starts a clip that shares no bone at its start', () => {
    const other = new THREE.AnimationClip('other', 1, [new THREE.QuaternionKeyframeTrack('leg.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])]);
    expect(matchingClipTime(turn('parry', 0, 90), 0.5, other)).toBe(0);
  });
});
