import * as THREE from 'three';

const SIZE = 32;
const FACES: [THREE.Vector3Tuple, THREE.Vector3Tuple][] = [
  [[1, 0, 0], [0, 1, 0]], [[-1, 0, 0], [0, 1, 0]], [[0, 1, 0], [0, 0, -1]],
  [[0, -1, 0], [0, 0, 1]], [[0, 0, 1], [0, 1, 0]], [[0, 0, -1], [0, 1, 0]],
];

/**
 * Free distance from a point to the room's opaque geometry in every direction.
 * Six 90 degree views of the room are rendered once into a small distance strip
 * and read back, so a lookup is a projection and a texel read. Directions are
 * judged conservatively: the smallest distance in a 3 by 3 texel neighbourhood.
 */
export const ROOM_CLEARANCE_SIZE = SIZE;

/** Room surfaces that bound the viewer camera: every hideout mesh but the world cards. */
export const HIDEOUT_ROOM_LAYER = 29;

/**
 * How far to move the hero away from the camera, along the view axis, to stand midway
 * between the room's nearest surfaces behind the camera and ahead of the hero. Negative
 * moves it toward the camera.
 */
export function hideoutCenteringShift(behind: number, ahead: number): number {
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return 0;
  return (ahead - behind) / 2;
}

/**
 * Whether any of a box's sample points (a 5 by 5 by 5 grid) is in sight of the clearance's
 * origin: nothing measured lies nearer along its direction. The box and the clearance share
 * one space.
 */
export function hideoutSeenThroughRoom(clearance: RoomClearance, box: THREE.Box3): boolean {
  const point = new THREE.Vector3(), direction = new THREE.Vector3();
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) for (let k = 0; k < 5; k++) {
    point.set(THREE.MathUtils.lerp(box.min.x, box.max.x, i / 4), THREE.MathUtils.lerp(box.min.y, box.max.y, j / 4), THREE.MathUtils.lerp(box.min.z, box.max.z, k / 4));
    direction.subVectors(point, clearance.origin);
    const distance = direction.length();
    if (distance === 0) return true;
    const free = clearance.distance(direction.divideScalar(distance), false);
    if (free >= clearance.range || free >= distance * 0.99) return true;
  }
  return false;
}

export class RoomClearance {
  readonly origin = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  private readonly target = new THREE.WebGLRenderTarget(SIZE * 6, SIZE, {
    type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  });
  private readonly cameras = FACES.map(([forward, up]) => {
    const camera = new THREE.PerspectiveCamera(90, 1, 0.01, 1);
    camera.up.set(...up);
    camera.userData.forward = new THREE.Vector3(...forward);
    return camera;
  });
  private readonly material = new THREE.ShaderMaterial({
    uniforms: { origin: { value: new THREE.Vector3() } },
    vertexShader: 'varying vec3 vWorld;\nvoid main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }',
    fragmentShader: 'uniform vec3 origin;\nvarying vec3 vWorld;\nvoid main() { gl_FragColor = vec4(distance(vWorld, origin), 0.0, 0.0, 1.0); }',
    side: THREE.DoubleSide,
  });
  private readonly pixels = new Float32Array(SIZE * 6 * SIZE * 4);
  private reach = 0;
  private stale = false;
  /** Counts invalidations: a read-back started before the latest one is discarded. */
  private generation = 0;
  private pending: Promise<void> | null = null;

  /** Renders the room's `layer` from `origin` out to `reach` world units and reads it back. */
  measure(gl: THREE.WebGLRenderer, scene: THREE.Scene, origin: THREE.Vector3, reach: number, layer: number): void {
    this.render(gl, scene, origin, reach, layer);
    gl.readRenderTargetPixels(this.target, 0, 0, SIZE * 6, SIZE, this.pixels);
    this.load(origin, reach);
  }

