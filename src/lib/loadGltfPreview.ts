import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveMorphicTextures } from './source2NprMaterial';

type CreateImageBitmapFunction = Window['createImageBitmap'];

let disableDepth = 0;
let hadCreateImageBitmap = false;
let savedCreateImageBitmap: CreateImageBitmapFunction | undefined;

function defineCreateImageBitmap(value: CreateImageBitmapFunction | undefined): void {
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value,
  });
}

function disableImageBitmapLoader(): void {
  if (disableDepth === 0) {
    hadCreateImageBitmap = 'createImageBitmap' in globalThis;
    savedCreateImageBitmap = globalThis.createImageBitmap;
    defineCreateImageBitmap(undefined);
  }
  disableDepth += 1;
}

function restoreImageBitmapLoader(): void {
  if (disableDepth === 0) return;
  disableDepth -= 1;
  if (disableDepth > 0) return;

  if (hadCreateImageBitmap) {
    defineCreateImageBitmap(savedCreateImageBitmap);
  } else {
    delete (globalThis as { createImageBitmap?: CreateImageBitmapFunction }).createImageBitmap;
  }

  hadCreateImageBitmap = false;
  savedCreateImageBitmap = undefined;
}

export async function loadGltfPreview(url: string): Promise<GLTF> {
  disableImageBitmapLoader();
  try {
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().load(url, resolve, undefined, reject);
    });
    // Resolve morphic preview texture indices (the only part of the morphic
    // contract the stock loader does not surface) while gltf.parser is still live
    // and the ImageBitmap suppression is in effect. No-op when no material
    // carries preview-only textures.
    await resolveMorphicTextures(gltf);
    return gltf;
  } finally {
    restoreImageBitmapLoader();
  }
}

/** Parse an in-memory `.glb` (ArrayBuffer) instead of fetching a URL. Used by
 *  the Soul Container import preview, which loads the dropped/picked file's bytes
 *  directly (before any build). Shares the createImageBitmap guard. */
export async function parseGltfPreview(buffer: ArrayBuffer): Promise<GLTF> {
  disableImageBitmapLoader();
  try {
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(buffer, '', resolve, reject);
    });
    await resolveMorphicTextures(gltf);
    return gltf;
  } finally {
    restoreImageBitmapLoader();
  }
}
