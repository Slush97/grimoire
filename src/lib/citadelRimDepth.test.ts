import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { citadelRimUnit } from './citadelRimDepth';

describe('citadelRimUnit', () => {
  it('measures game units at the hero meshes, below the GLB node scale', () => {
    // A morphic hero GLB: game-unit positions under an inch-to-meter node, inside the viewer's normalization.
    const normalized = new THREE.Group();
    normalized.scale.setScalar(0.9545);
    const root = new THREE.Group();
    const node = new THREE.Group();
    node.scale.setScalar(0.0254);
    node.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    root.add(node);
    normalized.add(root);
    normalized.updateMatrixWorld(true);
    expect(citadelRimUnit(root)).toBeCloseTo(0.9545 * 0.0254, 6);
  });
});
