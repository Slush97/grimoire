/**
 * A saved frame of the hideout room, drawn under the hero while the real room
 * loads. It holds the room's HDR scene color (before post) and depth, from one
 * camera, so it is exact only at that camera, that placement and that size.
 *
 * File layout: "GHS1", u32 header length, header JSON, zero padding to 4 bytes,
 * RGBA half floats (8 bytes a pixel), then float depth (4 bytes a pixel). Rows
 * run bottom to top, as WebGL reads them.
 */
export const HIDEOUT_SNAPSHOT_VERSION = 2;
const MAGIC = 0x31534847; // "GHS1" little endian

export interface HideoutSnapshotHeader {
  version: number;
  width: number;
  height: number;
  /** The camera's matrixWorldInverse and projectionMatrix, column major. */
  view: number[];
  projection: number[];
  /** The room group's normalization scale and floor offset. */
  placement: [number, number];
  /** The orbit camera's position and target, to restore this pose exactly. */
  orbit: { position: [number, number, number]; target: [number, number, number] } | null;
}

export interface HideoutSnapshot extends HideoutSnapshotHeader {
  color: Uint16Array;
  depth: Float32Array;
}

export function encodeHideoutSnapshot(snapshot: HideoutSnapshot): Uint8Array {
  const { color, depth, ...header } = snapshot;
  const pixels = header.width * header.height;
  if (color.length !== pixels * 4 || depth.length !== pixels) throw new Error('Snapshot size does not match its pixels.');
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = Math.ceil((8 + json.length) / 4) * 4;
  const bytes = new Uint8Array(start + color.byteLength + depth.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, json.length, true);
  bytes.set(json, 8);
  bytes.set(new Uint8Array(color.buffer, color.byteOffset, color.byteLength), start);
  bytes.set(new Uint8Array(depth.buffer, depth.byteOffset, depth.byteLength), start + color.byteLength);
  return bytes;
}

const isMatrix = (value: unknown): value is number[] => Array.isArray(value) && value.length === 16 && value.every(Number.isFinite);
const isVector = (value: unknown): value is [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export function decodeHideoutSnapshot(buffer: ArrayBuffer): HideoutSnapshot | null {
  if (buffer.byteLength < 8) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) return null;
  const length = view.getUint32(4, true);
  if (8 + length > buffer.byteLength) return null;
  let header: Partial<HideoutSnapshotHeader>;
  try { header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length))) as Partial<HideoutSnapshotHeader>; } catch { return null; }
  const { version, width, height, view: camera, projection, placement, orbit } = header;
  if (version !== HIDEOUT_SNAPSHOT_VERSION || !Number.isInteger(width) || !Number.isInteger(height) || !width || !height || width < 1 || height < 1
    || !isMatrix(camera) || !isMatrix(projection) || !Array.isArray(placement) || placement.length !== 2 || !placement.every(Number.isFinite)
    || (orbit !== null && !(isVector(orbit?.position) && isVector(orbit.target)))) return null;
  const start = Math.ceil((8 + length) / 4) * 4;
  const pixels = width * height;
  if (buffer.byteLength !== start + pixels * 12) return null;
  return { version, width, height, view: camera, projection, placement: [placement[0], placement[1]], orbit,
    color: new Uint16Array(buffer, start, pixels * 4), depth: new Float32Array(buffer, start + pixels * 8, pixels) };
}

/** One file per viewer (a hero or workspace). It holds the last size and pose
 *  the room rested at; the viewer reopens at that pose unless the window or
 *  the saved camera changed since. */
export function hideoutSnapshotName(hint: string): string {
  // FNV-1a, 64 bits as two 32-bit halves: a stable file name, not a security boundary.
  let high = 0xcbf29ce4, low = 0x84222325;
  for (let i = 0; i < hint.length; i++) {
    low ^= hint.charCodeAt(i);
    const lowProduct = low * 0x1b3;
    const carry = Math.floor(lowProduct / 2 ** 32);
    high = (Math.imul(high, 0x1b3) + Math.imul(low, 0x100) + carry) >>> 0;
    low = lowProduct >>> 0;
  }
  return `${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}.bin`;
}

/** Below a millionth of a matrix element the projected room moves by far less
 *  than a pixel; restoring a saved camera through the orbit controls' spherical
 *  coordinates can round at that level. */
export function hideoutSnapshotMatches(header: HideoutSnapshotHeader, view: ArrayLike<number>, projection: ArrayLike<number>,
  placement: readonly [number, number], width: number, height: number, tolerance = 1e-6): boolean {
  if (header.width !== width || header.height !== height) return false;
  if (Math.abs(header.placement[0] - placement[0]) > tolerance || Math.abs(header.placement[1] - placement[1]) > tolerance) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(header.view[i] - view[i]) > tolerance || Math.abs(header.projection[i] - projection[i]) > tolerance) return false;
  }
  return true;
}
