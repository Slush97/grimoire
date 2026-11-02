import * as THREE from 'three';
import type { HideoutLight, HideoutSceneInfo } from '../types/skinEditor';
import type { Source2ProbeVolume } from './source2MapData';
import type { Source2CookieAtlas, Source2ParticleLights } from './source2DynamicLights';
import { SOURCE_TO_GLTF } from './hideoutTransform';
import { source2LightmapNormalMatrix } from './source2Lightmap';

export interface Source2ProbeLighting {
  heading: number;
  normalization: THREE.Vector4;
  irradiance: THREE.Data3DTexture;
  shadows: THREE.Data3DTexture | null;
  volumes: Source2ProbeVolume[];
  encoding: 'linear' | 'rgbm';
  sourceFromViewer: THREE.Matrix4;
  normalFromViewer: THREE.Matrix3;
  /** The map lights that can reach what this lights (the hero), within `slots` map light slots. */
  lights: HideoutLight[];
  slots?: number;
  cookies?: Source2CookieAtlas | null;
  /** Lights placed by the map's particles, shared with the room. */
  particles?: Source2ParticleLights | null;
}

/** VTV1 preserves the stored canvas, RGBA channels and mip-zero slice order. */
export function parseSource2Volume(bytes: ArrayBuffer, srgb: boolean): THREE.Data3DTexture {
  if (bytes.byteLength < 20) throw new Error('Truncated volume header.');
  const header = new DataView(bytes);
  if (header.getUint32(0, true) !== 0x31565456) throw new Error('Unsupported volume format.');
  const width = header.getUint32(4, true), height = header.getUint32(8, true), depth = header.getUint32(12, true);
  const component = header.getUint32(16, true);
  if (!width || !height || !depth || width > 2048 || height > 2048 || depth > 2048 || ![1, 2].includes(component)) throw new Error('Invalid volume dimensions or type.');
  if (bytes.byteLength !== 20 + width * height * depth * 4 * component) throw new Error('Invalid volume pixel count.');
  const texture = new THREE.Data3DTexture(component === 1 ? new Uint8Array(bytes, 20) : new Uint16Array(bytes, 20), width, height, depth);
  texture.type = component === 1 ? THREE.UnsignedByteType : THREE.HalfFloatType;
  texture.format = THREE.RGBAFormat;
  texture.colorSpace = srgb && component === 1 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

export async function decodeSource2Volume(bytes: ArrayBuffer, srgb: boolean): Promise<THREE.Data3DTexture> {
  const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
  if (header[0] === 0x1f && header[1] === 0x8b) {
    bytes = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  return parseSource2Volume(bytes, srgb);
}

export function source2ViewerToMap(info: Pick<HideoutSceneInfo, 'anchor' | 'heading'>, scale: number, floor: number): THREE.Matrix4 {
  const anchor = new THREE.Vector3(...info.anchor).applyMatrix4(SOURCE_TO_GLTF);
  return SOURCE_TO_GLTF.clone().invert()
    .multiply(new THREE.Matrix4().makeTranslation(...anchor.toArray()))
    .multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(info.heading)))
    .multiply(new THREE.Matrix4().makeScale(1 / scale, 1 / scale, 1 / scale))
    .multiply(new THREE.Matrix4().makeTranslation(0, -floor, 0));
}

export function source2NormalizedVolume(volume: Source2ProbeVolume): THREE.Matrix4 {
  const size = new THREE.Vector3(...volume.max).sub(new THREE.Vector3(...volume.min));
  if (Math.min(size.x, size.y, size.z) <= 0) throw new Error('Invalid probe bounds.');
  return new THREE.Matrix4().makeScale(1 / size.x, 1 / size.y, 1 / size.z)
    .multiply(new THREE.Matrix4().makeTranslation(-volume.min[0], -volume.min[1], -volume.min[2]))
    .multiply(new THREE.Matrix4().fromArray(volume.matrix).invert());
}

function volumeSize(volume: Source2ProbeVolume): THREE.Vector3 {
  return new THREE.Vector3(...volume.max).sub(new THREE.Vector3(...volume.min));
}

