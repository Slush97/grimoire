// Evaluates a material's dynamic expressions (m_dynamicParams): the VfxEval bytecode that
// ValveResourceFormat/Serialization/VfxEval/VfxEval.cs (MIT) decompiles, run here instead of printed.
// Only straight-line expressions over render attributes and literals are taken: the arithmetic,
// negation, swizzles and the pure functions below. Anything else (branches, locals, features, textures,
// time, material params) compiles to null, and the material keeps its static value.

/** StringToken: MurmurHash2 of the lowercased name, seed 0x31415926, as the bytecode names attributes. */
export function stringToken(name: string): number {
  const data = new TextEncoder().encode(name.toLowerCase());
  const m = 0x5bd1e995;
  let length = data.length;
  let h = (0x31415926 ^ length) >>> 0;
  let i = 0;
  while (length >= 4) {
    let k = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    k = (k ^ (k >>> 24)) >>> 0;
    k = Math.imul(k, m) >>> 0;
    h = (Math.imul(h, m) ^ k) >>> 0;
    i += 4;
    length -= 4;
  }
  if (length === 3) h ^= data[i + 2] << 16;
  if (length >= 2) h ^= data[i + 1] << 8;
  if (length >= 1) h = Math.imul((h ^ data[i]) >>> 0, m) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, m) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

type Value = number[];
type Lookup = (token: number) => Value | undefined;
type Step = (stack: Value[], lookup: Lookup) => boolean;

/** A compiled expression and the attributes it reads. */
export interface VfxExpression {
  attributes: number[];
  /** The value, or null when an attribute it reads is not set. */
  evaluate(lookup: Lookup): Value | null;
}

const broadcast = (a: Value, b: Value, op: (x: number, y: number) => number): Value => {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, i) => op(a[a.length === 1 ? 0 : i] ?? 0, b[b.length === 1 ? 0 : i] ?? 0));
};

const BINARY: Record<number, (x: number, y: number) => number> = {
  0x13: (x, y) => x + y, 0x14: (x, y) => x - y, 0x15: (x, y) => x * y, 0x16: (x, y) => (y === 0 ? 0 : x / y), 0x17: (x, y) => (y === 0 ? 0 : x % y),
};

/** VfxEval's FUNCTION_REF entries that are pure maths, by id: arguments and the result. */
const FUNCTIONS: Record<number, [number, (args: Value[]) => Value]> = {
  0x00: [1, ([a]) => a.map((v) => Math.sin(v))],
  0x01: [1, ([a]) => a.map((v) => Math.cos(v))],
  0x02: [1, ([a]) => a.map((v) => Math.tan(v))],
  0x03: [1, ([a]) => a.map((v) => v - Math.floor(v))],
  0x04: [1, ([a]) => a.map((v) => Math.floor(v))],
  0x05: [1, ([a]) => a.map((v) => Math.ceil(v))],
  0x06: [1, ([a]) => a.map((v) => Math.min(Math.max(v, 0), 1))],
  0x07: [3, ([x, lo, hi]) => broadcast(broadcast(x, lo, Math.max), hi, Math.min)],
  0x08: [3, ([a, b, t]) => broadcast(broadcast(broadcast(a, b, (x, y) => y - x), t, (d, s) => d * s), a, (v, x) => v + x)],
  0x14: [1, ([a]) => a.map((v) => Math.abs(v))],
  0x15: [2, ([a, b]) => broadcast(a, b, (x, y) => Math.pow(x, y))],
  0x11: [1, ([a]) => a.map((v) => Math.sqrt(v))],
  0x18: [4, (args) => args.flat().slice(0, 4)],
  0x19: [3, (args) => args.flat().slice(0, 3)],
  0x1a: [2, (args) => args.flat().slice(0, 2)],
  0x1c: [2, ([a, b]) => broadcast(a, b, Math.min)],
  0x1d: [2, ([a, b]) => broadcast(a, b, Math.max)],
  0x1e: [1, ([a]) => a.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055))],
  0x1f: [1, ([a]) => a.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)))],
};

/** Compiles one dynamic expression, or returns null when it uses anything outside the subset above. */
export function compileVfxExpression(bytes: readonly number[]): VfxExpression | null {
  const view = new DataView(Uint8Array.from(bytes).buffer);
  const steps: Step[] = [];
  const attributes: number[] = [];
  let at = 0;
  let returned = false;

  while (at < view.byteLength && !returned) {
    const op = view.getUint8(at++);
    if (op === 0x00) {
      returned = true;
    } else if (op === 0x07) {
      const value = view.getFloat32(at, true);
      at += 4;
      steps.push((stack) => (stack.push([value]), true));
    } else if (op === 0x19) {
      const token = view.getUint32(at, true);
      at += 4;
      attributes.push(token);
      steps.push((stack, lookup) => {
        const value = lookup(token);
        if (value === undefined) return false;
        stack.push([...value]);
        return true;
      });
    } else if (op === 0x18) {
      steps.push((stack) => (stack.push(stack.pop()!.map((v) => -v)), true));
    } else if (op in BINARY) {
      const fn = BINARY[op];
      steps.push((stack) => {
        const b = stack.pop()!;
        const a = stack.pop()!;
        stack.push(broadcast(a, b, fn));
        return true;
      });
    } else if (op === 0x06) {
      const id = view.getUint8(at);
      const check = view.getUint8(at + 1);
      at += 2;
      const fn = FUNCTIONS[id];
      if (!fn || check !== 0) return null;
      const [count, apply] = fn;
      steps.push((stack) => {
        const args = stack.splice(stack.length - count, count);
        stack.push(apply(args));
        return true;
      });
    } else if (op === 0x1e) {
      const swizzle = view.getUint8(at++);
      // Four 2-bit component indices, the lowest first; repeats of the last are trimmed (VfxEval.GetSwizzle)
      const components = [0, 1, 2, 3].map((i) => (swizzle >> (i * 2)) & 3);
      while (components.length > 1 && components[components.length - 1] === components[components.length - 2]) components.pop();
      steps.push((stack) => {
        const value = stack.pop()!;
        stack.push(components.map((c) => value[c] ?? value[0] ?? 0));
        return true;
      });
    } else {
      return null;
    }
  }

  if (!returned || at !== view.byteLength) return null;

  return {
    attributes,
    evaluate(lookup) {
      const stack: Value[] = [];
      for (const step of steps) if (!step(stack, lookup)) return null;
      return stack.length === 1 ? stack[0] : null;
    },
  };
}
