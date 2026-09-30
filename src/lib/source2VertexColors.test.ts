import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { prepareSource2VertexColors } from './source2VertexColors';

function mesh(ints?: Record<string, number>) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute([0.5, 0.25, 1, 0.75], 4));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true });
  if (ints) material.userData.morphic = { shader: 'pbr.vfx', ints };
  return new THREE.Mesh(geometry, material);
}
describe('Source 2 vertex color space', () => {
  it('decodes authored face RGB once and preserves alpha', () => {
    const face = mesh({ F_VERTEX_COLOR: 1 });
    prepareSource2VertexColors(face);
    const color = face.geometry.getAttribute('color');
    expect(color.getX(0)).toBeCloseTo(0.21404114);
    expect(color.getY(0)).toBeCloseTo(0.05087609);
    expect(color.getW(0)).toBe(0.75);
    prepareSource2VertexColors(face);
    expect(face.geometry.getAttribute('color')).toBe(color);
  });
  it('does not multiply albedo by tint-only masks or reinterpret ordinary GLB colors', () => {
    const mask = mesh({ g_bMaskVertexColorTint1: 1 });
    prepareSource2VertexColors(mask);
    expect(mask.material.vertexColors).toBe(false);
    expect(mask.geometry.getAttribute('color').getX(0)).toBe(0.5);
    const ordinary = mesh();
    prepareSource2VertexColors(ordinary);
    expect(ordinary.material.vertexColors).toBe(true);
    expect(ordinary.geometry.getAttribute('color').getX(0)).toBe(0.5);
  });
});
