// Single-precision math for the particle runtime: the parts of System.Numerics and of
// ValveResourceFormat's MathUtils (ValveResourceFormat/Utils/MathUtils.cs, MIT) that the
// simulation uses.
//
// C# float arithmetic rounds every operation to single precision. Each helper here does the
// same through Math.fround, which gives the exact single-precision result for +, -, *, / and
// sqrt of single-precision inputs, so a port that rounds where the C# does reproduces it.

export const f32 = Math.fround;

export const FLOAT_MAX = 3.4028234663852886e38;
export const FLOAT_MIN = -FLOAT_MAX;
export const INT_MIN = -2147483648;
export const INT_MAX = 2147483647;
export const TAU = f32(Math.PI * 2);
export const PI = f32(Math.PI);

/** C# `(int)value` for a float: truncates, saturating out-of-range values and mapping NaN to 0. */
export function toInt(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value >= 2147483648) {
    return INT_MAX;
  }
  if (value <= -2147483649) {
    return INT_MIN;
  }
  return Math.trunc(value) | 0;
}

/** C# `unchecked(a + b)` on ints. */
export function addInt(a: number, b: number): number {
  return (a + b) | 0;
}

/** MathF.Round, which rounds halves to even. */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) {
    return floor;
  }
  if (diff > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}

/** MathF.Max: NaN in either argument gives NaN. */
export function maxF(a: number, b: number): number {
  return Math.max(a, b);
}

/** MathF.Min: NaN in either argument gives NaN. */
export function minF(a: number, b: number): number {
  return Math.min(a, b);
}

/** Math.Clamp for floats. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// MathUtils

export function remap(x: number, inputMin: number, inputMax: number): number {
  if (inputMin === inputMax) {
    return inputMax;
  }
  return f32(f32(x - inputMin) / f32(inputMax - inputMin));
}

export function saturate(x: number): number {
  return clamp(x, 0, 1);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = saturate(f32(f32(x - edge0) / f32(edge1 - edge0)));
  return f32(f32(t * t) * f32(3 - f32(2 * t)));
}

/** MathUtils.Lerp: `((to - from) * amount) + from`. */
export function lerp(from: number, to: number, amount: number): number {
  return f32(f32(f32(to - from) * amount) + from);
}

/** MathUtils.Clamp: bounds in either order. */
export function clampEitherOrder(value: number, min: number, max: number): number {
  if (min > max) {
    return Math.min(Math.max(value, max), min);
  }
  return Math.min(Math.max(value, min), max);
}

export function fract(x: number): number {
  return f32(x - Math.floor(x));
}

export function alignUp(value: number, alignment: number): number {
  return (value + alignment - 1) & ~(alignment - 1);
}

export function radicalInverse(index: number, radix: number): number {
  const inverseRadix = f32(1 / radix);
  let digitScale = inverseRadix;
  let result = 0;

  while (index > 0) {
    result = f32(result + f32((index % radix) * digitScale));
    index = Math.trunc(index / radix);
    digitScale = f32(digitScale * inverseRadix);
  }

  return result;
}

/** float.DegreesToRadians: `(degrees * Pi) / 180`. */
export function degreesToRadians(degrees: number): number {
  return f32(f32(degrees * PI) / 180);
}

/** float.RadiansToDegrees: `(radians * 180) / Pi`. */
export function radiansToDegrees(radians: number): number {
  return f32(f32(radians * 180) / PI);
}

const doubleView = new DataView(new ArrayBuffer(8));

/** The double one step from `x` toward the sign of `direction`. */
function nudgeDouble(x: number, direction: number): number {
  if (x === 0) {
    return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  }

  doubleView.setFloat64(0, x);
  const bits = doubleView.getBigInt64(0);
  doubleView.setBigInt64(0, (x > 0) === (direction > 0) ? bits + 1n : bits - 1n);
  return doubleView.getFloat64(0);
}

/**
 * MathF.FusedMultiplyAdd, rounded once. The product of two floats is exact in double; the sum is
 * split into a double and its exact remainder, and the remainder breaks a tie the double rounding
 * would otherwise settle the wrong way.
 */
