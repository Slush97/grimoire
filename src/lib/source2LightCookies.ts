import * as THREE from 'three';
import type { HideoutLight, HideoutSceneInfo } from '../types/skinEditor';
import { SOURCE_TO_GLTF } from './hideoutTransform';
import type { Source2CookieAtlas } from './source2DynamicLights';

const COOKIE_SIZE = 512;
let decoded: { key: string; strip: Promise<{ canvas: OffscreenCanvas; layers: string[]; means: THREE.Vector3[] } | null> } | null = null;

/** Light cookies in this scene, the map lights' and then the particle lights', in atlas order. */
export function source2CookieLayers(info: Pick<HideoutSceneInfo, 'lights' | 'particles'>): string[] {
  return [...new Set([...info.lights.flatMap(light => light.distribution.kind !== 'sun' && light.cookie ? [light.cookie] : []),
    ...Object.values(info.particles.lightCookies ?? {})])];
}

async function decodeStrip(info: Pick<HideoutSceneInfo, 'key'>, layers: string[]) {
  const images = await Promise.all(layers.map(async file => {
    const response = await fetch(`grimoire-hero://s/${info.key}/${file}`);
    if (!response.ok) throw new Error('Hideout light cookie could not be read.');
    return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none' });
  }));
  const canvas = new OffscreenCanvas(COOKIE_SIZE * layers.length, COOKIE_SIZE);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Hideout light cookies could not be drawn.');
  images.forEach((image, layer) => { context.drawImage(image, layer * COOKIE_SIZE, 0, COOKIE_SIZE, COOKIE_SIZE); image.close(); });
  const means = layers.map((_, layer) => source2CookieMean(context.getImageData(layer * COOKIE_SIZE, 0, COOKIE_SIZE, COOKIE_SIZE).data));
  return { canvas, layers, means };
}

/**
 * The scene's light cookies side by side, decoded once per scene and shared by the room's
 * materials and the fog. Each caller owns (and disposes) the texture it gets. A cookie that
 * cannot be read leaves every light on its authored soft edge.
 */
export async function loadSource2CookieAtlas(info: Pick<HideoutSceneInfo, 'key' | 'lights' | 'particles'>): Promise<Source2CookieAtlas | null> {
  const layers = source2CookieLayers(info);
  if (!layers.length) return null;
  if (decoded?.key !== info.key) decoded = { key: info.key, strip: decodeStrip(info, layers).catch(() => null) };
  const strip = await decoded.strip;
  if (!strip) return null;
  const texture = new THREE.CanvasTexture(strip.canvas);
  // Row 0 is the image's top, as the game samples it.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return { texture, layers: strip.layers, size: COOKIE_SIZE, means: strip.means };
}

/** A cookie's mean linear color, from sRGB RGBA bytes. */
export function source2CookieMean(rgba: ArrayLike<number>): THREE.Vector3 {
  const table = Array.from({ length: 256 }, (_, i) => new THREE.Color().setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r);
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < rgba.length; i += 4) { r += table[rgba[i]]; g += table[rgba[i + 1]]; b += table[rgba[i + 2]]; }
  return new THREE.Vector3(r, g, b).multiplyScalar(4 / Math.max(rgba.length, 4));
}

/** Where a light can reach, as a box in the scene's glTF axes: its illumination box when the
 *  map records one, else the sphere of its range. */
export function source2LightReach(light: HideoutLight): THREE.Box3 {
  if (!light.bounds) {
    const center = new THREE.Vector3(...light.position).applyMatrix4(SOURCE_TO_GLTF);
    return new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3().setScalar(2 * light.range * SOURCE_TO_GLTF.getMaxScaleOnAxis()));
  }
  const toScene = SOURCE_TO_GLTF.clone().multiply(new THREE.Matrix4().fromArray(light.bounds));
  return new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)).applyMatrix4(toScene);
}
