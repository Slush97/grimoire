import * as THREE from 'three';

/**
 * Hides `objects` until their programs have linked off the render loop. Drawn at once, each new
 * program links synchronously on first use, and a dozen particle and world-card shaders stalled the
 * whole app for seconds as the hideout appeared. Programs key on whether a render target is bound,
 * so a post-processed viewer compiles with one, as its passes draw.
 */
export async function precompileHidden(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, objects: THREE.Object3D[], postprocess: boolean): Promise<void> {
  if (!objects.length) return;
  const shown = objects.map(object => object.visible);
  objects.forEach(object => { object.visible = false; });
  const target = postprocess ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }) : null;
  const previous = gl.getRenderTarget();
  let ready: Promise<unknown>[];
  try {
    if (target) gl.setRenderTarget(target);
    ready = objects.map(object => gl.compileAsync(object, camera, scene));
  } finally {
    gl.setRenderTarget(previous);
    target?.dispose();
  }
  await Promise.all(ready).catch(() => {});
  objects.forEach((object, index) => { object.visible = shown[index]; });
}