  /** {@link measure} without stalling on the read-back: the held measurement answers until the new
   *  one lands. A call while one is in flight is dropped, and resolves when that one lands. */
  measureAsync(gl: THREE.WebGLRenderer, scene: THREE.Scene, origin: THREE.Vector3, reach: number, layer: number): Promise<void> {
    if (this.pending) return this.pending;
    const from = origin.clone();
    this.render(gl, scene, from, reach, layer);
    if (this.reach) this.aim(this.origin, this.reach);
    const pixels = new Float32Array(this.pixels.length);
    const generation = this.generation;
    this.pending = gl.readRenderTargetPixelsAsync(this.target, 0, 0, SIZE * 6, SIZE, pixels)
      .then(() => { if (generation === this.generation) this.load(from, reach, pixels); }, () => {})
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  private render(gl: THREE.WebGLRenderer, scene: THREE.Scene, origin: THREE.Vector3, reach: number, layer: number): void {
    this.material.uniforms.origin.value.copy(origin);
    const override = scene.overrideMaterial, background = scene.background, previous = gl.getRenderTarget();
    const clear = gl.getClearColor(new THREE.Color()), alpha = gl.getClearAlpha(), autoClear = gl.autoClear;
    scene.overrideMaterial = this.material;
    scene.background = null;
    gl.autoClear = false;
    try {
      gl.setRenderTarget(this.target);
      gl.setClearColor(new THREE.Color(reach, 0, 0), 1);
      gl.clear(true, true, false);
      this.aim(origin, reach);
      this.cameras.forEach((camera, face) => {
        camera.layers.set(layer);
        this.target.viewport.set(face * SIZE, 0, SIZE, SIZE);
        gl.setRenderTarget(this.target);
        gl.render(scene, camera);
      });
    } finally {
      this.target.viewport.set(0, 0, SIZE * 6, SIZE);
      scene.overrideMaterial = override;
      scene.background = background;
      gl.setClearColor(clear, alpha);
      gl.autoClear = autoClear;
      gl.setRenderTarget(previous);
    }
  }

  /** Adopts read-back distances (RGBA float texels, six faces side by side) measured from `origin`. */
  load(origin: THREE.Vector3, reach: number, pixels: Float32Array = this.pixels): void {
    if (pixels !== this.pixels) this.pixels.set(pixels);
    this.origin.copy(origin);
    this.reach = reach;
    this.stale = false;
    this.aim(origin, reach);
  }

  /** Points the six face cameras out from `origin`, as a measurement there renders and reads them. */
  private aim(origin: THREE.Vector3, reach: number): void {
    this.cameras.forEach(camera => {
      camera.near = reach * 0.001; camera.far = reach;
      camera.position.copy(origin);
      camera.lookAt(origin.clone().add(camera.userData.forward as THREE.Vector3));
      camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    });
  }

  /** How far the measurement reached; a direction reading this far met nothing. */
  get range(): number {
    return this.reach;
  }

  /** Marks the measurement out of date, so the next {@link measured} check fails. It still
   *  answers {@link distance} until a new one replaces it. */
  invalidate(): void {
    this.stale = true;
    this.generation++;
  }

  /** Whether a current measurement from within `tolerance` of `origin` is held. */
  measured(origin: THREE.Vector3, tolerance: number): boolean {
    return this.reach > 0 && !this.stale && this.origin.distanceTo(origin) <= tolerance;
  }

  /** Free distance from the measured origin along `direction`, at most the measured reach,
   * blended between texel centers so it changes smoothly as the direction turns.
   * Conservative by default: each texel reads the nearest of the 3 by 3 around it. */
  distance(direction: THREE.Vector3, conservative = true): number {
    if (!this.reach) return Number.POSITIVE_INFINITY;
    // The face whose axis dominates the direction sees it (+X, -X, +Y, -Y, +Z, -Z).
    const ax = Math.abs(direction.x), ay = Math.abs(direction.y), az = Math.abs(direction.z);
    const face = ax >= ay && ax >= az ? (direction.x >= 0 ? 0 : 1) : ay >= az ? (direction.y >= 0 ? 2 : 3) : (direction.z >= 0 ? 4 : 5);
    const point = this.origin.clone().add(direction).project(this.cameras[face]);
    const spread = conservative ? 1 : 0;
    const texel = (x: number, y: number) => {
      let nearest = this.reach;
      for (let dy = -spread; dy <= spread; dy++) for (let dx = -spread; dx <= spread; dx++) {
        const tx = THREE.MathUtils.clamp(x + dx, 0, SIZE - 1), ty = THREE.MathUtils.clamp(y + dy, 0, SIZE - 1);
        nearest = Math.min(nearest, this.pixels[(ty * SIZE * 6 + face * SIZE + tx) * 4]);
      }
      return nearest;
    };
    const u = THREE.MathUtils.clamp((point.x * 0.5 + 0.5) * SIZE - 0.5, 0, SIZE - 1);
    const v = THREE.MathUtils.clamp((point.y * 0.5 + 0.5) * SIZE - 0.5, 0, SIZE - 1);
    const x = Math.floor(u), y = Math.floor(v), fx = u - x, fy = v - y;
    const lerp = THREE.MathUtils.lerp;
    return lerp(lerp(texel(x, y), texel(x + 1, y), fx), lerp(texel(x, y + 1), texel(x + 1, y + 1), fx), fy);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
