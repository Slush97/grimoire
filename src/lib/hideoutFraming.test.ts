import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { hideoutFraming } from './hideoutFraming';

describe('hideout framing', () => {
  const hero = new THREE.Box3(new THREE.Vector3(-0.4, -1, -0.3), new THREE.Vector3(0.4, 1, 0.3));

  it('stands the hero low in the frame with room above it', () => {
    const { target, distance } = hideoutFraming(hero, 40, 0.75);
    const half = Math.tan(THREE.MathUtils.degToRad(20)) * (distance - 0.3);
    // The feet sit just above the frame bottom, the head well below its top.
    expect(-1 - (target.y - half)).toBeGreaterThan(0);
    expect(-1 - (target.y - half)).toBeLessThan(0.3);
    expect(target.y + half - 1).toBeGreaterThan(0.8);
  });

  it('fits a wide model by width', () => {
    const wide = new THREE.Box3(new THREE.Vector3(-3, -1, -0.3), new THREE.Vector3(3, 1, 0.3));
    expect(hideoutFraming(wide, 40, 0.75).distance).toBeGreaterThan(hideoutFraming(hero, 40, 0.75).distance * 2);
  });
});
