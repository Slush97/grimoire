import type * as THREE from 'three';
import { flag, getMorphic } from './source2NprMaterial';
import type { ParticleMaterialData } from './particles/render/particleModels';

/** World-authored unlit PBR effects use the same shader as particle models. */
export function isWorldParticleCard(material: THREE.Material): boolean {
  const data = getMorphic(material);
  return data?.shader === 'pbr.vfx' && flag(data, 'F_UNLIT');
}

export function worldCardData(material: THREE.Material): ParticleMaterialData {
  const data = getMorphic(material);
  const scalars = (values: Record<string, number | number[]> = {}) => Object.fromEntries(Object.entries(values)
    .map(([key, value]) => [key, typeof value === 'number' ? value : value[0] ?? 0]));
  const vectors: ParticleMaterialData['vectorParams'] = {};
  for (const [key, value] of Object.entries(data?.vectors ?? {})) vectors[key] = [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0];
  return { name: material.name, shader: data?.shader ?? '', intParams: scalars(data?.ints), floatParams: scalars(data?.floats),
    vectorParams: vectors, textureParams: data?.texture_slots ?? {}, intAttributes: {} };
}
