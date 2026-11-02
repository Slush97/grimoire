// The opaque scene's depth for particle renderers that feather against it (m_nFeatheringMode). Source 2
// feathers against the depth of the opaque pass, which translucent surfaces do not write, so this
// draws the scene's opaque meshes depth only into a texture of the drawing buffer's size, without the
// particles, the background or the shadow maps.

import * as THREE from 'three';
import type { ParticleSceneDepth } from '../../../lib/particles/render';

function isOpaque(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => entry.visible && !entry.transparent && entry.depthWrite);
}

export class SceneDepthPass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, depthTexture: new THREE.DepthTexture(1, 1) });
  private readonly material = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly hidden: THREE.Object3D[] = [];

  /** Renders the depth of `scene` as `camera` sees it, with `exclude` (the particles) left out. */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, size: [number, number], exclude: THREE.Object3D): ParticleSceneDepth {
    if (this.target.width !== size[0] || this.target.height !== size[1]) {
      this.target.setSize(size[0], size[1]);
    }

    exclude.visible = false;
    scene.traverseVisible((object) => {
      const mesh = object as THREE.Mesh;
      if ((mesh.isMesh && !isOpaque(mesh.material)) || (object as THREE.Points).isPoints || (object as THREE.Line).isLine || (object as THREE.Sprite).isSprite) {
        this.hidden.push(object);
      }
    });
    for (const object of this.hidden) object.visible = false;

    const background = scene.background;
    const override = scene.overrideMaterial;
    const shadows = gl.shadowMap.autoUpdate;
    const previous = gl.getRenderTarget();
    scene.background = null;
    scene.overrideMaterial = this.material;
    gl.shadowMap.autoUpdate = false;

    gl.setRenderTarget(this.target);
    gl.clear(false, true, false);
    gl.render(scene, camera);

    gl.setRenderTarget(previous);
    gl.shadowMap.autoUpdate = shadows;
    scene.overrideMaterial = override;
    scene.background = background;
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
    exclude.visible = true;

    const perspective = camera as THREE.PerspectiveCamera;
    return { texture: this.target.depthTexture!, near: perspective.near, far: perspective.far };
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
  }
}
