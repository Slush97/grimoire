import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDeadlockMaterial } from './deadlockMaterial';
import { wrapMaterialWithNpr } from './source2NprMaterial';
import { applySkinPartEdits, dominantSkinColor, highlightSkinPart, isSkinSurface, isEditorMaterial } from './skinPartPreview';

describe('skin editor with real shader wrappers', () => {
  it.each(['unified', 'legacy'])('keeps %s material identity and hides only the selected part', (path) => {
    const body = new THREE.MeshStandardMaterial();
    body.name = 'abrams_body.vmat';
    body.userData.morphic = { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1 } };
    const built = path === 'unified' ? buildDeadlockMaterial(body) : wrapMaterialWithNpr(body);
    if (!built) throw new Error('Expected an NPR material');
    expect(built.material.name).toBe('abrams_body.vmat');
    expect(isSkinSurface(built.material)).toBe(true);
    const book = new THREE.MeshStandardMaterial(); book.name = 'abrams_book.vmat';
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), built.material);
    scene.add(mesh, new THREE.Mesh(new THREE.BoxGeometry(), book));
    const clearHighlight = highlightSkinPart(scene, 'models/abrams_body.vmat', new THREE.Color('purple'));
    if (!isEditorMaterial(built.material)) throw new Error('Missing editor highlight uniforms');
    expect(built.material.uniforms.uEditorSelected.value).toBe(1);
    expect(mesh.children).toHaveLength(0);
    clearHighlight(); expect(mesh.children).toHaveLength(0);
    expect(built.material.uniforms.uEditorSelected.value).toBe(0);
    const restore = applySkinPartEdits(scene, [{ material: 'models/abrams_body.vmat', hidden: true, tint: null }], false);
    expect(built.material.visible).toBe(false); expect(book.visible).toBe(true);
    const clearHidden = highlightSkinPart(scene, 'models/abrams_body.vmat', new THREE.Color('purple'));
    expect(mesh.children).toHaveLength(0);
    clearHidden(); restore(); expect(built.material.visible).toBe(true);
    built.material.dispose(); body.dispose(); book.dispose();
  });

  it('starts the picker with opaque blue texture pixels rather than padding or outlines', () => {
    expect(dominantSkinColor(new Uint8Array([
      255, 255, 255, 0, 0, 0, 0, 255,
      60, 100, 170, 255, 62, 102, 172, 255, 240, 80, 20, 255,
    ]))).toBe('#3d65ab');
    expect(dominantSkinColor(new Uint8Array([16, 16, 16, 255]))).toBe('#101010');
  });
});
