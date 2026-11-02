// Ported from ValveResourceFormat (MIT): StringToken.Get in ValveResourceFormat/Utils/StringToken.cs.
// MurmurHash2 of the UTF-8 bytes with ASCII letters folded to lower case, seeded with 0x31415926.

const SEED = 0x31415926;
const M = 0x5bd1e995;
const R = 24;

function mix(hash: number, block: number): number {
  let k = Math.imul(block, M);
  k ^= k >>> R;
  k = Math.imul(k, M);
  return (Math.imul(hash, M) ^ k) >>> 0;
}

/** The hash token of `key`, case insensitive for ASCII letters, as an unsigned 32-bit value. */
export function stringToken(key: string): number {
  if (key.length === 0) {
    return 0;
  }

  const bytes = new TextEncoder().encode(key).map((byte) => (byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte));
  let hash = (SEED ^ bytes.length) >>> 0;
  let i = 0;

  for (; i <= bytes.length - 4; i += 4) {
    hash = mix(hash, bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24));
  }

  let tail = 0;

  for (let j = bytes.length - 1; j >= i; j--) {
    tail = ((tail << 8) | bytes[j]) >>> 0;
  }

  if (bytes.length - i > 0) {
    hash = Math.imul((hash ^ tail) >>> 0, M) >>> 0;
  }

  hash ^= hash >>> 13;
  hash = Math.imul(hash, M) >>> 0;
  hash ^= hash >>> 15;

  return hash >>> 0;
}
