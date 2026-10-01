import type { HeroPoseInfo } from '../types/portrait';
import { parseFeModel, type ClothModel } from './feModel';
import { loadGltfPreview } from './loadGltfPreview';
import type { ModelAttachment } from '../types/modelAttachment';

async function loadAttachments(url: string): Promise<ModelAttachment[]> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const raw: unknown = response.ok ? await response.json() : null;
    if (!Array.isArray(raw) || raw.length > 256) return [];
    return raw.filter((value): value is ModelAttachment => {
      if (!value || typeof value !== 'object') return false;
      const frame = value as ModelAttachment;
      return typeof frame.name === 'string' && typeof frame.bone === 'string'
        && Array.isArray(frame.position) && frame.position.length === 3 && frame.position.every(Number.isFinite)
        && Array.isArray(frame.rotation) && frame.rotation.length === 4 && frame.rotation.every(Number.isFinite)
        && Math.abs(frame.rotation.reduce((sum, n) => sum + n * n, 0) - 1) < 0.001;
    });
  } catch { return []; }
}

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
  const [gltf, clothModel, attachments] = await Promise.all([
    loadGltfPreview(`${base}/model-rigged.glb?v=${version}`),
    physics ? loadClothSidecar(`${base}/cloth-rigged.json?v=${version}`) : null,
    loadAttachments(`${base}/attachments.json?v=${version}`),
  ]);
  gltf.scene.userData.grimoireAttachments = attachments;
  return { gltf, clothModel };
}
