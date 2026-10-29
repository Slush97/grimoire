// Ported from ValveResourceFormat (MIT): ValveResourceFormat/Particles/Utils/Noise.cs.
//
// Particle noise primitives. The default is a value-noise lattice whose corners come from a
// packed-index integer hash, trilinearly interpolated with unsmoothed weights, returning [-1, 1].
// The hash is a MurmurHash3 mixing round followed by a finalizer. The gradient and cellular
// primitives share the corner packing with a shorter hash chain; the curl primitive interpolates a
// table-driven vector lattice instead.
//
// Integer math mirrors the C# unchecked int/uint arithmetic: Math.imul for wrapping multiplies,
// `>>` for int shifts, `>>>` for uint shifts and `>>> 0` for (uint) casts.

import {
  FLOAT_MAX,
  INT_MIN,
  Vector3,
  f32,
  lerp,
  lerpV,
  roundHalfEven,
  saturate,
  singleToUInt32Bits,
} from '../numerics';
import { CURL_VECTORS, PERM_X, PERM_Y, PERM_Z } from './noiseTables';

/** BitOperations.RotateLeft on a uint. */
function rotateLeft(value: number, offset: number): number {
  return ((value << offset) | (value >>> (32 - offset))) >>> 0;
}

/** Samples the noise lattice at a point, returning a value in [-1, 1]. */
export function value3D(position: Vector3): number;
export function value3D(x: number, y: number, z: number): number;
export function value3D(xOrPosition: number | Vector3, y = 0, z = 0): number {
  if (xOrPosition instanceof Vector3) {
    return value3D(xOrPosition.x, xOrPosition.y, xOrPosition.z);
  }

  const x = f32(xOrPosition);
  const [ix, fx] = cell(x);
  const [iy, fy] = cell(f32(y));
  const [iz, fz] = cell(f32(z));

  const c00 = lerp(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx);
  const c10 = lerp(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx);
  const c01 = lerp(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx);
  const c11 = lerp(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx);

  const c0 = lerp(c00, c10, fy);
  const c1 = lerp(c01, c11, fy);

  return f32(f32(lerp(c0, c1, fz) - 0.5) * 2);
}

/**
 * Samples a vector-valued lattice at a point, returning each component in [-1, 1]. Shares the
 * packed-corner indexing and unsmoothed trilinear weights of value3D, but draws all three
 * components from a single hash of each corner, so they are correlated.
 */
export function valueVector3(position: Vector3): Vector3 {
  const [ix, fx] = cell(position.x);
  const [iy, fy] = cell(position.y);
  const [iz, fz] = cell(position.z);

  const c00 = lerpV(hashVector(ix, iy, iz), hashVector(ix + 1, iy, iz), fx);
  const c10 = lerpV(hashVector(ix, iy + 1, iz), hashVector(ix + 1, iy + 1, iz), fx);
  const c01 = lerpV(hashVector(ix, iy, iz + 1), hashVector(ix + 1, iy, iz + 1), fx);
  const c11 = lerpV(hashVector(ix, iy + 1, iz + 1), hashVector(ix + 1, iy + 1, iz + 1), fx);

  const c0 = lerpV(c00, c10, fy);
  const c1 = lerpV(c01, c11, fy);

  return lerpV(c0, c1, fz);
}

/**
 * Splits a coordinate into its lattice cell and the fraction within it. The fraction is taken
 * from the float floor, so it stays in [0, 1) past the int range, where every cell index
 * becomes int.MinValue.
 */
function cell(x: number): [index: number, fraction: number] {
  const floor = Math.floor(x);
  const fraction = f32(x - floor);
  return [floor >= -2147483648 && floor < 2147483648 ? floor | 0 : INT_MIN, fraction];
}

/** The packed corner index `x + (y << 10) + (z << 20)`, wrapping as unchecked int math. */
function packCorner(x: number, y: number, z: number): number {
  return (x + (y << 10) + (z << 20)) | 0;
}

/**
 * Hashes one lattice corner to a vector with each component in [-1, 1], taken from three bytes
 * of a single mixed value.
 */
function hashVector(x: number, y: number, z: number): Vector3 {
  const index = packCorner(x, y, z);

  let k = Math.imul(index, 0xcc9e2d51) & 0x7fffffff;
  k = Math.imul(rotateLeft(k, 15), 0x1b873593) & 0x7fffffff;
  k = rotateLeft(k, 13) & 0x7fffffff;

  let mixed = Math.imul(k, 0x04b2ae35);
  mixed ^= mixed >> 16;

  const scale = f32(2 / 255);

  return new Vector3(
    f32(f32((mixed & 255) * scale) - 1),
    f32(f32(((mixed >> 8) & 255) * scale) - 1),
    f32(f32(((mixed >> 16) & 255) * scale) - 1),
  );
}

/**
 * Hashes one lattice corner to [0, 1]. The corner is packed by plain addition rather than
 * into disjoint bit fields, so the field aliases: hash(x + 1024, y, z) == hash(x, y + 1, z).
 */
