import type { HeroPoseInfo } from '../types/portrait';
import { parseFeModel, type ClothModel } from './feModel';
import { loadGltfPreview } from './loadGltfPreview';

async function loadClothSidecar(url: string): Promise<ClothModel | null> {
  try {
    const response = await fetch(url);
    return response.ok ? parseFeModel(await response.json()) : null;
  } catch {
    return null;
  }
}

export async function loadRiggedHeroPreview(info: HeroPoseInfo, physics: boolean) {
  const base = `grimoire-hero://m/${encodeURIComponent(info.key)}`;
  const version = info.mtimeMs ?? 0;
  // Resolve both before mounting the mixer: cloth calibration needs the bind
  // pose, and a fallback export's physics must follow its returned cache key.
  const [gltf, clothModel] = await Promise.all([
    loadGltfPreview(`${base}/model-rigged.glb?v=${version}`),
    physics ? loadClothSidecar(`${base}/cloth-rigged.json?v=${version}`) : null,
  ]);
  return { gltf, clothModel };
}
