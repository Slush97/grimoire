import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { disposeTexture, materialTextures } from '../../lib/loadGltfPreview';

/**
 * Shared helpers for the Locker's Global soul-container previews.
 *
 * The grid renders every card's model through a SINGLE shared WebGL context
 * (see SoulContainerCanvas), so the per-card pieces here are deliberately
 * renderer-agnostic: a tile just produces a normalized THREE group and the
 * shared canvas scissor-renders it into that card's on-screen rect. This is
 * what keeps a 40-card grid from blowing past the browser's ~16 live-context
 * cap (which silently drops the oldest contexts, leaving cards blank white).
 */

export const SOUL_MODEL_SCHEME = 'grimoire-soul';

/** Normalized size (largest dimension) the model is scaled to fit the card. */
const TARGET_SIZE = 1.7;

export function meshUrlFor(key: string, mtimeMs: number | null): string {
  // The key is a mod metaKey (overflow mods carry a '/', which a standard
  // scheme forbids in the host), so carry it as a single encoded path segment
  // under a fixed `m` host.
  return `${SOUL_MODEL_SCHEME}://m/${encodeURIComponent(key)}/model.glb?v=${mtimeMs ?? 0}`;
}

/**
 * The grid and the import previews light a model directly, with no environment to reflect, and a
 * metal surface only shows what it reflects: the albedo alpha vpkmerge reads as metalness would draw
 * most props near black.
 */
export function zeroMetalness(scene: THREE.Object3D): void {
  scene.traverse((obj) => {
    const { material } = obj as THREE.Mesh;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (entry instanceof THREE.MeshStandardMaterial) entry.metalness = 0;
    }
  });
}

/**
 * Wrap a loaded GLB scene in a group normalized to a unit size and centered on
 * the origin, so tall and wide props both fit the small card frame. The shared
 * canvas spins the returned group's `rotation.y`; the inner group recenters.
 */
export function buildNormalizedRoot(scene: THREE.Object3D): THREE.Group {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const scale = maxDim > 0 ? TARGET_SIZE / maxDim : 1;

  const centered = new THREE.Group();
  centered.position.set(-center.x, -center.y, -center.z);
  centered.add(scene);

  const root = new THREE.Group();
  root.scale.setScalar(scale);
  root.add(centered);
  return root;
}

/** Free a loaded group's GPU resources (geometry, materials, textures). */
export function disposeScene(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!m) continue;
      materialTextures(m).forEach(disposeTexture);
      m.dispose();
    }
  });
}

export interface PreparedPropLease {
  root: THREE.Object3D;
  release: () => void;
}

interface PreparedPropEntry {
  pending: Promise<THREE.Object3D>;
  template?: THREE.Object3D;
  users: number;
  bytes: number;
  used: number;
  stale: boolean;
}

/** Estimate shared geometry and decoded texture memory once per template. */
function preparedPropBytes(root: THREE.Object3D): number {
  const buffers = new Set<ArrayBufferView>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const attribute of [...Object.values(mesh.geometry.attributes), mesh.geometry.index]) {
      if (!attribute) continue;
      const array = 'data' in attribute ? attribute.data.array : attribute.array;
      buffers.add(array);
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const texture of materialTextures(material)) textures.add(texture);
    }
  });
  let bytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | undefined;
    bytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 4 / 3;
  }
  return bytes;
}

/** Shared resources are cache-owned; each card gets its own transform and skeleton. */
export class PreparedPropCache {
  private entries = new Map<string, PreparedPropEntry>();
  private clock = 0;
  private maxIdleEntries: number;
  private maxIdleBytes: number;
  constructor(maxIdleEntries = 4, maxIdleBytes = 320 * 1024 * 1024) {
    this.maxIdleEntries = maxIdleEntries;
    this.maxIdleBytes = maxIdleBytes;
  }