function hash(x: number, y: number, z: number): number {
  const index = packCorner(x, y, z);

  let k = Math.imul(index, 0xcc9e2d51) & 0x7fffffff;
  k = Math.imul(rotateLeft(k, 15), 0x1b873593) & 0x7fffffff;

  const h = (Math.imul(rotateLeft(k, 13), 5) + 0xe6546b64) | 0;

  // Sign-extending shift: the unmasked bit 31 reaches bits that survive the mask
  const mixed = (h ^ (h >> 16)) & 0x7fffffff;
  const scaled = Math.imul(mixed, 0x04b2ae35);

  return f32(((scaled ^ (scaled >> 16)) & 0xffff) / 65535);
}

/**
 * Samples the simplex-named primitive, which is gradient noise with a quintic fade over the
 * same packed corner indexing as the value lattice, returning roughly [-0.87, 0.87]. Zero on
 * the lattice itself.
 */
export function simplex3D(position: Vector3): number;
export function simplex3D(x: number, y: number, z: number): number;
export function simplex3D(xOrPosition: number | Vector3, y = 0, z = 0): number {
  if (xOrPosition instanceof Vector3) {
    return simplex3D(xOrPosition.x, xOrPosition.y, xOrPosition.z);
  }

  const [ix, fx] = cell(f32(xOrPosition));
  const [iy, fy] = cell(f32(y));
  const [iz, fz] = cell(f32(z));

  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);

  const lower = gradientPlane(ix, iy, iz, fx, fy, fz, u, v, f32(1 - w));
  const upper = gradientPlane(ix, iy, iz + 1, fx, fy, f32(fz - 1), u, v, w);

  return f32(upper + lower);
}

function fade(t: number): number {
  return f32(f32(f32(f32(f32(6 * t) - 15) * t) + 10) * f32(f32(t * t) * t));
}

function gradientPlane(
  ix: number,
  iy: number,
  iz: number,
  fx: number,
  fy: number,
  dz: number,
  u: number,
  v: number,
  wz: number,
): number {
  const c0 = f32(gradientCorner(ix, iy, iz, fx, fy, dz) * f32(wz * f32(f32(1 - v) * f32(1 - u))));
  const c1 = f32(gradientCorner(ix + 1, iy, iz, f32(fx - 1), fy, dz) * f32(wz * f32(f32(1 - v) * u)));
  const c2 = f32(gradientCorner(ix, iy + 1, iz, fx, f32(fy - 1), dz) * f32(wz * f32(v * f32(1 - u))));
  const c3 = f32(gradientCorner(ix + 1, iy + 1, iz, f32(fx - 1), f32(fy - 1), dz) * f32(wz * f32(v * u)));

  return f32(f32(c2 + c3) + f32(c0 + c1));
}

function gradientCorner(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  const h = hashSeeded(packCorner(x, y, z), 0) & 15;

  let u = h < 8 ? dx : dy;
  let v = h < 4 ? dy : h === 12 || h === 14 ? dx : dz;

  u = (h & 1) !== 0 ? -u : u;
  v = (h & 2) !== 0 ? -v : v;

  return f32(u + v);
}

/**
 * Samples the cellular primitive: the squared distance to the nearest jittered feature point
 * of worleyOffset3D, remapped to [-1, 1].
 */
export function worley3D(position: Vector3, jitter: number, offset: number): number {
  return f32(f32(saturate(worleyOffset3D(position, jitter, offset).lengthSquared()) * 2) - 1);
}

/**
 * Samples the cellular primitive's vector variant: the offset from the sample point to the
 * nearest jittered feature point in the surrounding 3x3x3 cells, in lattice units. Ties keep
 * the earlier cell. The offset seeds the feature hash by its raw bit pattern.
 */
export function worleyOffset3D(position: Vector3, jitter: number, offset: number): Vector3 {
  const seed = singleToUInt32Bits(offset);

  const [ix, fx] = cell(position.x);
  const [iy, fy] = cell(position.y);
  const [iz, fz] = cell(position.z);

  const featureScale = f32(jitter / 255);

  let nearest = FLOAT_MAX;
  let best = Vector3.zero;

  for (let i = -1; i <= 1; i++) {
    const dx = f32(i - fx);

    for (let j = -1; j <= 1; j++) {
      const dy = f32(j - fy);

      for (let k = -1; k <= 1; k++) {
        const dz = f32(k - fz);

        const h = hashSeeded(packCorner(ix + i, iy + j, iz + k), seed);

        const feature = new Vector3(h & 255, (h >>> 8) & 255, (h >>> 16) & 255)
          .scale(featureScale)
          .add(new Vector3(dx, dy, dz));
        const distance = feature.lengthSquared();

        if (distance < nearest) {
          nearest = distance;
          best = feature;
        }
      }
    }
  }

  return best;
}

