import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { parseSource2MapProbeFaces, source2CubemapNormalization, type Source2CubemapFace } from './source2Lightmap';

/** The hideout's lighting files, decoded to the arrays their textures take.
 *  The decode needs no DOM, so it runs in a worker (hideoutResources.worker.ts)
 *  and falls back to the main thread. The page fetches the bytes: its fetch
 *  is the one that knows the app's schemes (and the dev harness's stand-ins). */
export type HideoutResourceRequest = { kind: 'cubemap' | 'volume' | 'hdr'; bytes: ArrayBuffer };

export interface HideoutCubemap { faces: Source2CubemapFace[]; normalization: [number, number, number, number] }
export interface HideoutHdr { width: number; height: number; data: Float32Array }
export type HideoutResource = HideoutCubemap | ArrayBuffer | HideoutHdr;

export async function decodeHideoutResource({ kind, bytes }: HideoutResourceRequest): Promise<HideoutResource> {
  if (kind === 'cubemap') {
    const faces = parseSource2MapProbeFaces(bytes, HDRLoader);
    const fit = source2CubemapNormalization(faces);
    return { faces, normalization: [fit.x, fit.y, fit.z, fit.w] };
  }
  if (kind === 'volume') {
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 2));
    return header[0] === 0x1f && header[1] === 0x8b
      ? new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : bytes;
  }
  const data = new HDRLoader().setDataType(THREE.FloatType).parse(bytes);
  if (!(data.data instanceof Float32Array) || !data.width || !data.height) throw new Error('Expected floating point lightmap pixels.');
  return { width: data.width, height: data.height, data: data.data };
}

/** Buffers a worker hands back without copying. */
export function hideoutResourceTransfers(resource: HideoutResource): ArrayBuffer[] {
  if (resource instanceof ArrayBuffer) return [resource];
  if ('faces' in resource) return resource.faces.map(face => face.data.buffer as ArrayBuffer);
  return [resource.data.buffer as ArrayBuffer];
}
