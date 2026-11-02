// Ported from ValveResourceFormat (MIT): Renderer/Particles/Renderers/SpritecardVertex.cs and
// Renderer/Renderer/QuadIndexBuffer.cs.
//
// One corner of a spritecard strip, for renderers that supply vertices rather than generating them.
// The shader looks the sheet frames up itself and applies the size clamp and the fades, so a corner
// carries the particle values those read rather than placed coordinates.

import * as THREE from 'three';

/** The attributes of a corner in buffer order, with their sizes. */
export const SPRITECARD_VERTEX_LAYOUT = [
  // The corner, placed at the radius along the width axis before the size clamp
  ['vPOSITION', 3],
  // The colour, its alpha before any fade
  ['vCOLOR', 4],
  // The random value, shader extra data 1, the age the sheet and the per particle modes play by, and shader extra data 2
  ['vTEXCOORD', 4],
  // The card corner after flipping in xy, and the V before it is mapped to the texture in z
  ['vTEXCOORD1', 3],
  // Roll, yaw and pitch, and the radius before the size clamp
  ['vTEXCOORD3', 4],
  // The unit axis from the strip's centre line out to this corner
  ['vAxisU', 3],
  // The axis whose alignment with the view fades the strip out by view angle
  ['vNORMAL', 3],
  // The alpha and the radius of the particle the segment starts at, which the per particle modes read
  ['vSegmentAlphaRadius', 2],
] as const;

export const SPRITECARD_VERTEX_STRIDE = SPRITECARD_VERTEX_LAYOUT.reduce((sum, [, size]) => sum + size, 0);

export interface StripCorner {
  position: { x: number; y: number; z: number };
  color: [number, number, number, number];
  sheetInputs: [number, number, number, number];
  cornerV: [number, number, number];
  rotationRadius: [number, number, number, number];
  widthAxis: { x: number; y: number; z: number };
  facingAxis: { x: number; y: number; z: number };
  segmentAlphaRadius: [number, number];
}

/**
 * The vertex buffer of a strip renderer: four corners per quad, drawn through the shared quad
 * indices (0 1 2, 0 2 3 per quad), grown as the strip needs.
 */
export class StripBuffer {
  readonly geometry: THREE.BufferGeometry;
  private vertices = new Float32Array(0);
  private buffer: THREE.InterleavedBuffer | null = null;
  private quadCapacity = 0;

  constructor(geometry: THREE.BufferGeometry) {
    this.geometry = geometry;
  }

  /** The vertex array, holding at least `quads` quads. */
  reserve(quads: number): Float32Array {
    if (quads <= this.quadCapacity && this.buffer !== null) {
      this.buffer.clearUpdateRanges();
      return this.vertices;
    }

    const capacity = Math.max(16, 1 << Math.ceil(Math.log2(Math.max(quads, 1))));
    this.quadCapacity = capacity;
    this.vertices = new Float32Array(capacity * 4 * SPRITECARD_VERTEX_STRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.vertices, SPRITECARD_VERTEX_STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);

    let offset = 0;

    for (const [name, size] of SPRITECARD_VERTEX_LAYOUT) {
      this.geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
      offset += size;
    }

    const indices = new Uint32Array(capacity * 6);

    for (let i = 0; i < capacity; i++) {
      indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    }

    this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return this.vertices;
  }

  /** Writes one corner at vertex `index`. */
  static write(vertices: Float32Array, index: number, corner: StripCorner): void {
    const o = index * SPRITECARD_VERTEX_STRIDE;
    vertices[o] = corner.position.x;
    vertices[o + 1] = corner.position.y;
    vertices[o + 2] = corner.position.z;
    vertices.set(corner.color, o + 3);
    vertices.set(corner.sheetInputs, o + 7);
    vertices.set(corner.cornerV, o + 11);
    vertices.set(corner.rotationRadius, o + 14);
    vertices[o + 18] = corner.widthAxis.x;
    vertices[o + 19] = corner.widthAxis.y;
    vertices[o + 20] = corner.widthAxis.z;
    vertices[o + 21] = corner.facingAxis.x;
    vertices[o + 22] = corner.facingAxis.y;
    vertices[o + 23] = corner.facingAxis.z;
    vertices[o + 24] = corner.segmentAlphaRadius[0];
    vertices[o + 25] = corner.segmentAlphaRadius[1];
  }

  /** Draws the first `quads` quads after their vertices were written. */
  commit(quads: number): void {
    this.geometry.setDrawRange(0, quads * 6);

    if (this.buffer !== null) {
      this.buffer.addUpdateRange(0, quads * 4 * SPRITECARD_VERTEX_STRIDE);
      this.buffer.needsUpdate = true;
    }
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