/**
 * The feature point jitter derived from the authored noise offset, in [0.75, 0.815]. The
 * negative half of the remainder clamps to the 0.75 floor.
 */
export function worleyJitter(noiseOffset: number): number {
  const remainder = ieeeRemainder(f32(f32(noiseOffset) + f32(1.7234)), f32(0.648326));

  return f32(f32(saturate(remainder) * f32(0.2)) + 0.75);
}

/**
 * MathF.IEEERemainder as .NET implements it: the fmod result or the one a divisor away from it,
 * whichever is smaller, ties going to the even quotient.
 */
function ieeeRemainder(x: number, y: number): number {
  if (Number.isNaN(x)) {
    return x;
  }
  if (Number.isNaN(y)) {
    return y;
  }

  const regularMod = x % y;

  if (Number.isNaN(regularMod)) {
    return Number.NaN;
  }
  if (regularMod === 0 && (x < 0 || Object.is(x, -0))) {
    return -0;
  }

  const alternativeResult = f32(regularMod - Math.abs(y) * Math.sign(x));

  if (Math.abs(alternativeResult) === Math.abs(regularMod)) {
    const divisionResult = f32(x / y);
    const roundedResult = roundHalfEven(divisionResult);

    return Math.abs(roundedResult) > Math.abs(divisionResult) ? alternativeResult : regularMod;
  }

  return Math.abs(alternativeResult) < Math.abs(regularMod) ? alternativeResult : regularMod;
}

/**
 * Samples the curl primitive: the curl combination of three decorrelated samples of a
 * table-driven vector lattice. Scalar noise inputs read only the X component.
 */
export function curl3D(position: Vector3): Vector3 {
  const first = curlSample(position);
  const offsetPosition = position.add(new Vector3(43.256, -67.89, 1338.2));
  const second = curlSample(offsetPosition);
  const third = curlSample(offsetPosition.add(new Vector3(-129.856, -967.23, 2338.98)));

  return new Vector3(third.y - second.z, first.z - third.x, second.x - first.y);
}

/**
 * The vector lattice under the curl primitive: 8.8 fixed-point coordinates taken from the
 * float bits after a +32768 bias (so the lattice repeats every 256 units and aliases outside
 * the biased-positive range), three chained permutations, and unfaded trilinear blending.
 */
function curlSample(position: Vector3): Vector3 {
  const bx = singleToUInt32Bits(f32(position.x + 32768)) & 0xffff;
  const by = singleToUInt32Bits(f32(position.y + 32768)) & 0xffff;
  const bz = singleToUInt32Bits(f32(position.z + 32768)) & 0xffff;

  const ix = bx >> 8;
  const iy = by >> 8;
  const iz = bz >> 8;

  const fx = f32((bx & 0xff) * f32(1 / 256));
  const fy = f32((by & 0xff) * f32(1 / 256));
  const fz = f32((bz & 0xff) * f32(1 / 256));

  const rowX0 = (PERM_X[ix] + iy) & 0xff;
  const rowX1 = (PERM_X[(ix + 1) & 0xff] + iy) & 0xff;

  const cell00 = (PERM_Y[rowX0] + iz) & 0xff;
  const cell01 = (PERM_Y[(rowX0 + 1) & 0xff] + iz) & 0xff;
  const cell10 = (PERM_Y[rowX1] + iz) & 0xff;
  const cell11 = (PERM_Y[(rowX1 + 1) & 0xff] + iz) & 0xff;

  const x0 = lerpV(curlVector(cell00), curlVector(cell10), fx);
  const x1 = lerpV(curlVector(cell01), curlVector(cell11), fx);
  const x2 = lerpV(curlVector((cell00 + 1) & 0xff), curlVector((cell10 + 1) & 0xff), fx);
  const x3 = lerpV(curlVector((cell01 + 1) & 0xff), curlVector((cell11 + 1) & 0xff), fx);

  const y0 = lerpV(x0, x1, fy);
  const y1 = lerpV(x2, x3, fy);

  return lerpV(y0, y1, fz);
}

function curlVector(cellIndex: number): Vector3 {
  const index = PERM_Z[cellIndex] * 3;

  return new Vector3(CURL_VECTORS[index], CURL_VECTORS[index + 1], CURL_VECTORS[index + 2]);
}

/**
 * Hashes one lattice corner with a seed folded in mid-chain, as the gradient and cellular
 * primitives do. Unlike hash there is no second mixing round and the mask precedes the final
 * multiply. The rotates come from sign-extending shifts, so a seed sign bit floods the rotated
 * lanes. Returns a uint.
 */
function hashSeeded(index: number, seed: number): number {
  let k = Math.imul(index, 0xcc9e2d51) & 0x7fffffff;
  k = (Math.imul(rotateLeft(k, 15), 0x1b873593) & 0x7fffffff) ^ seed;
  k = ((k >> 19) | (k << 13)) & 0x7fffffff;

  const h = Math.imul(k, 0x04b2ae35);

  return (h ^ (h >> 16)) >>> 0;
}
