import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

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
    return await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().load(url, resolve, undefined, reject);
    });
  } finally {
    restoreImageBitmapLoader();
  }
}