// VRF MIT lighting.lpv.slang and envmap_data.slang. Six faces occupy equal
// depth bands in +X,+Y,+Z,-X,-Y,-Z order. Source 2 8.3+ reaches LPVs through
// the associated cubemap boxes, in priority and increasing influence volume.
const PROBE_GLSL = /* glsl */`
uniform highp sampler3D source2ProbeIrradiance;
uniform highp sampler3D source2ProbeShadows;
uniform mat4 source2MapFromViewer;
uniform mat3 source2ProbeNormalFromViewer;
uniform mat4 source2VolumeFromMap[SOURCE2_VOLUME_COUNT];
uniform vec3 source2VolumeSize[SOURCE2_VOLUME_COUNT];
uniform vec3 source2VolumeOffset[SOURCE2_VOLUME_COUNT];
uniform vec3 source2VolumeFade[SOURCE2_VOLUME_COUNT];
uniform vec3 source2ProbeAtlasSize;
vec3 source2SourceCube[6];
vec3 source2ViewerCube[6];
vec4 source2ProbeShadow;
vec3 source2EvaluateProbe(vec3 direction) {
  vec3 weights = direction * direction;
  return weights.x * (direction.x >= 0.0 ? source2SourceCube[0] : source2SourceCube[3]) +
    weights.y * (direction.y >= 0.0 ? source2SourceCube[1] : source2SourceCube[4]) +
    weights.z * (direction.z >= 0.0 ? source2SourceCube[2] : source2SourceCube[5]);
}
vec3 source2DecodeProbe(vec4 value) {
  #if SOURCE2_PROBE_RGBM == 1
    vec3 encoded = mix(value.rgb * 12.92, 1.055 * pow(max(value.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), value.rgb));
    vec3 rgbm = encoded * (value.a * 6.0);
    return rgbm * rgbm;
  #else
    return value.rgb;
  #endif
}
void source2SampleProbes(vec3 worldPosition) {
  for (int face = 0; face < 6; face++) source2SourceCube[face] = vec3(0.0);
  source2ProbeShadow = vec4(0.0);
  float coverage = 0.0;
  vec3 position = (source2MapFromViewer * vec4(worldPosition, 1.0)).xyz;
  for (int volume = 0; volume < SOURCE2_VOLUME_COUNT; volume++) {
    vec3 local = (source2VolumeFromMap[volume] * vec4(position, 1.0)).xyz;
    vec3 edge = min(local, 1.0 - local);
    vec3 fade = clamp(edge * source2VolumeFade[volume], 0.0, 1.0);
    float weight = smoothstep(0.0, 1.0, min(min(fade.x, fade.y), fade.z)) * (1.0 - coverage);
    if (weight > 0.0) {
      vec3 voxel = clamp(local * source2VolumeSize[volume], vec3(0.5), source2VolumeSize[volume] - 0.5) + source2VolumeOffset[volume];
      vec3 coord = voxel / source2ProbeAtlasSize;
      coord.z /= 6.0;
      for (int face = 0; face < 6; face++) {
        source2SourceCube[face] += source2DecodeProbe(texture(source2ProbeIrradiance, coord + vec3(0.0, 0.0, float(face) / 6.0))) * weight;
      }
      #if SOURCE2_PROBE_SHADOWS == 1
        vec3 shadowCoord = (clamp(local, 0.0, 1.0) * source2VolumeSize[volume] + source2VolumeOffset[volume]) / source2ProbeAtlasSize;
        source2ProbeShadow += texture(source2ProbeShadows, shadowCoord) * weight;
      #endif
      coverage += weight;
      if (coverage > 0.99) break;
    }
  }
  source2ViewerCube[0] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(1.0, 0.0, 0.0));
  source2ViewerCube[1] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(-1.0, 0.0, 0.0));
  source2ViewerCube[2] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(0.0, 1.0, 0.0));
  source2ViewerCube[3] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(0.0, -1.0, 0.0));
  source2ViewerCube[4] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(0.0, 0.0, 1.0));
  source2ViewerCube[5] = source2EvaluateProbe(source2ProbeNormalFromViewer * vec3(0.0, 0.0, -1.0));
}
`;

/** Applies spatial irradiance and shadow masks after the material's own shader build. */
export function applySource2ProbeVolume(material: THREE.Material, lighting: Source2ProbeLighting): () => void {
  const compile = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey;
  const volumes = [...lighting.volumes].sort((a, b) => b.priority - a.priority
    || volumeSize(a).toArray().reduce((a, b) => a * b, 1) - volumeSize(b).toArray().reduce((a, b) => a * b, 1));
  if (!volumes.length) return () => {};
  const image = lighting.irradiance.image;
  const uniforms = {
    source2ProbeIrradiance: { value: lighting.irradiance }, source2ProbeShadows: { value: lighting.shadows },
    source2MapFromViewer: { value: lighting.sourceFromViewer }, source2ProbeNormalFromViewer: { value: lighting.normalFromViewer },
    source2VolumeFromMap: { value: volumes.map(source2NormalizedVolume) },
    source2VolumeSize: { value: volumes.map(volume => new THREE.Vector3(...volume.size)) },
    source2VolumeOffset: { value: volumes.map(volume => new THREE.Vector3(...volume.offset)) },
    source2VolumeFade: { value: volumes.map(volume => volumeSize(volume).divide(new THREE.Vector3(...volume.fade).max(new THREE.Vector3(1e-10, 1e-10, 1e-10)))) },
    source2ProbeAtlasSize: { value: new THREE.Vector3(image.width, image.height, image.depth / 6) },
  };
  material.onBeforeCompile = (shader, renderer) => {
    compile.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    // CSM expands its own lighting chunks. Expand the remaining standard chunks
    // too, then patch their shared point-light call and indirect-light boundary.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
      .replace(/uNprAmbientCube\[/g, 'source2ViewerCube[')
      .replace('uniform vec3 source2ViewerCube[6];', '')
      .replace('#include <common>', `#include <common>\n#define SOURCE2_VOLUME_COUNT ${volumes.length}\n#define SOURCE2_PROBE_RGBM ${lighting.encoding === 'rgbm' ? 1 : 0}\n#define SOURCE2_PROBE_SHADOWS ${lighting.shadows ? 1 : 0}\n${PROBE_GLSL}`)
      .replace(/void main\s*\(\s*\)\s*\{/, '$&\nsource2SampleProbes(cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz);')
      .replace('#include <lights_fragment_end>', `
        irradiance = PI * source2EvaluateProbe(source2ProbeNormalFromViewer * inverseTransformDirection(geometryNormal, viewMatrix));
        iblIrradiance = vec3(0.0);
        #include <lights_fragment_end>
      `);
  };
  material.customProgramCacheKey = () => `${cacheKey.call(material)}:source2-lpv-v1:${volumes.length}:${lighting.encoding}:${!!lighting.shadows}`;
  material.needsUpdate = true;
  return () => { material.onBeforeCompile = compile; material.customProgramCacheKey = cacheKey; material.needsUpdate = true; };
}

export function source2MapProbeNormals(heading: number): THREE.Matrix3 {
  return source2LightmapNormalMatrix(heading);
}