  async acquire(key: string, load: () => Promise<THREE.Object3D>): Promise<PreparedPropLease> {
    let entry = this.entries.get(key);
    if (!entry) {
      const pending = Promise.resolve().then(load);
      const created: PreparedPropEntry = { pending, users: 0, bytes: 0, used: 0, stale: false };
      created.pending = pending.then(template => {
        created.template = template;
        created.bytes = preparedPropBytes(template);
        return template;
      });
      entry = created;
      this.entries.set(key, entry);
    }
    const owned = entry;
    owned.users++;
    owned.used = ++this.clock;
    const release = () => {
      owned.users--;
      owned.used = ++this.clock;
      if (owned.stale && owned.users === 0) this.remove(key, owned);
      this.evict();
    };
    try {
      const template = await owned.pending;
      const root = cloneSkeleton(template);
      let released = false;
      return { root, release: () => {
        if (released) return;
        released = true;
        const skeletons = new Set<THREE.Skeleton>();
        root.traverse(object => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) skeletons.add((object as THREE.SkinnedMesh).skeleton); });
        for (const skeleton of skeletons) skeleton.dispose();
        release();
      } };
    } catch (error) {
      owned.stale = true;
      if (this.entries.get(key) === owned) this.entries.delete(key);
      release();
      throw error;
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) {
      entry.stale = true;
      if (entry.users === 0) this.remove(key, entry);
    }
    this.entries.clear();
  }

  private remove(key: string, entry: PreparedPropEntry): void {
    if (this.entries.get(key) === entry) this.entries.delete(key);
    if (entry.template) { disposeScene(entry.template); entry.template = undefined; }
  }

  private evict(): void {
    const idle = [...this.entries].filter(([, entry]) => entry.users === 0 && entry.template)
      .sort(([, a], [, b]) => a.used - b.used);
    let bytes = idle.reduce((total, [, entry]) => total + entry.bytes, 0);
    while (idle.length > this.maxIdleEntries || bytes > this.maxIdleBytes) {
      const [key, entry] = idle.shift()!;
      bytes -= entry.bytes;
      this.remove(key, entry);
    }
  }
}

export const preparedPropCache = new PreparedPropCache();

// This subscription outlives Locker so Settings can clear idle prepared models.
if (typeof window !== 'undefined') {
  window.electronAPI?.onPreviewCacheCleared?.(() => preparedPropCache.clear());
}

const SAVED_YAW_KEY = 'lockerPropPreviewYaw';

export function normalizePropYaw(yaw: number): number {
  return ((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

export function readPropYaw(key: string): number {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_YAW_KEY) ?? '{}')[key];
    return typeof value === 'number' && Number.isFinite(value) ? normalizePropYaw(value) : 0;
  } catch { return 0; }
}

export function savePropYaw(key: string, yaw: number): void {
  let stored: Record<string, number> = {};
  try {
    const value: unknown = JSON.parse(localStorage.getItem(SAVED_YAW_KEY) ?? '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) stored = value as Record<string, number>;
  } catch { /* Replace an unreadable preference map. */ }
  localStorage.setItem(SAVED_YAW_KEY, JSON.stringify({ ...stored, [key]: normalizePropYaw(yaw) }));
}

export function thumbnailUrlFor(key: string, mtimeMs: number): string {
  return SOUL_MODEL_SCHEME + '://m/' + encodeURIComponent(key) + '/preview.png?v=' + mtimeMs;
}

// Visible missing thumbnails share one export/capture job at a time. Hover
// loads can go first through the same deduplicated prepared-model cache.
let thumbnailQueue: Promise<unknown> = Promise.resolve();
export function queuePropThumbnail<T>(job: () => Promise<T>): Promise<T> {
  const next = thumbnailQueue.then(job, job);
  thumbnailQueue = next.catch(() => {});
  return next;
}

/** A derived-cache write must never discard an already captured model image. */
export async function propThumbnailSource(
  pngDataUrl: string,
  persist: () => Promise<{ mtimeMs: number | null }>,
  urlFor: (mtimeMs: number) => string,
): Promise<string> {
  try {
    const info = await persist();
    if (info.mtimeMs !== null) return urlFor(info.mtimeMs);
  } catch (error) {
    console.warn('Could not persist model preview; retaining the captured image for this session.', error);
  }
  return pngDataUrl;
}
