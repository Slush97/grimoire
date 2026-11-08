import * as THREE from 'three';

/** The angle between two unit quaternions, radians. */
function quaternionAngle(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Where to enter `to` so its pose continues `from` as it stands at `fromTime`: the time, on a 1/30 s grid,
 * whose bone rotations are closest to `from`'s (the mean angle over the bones both animate). A clip
 * authored to start from the pose the first one holds is entered at its start; one that repeats the
 * first one's motion is entered where that motion has got to. 0 when the clips share no bone.
 */
export function matchingClipTime(from: THREE.AnimationClip, fromTime: number, to: THREE.AnimationClip, step = 1 / 30): number {
  const rotations = (clip: THREE.AnimationClip) => new Map(clip.tracks
    .filter((track): track is THREE.QuaternionKeyframeTrack => track instanceof THREE.QuaternionKeyframeTrack)
    .map((track) => [track.name, track]));
  const interpolant = (track: THREE.QuaternionKeyframeTrack) => new THREE.QuaternionLinearInterpolant(track.times, track.values, 4, new Float32Array(4));
  const source = rotations(from);
  const pairs = [...rotations(to)].filter(([name]) => source.has(name)).map(([name, track]) => ({
    // The interpolant reuses its result buffer: copy the target pose out
    target: Array.from(interpolant(source.get(name)!).evaluate(Math.min(fromTime, from.duration)) as ArrayLike<number>),
    candidate: interpolant(track),
  }));
  if (pairs.length === 0) return 0;
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i * step <= to.duration + 1e-6; i++) {
    const time = Math.min(i * step, to.duration);
    const cost = pairs.reduce((sum, { target, candidate }) => sum + quaternionAngle(target, candidate.evaluate(time) as ArrayLike<number>), 0) / pairs.length;
    if (cost < bestCost - 1e-9) { bestCost = cost; best = time; }
  }
  return best;
}
