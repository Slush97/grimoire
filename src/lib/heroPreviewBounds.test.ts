import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { heroPreviewBounds, normalizeHeroPreview } from './heroPreviewBounds';

describe('animated hero framing', () => {
  it('excludes authored and generated shells from both initial and animated framing', () => {
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    const shell = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20));
    shell.userData.morphic_shell = { version: 1, role: 'authored_shell' };
    const generated = new THREE.Mesh(new THREE.BoxGeometry(30, 30, 30));
    generated.userData.citadelNprOutline = true;
    model.add(body, shell, generated); model.updateMatrixWorld(true);
    const bind = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    expect(heroPreviewBounds(model).equals(bind)).toBe(true);
    expect(heroPreviewBounds(model, bind).equals(bind)).toBe(true);
    body.geometry.dispose(); shell.geometry.dispose(); generated.geometry.dispose();
  });
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

describe('hero preview normalization', () => {
  it('reports the normalized height of the model origin, where a Source model stands', () => {
    // A figure whose bind bounds reach far below its feet (a hidden prop), standing on its origin.
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)); body.position.y = 1;
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1)); hidden.position.y = -0.95;
    model.add(body, hidden);
    const norm = normalizeHeroPreview(model);
    expect(norm.scale).toBeCloseTo(2 / 3, 9);
    expect(norm.center.y).toBeCloseTo(0.5, 9);
    // Bounds center minus one third of a unit: the origin, not the bottom of the bounds (-1).
    expect(norm.ground).toBeCloseTo(-1 / 3, 9);
    model.position.set(0, 4, 0);
    expect(normalizeHeroPreview(model).ground).toBeCloseTo(-1 / 3, 9);
    body.geometry.dispose(); hidden.geometry.dispose();
  });

  it('stands a pose lifted above its origin on its lowest point', () => {
    // A static pose mid-hop: every vertex 0.5 above the origin.
    const model = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1)); body.position.y = 1.5;
    model.add(body);
    const norm = normalizeHeroPreview(model);
    expect(norm.ground).toBeCloseTo(-1, 9);
    body.geometry.dispose();
  });
});