export function fmaF(a: number, b: number, c: number): number {
  const product = a * b;
  const sum = product + c;
  const back = sum - product;
  const remainder = product - (sum - back) + (c - back);

  if (remainder === 0 || !Number.isFinite(sum)) {
    return f32(sum);
  }

  return f32(nudgeDouble(sum, remainder));
}

/** float.Lerp and TensorPrimitives.Lerp, which .NET evaluates fused: `FMA(x, 1 - amount, y * amount)`. */
export function floatLerp(x: number, y: number, amount: number): number {
  return fmaF(x, f32(1 - amount), f32(y * amount));
}

/** Reinterprets a float's bits as an int, as BitConverter.SingleToInt32Bits does. */
const bitsView = new DataView(new ArrayBuffer(4));

export function singleToInt32Bits(value: number): number {
  bitsView.setFloat32(0, value, true);
  return bitsView.getInt32(0, true);
}

export function int32BitsToSingle(value: number): number {
  bitsView.setInt32(0, value, true);
  return bitsView.getFloat32(0, true);
}

export function singleToUInt32Bits(value: number): number {
  bitsView.setFloat32(0, value, true);
  return bitsView.getUint32(0, true);
}

// Vector3

/** An immutable System.Numerics.Vector3: every component is a single-precision value. */
export class Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;

  constructor(x: number, y: number, z: number) {
    this.x = f32(x);
    this.y = f32(y);
    this.z = f32(z);
  }

  static readonly zero = new Vector3(0, 0, 0);
  static readonly one = new Vector3(1, 1, 1);
  static readonly unitX = new Vector3(1, 0, 0);
  static readonly unitY = new Vector3(0, 1, 0);
  static readonly unitZ = new Vector3(0, 0, 1);

  static splat(value: number): Vector3 {
    return new Vector3(value, value, value);
  }

  equals(other: Vector3): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  withX(x: number): Vector3 {
    return new Vector3(x, this.y, this.z);
  }

  withY(y: number): Vector3 {
    return new Vector3(this.x, y, this.z);
  }

  withZ(z: number): Vector3 {
    return new Vector3(this.x, this.y, z);
  }

  /** Vector3.GetComponent as ParticleFieldExtensions clamps it: 0, 1 or 2. */
  component(index: number): number {
    const clamped = clamp(index, 0, 2);
    return clamped === 0 ? this.x : clamped === 1 ? this.y : this.z;
  }

  add(other: Vector3): Vector3 {
    return new Vector3(this.x + other.x, this.y + other.y, this.z + other.z);
  }

  sub(other: Vector3): Vector3 {
    return new Vector3(this.x - other.x, this.y - other.y, this.z - other.z);
  }

  mul(other: Vector3): Vector3 {
    return new Vector3(this.x * other.x, this.y * other.y, this.z * other.z);
  }

  scale(value: number): Vector3 {
    return new Vector3(this.x * value, this.y * value, this.z * value);
  }

  div(value: number): Vector3 {
    return new Vector3(this.x / value, this.y / value, this.z / value);
  }

  negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  dot(other: Vector3): number {
    return dot(this, other);
  }

  lengthSquared(): number {
    return dot(this, this);
  }

  length(): number {
    return f32(Math.sqrt(this.lengthSquared()));
  }
}

export function dot(a: Vector3, b: Vector3): number {
  return f32(f32(f32(a.x * b.x) + f32(a.y * b.y)) + f32(a.z * b.z));
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(
    f32(a.y * b.z) - f32(a.z * b.y),
    f32(a.z * b.x) - f32(a.x * b.z),
    f32(a.x * b.y) - f32(a.y * b.x),
  );
}

export function distance(a: Vector3, b: Vector3): number {
  return a.sub(b).length();
}

export function distanceSquared(a: Vector3, b: Vector3): number {
  return a.sub(b).lengthSquared();
}

export function normalize(v: Vector3): Vector3 {
  return v.div(v.length());
}

export function minV(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
}

export function maxV(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
}

