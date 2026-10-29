import * as THREE from 'three';
import { getMorphic } from './source2NprMaterial';
import { applySource2ColorCorrection } from './source2ColorCorrection';

/**
 * Affine form of VRF's g_mAlbedoColorCorrect1 (MatrixColorCorrect2): the layer's
 * authored contrast, saturation and brightness around its color texture's
 * reflectivity. Identity when the material has no correction or no pivot.
 */
export function source2LayerColorCorrection(csb: number[] | undefined, reflectivity: number[] | undefined): { matrix: THREE.Matrix3; offset: THREE.Vector3 } {
  const values = csb && reflectivity ? new THREE.Vector3(csb[0] ?? 1, csb[1] ?? 1, csb[2] ?? 1) : new THREE.Vector3(1, 1, 1);
  const pivot = reflectivity ? new THREE.Vector3(reflectivity[0], reflectivity[1], reflectivity[2]) : new THREE.Vector3(1, 1, 1);
  const offset = applySource2ColorCorrection(new THREE.Vector3(), values, pivot);
  const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    .map(axis => applySource2ColorCorrection(axis, values, pivot).sub(offset));
  const matrix = new THREE.Matrix3().set(
    basis[0].x, basis[1].x, basis[2].x,
    basis[0].y, basis[1].y, basis[2].y,
    basis[0].z, basis[1].z, basis[2].z,
  );
  return { matrix, offset };
}

/** environment_blend's world overlay (F_WORLD_OVERLAY 1) for layer 1: the overlay texture,
 * its tiling, contrasts, strength and tint mask mode (0 unmasked, 1 masked, 2 inverted). */
export interface Source2WorldOverlay {
  texture: THREE.Texture;
  tiling: number;
  darknessContrast: number;
  brightnessContrast: number;
  strength: number;
  tintMaskMode: number;
}

export function source2WorldOverlay(data: NonNullable<ReturnType<typeof getMorphic>>): Source2WorldOverlay | null {
  const texture = data.resolvedTextures?.g_tColorWorldOverlay;
  const flag = data.ints?.F_WORLD_OVERLAY;
  if (!texture || (Array.isArray(flag) ? flag[0] : flag) !== 1) return null;
  const float = (name: string, fallback: number) => { const value = data.floats?.[name]; return typeof value === 'number' ? value : fallback; };
  const int = (name: string, fallback: number) => { const value = data.ints?.[name]; return Number(Array.isArray(value) ? value[0] : value ?? fallback); };
  return {
    texture, tiling: float('g_flWorldOverlayTiling', 512), darknessContrast: float('g_flWorldOverlayDarknessContrast', 1),
    brightnessContrast: float('g_flWorldOverlayBrightnessContrast', 1), strength: float('g_flWorldOverlayStrength1', 1),
    tintMaskMode: int('g_nWorldOverlayTintMask1', 1),
  };
}

/** The world overlay's multiplier for one overlay texel (linear), VRF GetOverlayFactor. */
export function source2OverlayFactor(texel: number, darknessContrast: number, brightnessContrast: number): number {
  const signed = texel * 2 - 1;
  const brighten = (1 - Math.pow(1 - Math.max(0, signed), brightnessContrast)) * brightnessContrast;
  const darken = (Math.pow(1 + Math.min(0, signed), darknessContrast) - 1) * darknessContrast;
  return Math.max(0, brighten + darken + 1);
}

const WORLD_OVERLAY_GLSL = /* glsl */`
  uniform sampler2D source2WorldOverlay;
  uniform vec4 source2WorldOverlayParams; // tiling, darkness contrast, brightness contrast, strength
  uniform float source2WorldOverlayMask; // 0 unmasked, 1 masked, 2 inverted
  varying vec3 vSource2OverlayPosition;
  vec3 source2OverlayFactor(vec3 overlay, float darkness, float brightness) {
    vec3 signedOverlay = overlay * 2.0 - 1.0;
    vec3 brighten = (vec3(1.0) - pow(max(vec3(1.0) - max(vec3(0.0), signedOverlay), vec3(1e-6)), vec3(brightness))) * brightness;
    vec3 darken = (pow(max(vec3(1.0) + min(vec3(0.0), signedOverlay), vec3(1e-6)), vec3(darkness)) - vec3(1.0)) * darkness;
    return max(vec3(0.0), brighten + darken + vec3(1.0));
  }
  // VRF environment_blend SampleBiPlanar: the dominant and median planes of the Source
  // geometric normal, blended once either is more than about 35 degrees off its axis.
  vec2 source2PlanarUv(vec3 position, ivec3 axis) {
    vec2 planar = vec2(position[axis.y], position[axis.z]);
    if (axis.x == 1) planar = planar.yx;
    return vec2(planar.x, -planar.y);
  }
  vec3 source2WorldOverlaySample() {
    vec3 position = vSource2OverlayPosition;
    vec3 normal = normalize(cross(dFdx(position), dFdy(position)));
    vec3 absNormal = abs(normal);
    ivec3 major = (absNormal.x > absNormal.y && absNormal.x > absNormal.z) ? ivec3(0, 1, 2) : ((absNormal.y > absNormal.z) ? ivec3(1, 2, 0) : ivec3(2, 0, 1));
    ivec3 minor = (absNormal.x < absNormal.y && absNormal.x < absNormal.z) ? ivec3(0, 1, 2) : ((absNormal.y < absNormal.z) ? ivec3(1, 2, 0) : ivec3(2, 0, 1));
    ivec3 median = ivec3(3) - minor - major;
    float invTiling = 1.0 / (source2WorldOverlayParams.x == 0.0 ? 1.0 : source2WorldOverlayParams.x);
    vec3 dx = dFdx(position) * invTiling, dy = dFdy(position) * invTiling;
    vec4 a = textureGrad(source2WorldOverlay, source2PlanarUv(position, major) * invTiling, vec2(dx[major.y], dx[major.z]), vec2(dy[major.y], dy[major.z]));
    vec4 b = textureGrad(source2WorldOverlay, source2PlanarUv(position, median) * invTiling, vec2(dx[median.y], dx[median.z]), vec2(dy[median.y], dy[median.z]));
    vec2 weights = clamp((vec2(absNormal[major.x], absNormal[median.x]) - 0.5773) * 2.3657441, 0.0, 1.0);
    weights /= max(weights.x + weights.y, 1e-6);
    // The overlay is an sRGB color texture (SrgbRead), embedded raw.
    vec3 srgb = mix(a.rgb, b.rgb, weights.y);
    return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), srgb));
  }
`;

