import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ParticleLightPool, type ParticleLightState } from './lightRenderer';

function lightState(): ParticleLightState {
  return {
    color: [1, 0.5, 0.25], linearBrightness: 1, brightnessScale: 1, range: 100, spotInnerAngle: 0, spotOuterAngle: 180, luminaireSize: 0,
    fallOff: 0, position: new THREE.Vector3(1, 2, 3), direction: new THREE.Vector3(1, 0, 0), left: new THREE.Vector3(0, 1, 0),
    up: new THREE.Vector3(0, 0, 1), cookie: null, castShadows: false, tubeHalfLength: 0,
  };
}

function step(pool: ParticleLightPool, ids: number[]): void {
  pool.beginStep(ids.length);
  for (const id of ids) {
    const slot = pool.claim(id);
    if (!slot) continue;
    slot.touched = true;
    slot.state = lightState();
  }
  pool.endStep();
  pool.apply();
}

const lights = (pool: ParticleLightPool) => pool.group.children.filter((child): child is THREE.PointLight => child instanceof THREE.PointLight);

describe('ParticleLightPool', () => {
  it('shows a new light at once by default', () => {
    const pool = new ParticleLightPool(false);
    step(pool, [1]);
    expect(lights(pool)).toHaveLength(1);
    expect(lights(pool)[0].visible).toBe(true);
    expect(lights(pool)[0].userData.awaitingPrograms).toBeUndefined();
  });

  it('keeps each new light hidden for the host when deferred, and lights it all the same', () => {
    const pool = new ParticleLightPool(false);
    pool.deferNewLights = true;
    step(pool, [1]);
    const [first] = lights(pool);
    expect(first.visible).toBe(false);
    expect(first.userData.awaitingPrograms).toBe(true);
    expect(first.intensity).toBeGreaterThan(0);
    // The host shows it; a later light is deferred on its own.
    first.visible = true;
    delete first.userData.awaitingPrograms;
    step(pool, [1, 2]);
    expect(lights(pool).map(light => [light.visible, light.userData.awaitingPrograms ?? false])).toEqual([[true, false], [false, true]]);
  });
});
