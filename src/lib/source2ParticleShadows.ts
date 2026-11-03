import * as THREE from 'three';

// Dynamic shadows for map particle lights (VRF SceneLight.CastShadows, which the game renders for
// lights such as the fireplace's). Each shadowed light's view of the room is rendered once as a
// cube of Source-unit distances, then folded into one octahedral tile of a shared atlas, so every
// map-lit material reads all of them through a single sampler.

/** Room meshes that cast particle light shadows are also on this layer. */
export const SOURCE2_PARTICLE_SHADOW_LAYER = 30;

const TILE = 512;
const COLUMNS = 2;
/** One tile per particle light slot. */
export const SOURCE2_PARTICLE_SHADOW_TILES = COLUMNS * COLUMNS;

const DEPTH_VERTEX = /* glsl */`
varying vec3 vViewerPosition;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vViewerPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const DEPTH_FRAGMENT = /* glsl */`
uniform mat4 sourceFromViewer;
uniform vec3 lightSource;
uniform float far;
varying vec3 vViewerPosition;
// The distance as a fraction of the light's reach; the cleared 1 is nothing hit.
void main() {
  gl_FragColor = vec4(length((sourceFromViewer * vec4(vViewerPosition, 1.0)).xyz - lightSource) / far);
}`;

// Octahedral layout: the tile's uv maps to a Source-axis direction from the light.
const FOLD_FRAGMENT = /* glsl */`
uniform samplerCube distances;
uniform mat3 viewerFromSource;
varying vec2 vUv;
void main() {
  vec2 f = vUv * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.xy += vec2(n.x >= 0.0 ? -t : t, n.y >= 0.0 ? -t : t);
  gl_FragColor = vec4(textureCube(distances, normalize(viewerFromSource * normalize(n))).r);
}`;

/** Shader text for the lit materials: the fraction of a particle light that reaches a point. */
export const SOURCE2_PARTICLE_SHADOW_GLSL = /* glsl */`
uniform sampler2D source2ParticleShadowAtlas;
// xy: the tile's corner in atlas uv, z: its size, w: the reach its distances are a fraction of, 0 for none.
uniform vec4 source2ParticleShadowTile[SOURCE2_PARTICLE_LIGHT_SLOTS];
uniform vec3 source2ParticleLightSource[SOURCE2_PARTICLE_LIGHT_SLOTS];
float source2ParticleShadow(int index, vec3 sourcePosition) {
  vec4 tile = source2ParticleShadowTile[index];
  if (tile.w <= 0.0) return 1.0;
  vec3 ray = sourcePosition - source2ParticleLightSource[index];
  float distance = length(ray);
  vec3 n = ray / max(abs(ray.x) + abs(ray.y) + abs(ray.z), 1e-5);
  vec2 f = n.z >= 0.0 ? n.xy : (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  float texel = 1.0 / float(textureSize(source2ParticleShadowAtlas, 0).x);
  vec2 uv = tile.xy + clamp(f * 0.5 + 0.5, vec2(texel), vec2(tile.z - texel) / tile.z) * tile.z;
  // A texel spans more distance further out, so the bias grows with it.
  float bias = 2.0 + distance * 0.02;
  float lit = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 offset = (vec2(k & 1, k >> 1) - 0.5) * texel;
    lit += step(distance - bias, texture2D(source2ParticleShadowAtlas, uv + offset).r * tile.w);
  }
  return lit * 0.25;
}
`;

export class Source2ParticleShadows {
  readonly atlas = new THREE.WebGLRenderTarget(TILE * COLUMNS, TILE * COLUMNS, {
    type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false,
  });
  /** Per slot: the atlas tile and whether it holds a shadow, and the light's Source position. */
  readonly tiles = Array.from({ length: COLUMNS * COLUMNS }, () => new THREE.Vector4());
  readonly sources = Array.from({ length: COLUMNS * COLUMNS }, () => new THREE.Vector3());
  private readonly cube = new THREE.WebGLCubeRenderTarget(TILE, { type: THREE.HalfFloatType, generateMipmaps: false });
  private readonly camera = new THREE.CubeCamera(1, 2, this.cube);
  private readonly depth = new THREE.ShaderMaterial({
    uniforms: { sourceFromViewer: { value: new THREE.Matrix4() }, lightSource: { value: new THREE.Vector3() }, far: { value: 1 } },
    vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT, side: THREE.DoubleSide,
  });
  private readonly fold = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { distances: { value: this.cube.texture }, viewerFromSource: { value: new THREE.Matrix3() } },
    vertexShader: 'varying vec2 vUv;\nvoid main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FOLD_FRAGMENT, depthTest: false, depthWrite: false,
  }));
  private readonly foldScene = new THREE.Scene();
  private readonly foldCamera = new THREE.OrthographicCamera();

  constructor() {
    for (const face of this.camera.children) face.layers.set(SOURCE2_PARTICLE_SHADOW_LAYER);
    this.fold.frustumCulled = false;
    this.foldScene.add(this.fold);
  }

  /** Renders the room as `slot`'s light at `source` (Source units) sees it, out to `range`. */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, slot: number, source: THREE.Vector3, range: number, sourceFromViewer: THREE.Matrix4): void {
    const viewerFromSource = sourceFromViewer.clone().invert();
    const viewerPerSource = new THREE.Vector3().setFromMatrixColumn(viewerFromSource, 0).length();
    const reach = Math.max(range, 2) * 1.05;
    for (const face of this.camera.children) if (face instanceof THREE.PerspectiveCamera) {
      face.near = viewerPerSource; face.far = reach * viewerPerSource; face.updateProjectionMatrix();
    }
    this.camera.position.copy(source).applyMatrix4(viewerFromSource);
    this.camera.updateMatrixWorld(true);
    this.depth.uniforms.sourceFromViewer.value.copy(sourceFromViewer);
    this.depth.uniforms.lightSource.value.copy(source);
    this.depth.uniforms.far.value = reach;

    const override = scene.overrideMaterial, background = scene.background, target = gl.getRenderTarget();
    const clear = gl.getClearColor(new THREE.Color()), alpha = gl.getClearAlpha(), autoClear = gl.autoClear;
    scene.overrideMaterial = this.depth;
    scene.background = null;
    gl.autoClear = true;
    gl.setClearColor(0xffffff, 1);
    try {
      this.camera.update(gl, scene);
      const column = slot % COLUMNS, row = Math.floor(slot / COLUMNS);
      (this.fold.material as THREE.ShaderMaterial).uniforms.viewerFromSource.value.setFromMatrix4(viewerFromSource).multiplyScalar(1 / viewerPerSource);
      gl.setRenderTarget(this.atlas);
      this.atlas.viewport.set(column * TILE, row * TILE, TILE, TILE);
      this.atlas.scissor.set(column * TILE, row * TILE, TILE, TILE);
      this.atlas.scissorTest = true;
      gl.autoClear = false;
      gl.render(this.foldScene, this.foldCamera);
      this.tiles[slot].set(column / COLUMNS, row / COLUMNS, 1 / COLUMNS, reach);
      this.sources[slot].copy(source);
    } finally {
      this.atlas.scissorTest = false;
      this.atlas.viewport.set(0, 0, TILE * COLUMNS, TILE * COLUMNS);
      scene.overrideMaterial = override;
      scene.background = background;
      gl.setClearColor(clear, alpha);
      gl.autoClear = autoClear;
      gl.setRenderTarget(target);
    }
  }

  /** Marks `slot` as unshadowed. */
  clear(slot: number): void {
    this.tiles[slot].w = 0;
  }

  dispose(): void {
    this.atlas.dispose();
    this.cube.dispose();
    this.depth.dispose();
    this.fold.geometry.dispose();
    (this.fold.material as THREE.Material).dispose();
  }
}
