import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { viewerAmbientCube, VIEWER_GROUND_COLOR, VIEWER_SKY_COLOR, VIEWER_HEMISPHERE_INTENSITY } from './viewerAmbientLight';

describe('viewer diffuse environment', () => {
  it('does not add an outdoor hemisphere to the captured hideout lighting', () => {
    expect(viewerAmbientCube(new THREE.SphericalHarmonics3(), 1, false).every((face) => face.length() === 0)).toBe(true);
    const sh = new THREE.SphericalHarmonics3();
    sh.coefficients[0].set(0.2, 0.1, 0.05);
    const indoor = viewerAmbientCube(sh, 1, false);
    const outdoor = viewerAmbientCube(sh, 1);
    expect(indoor[2].y).toBeLessThan(outdoor[2].y);
    expect(indoor[0].x).toBeGreaterThan(indoor[0].y);
  });
  it('keeps sky, floor and side irradiance in world-axis order', () => {
    const cube = viewerAmbientCube(new THREE.SphericalHarmonics3(), 1);
    VIEWER_SKY_COLOR.toArray().forEach((v, i) => expect(cube[2].getComponent(i)).toBeCloseTo(v * VIEWER_HEMISPHERE_INTENSITY, 12));
    VIEWER_GROUND_COLOR.toArray().forEach((v, i) => expect(cube[3].getComponent(i)).toBeCloseTo(v * VIEWER_HEMISPHERE_INTENSITY, 12));
    expect(cube[0].toArray()).toEqual(cube[1].toArray());
    expect(cube[0].toArray()).toEqual(cube[4].toArray());
    expect(cube[0].toArray()).toEqual(cube[5].toArray());
  });

  it('projects directional SH without rotating it with the camera', () => {
    const sh = new THREE.SphericalHarmonics3();
    sh.coefficients[0].set(3, 3, 3);
    sh.coefficients[3].set(1, 0, 0);
    const cube = viewerAmbientCube(sh, 1);
    expect(cube[0].x - cube[1].x).toBeCloseTo(4 * 0.511664);
    expect(cube[0].y).toBeCloseTo(cube[1].y);
    expect(cube[0].z).toBeCloseTo(cube[1].z);
  });

  it('scales the sampled environment separately from the hemisphere and owns its values', () => {
    const sh = new THREE.SphericalHarmonics3();
    sh.coefficients[0].set(1, 2, 3);
    const dark = viewerAmbientCube(sh, 0);
    const a = viewerAmbientCube(sh, 1);
    const b = viewerAmbientCube(sh, 2);
    for (let i = 0; i < 6; i++) {
      for (let c = 0; c < 3; c++) {
        expect(b[i].getComponent(c) - dark[i].getComponent(c)).toBeCloseTo(2 * (a[i].getComponent(c) - dark[i].getComponent(c)), 12);
      }
      expect(a[i]).not.toBe(b[i]);
    }
    expect(sh.coefficients[0].toArray()).toEqual([1, 2, 3]);
  });

  it('clamps negative SH reconstruction lobes before exposure normalization', () => {
    const sh = new THREE.SphericalHarmonics3();
    sh.coefficients[3].set(10, 10, 10);
    const cube = viewerAmbientCube(sh, 1);
    expect(cube[1].toArray()).toEqual([0, 0, 0]);
    expect(cube.every((v) => v.toArray().every(Number.isFinite))).toBe(true);
  });
});