export function absV(v: Vector3): Vector3 {
  return new Vector3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
}

/** MathUtils.Lerp for vectors with one amount: `((to - from) * amount) + from`. */
export function lerpV(from: Vector3, to: Vector3, amount: number): Vector3 {
  return to.sub(from).scale(amount).add(from);
}

/** MathUtils.Lerp for vectors with an amount per component. */
export function lerpVV(from: Vector3, to: Vector3, amount: Vector3): Vector3 {
  return to.sub(from).mul(amount).add(from);
}

/** MathUtils.SafeNormalize: zero for a vector with no length. */
export function safeNormalize(value: Vector3): Vector3 {
  const lengthSquared = value.lengthSquared();
  return lengthSquared === 0 ? Vector3.zero : value.div(f32(Math.sqrt(lengthSquared)));
}

// Matrix4x4, row-vector convention as System.Numerics.

export class Matrix4x4 {
  readonly m: Float32Array;

  constructor(values?: ArrayLike<number>) {
    this.m = new Float32Array(16);
    if (values) {
      this.m.set(values);
    } else {
      this.m[0] = this.m[5] = this.m[10] = this.m[15] = 1;
    }
  }

  static identity(): Matrix4x4 {
    return new Matrix4x4();
  }

  /** The rotation with `x`, `y` and `z` as its rows (MathUtils.CreateBasis). */
  static createBasis(x: Vector3, y: Vector3, z: Vector3): Matrix4x4 {
    return new Matrix4x4([x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, 0, 0, 0, 1]);
  }

  static fromQuaternion(q: Quaternion): Matrix4x4 {
    const xx = f32(q.x * q.x);
    const yy = f32(q.y * q.y);
    const zz = f32(q.z * q.z);
    const xy = f32(q.x * q.y);
    const wz = f32(q.z * q.w);
    const xz = f32(q.z * q.x);
    const wy = f32(q.y * q.w);
    const yz = f32(q.y * q.z);
    const wx = f32(q.x * q.w);

    return new Matrix4x4([
      1 - f32(2 * f32(yy + zz)), f32(2 * f32(xy + wz)), f32(2 * f32(xz - wy)), 0,
      f32(2 * f32(xy - wz)), 1 - f32(2 * f32(zz + xx)), f32(2 * f32(yz + wx)), 0,
      f32(2 * f32(xz + wy)), f32(2 * f32(yz - wx)), 1 - f32(2 * f32(yy + xx)), 0,
      0, 0, 0, 1,
    ]);
  }

  get translation(): Vector3 {
    return new Vector3(this.m[12], this.m[13], this.m[14]);
  }

  withTranslation(translation: Vector3): Matrix4x4 {
    const result = new Matrix4x4(this.m);
    result.m[12] = translation.x;
    result.m[13] = translation.y;
    result.m[14] = translation.z;
    return result;
  }

