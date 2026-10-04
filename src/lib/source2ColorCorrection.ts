import * as THREE from 'three';
import type { MorphicExtras } from './source2NprMaterial';

// MatrixColorCorrect2's scale/rotate/saturate/unscale construction reduces to
// squared, normalized Rec. 709 weights. Keep this distinct from display luma.
const REC709 = new THREE.Vector3(0.2126, 0.7152, 0.0722);
const SATURATION_WEIGHTS = REC709.clone().multiply(REC709).divideScalar(REC709.lengthSq());
export const SOURCE2_SATURATION_WEIGHTS = SATURATION_WEIGHTS.toArray();

/** Linear input and output, no clamp. The texture's reflectivity is already
 * linear and is not the midpoint of the display transfer function. */
export function applySource2ColorCorrection(
  color: THREE.Vector3, csb: THREE.Vector3, reflectivity: THREE.Vector3
): THREE.Vector3 {
  const result = color.clone().sub(reflectivity).multiplyScalar(csb.x).add(reflectivity).multiplyScalar(csb.z);
  const gray = result.dot(SATURATION_WEIGHTS);
  return result.multiplyScalar(csb.y).addScalar(gray * (1 - csb.y));
}

/** Equivalent of VRF MatrixColorTint3, with an authored sRGB tint decoded once. */
export function source2TintMatrix(tint: THREE.Color, mode: number): THREE.Matrix3 {
  if (mode !== 1) return new THREE.Matrix3().set(
    tint.r * (mode === 2 ? 2 : 1), 0, 0,
    0, tint.g * (mode === 2 ? 2 : 1), 0,
    0, 0, tint.b * (mode === 2 ? 2 : 1)
  );
  const peak = Math.max(tint.r, tint.g, tint.b);
  const saturation = peak === 0 ? 0 : (peak - Math.min(tint.r, tint.g, tint.b)) / peak;
  const xy = 1 - saturation;
  const z = 1 - saturation * saturation * 0.85;
  const w = SOURCE2_SATURATION_WEIGHTS;
  return new THREE.Matrix3().set(
    xy + (z - xy) * w[0], (z - xy) * w[1], (z - xy) * w[2],
    (z - xy) * w[0], xy + (z - xy) * w[1], (z - xy) * w[2],
    (z - xy) * w[0], (z - xy) * w[1], xy + (z - xy) * w[2]
  );
}

export interface Source2TintPlan {
  matrix: THREE.Matrix3;
  offset: THREE.Vector3;
  /** Only a proven morphic v2 exported factor may be removed from the GLTF base. */
  ownsExportedFactor: boolean;
  linearTint: THREE.Color;
}

/** vpkmerge v0.19.1 writes the raw sRGB g_vColorTint1 into a linear glTF factor.
 * Match both schema and value, so arbitrary GLBs, future schemas and independently
 * edited factors are untouched. A factor already decoded by a newer exporter is
 * accepted without decoding that factor again. Dynamic tint stays on its fallback.
 */
export function source2TintPlan(morphic: MorphicExtras, factor: THREE.Color): Source2TintPlan {
  const raw = morphic.vectors?.g_vColorTint1;
  const valid = morphic.schema_version === 2 && morphic.shader.toLowerCase() === 'pbr.vfx' &&
    !morphic.dynamic_params?.g_vColorTint1 && raw && raw.length >= 3 && raw.slice(0, 3).every(Number.isFinite);
  const linearTint = valid ? new THREE.Color().setRGB(raw[0], raw[1], raw[2]).convertSRGBToLinear() : new THREE.Color(1, 1, 1);
  const matches = (values: number[]) => Math.abs(factor.r - values[0]) < 1e-6 &&
    Math.abs(factor.g - values[1]) < 1e-6 && Math.abs(factor.b - values[2]) < 1e-6;
  const ownsExportedFactor = !!valid && (matches(raw) || matches(linearTint.toArray()));
  const modeValue = morphic.ints?.g_nTextureColorTintMode1;
  const mode = Array.isArray(modeValue) ? modeValue[0] : modeValue ?? 0;
  const matrix = ownsExportedFactor ? source2TintMatrix(linearTint, mode) : new THREE.Matrix3();
  const tint = new THREE.Vector3(linearTint.r, linearTint.g, linearTint.b);
  const offset = ownsExportedFactor && mode === 1 ? tint.clone().sub(tint.clone().applyMatrix3(matrix)) : new THREE.Vector3();
  return { matrix, offset, ownsExportedFactor, linearTint };
}

/** Decoded top-mip fallback only. It cannot reproduce a compiled VTEX header's
 * reflectivity exactly, but avoids an invented fixed gray pivot for legacy GLBs. */
export function decodedAlbedoAverage(texture: THREE.Texture | null): THREE.Vector3 | null {
  const image = texture?.image as { width: number; height: number; data?: ArrayLike<number> } | undefined;
  if (!image?.width || !image.height) return null;
  let pixels: ArrayLike<number> | undefined = image.data;
  if (!pixels) {
    if (typeof OffscreenCanvas === 'undefined') return null;
    try {
      // Bounded fallback for unusually large atlases. Downsampling is approximate.
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch { return null; }
  }
  const count = Math.floor(pixels.length / 4);
  if (!count) return null;
  const sum = new THREE.Vector3();
  const color = new THREE.Color();
  const floatData = pixels instanceof Float32Array || pixels instanceof Float64Array;
  const divisor = floatData ? 1 : 255;
  for (let i = 0; i < count; i++) {
    color.setRGB(pixels[i * 4] / divisor, pixels[i * 4 + 1] / divisor, pixels[i * 4 + 2] / divisor);
    if (texture?.colorSpace === THREE.SRGBColorSpace) color.convertSRGBToLinear();
    sum.x += color.r; sum.y += color.g; sum.z += color.b;
  }
  return sum.divideScalar(count);
}
