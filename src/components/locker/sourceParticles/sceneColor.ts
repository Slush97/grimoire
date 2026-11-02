// The opaque scene's colour for particle renderers that refract it (m_flRefractAmount and the refract
// texture layers). VRF copies the frame's colour after the opaque pass, before the translucent one: the
// opaque meshes and the background, linear and before post processing. This draws exactly that into a
// half float texture of the drawing buffer's size, without the particles and translucent meshes. Where
// the viewer's canvas is transparent the page shows through (the studio's plain background), so the
// copy holds the linear colour the Source 2 post shows as the page's background colour there (the post
// settings BloomEffect publishes on the scene), so a refraction over it shows the page.

import * as THREE from 'three';
import { linearForDisplay, type SourcePostSettings } from '../../../lib/particles/render/post';

function isOpaque(material: THREE.Material | THREE.Material[]): boolean {
  const materials = Array.isArray(material) ? material : [material];
  return materials.some((entry) => entry.visible && !entry.transparent && entry.depthWrite);
}

/** The linear colour that shows as the page behind the canvas (the first ancestor with an opaque background). */
function pageBackground(canvas: HTMLElement, post: SourcePostSettings | undefined): THREE.Color {
  for (let element: HTMLElement | null = canvas; element; element = element.parentElement) {
    const match = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(element).backgroundColor);
    if (match && (match[4] === undefined || Number(match[4]) >= 1)) {
      const display = [match[1], match[2], match[3]].map((channel) => Number(channel) / 255);
      if (post) {
        const [r, g, b] = display.map((channel) => linearForDisplay(post, channel));
        return new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);
      }
      return new THREE.Color().setRGB(display[0], display[1], display[2], THREE.SRGBColorSpace);
    }
  }
  return new THREE.Color(0, 0, 0);
}

export class SceneColorPass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
  private readonly hidden: THREE.Object3D[] = [];

  /** Renders `scene` as `camera` sees it, with `exclude` (the particles) and translucent meshes left out. */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, size: [number, number], exclude: THREE.Object3D): THREE.Texture {
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

    const shadows = gl.shadowMap.autoUpdate;
    const previous = gl.getRenderTarget();
    gl.shadowMap.autoUpdate = false;
    const clearColor = gl.getClearColor(new THREE.Color());
    const clearAlpha = gl.getClearAlpha();
    gl.setRenderTarget(this.target);
    gl.setClearColor(pageBackground(gl.domElement, scene.userData.sourcePostSettings as SourcePostSettings | undefined), 1);
    gl.clear(true, true, false);
    gl.setClearColor(clearColor, clearAlpha);
    gl.render(scene, camera);
    gl.setRenderTarget(previous);
    gl.shadowMap.autoUpdate = shadows;
    for (const object of this.hidden) object.visible = true;
    this.hidden.length = 0;
    exclude.visible = true;

    return this.target.texture;
  }

  dispose(): void {
    this.target.dispose();
  }
}