  /** Matrix4x4 multiplication as .NET 10 evaluates it: each row a fused multiply-add chain over the other's rows. */
  multiply(other: Matrix4x4): Matrix4x4 {
    const a = this.m;
    const b = other.m;
    const result = new Float32Array(16);

    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        let sum = f32(a[row * 4] * b[column]);

        for (let k = 1; k < 4; k++) {
          sum = fmaF(a[row * 4 + k], b[k * 4 + column], sum);
        }

        result[row * 4 + column] = sum;
      }
    }

    return new Matrix4x4(result);
  }

  /**
   * Matrix4x4.Invert, or null when the matrix is singular. .NET inverts with its SSE path on x86
   * (the DirectXMath cofactor expansion, with fused multiply-adds), whose rounding differs from the
   * scalar fallback, so that path is the one ported.
   */
  invert(): Matrix4x4 | null {
    const m = this.m;
    let row1: Lanes = [m[0], m[1], m[2], m[3]];
    let row2: Lanes = [m[4], m[5], m[6], m[7]];
    let row3: Lanes = [m[8], m[9], m[10], m[11]];
    let row4: Lanes = [m[12], m[13], m[14], m[15]];

    // Transpose the matrix
    const t1 = shuffle(row1, row2, 0x44);
    const t3 = shuffle(row1, row2, 0xee);
    const t2 = shuffle(row3, row4, 0x44);
    const t4 = shuffle(row3, row4, 0xee);

    row1 = shuffle(t1, t2, 0x88);
    row2 = shuffle(t1, t2, 0xdd);
    row3 = shuffle(t3, t4, 0x88);
    row4 = shuffle(t3, t4, 0xdd);

    let v00 = permute(row3, 0x50);
    let v10 = permute(row4, 0xee);
    let v01 = permute(row1, 0x50);
    let v11 = permute(row2, 0xee);
    let v02 = shuffle(row3, row1, 0x88);
    let v12 = shuffle(row4, row2, 0xdd);

    let d0 = mul(v00, v10);
    let d1 = mul(v01, v11);
    let d2 = mul(v02, v12);

    v00 = permute(row3, 0xee);
    v10 = permute(row4, 0x50);
    v01 = permute(row1, 0xee);
    v11 = permute(row2, 0x50);
    v02 = shuffle(row3, row1, 0xdd);
    v12 = shuffle(row4, row2, 0x88);

    d0 = fusedSubtract(d0, v00, v10);
    d1 = fusedSubtract(d1, v01, v11);
    d2 = fusedSubtract(d2, v02, v12);

    v11 = shuffle(d0, d2, 0x5d);
    v00 = permute(row2, 0x49);
    v10 = shuffle(v11, d0, 0x32);
    v01 = permute(row1, 0x12);
    v11 = shuffle(v11, d0, 0x99);

    let v13 = shuffle(d1, d2, 0xfd);
    v02 = permute(row4, 0x49);
    v12 = shuffle(v13, d1, 0x32);
    let v03 = permute(row3, 0x12);
    v13 = shuffle(v13, d1, 0x99);

    let c0 = mul(v00, v10);
    let c2 = mul(v01, v11);
    let c4 = mul(v02, v12);
    let c6 = mul(v03, v13);

    v11 = shuffle(d0, d2, 0x04);
    v00 = permute(row2, 0x9e);
    v10 = shuffle(d0, v11, 0x93);
    v01 = permute(row1, 0x7b);
    v11 = shuffle(d0, v11, 0x26);

    v13 = shuffle(d1, d2, 0xa4);
    v02 = permute(row4, 0x9e);
    v12 = shuffle(d1, v13, 0x93);
    v03 = permute(row3, 0x7b);
    v13 = shuffle(d1, v13, 0x26);

    c0 = fusedSubtract(c0, v00, v10);
    c2 = fusedSubtract(c2, v01, v11);
    c4 = fusedSubtract(c4, v02, v12);
    c6 = fusedSubtract(c6, v03, v13);

    v00 = permute(row2, 0x33);
    v10 = permute(shuffle(d0, d2, 0x4a), 0x2c);
    v01 = permute(row1, 0x8d);
    v11 = permute(shuffle(d0, d2, 0x4c), 0x93);
    v02 = permute(row4, 0x33);
    v12 = permute(shuffle(d1, d2, 0xea), 0x2c);
    v03 = permute(row3, 0x8d);
    v13 = permute(shuffle(d1, d2, 0xec), 0x93);

    v00 = mul(v00, v10);
    v01 = mul(v01, v11);
    v02 = mul(v02, v12);
    v03 = mul(v03, v13);

    const c1 = sub(c0, v00);
    c0 = add(c0, v00);
    const c3 = add(c2, v01);
    c2 = sub(c2, v01);
    const c5 = sub(c4, v02);
    c4 = add(c4, v02);
    const c7 = add(c6, v03);
    c6 = sub(c6, v03);

    c0 = permute(shuffle(c0, c1, 0xd8), 0xd8);
    c2 = permute(shuffle(c2, c3, 0xd8), 0xd8);
    c4 = permute(shuffle(c4, c5, 0xd8), 0xd8);
    c6 = permute(shuffle(c6, c7, 0xd8), 0xd8);

    const det = dot4(c0, row1);

    // float.Epsilon, the smallest denormal
    if (Math.abs(det) < 1.401298464324817e-45) {
      return null;
    }

    const inverse = f32(1 / det);
    return new Matrix4x4([...scale4(c0, inverse), ...scale4(c2, inverse), ...scale4(c4, inverse), ...scale4(c6, inverse)]);
  }
}

