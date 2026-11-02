import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { heroModelBytes } from './heroModelBytes';

describe('hero model bytes', () => {
  it('counts shared textures and buffers once, mips as a third more, and bone textures', () => {
    const map = new THREE.Texture({ width: 1024, height: 512 });
    const flat = new THREE.Texture({ width: 256, height: 256 });
    flat.generateMipmaps = false;
    const material = new THREE.MeshStandardMaterial({ map, normalMap: flat });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(300), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(60), 1));
    const root = new THREE.Group();
    const bones = Array.from({ length: 70 }, () => new THREE.Bone());
    const skinned = new THREE.SkinnedMesh(geometry, material);
    skinned.bind(new THREE.Skeleton(bones));
    root.add(skinned, new THREE.Mesh(geometry, material));
    const clip = new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('a.b', [0, 1], [0, 1])]);
    const bytes = heroModelBytes(root, [clip]);
    expect(bytes.textures).toBe(Math.round(1024 * 512 * 4 * 4 / 3) + 256 * 256 * 4);
    expect(bytes.geometry).toBe(1200 + 120);
    expect(bytes.skinning).toBe(32 * 32 * 16);
    expect(bytes.animation).toBe(16);
    expect(bytes.gpu).toBe(bytes.textures + bytes.geometry + bytes.skinning);
  });
});
