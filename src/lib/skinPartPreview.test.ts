import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildDeadlockMaterial } from './deadlockMaterial';
import { wrapMaterialWithNpr } from './source2NprMaterial';
import { applySkinPartEdits, dominantSkinColor, highlightSkinPart, isSkinSurface, isEditorMaterial } from './skinPartPreview';
import { TRANSLUCENT_OVERLAY_RENDER_ORDER } from './source2Preview/types';

describe('skin editor with real shader wrappers', () => {
  it.each(['standard', 'unified', 'legacy'])('previews translucent opacity on %s materials and restores the source glass and alpha state', (path) => {
    const source = new THREE.MeshPhysicalMaterial({ opacity: 0.8, transmission: 0.7, alphaTest: 0.1 });
    source.name = 'gun.vmat'; source.map = new THREE.Texture(); source.alphaMap = new THREE.Texture(); source.transmissionMap = new THREE.Texture();
    source.blending = THREE.AdditiveBlending; source.depthWrite = false; source.depthTest = false;
    source.userData.morphic = { shader: 'pbr.vfx', ints: { F_GLASS: 1, F_USE_NPR_LIGHTING: 1 } };
    const built = path === 'unified' ? buildDeadlockMaterial(source) : path === 'legacy' ? wrapMaterialWithNpr(source) : null;
    const material = built?.material ?? source;
    if (!('alphaMap' in material) || !('transmission' in material) || !('transmissionMap' in material)) throw new Error('Expected physical surface');
    const before = { transparent: material.transparent, opacity: material.opacity, blending: material.blending,
      depthWrite: material.depthWrite, depthTest: material.depthTest, alphaTest: material.alphaTest, alphaMap: material.alphaMap,
      transmission: material.transmission, transmissionMap: material.transmissionMap };
    const map = isSkinSurface(material) ? material.map : null;
    const glass = built?.uniforms.uCitadelGlass?.value;
    const npr = built?.uniforms.uNprLighting?.value;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.renderOrder = 2;
    const shared = new THREE.Mesh(mesh.geometry, material); shared.renderOrder = 3;
    const untouched = new THREE.MeshStandardMaterial({ opacity: 0.9 }); untouched.name = 'coat';
    const scene = new THREE.Group(); scene.add(mesh, shared, new THREE.Mesh(mesh.geometry, untouched));
    const restore = applySkinPartEdits(scene, [{ material: 'gun.vmat', hidden: false, tint: null,
      surface: { mode: 'translucent', opacity: 0.35 } }], false);
    expect(material).toMatchObject({ transparent: true, opacity: 0.35, blending: THREE.NormalBlending,
      depthWrite: true, depthTest: true, alphaTest: 0, alphaMap: null, transmission: 0, transmissionMap: null });
    expect(mesh.material).toBe(material); expect(shared.material).toBe(material);
    expect(isSkinSurface(material) && material.map).toBe(map);
    expect(mesh.renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER); expect(shared.renderOrder).toBe(TRANSLUCENT_OVERLAY_RENDER_ORDER);
    expect(untouched.opacity).toBe(0.9); expect(untouched.transparent).toBe(false);
    if (built) { expect(built.uniforms.uCitadelGlass.value).toBe(0); expect(built.uniforms.uNprLighting.value).toBe(0); }
    restore(); expect(material).toMatchObject(before);
    expect(mesh.renderOrder).toBe(2); expect(shared.renderOrder).toBe(3);
    if (built) { expect(built.uniforms.uCitadelGlass.value).toBe(glass); expect(built.uniforms.uNprLighting.value).toBe(npr); }
    material.dispose(); if (material !== source) source.dispose(); untouched.dispose();
  });
  it('updates the requested opacity without compounding earlier edits or replacing the material', () => {
    const material = new THREE.MeshStandardMaterial({ opacity: 0.4 }); material.name = 'gun';
    const scene = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const first = applySkinPartEdits(scene, [{ material: 'gun', hidden: false, tint: null, surface: { mode: 'translucent', opacity: 0.35 } }], false);
    expect(material.opacity).toBe(0.35); first(); expect(material.opacity).toBe(0.4);
    const second = applySkinPartEdits(scene, [{ material: 'gun', hidden: false, tint: null, surface: { mode: 'translucent', opacity: 0.6 } }], false);
    expect(material.opacity).toBe(0.6); expect(mesh.material).toBe(material); second(); expect(material.opacity).toBe(0.4);
    material.dispose(); mesh.geometry.dispose();
  });
  it('keeps base opacity pixels but excludes the alternate translucency mask in basic mode', () => {
    const source = new THREE.MeshStandardMaterial({ opacity: 0.8 }); source.name = 'gun';
    const mask = new THREE.DataTexture(new Uint8Array(8 * 8 * 4).fill(128), 8, 8);
    const albedo = new THREE.Texture(); source.map = albedo;
    source.userData.morphic = { shader: 'pbr.vfx', ints: { F_TRANSLUCENT: 1 }, floats: { g_flOpacityScale1: 0.8 },
      resolvedTextures: { g_tAltTranslucency: mask } };
    const built = buildDeadlockMaterial(source);
    const material = built.material;
    if (!('alphaMap' in material)) throw new Error('Expected alpha map support');
    const authored = material.alphaMap;
    expect(authored).not.toBeNull();
    const scene = new THREE.Group(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); scene.add(mesh);
    const restore = applySkinPartEdits(scene, [{ material: 'gun', hidden: false, tint: null, surface: { mode: 'translucent', opacity: 0.35 } }], false);
    expect(material.opacity).toBe(0.35); expect(material.alphaMap).toBeNull();
    expect(isSkinSurface(material) && material.map).toBe(albedo);
    restore(); expect(material.opacity).toBe(0.8); expect(material.alphaMap).toBe(authored);
    built.dispose(); source.dispose(); mask.dispose(); albedo.dispose(); mesh.geometry.dispose();
  });
  it('overrides finish maps on one part and restores them when comparing the original', () => {
    const source = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.2 }); source.name = 'gun.vmat';
    source.roughnessMap = new THREE.Texture(); source.metalnessMap = new THREE.Texture();
    source.userData.morphic = { shader: 'pbr.vfx', ints: { F_USE_NPR_LIGHTING: 1 } };
    const built = buildDeadlockMaterial(source);
    const coat = new THREE.MeshStandardMaterial({ roughness: 0.9 }); coat.name = 'coat.vmat';
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(), built.material), new THREE.Mesh(new THREE.BoxGeometry(), coat));
    const restore = applySkinPartEdits(scene, [{ material: 'gun.vmat', hidden: false, tint: null, finish: { roughness: 0.12, metalness: 1 } }], false);
    expect(built.material).toMatchObject({ roughness: 0.12, metalness: 1, roughnessMap: null, metalnessMap: null });
    expect(coat.roughness).toBe(0.9);
    restore();
    expect(built.material).toMatchObject({ roughness: 0.8, metalness: 0.2, roughnessMap: source.roughnessMap, metalnessMap: source.metalnessMap });
    built.material.dispose(); source.dispose(); coat.dispose();
  });
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