/** Four single-precision lanes, as a Vector128<float>. */
type Lanes = [number, number, number, number];

/** Sse.Shuffle: two lanes of `a` then two of `b`, picked by the immediate's 2-bit fields. */
function shuffle(a: Lanes, b: Lanes, control: number): Lanes {
  return [a[control & 3], a[(control >> 2) & 3], b[(control >> 4) & 3], b[(control >> 6) & 3]];
}

function permute(a: Lanes, control: number): Lanes {
  return shuffle(a, a, control);
}

function mul(a: Lanes, b: Lanes): Lanes {
  return [f32(a[0] * b[0]), f32(a[1] * b[1]), f32(a[2] * b[2]), f32(a[3] * b[3])];
}

function add(a: Lanes, b: Lanes): Lanes {
  return [f32(a[0] + b[0]), f32(a[1] + b[1]), f32(a[2] + b[2]), f32(a[3] + b[3])];
}

function sub(a: Lanes, b: Lanes): Lanes {
  return [f32(a[0] - b[0]), f32(a[1] - b[1]), f32(a[2] - b[2]), f32(a[3] - b[3])];
}

/** Vector128.MultiplyAddEstimate(-a, b, c), fused on x86: `c - a * b` rounded once. */
function fusedSubtract(c: Lanes, a: Lanes, b: Lanes): Lanes {
  return [fmaF(-a[0], b[0], c[0]), fmaF(-a[1], b[1], c[1]), fmaF(-a[2], b[2], c[2]), fmaF(-a[3], b[3], c[3])];
}

function scale4(a: Lanes, value: number): Lanes {
  return [f32(a[0] * value), f32(a[1] * value), f32(a[2] * value), f32(a[3] * value)];
}

/** Vector4.Dot: the products summed pairwise, as the SSE dot product does. */
function dot4(a: Lanes, b: Lanes): number {
  const p = mul(a, b);
  return f32(f32(p[0] + p[1]) + f32(p[2] + p[3]));
}

/**
 * Vector3.Transform(position, matrix) as .NET 10 evaluates it: a fused multiply-add chain over the
 * rotation rows, then the translation added.
 */
export function transform(v: Vector3, m: Matrix4x4): Vector3 {
  const a = m.m;
  return new Vector3(
    f32(fmaF(v.z, a[8], fmaF(v.y, a[4], f32(v.x * a[0]))) + a[12]),
    f32(fmaF(v.z, a[9], fmaF(v.y, a[5], f32(v.x * a[1]))) + a[13]),
    f32(fmaF(v.z, a[10], fmaF(v.y, a[6], f32(v.x * a[2]))) + a[14]),
  );
}

/** Vector3.TransformNormal(direction, matrix): the same chain without the translation. */
export function transformNormal(v: Vector3, m: Matrix4x4): Vector3 {
  const a = m.m;
  return new Vector3(
    fmaF(v.z, a[8], fmaF(v.y, a[4], f32(v.x * a[0]))),
    fmaF(v.z, a[9], fmaF(v.y, a[5], f32(v.x * a[1]))),
    fmaF(v.z, a[10], fmaF(v.y, a[6], f32(v.x * a[2]))),
  );
}

// Quaternion