/**
 * First-layer controls retained in the exported environment material: roughness
 * contrast and brightness, normal strength and the albedo correction. The exporter
 * already writes Cartesian tangent normals, so only their strength is applied.
 * The correction runs on the texel before the tint, as environment_blend's
 * SampleLayer does. A negative corrected channel is clamped to zero.
 */
export function applySource2EnvironmentMaterial(material: THREE.MeshStandardMaterial, sourceFromViewer?: THREE.Matrix4): void {
  const data = getMorphic(material);
  if (!data || !['environment_layer.vfx', 'environment_blend.vfx'].includes(data.shader)) return;
  const controls = ['g_vLayerRoughnessContrastBrightness1', 'g_fLayerNormalStrength1', 'g_vAlbedoContrastSaturationBrightness1'];
  if (controls.some(name => data.dynamic_params?.[name])) return;
  const roughness = data.vectors?.g_vLayerRoughnessContrastBrightness1 ?? [1, 0];
  const authoredStrength = data.floats?.g_fLayerNormalStrength1;
  const strength = typeof authoredStrength === 'number' ? authoredStrength : 1;
  material.normalScale.multiplyScalar(strength);
  const correction = source2LayerColorCorrection(data.vectors?.g_vAlbedoContrastSaturationBrightness1, data.texture_reflectivity?.g_tColor);
  // The overlay is projected in Source world space, so it needs the map's placement.
  const overlay = sourceFromViewer ? source2WorldOverlay(data) : null;
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.source2LayerRoughness = { value: new THREE.Vector2(roughness[0], roughness[1]) };
    shader.uniforms.source2LayerColorMatrix = { value: correction.matrix };
    shader.uniforms.source2LayerColorOffset = { value: correction.offset };
    if (overlay && sourceFromViewer) {
      shader.uniforms.source2WorldOverlay = { value: overlay.texture };
      shader.uniforms.source2WorldOverlayFromViewer = { value: sourceFromViewer };
      shader.uniforms.source2WorldOverlayParams = { value: new THREE.Vector4(overlay.tiling, overlay.darknessContrast, overlay.brightnessContrast, overlay.strength) };
      shader.uniforms.source2WorldOverlayMask = { value: overlay.tintMaskMode };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 source2WorldOverlayFromViewer;\nvarying vec3 vSource2OverlayPosition;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvSource2OverlayPosition = (source2WorldOverlayFromViewer * modelMatrix * vec4(transformed, 1.0)).xyz;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 source2LayerRoughness;
        uniform mat3 source2LayerColorMatrix;
        uniform vec3 source2LayerColorOffset;
        ${overlay ? WORLD_OVERLAY_GLSL : ''}
      `)
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          diffuseColor.rgb *= max(source2LayerColorMatrix * sampledDiffuseColor.rgb + source2LayerColorOffset, vec3(0.0));
          diffuseColor.a *= sampledDiffuseColor.a;
        #endif
      `)
      .replace('#include <color_fragment>', overlay ? `
        #include <color_fragment>
        {
          // After the vertex paint, as SampleLayer's albedo is. The layer's tint mask is not
          // exported (color alpha is cleared), so a masked overlay reads it as 1.
          float overlayMask = source2WorldOverlayMask == 2.0 ? 0.0 : 1.0;
          vec3 factor = source2OverlayFactor(source2WorldOverlaySample(), source2WorldOverlayParams.y, source2WorldOverlayParams.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * factor, overlayMask * source2WorldOverlayParams.w);
        }
      ` : '#include <color_fragment>')
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(((roughnessFactor - 0.5) + source2LayerRoughness.y) * source2LayerRoughness.x + 0.5, 0.0, 1.0);
      `);
  };
  material.customProgramCacheKey = () => `${key.call(material)}:source2-environment-layer-v3${overlay ? ':overlay' : ''}`;
  material.needsUpdate = true;
}
