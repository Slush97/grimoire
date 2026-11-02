import * as THREE from 'three';
import type { Source2MapTonemap } from '../types/skinEditor';

// SH2 decoding follows ValveResourceFormat lighting.slang, MIT, pinned by the
// hideout oracle. L1 is relative to DC; the luminance direction reconstructs L2.
export const SOURCE2_LIGHTMAP_GLSL = /* glsl */`
uniform sampler2D source2LightmapDirection;
uniform mat3 source2NormalFromViewer;
vec3 source2EvaluateLightmap(vec3 dc, vec3 packedBand, vec3 direction) {
  vec3 band = (packedBand * 2.0 - 1.0) * sqrt(3.0);
  band = vec3(-band.z, -band.x, band.y);
  vec3 linearR = band * dc.r;
  vec3 linearG = band * dc.g;
  vec3 linearB = band * dc.b;
  vec3 axis = linearR * 0.2125 + linearG * 0.7154 + linearB * 0.0721;
  axis /= max(1e-5, length(axis));
  vec3 alignment = abs(vec3(dot(linearR, axis), dot(linearG, axis), dot(linearB, axis)));
  vec3 ratio = alignment / max(vec3(1e-5), dc);
  vec3 zonal = dc * ratio * (0.08 + 0.6 * ratio) * 0.25 * sqrt(5.0 / (16.0 * PI));
  vec3 linearTerm = (0.886227 * dc + 1.023328 * vec3(dot(linearR, direction), dot(linearG, direction), dot(linearB, direction))) / PI;
  float cosine = dot(axis, direction);
  return max(vec3(0.0), linearTerm + zonal * (3.0 * cosine * cosine - 1.0));
}
vec3 source2LightmapNormal(vec3 viewNormal) {
  return normalize(source2NormalFromViewer * inverseTransformDirection(viewNormal, viewMatrix));
}
`;

export function source2LightmapNormalMatrix(heading: number): THREE.Matrix3 {
  const basis = new THREE.Matrix3().set(0, 0, 1, 1, 0, 0, 0, 1, 0);
  return basis.multiply(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(heading))));
}

export function applySource2Lightmap(material: THREE.MeshStandardMaterial, options: {
  direction: THREE.Texture; heading: number; exposure: number; reflections?: boolean;
  shadows?: THREE.Texture; pointShadowChannels?: THREE.Vector4[]; linearOutput?: boolean;
}): void {
  const normalMatrix = source2LightmapNormalMatrix(options.heading);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.source2LightmapDirection = { value: options.direction };
    shader.uniforms.source2NormalFromViewer = { value: normalMatrix };
    shader.uniforms.source2MapExposure = { value: options.exposure };
    if (options.shadows) {
      shader.uniforms.source2MapShadows = { value: options.shadows };
      shader.uniforms.source2PointShadowChannels = { value: options.pointShadowChannels };
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SOURCE2_LIGHTMAP_GLSL}\nuniform float source2MapExposure;
        ${options.shadows ? 'uniform sampler2D source2MapShadows;\n#if NUM_POINT_LIGHTS > 0\nuniform vec4 source2PointShadowChannels[NUM_POINT_LIGHTS];\n#endif' : ''}`)
      .replace('#include <lights_fragment_maps>', `
        #include <lights_fragment_maps>
        vec3 source2Dc = texture2D(lightMap, vLightMapUv).rgb;
        vec3 source2Band = texture2D(source2LightmapDirection, vLightMapUv).rgb;
        // The SH evaluation already includes Lambert's 1/pi. Three applies it
        // in RE_IndirectDiffuse, so its irradiance input needs the pi back.
        irradiance = PI * source2EvaluateLightmap(source2Dc, source2Band, source2LightmapNormal(geometryNormal));
        iblIrradiance = vec3(0.0);
        ${options.reflections ? `
          float source2RoughnessSquared = material.roughness * material.roughness;
          float source2Smoothness = 1.0 - source2RoughnessSquared;
          vec3 source2Reflection = reflect(-geometryViewDir, geometryNormal);
          vec3 source2Dominant = mix(geometryNormal, source2Reflection, source2Smoothness * (sqrt(source2Smoothness) + source2RoughnessSquared));
          float source2LightmapReflection = saturate(-2.0 + 10.0 * material.roughness) * (1.0 - metalnessFactor);
          radiance = mix(radiance, source2EvaluateLightmap(source2Dc, source2Band, source2LightmapNormal(source2Dominant)), source2LightmapReflection);
        ` : ''}
      `)
      .replace('#include <tonemapping_fragment>', `${options.linearOutput ? '' : 'gl_FragColor.rgb *= source2MapExposure;'}\n#include <tonemapping_fragment>`);
    if (options.shadows) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(
        'getPointLightInfo( pointLight, geometryPosition, directLight );', `
          getPointLightInfo( pointLight, geometryPosition, directLight );
          {
            vec4 source2Mask = source2PointShadowChannels[i];
            directLight.color *= 1.0 - dot(source2Mask, vec4(1.0)) + dot(source2Mask, texture2D(source2MapShadows, vLightMapUv));
          }
        `));
    }
  };
  material.customProgramCacheKey = () => `source2-sh2-luminance-v2:${options.reflections}:${!!options.shadows}:${!!options.linearOutput}`;
}

export function applySource2MapProbe(material: THREE.Material, heading: number): void {
  // PMREM's image-cubemap import mirrors X. Undo that mirror while converting
  // the viewer's heading and Y-up basis back to the probe's Source world axes.
  const rotation = source2LightmapNormalMatrix(heading).premultiply(new THREE.Matrix3().set(-1, 0, 0, 0, 1, 0, 0, 0, 1));
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.source2ProbeFromViewer = { value: rotation };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform mat3 source2ProbeFromViewer;')
      .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment.replaceAll('envMapRotation *', 'source2ProbeFromViewer *'))
      .replaceAll('envMapRotation * citadelR', 'source2ProbeFromViewer * citadelR');
  };
  material.customProgramCacheKey = () => `${key}:source2-map-probe-v1`;
}

