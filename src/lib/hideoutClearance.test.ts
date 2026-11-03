import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ROOM_CLEARANCE_SIZE as SIZE, RoomClearance, hideoutCenteringShift, hideoutSeenThroughRoom } from './hideoutClearance';

// Six faces side by side: +X, -X, +Y, -Y, +Z, -Z, each SIZE by SIZE RGBA floats.
function strip(fill: (face: number, x: number, y: number) => number): Float32Array {
  const pixels = new Float32Array(SIZE * 6 * SIZE * 4);
  for (let face = 0; face < 6; face++) for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    pixels[(y * SIZE * 6 + face * SIZE + x) * 4] = fill(face, x, y);
  }
  return pixels;
}

describe('room clearance lookup', () => {
  it('reads each direction from the face that sees it', () => {
    const clearance = new RoomClearance();
    clearance.load(new THREE.Vector3(1, 2, 3), 50, strip(face => [5, 6, 7, 8, 9, 10][face]));
    const axes: [THREE.Vector3, number][] = [[new THREE.Vector3(1, 0, 0), 5], [new THREE.Vector3(-1, 0, 0), 6], [new THREE.Vector3(0, 1, 0), 7],
      [new THREE.Vector3(0, -1, 0), 8], [new THREE.Vector3(0, 0, 1), 9], [new THREE.Vector3(0, 0, -1), 10]];
    for (const [direction, expected] of axes) expect(clearance.distance(direction)).toBe(expected);
    expect(clearance.distance(new THREE.Vector3(0.2, 0.1, 1).normalize())).toBe(9);
    clearance.dispose();
  });

  it('keeps the nearest neighbouring texel unless asked for the exact one', () => {
    const clearance = new RoomClearance();
    // One near texel right of the +Z face's center (the face looks along +Z with +Y up, so +X is screen left).
    const c = SIZE / 2;
    clearance.load(new THREE.Vector3(), 50, strip((face, x, y) => face === 4 && x === c - 2 && y === c ? 1 : 20));
    const direction = new THREE.Vector3(-((c - 1 + 0.5) / SIZE * 2 - 1), (c + 0.5) / SIZE * 2 - 1, 1).normalize();
    expect(clearance.distance(direction)).toBe(1);
    expect(clearance.distance(direction, false)).toBe(20);
    clearance.dispose();
  });

  it('reports an unmeasured room as unbounded and tracks the measured origin', () => {
    const clearance = new RoomClearance();
    expect(clearance.distance(new THREE.Vector3(0, 0, 1))).toBe(Number.POSITIVE_INFINITY);
    clearance.load(new THREE.Vector3(0, 0, 0), 10, strip(() => 10));
    expect(clearance.measured(new THREE.Vector3(0.05, 0, 0), 0.1)).toBe(true);
    expect(clearance.measured(new THREE.Vector3(0.5, 0, 0), 0.1)).toBe(false);
    clearance.invalidate();
    expect(clearance.measured(new THREE.Vector3(), 0.1)).toBe(false);
    clearance.dispose();
  });
});

describe('hideout hero centering', () => {
  it('moves the hero midway between the surfaces behind the camera and ahead of it', () => {
    // Measured at the spawn: 4.7 units to the wall behind the camera, 7.9 to the table ahead.
    expect(hideoutCenteringShift(4.7, 7.9)).toBeCloseTo(1.6, 9);
    expect(hideoutCenteringShift(6, 2)).toBe(-2);
    expect(hideoutCenteringShift(Number.POSITIVE_INFINITY, 3)).toBe(0);
  });
});

describe('distant hideout instances', () => {
  it('keeps a box seen through an opening and drops one behind a wall', () => {
    const clearance = new RoomClearance();
    // A wall 2 units away everywhere except an open window around +Z (the +Z face's central texels).
    const c = SIZE / 2;
    clearance.load(new THREE.Vector3(), 100, strip((face, x, y) => face === 4 && Math.abs(x - c) <= 3 && Math.abs(y - c) <= 3 ? 100 : 2));
    const ahead = new THREE.Box3(new THREE.Vector3(-2, -2, 60), new THREE.Vector3(2, 2, 64));
    const behindWall = new THREE.Box3(new THREE.Vector3(-2, -2, -64), new THREE.Vector3(2, 2, -60));
    const beside = new THREE.Box3(new THREE.Vector3(30, -2, 30), new THREE.Vector3(34, 2, 34));
    expect(hideoutSeenThroughRoom(clearance, ahead)).toBe(true);
    expect(hideoutSeenThroughRoom(clearance, behindWall)).toBe(false);
    expect(hideoutSeenThroughRoom(clearance, beside)).toBe(false);
    clearance.dispose();
  });
});
