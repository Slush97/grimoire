import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveMorphicTextures } from './source2NprMaterial';

export interface GltfPreviewOptions {
  /** Decode embedded images with createImageBitmap, off the main thread, instead
   *  of <img> elements, which decode synchronously during the first render (a
   *  ~1 s freeze on a full-size hero GLB). The decoded bitmaps stay pinned in
   *  renderer memory until disposeTexture closes them, while Chromium can drop
   *  an <img>'s pixels, so this suits one model at a time (the hero viewer), not
   *  the soul-container grid. */
  imageBitmaps?: boolean;
}

function previewLoader({ imageBitmaps = false }: GltfPreviewOptions): GLTFLoader {
  const loader = new GLTFLoader();
  if (!imageBitmaps) {
    // Swap this parser's texture loader rather than hiding createImageBitmap
    // globally, so a concurrent imageBitmaps load is unaffected.
    loader.register((parser) => {
      parser.textureLoader = new THREE.TextureLoader(parser.options.manager)
        .setCrossOrigin(parser.options.crossOrigin)
        .setRequestHeader(parser.options.requestHeader);
      return { name: 'grimoire_img_textures' };
    });
  }
  return loader;
}

/** Fetch a self-contained `.glb` and parse it. One native `arrayBuffer()` read
 *  instead of GLTFLoader.load, whose FileLoader re-streams every body chunk
 *  through JS to report progress. */
export async function loadGltfPreview(
  url: string,
  options: GltfPreviewOptions = {}
): Promise<GLTF> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GLB request failed (${response.status}): ${url}`);
  return parseGltfPreview(await response.arrayBuffer(), options);
}

/** Parse an in-memory `.glb` (ArrayBuffer). Also used directly by the Soul
 *  Container import preview, which loads the dropped/picked file's bytes before
 *  any build. Morphic preview texture indices (the only part of the morphic
 *  contract the stock loader does not surface) resolve while gltf.parser is
 *  still live; no-op when no material carries them. */
export async function parseGltfPreview(
  buffer: ArrayBuffer,
  options: GltfPreviewOptions = {}
): Promise<GLTF> {
  const gltf = await previewLoader(options).parseAsync(buffer, '');
  await resolveMorphicTextures(gltf);
  return gltf;
}

/** Every texture a material holds directly (map, normalMap, sheenColorMap, ...). */
export function materialTextures(material: THREE.Material): THREE.Texture[] {
  return Object.values(material).filter(
    (value): value is THREE.Texture => (value as THREE.Texture | null)?.isTexture === true
  );
}

/** Dispose a texture and close its ImageBitmap, if it has one (three.js never
 *  does). Clones share the bitmap, so only call this when freeing the whole scene
 *  the texture came from. */
export function disposeTexture(texture: THREE.Texture): void {
  texture.dispose();
  const image: unknown = texture.image;
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}