export function applySource2MapTonemap(material: THREE.Material, tone: Source2MapTonemap, exposure: number): void {
  const white = source2TonemapValue(tone.white, tone);
  if (!(white > 0)) throw new Error('Invalid map tone curve white point.');
  const compile = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    shader.uniforms.source2ToneA = { value: new THREE.Vector4(tone.shoulder, tone.linear, tone.angle, tone.toe) };
    shader.uniforms.source2ToneB = { value: new THREE.Vector4(tone.toeNumerator, tone.toeDenominator, tone.white, 1 / white) };
    shader.uniforms.source2ToneExposure = { value: exposure * 2 ** tone.exposureBias };
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec4 source2ToneA;
      uniform vec4 source2ToneB;
      uniform float source2ToneExposure;
      vec3 source2MapTone(vec3 color) {
        vec3 x = min(color * source2ToneExposure * 2.8, vec3(source2ToneB.z));
        vec3 numerator = x * (source2ToneA.x * x + source2ToneA.y * source2ToneA.z) + source2ToneB.x * source2ToneA.w;
        vec3 denominator = x * (source2ToneA.x * x + source2ToneA.y) + source2ToneB.y * source2ToneA.w;
        return max(vec3(0.0), (numerator / denominator - source2ToneB.x / source2ToneB.y) * source2ToneB.w);
      }
    `).replace('gl_FragColor.rgb *= source2MapExposure;', '')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = source2MapTone(gl_FragColor.rgb);');
  };
  material.customProgramCacheKey = () => `${key}:source2-map-tonemap-v1`;
}

export function source2TonemapValue(value: number, tone: Source2MapTonemap): number {
  return (value * (tone.shoulder * value + tone.linear * tone.angle) + tone.toeNumerator * tone.toe)
    / (value * (tone.shoulder * value + tone.linear) + tone.toeDenominator * tone.toe) - tone.toeNumerator / tone.toeDenominator;
}

export interface Source2CubemapFace { width: number; height: number; data: Float32Array }

/** The six float faces of a cubemap pack. Needs no DOM, so it runs in a worker. */
export function parseSource2MapProbeFaces(bytes: ArrayBuffer, Loader: typeof import('three/examples/jsm/loaders/HDRLoader.js').HDRLoader): Source2CubemapFace[] {
  const header = new DataView(bytes);
  if (bytes.byteLength < 24) throw new Error('Truncated cubemap pack.');
  const faces: Source2CubemapFace[] = [];
  let offset = 24;
  for (let i = 0; i < 6; i++) {
    const length = header.getUint32(i * 4, true);
    if (offset + length > bytes.byteLength) throw new Error('Truncated cubemap face.');
    const face = new Loader().setDataType(THREE.FloatType).parse(bytes.slice(offset, offset + length));
    if (!(face.data instanceof Float32Array) || !face.width || !face.height) throw new Error('Expected floating point cubemap pixels.');
    faces.push({ width: face.width, height: face.height, data: face.data });
    offset += length;
  }
  if (offset !== bytes.byteLength) throw new Error('Invalid cubemap pack length.');
  return faces;
}

export function source2MapProbeTarget(faces: readonly Source2CubemapFace[], renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const textures = faces.map(face => new THREE.DataTexture(face.data, face.width, face.height, THREE.RGBAFormat, THREE.FloatType));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let cube: THREE.CubeTexture | null = null;
  try {
    cube = new THREE.CubeTexture(textures);
    cube.type = THREE.FloatType;
    cube.colorSpace = THREE.LinearSRGBColorSpace;
    cube.needsUpdate = true;
    return pmrem.fromCubemap(cube);
  } finally {
    cube?.dispose();
    textures.forEach(face => face.dispose());
    pmrem.dispose();
  }
}

export async function loadSource2MapProbe(bytes: ArrayBuffer, renderer: THREE.WebGLRenderer, onNormalization?: (fit: THREE.Vector4) => void): Promise<THREE.WebGLRenderTarget> {
  const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
  const faces = parseSource2MapProbeFaces(bytes, HDRLoader);
  onNormalization?.(source2CubemapNormalization(faces));
  return source2MapProbeTarget(faces, renderer);
}

/** L0/L1 cosine-convolved radiance fit, in the cubemap's Source axes. */
export function source2CubemapNormalization(faces: readonly Source2CubemapFace[]): THREE.Vector4 {
  const sum = new THREE.Vector4(0, 0, 0, 0);
  let area = 0;
  const direction = new THREE.Vector3();
  for (const [face, { width, height, data }] of faces.entries()) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = 2 * (x + 0.5) / width - 1, v = 2 * (y + 0.5) / height - 1;
      if (face === 0) direction.set(1, -v, -u); else if (face === 1) direction.set(-1, -v, u);
      else if (face === 2) direction.set(u, 1, v); else if (face === 3) direction.set(u, -1, -v);
      else if (face === 4) direction.set(u, -v, 1); else direction.set(-u, -v, -1);
      direction.normalize();
      const weight = (1 + u * u + v * v) ** -1.5;
      const offset = (y * width + x) * 4;
      const luma = data[offset] * 0.2125 + data[offset + 1] * 0.7154 + data[offset + 2] * 0.0721;
      const value = luma * weight;
      sum.x += 2 * direction.x * value; sum.y += 2 * direction.y * value; sum.z += 2 * direction.z * value; sum.w += value;
      area += weight;
    }
  }
  return sum.multiplyScalar(1 / area);
}
