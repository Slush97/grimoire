import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { citadelOutlineMesh } from './citadelNprOutline';
import { regionBaker } from './skinRegionScene';

function part(name: string, offset = 0): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, offset, 1, 0, offset, 0, 1, offset, 1, 1, offset], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.5, 0, 0, 0.5, 0.5, 0.5].map((value) => value + offset * 0.4), 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  const material = new THREE.MeshBasicMaterial();
  material.name = name;
  return new THREE.Mesh(geometry, material);
}

/** A scene holding two meshes of one material, with an outline shell on each when asked. */
function scene(shells: 'none' | 'outline' | 'plain'): THREE.Group {
  const root = new THREE.Group();
  for (const mesh of [part('clothing'), part('clothing', 1)]) {
    root.add(mesh);
    if (shells === 'none') continue;
    const shell = citadelOutlineMesh(mesh, mesh.material);
    // Before outline shells were skipped, they counted as more of the part.
    if (shells === 'plain') delete shell.userData.citadelNprOutline;
    mesh.add(shell);
  }
  return root;
}

describe('regionBaker layout', () => {
  it('does not change when outline shells are in the scene', () => {
    expect(regionBaker(scene('outline')).layout('clothing')).toBe(regionBaker(scene('none')).layout('clothing'));
  });

  it('keeps areas saved while outline shells were counted', () => {
    const saved = regionBaker(scene('plain')).layout('clothing');
    expect(saved).not.toBe(regionBaker(scene('none')).layout('clothing'));
    expect(regionBaker(scene('none')).stale('clothing', saved!)).toBe(false);
    expect(regionBaker(scene('outline')).stale('clothing', saved!)).toBe(false);
  });

  it('flags an area saved on another layout', () => {
    const other = new THREE.Group().add(part('clothing', 2));
    const saved = regionBaker(other).layout('clothing');
    expect(regionBaker(scene('none')).stale('clothing', saved!)).toBe(true);
  });
});
