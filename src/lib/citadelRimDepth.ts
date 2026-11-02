import * as THREE from 'three';

/**
 * Depth of a hero's opaque surfaces from the current camera, for the game's rim
 * light occlusion test (see citadelRimOcclusion in citadelNprLighting.ts). The
 * engine reads its full scene depth; the viewer only needs the hero, so this
 * renders the hero's opaque, visible meshes with a depth-only material into a
 * small target before the main render. Transparent and additive meshes (glow
 * shells, particles) are left out, as they would not occlude a rim in game.
 */
/**
 * Viewer units per game unit for the rim occlusion distances. The hero GLB keeps game units in its
 * mesh positions under its own node scale, so this is a hero mesh's world scale, not the root's.
 */
export function citadelRimUnit(root: THREE.Object3D): number {
  let mesh: THREE.Object3D | null = null;
  root.traverse((object) => { if (!mesh && (object as THREE.Mesh).isMesh) mesh = object; });
  return new THREE.Vector3().setFromMatrixScale((mesh ?? root).matrixWorld).x;
}

export class CitadelRimDepth {
  readonly target: THREE.WebGLRenderTarget;
  private readonly front = new THREE.MeshBasicMaterial({ colorWrite: false });
  private readonly double = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private readonly skip = new THREE.MeshBasicMaterial({ visible: false });
  private readonly size = new THREE.Vector2();
  private unit = 1;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1);
    this.target.depthTexture = new THREE.DepthTexture(1, 1);
  }

  get texture(): THREE.DepthTexture {
    return this.target.depthTexture!;
  }

  private depthMaterial(material: THREE.Material): THREE.Material {
    if (!material.visible || material.transparent || !material.depthWrite || material.blending !== THREE.NormalBlending
      || ('transmission' in material && typeof material.transmission === 'number' && material.transmission > 0)) return this.skip;
    return material.side === THREE.DoubleSide ? this.double : this.front;
  }

  /** Renders `root`'s depth. Returns the drawing buffer size the depth matches. */
  render(renderer: THREE.WebGLRenderer, root: THREE.Object3D, camera: THREE.Camera): THREE.Vector2 {
    renderer.getDrawingBufferSize(this.size);
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y);
    const swaps: Array<[THREE.Mesh, THREE.Material | THREE.Material[]]> = [];
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      swaps.push([mesh, mesh.material]);
      mesh.material = mesh.userData.citadelNprOutline || Object.hasOwn(mesh.userData, 'morphic_shell') ? this.skip
        : Array.isArray(mesh.material) ? mesh.material.map((m) => this.depthMaterial(m)) : this.depthMaterial(mesh.material);
    });
    const previousTarget = renderer.getRenderTarget();
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    try {
      renderer.setRenderTarget(this.target);
      renderer.clear(true, true, true);
      renderer.render(root, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.shadowMap.autoUpdate = shadows;
      for (const [mesh, material] of swaps) mesh.material = material;
    }
    this.unit = citadelRimUnit(root);
    return this.size;
  }

  /** Points a material's rim-depth uniforms at this pass for `camera`. */
  bind(uniforms: Record<string, THREE.IUniform>, camera: THREE.Camera): void {
    if (!uniforms.uCitadelDepth) return;
    const perspective = camera as THREE.PerspectiveCamera;
    uniforms.uCitadelDepth.value = this.texture;
    uniforms.uCitadelDepthOn.value = perspective.isPerspectiveCamera ? 1 : 0;
    uniforms.uCitadelDepthNearFar.value.set(perspective.near, perspective.far);
    uniforms.uCitadelDepthSize.value.copy(this.size);
    uniforms.uCitadelProjection.value.copy(perspective.projectionMatrix);
    uniforms.uCitadelUnit.value = this.unit;
  }

  dispose(): void {
    this.target.dispose();
    this.front.dispose();
    this.double.dispose();
    this.skip.dispose();
  }
}
