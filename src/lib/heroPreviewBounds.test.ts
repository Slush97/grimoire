import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { heroPreviewBounds } from './heroPreviewBounds';

describe('animated hero framing', () => {
  it('fits body and normal weapon motion through normalized parents, excluding offscreen hide transforms', () => {
    const wrapper = new THREE.Group(); wrapper.scale.setScalar(0.5); wrapper.position.set(0, -1, 0);
    const model = new THREE.Group(); wrapper.add(model);
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1)); body.position.y = 2; model.add(body);
    const weapon = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); weapon.position.set(2, 2, 0); model.add(weapon);
    wrapper.updateMatrixWorld(true);
    const bind = new THREE.Box3(new THREE.Vector3(-1, 0, -0.5), new THREE.Vector3(2.5, 4, 0.5));
    const visible = heroPreviewBounds(model, bind);
    expect(visible.max.x).toBe(1.25);
    weapon.position.y = -477; wrapper.updateMatrixWorld(true);
    const framed = heroPreviewBounds(model, bind);
    expect(framed.min.y).toBe(-1);
    expect(framed.max.y).toBe(1);
    expect(framed.max.x).toBe(0.5);
    expect(weapon.visible).toBe(true);
    expect(weapon.position.y).toBe(-477);
  });
  it('falls back to the reference when every animated mesh is outside it', () => {
    const model = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry());
    mesh.position.y = -100; model.add(mesh); model.updateMatrixWorld(true);
    const bind = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    expect(heroPreviewBounds(model, bind).equals(bind)).toBe(true);
  });
});