export class Quaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;

  constructor(x: number, y: number, z: number, w: number) {
    this.x = f32(x);
    this.y = f32(y);
    this.z = f32(z);
    this.w = f32(w);
  }

  static readonly identity = new Quaternion(0, 0, 0, 1);

  /** Quaternion.CreateFromRotationMatrix. */
  static fromRotationMatrix(matrix: Matrix4x4): Quaternion {
    const [m11, m12, m13, , m21, m22, m23, , m31, m32, m33] = matrix.m;
    const trace = f32(f32(m11 + m22) + m33);

    if (trace > 0) {
      let s = f32(Math.sqrt(f32(trace + 1)));
      const w = f32(s * 0.5);
      s = f32(0.5 / s);
      return new Quaternion(f32(m23 - m32) * s, f32(m31 - m13) * s, f32(m12 - m21) * s, w);
    }

    if (m11 >= m22 && m11 >= m33) {
      const s = f32(Math.sqrt(f32(f32(f32(1 + m11) - m22) - m33)));
      const invS = f32(0.5 / s);
      return new Quaternion(f32(0.5 * s), f32(m12 + m21) * invS, f32(m13 + m31) * invS, f32(m23 - m32) * invS);
    }

    if (m22 > m33) {
      const s = f32(Math.sqrt(f32(f32(f32(1 + m22) - m11) - m33)));
      const invS = f32(0.5 / s);
      return new Quaternion(f32(m21 + m12) * invS, f32(0.5 * s), f32(m32 + m23) * invS, f32(m31 - m13) * invS);
    }

    const s = f32(Math.sqrt(f32(f32(f32(1 + m33) - m11) - m22)));
    const invS = f32(0.5 / s);
    return new Quaternion(f32(m31 + m13) * invS, f32(m32 + m23) * invS, f32(0.5 * s), f32(m12 - m21) * invS);
  }

  /** Quaternion.Dot: Vector128.Dot, the products summed pairwise. */
  static dot(a: Quaternion, b: Quaternion): number {
    return f32(f32(f32(a.x * b.x) + f32(a.y * b.y)) + f32(f32(a.z * b.z) + f32(a.w * b.w)));
  }

  /** Quaternion.Slerp. */
  static slerp(q1: Quaternion, q2: Quaternion, t: number): Quaternion {
    let cosOmega = Quaternion.dot(q1, q2);
    let flip = false;

    if (cosOmega < 0) {
      flip = true;
      cosOmega = -cosOmega;
    }

    let s1: number;
    let s2: number;

    if (cosOmega > f32(0.999999)) {
      s1 = f32(1 - t);
      s2 = flip ? -t : t;
    } else {
      const omega = f32(Math.acos(cosOmega));
      const invSinOmega = f32(1 / f32(Math.sin(omega)));
      s1 = f32(f32(Math.sin(f32(f32(1 - t) * omega))) * invSinOmega);
      const sin = f32(f32(Math.sin(f32(t * omega))) * invSinOmega);
      s2 = flip ? -sin : sin;
    }

    return new Quaternion(
      f32(s1 * q1.x) + f32(s2 * q2.x),
      f32(s1 * q1.y) + f32(s2 * q2.y),
      f32(s1 * q1.z) + f32(s2 * q2.z),
      f32(s1 * q1.w) + f32(s2 * q2.w),
    );
  }
}

/**
 * EntityTransformHelper.EulerAnglesToQuaternion (ValveResourceFormat/Resource/ResourceTypes/
 * EntityTransformHelper.cs): (pitch, yaw, roll) in degrees to a rotation.
 */
export function eulerAnglesToQuaternion(pitchYawRoll: Vector3): Quaternion {
  const half = (degrees: number) => f32(degreesToRadians(degrees) * 0.5);
  const sp = f32(Math.sin(half(pitchYawRoll.x)));
  const cp = f32(Math.cos(half(pitchYawRoll.x)));
  const sy = f32(Math.sin(half(pitchYawRoll.y)));
  const cy = f32(Math.cos(half(pitchYawRoll.y)));
  const sr = f32(Math.sin(half(pitchYawRoll.z)));
  const cr = f32(Math.cos(half(pitchYawRoll.z)));
  const product = (a: number, b: number, c: number) => f32(f32(a * b) * c);

  return new Quaternion(
    product(sr, cp, cy) - product(cr, sp, sy),
    product(cr, sp, cy) + product(sr, cp, sy),
    product(cr, cp, sy) - product(sr, sp, cy),
    product(cr, cp, cy) + product(sr, sp, sy),
  );
}
