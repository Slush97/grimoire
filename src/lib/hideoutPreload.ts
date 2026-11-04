import type { HideoutSceneInfo } from '../types/skinEditor';
import { hideoutSnapshotName } from './hideoutSnapshot';
import { decodeHideoutResource, type HideoutCubemap, type HideoutHdr, type HideoutResource, type HideoutResourceRequest } from './hideoutResources';

/** Everything the hideout scene reads before it builds the room. */
export interface HideoutLoad {
  info: Promise<HideoutSceneInfo>;
  bundle: Promise<ArrayBuffer>;
  reflection: Promise<HideoutCubemap | null>;
  /** Irradiance, then shadows, ungzipped. */
  probes: Promise<[ArrayBuffer, ArrayBuffer | null] | null>;
  lightmap: Promise<HideoutHdr | null>;
  /** The viewer's saved room frame (HideoutSnapshot), if it has one. */
  snapshot: Promise<ArrayBuffer | null>;
}

/** A preload nobody claims (the viewer closed or changed scene) is dropped. */
const UNCLAIMED_MS = 15000;
let pending: { hint: string | undefined; load: HideoutLoad; timer: ReturnType<typeof setTimeout> } | null = null;
/** The map post's fog volume, per scene key, for Source2MapPost to take once. */
let fogVolume: { key: string; bytes: Promise<ArrayBuffer | null> } | null = null;

async function read(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hideout resource could not be read: ${url}`);
  return response.arrayBuffer();
}

function decoder(): { decode: (kind: HideoutResourceRequest['kind'], url: string) => Promise<HideoutResource>; close: () => void } {
  type Waiting = { kind: HideoutResourceRequest['kind']; url: string; resolve: (resource: HideoutResource) => void; reject: (error: unknown) => void };
  const waiting = new Map<number, Waiting>();
  const local = async (kind: HideoutResourceRequest['kind'], url: string) => decodeHideoutResource({ kind, bytes: await read(url) });
  let worker: Worker | null = null;
  let next = 0;
  // A worker that cannot start decodes on the main thread instead. The bytes
  // it was sent are gone with it, so those files are read again.
  const fallBack = () => {
    worker?.terminate();
    worker = null;
    for (const { kind, url, resolve, reject } of waiting.values()) local(kind, url).then(resolve, reject);
    waiting.clear();
  };
  try {
    worker = new Worker(new URL('./hideoutResources.worker.ts', import.meta.url), { type: 'module', name: 'hideout-resources' });
    worker.onmessage = ({ data }: MessageEvent<{ id: number; resource?: HideoutResource; error?: string }>) => {
      const entry = waiting.get(data.id);
      if (!entry) return;
      waiting.delete(data.id);
      if (data.resource !== undefined) entry.resolve(data.resource);
      else entry.reject(new Error(data.error ?? 'Hideout resource decode failed.'));
    };
    worker.onerror = fallBack;
  } catch { worker = null; }
  return {
    decode: async (kind, url) => {
      const bytes = await read(url);
      if (!worker) return decodeHideoutResource({ kind, bytes });
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { kind, url, resolve, reject });
        worker?.postMessage({ id, request: { kind, bytes } }, [bytes]);
      });
    },
    close: () => worker?.terminate(),
  };
}

function startLoad(hint: string | undefined): HideoutLoad {
  if (import.meta.env.VITE_GRIMOIRE_VIEWER_BENCH === '1') Object.assign(window, { __benchHideoutLoadAt: performance.now() });
  const info = window.electronAPI.loadHideoutScene();
  const { decode, close } = decoder();
  const url = (key: string, file: string) => `grimoire-hero://s/${key}/${file}`;
  const bundle = info.then(async ({ key, bundle }) => {
    const response = await fetch(url(key, bundle.file));
    if (!response.ok) throw new Error('Hideout bundle could not be read.');
    return response.arrayBuffer();
  });
  // The hero's lighting first: the reflection and probes. The lightmap only
  // feeds room materials, which wait for the bundle anyway.
  const reflection = info.then(({ key, reflection }) => reflection.kind === 'cubemap'
    ? decode('cubemap', url(key, reflection.file)) as Promise<HideoutCubemap> : null);
  const probes = info.then(({ key, probes }) => probes.kind === 'atlas'
    ? Promise.all([decode('volume', url(key, probes.file)) as Promise<ArrayBuffer>,
      probes.shadows ? decode('volume', url(key, probes.shadows)) as Promise<ArrayBuffer> : null]) : null);
  // The fog is part of the visible frame's post, so it decodes with the hero's lighting.
  const fog = info.then(({ key, fog }) => fog ? decode('volume', url(key, fog.file)) as Promise<ArrayBuffer> : null);
  void info.then(({ key }) => {
    fogVolume = { key, bytes: fog };
    // Unclaimed (no map post mounted), it is dropped with the rest of the read.
    setTimeout(() => { if (fogVolume?.bytes === fog) fogVolume = null; }, UNCLAIMED_MS);
  }, () => {});
  const lightmap = info.then(async ({ key, lighting }) => {
    await probes.catch(() => {});
    return lighting.kind === 'baked' ? decode('hdr', url(key, lighting.file)) as Promise<HideoutHdr> : null;
  });
  // The snapshot route answers 204 when there is none.
  const snapshot = hint === undefined ? Promise.resolve(null) : info.then(async ({ key }) => {
    const response = await fetch(url(key, `snapshots/${hideoutSnapshotName(hint)}`));
    return response.status === 200 ? response.arrayBuffer() : null;
  }).catch(() => null);
  const load = { info, bundle, reflection, probes, lightmap, snapshot };
  // Failures surface where the scene awaits each part.
  for (const part of Object.values(load)) void part.catch(() => {});
  void fog.catch(() => {});
  void Promise.allSettled([reflection, probes, fog, lightmap]).then(close);
  return load;
}

/** The fog volume read with the scene `key`, ungzipped, or null when another
 *  scene was read last. Each read is taken once. */
export function takeHideoutFog(key: string): Promise<ArrayBuffer | null> | null {
  if (fogVolume?.key !== key) return null;
  const { bytes } = fogVolume;
  fogVolume = null;
  return bytes;
}

/** Starts reading the hideout as the viewer opens on it, while the canvas and
 *  hero are still loading, so the scene finds its lighting decoded. */
export function preloadHideout(snapshotHint?: string): void {
  if (pending) return;
  const timer = setTimeout(() => { pending = null; }, UNCLAIMED_MS);
  pending = { hint: snapshotHint, load: startLoad(snapshotHint), timer };
}

/** The preloaded read, or a new one. Each read is claimed once. */
export function claimHideoutLoad(snapshotHint?: string): HideoutLoad {
  const preloaded = pending;
  pending = null;
  if (preloaded) clearTimeout(preloaded.timer);
  return preloaded && preloaded.hint === snapshotHint ? preloaded.load : startLoad(snapshotHint);
}
