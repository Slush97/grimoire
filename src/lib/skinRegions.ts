import type { SkinPartRegion, SkinRegionSeed } from '../types/skinEditor';
export { hasRegionEdit } from './skinColorAdjustments';

/** One triangle list in texture space. `index` null means every three vertices form a triangle. */
export interface UvGeometry {
  uv: ArrayLike<number>;
  position: ArrayLike<number>;
  index: ArrayLike<number> | null;
  /** Range in index units (or vertices when unindexed). */
  start?: number;
  count?: number;
}

/**
 * Every triangle of one material in texture space, grouped into connected UV islands.
 *
 * Vertices weld when both their position and UV match, so normal and tangent splits do not
 * break an island apart, while a UV seam still does. Mirrored pieces stay separate islands
 * here; seeds resolve by texture point, so selecting one selects every island on those texels.
 */
export interface UvIslands {
  /** Six numbers per triangle: u0 v0 u1 v1 u2 v2, shifted so each centroid sits in [0, 1). */
  triangles: Float32Array;
  island: Int32Array;
  count: number;
}

const POSITION_STEP = 1e-3;
const UV_STEP = 1 / 16384;

/**
 * Whether a triangle has no area on the model. Hero meshes carry thousands of these, stretched
 * across the whole texture: invisible, but they would join every island and paint the atlas.
 */
function collapsed(position: ArrayLike<number>, [a, b, c]: number[]): boolean {
  const e1 = [0, 1, 2].map((axis) => position[b * 3 + axis] - position[a * 3 + axis]);
  const e2 = [0, 1, 2].map((axis) => position[c * 3 + axis] - position[a * 3 + axis]);
  const cross = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
  return cross <= 1e-6 * Math.hypot(...e1) * Math.hypot(...e2);
}

export function buildUvIslands(geometries: UvGeometry[]): UvIslands {
  const corners: number[] = [];
  const keys = new Map<string, number>();
  const ids: number[] = [];
  const parent: number[] = [];
  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== root) { const next = parent[value]; parent[value] = root; value = next; }
    return root;
  };
  const vertexId = (geometry: UvGeometry, vertex: number) => {
    const { position, uv } = geometry;
    const key = [position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]].map((value) => Math.round(value / POSITION_STEP))
      .concat([uv[vertex * 2], uv[vertex * 2 + 1]].map((value) => Math.round(value / UV_STEP))).join(',');
    let id = keys.get(key);
    if (id === undefined) { id = parent.length; parent.push(id); keys.set(key, id); }
    return id;
  };
  for (const geometry of geometries) {
    const total = geometry.index ? geometry.index.length : geometry.position.length / 3;
    const start = geometry.start ?? 0;
    const end = Math.min(total, start + (geometry.count ?? total));
    for (let corner = start; corner + 2 < end; corner += 3) {
      const triangle = [0, 1, 2].map((offset) => geometry.index ? geometry.index[corner + offset] : corner + offset);
      if (collapsed(geometry.position, triangle)) continue;
      const welded = triangle.map((vertex) => vertexId(geometry, vertex));
      parent[find(welded[1])] = find(welded[0]);
      parent[find(welded[2])] = find(welded[0]);
      ids.push(welded[0]);
      const uvs = triangle.flatMap((vertex) => [geometry.uv[vertex * 2], geometry.uv[vertex * 2 + 1]]);
      const shiftU = Math.floor((uvs[0] + uvs[2] + uvs[4]) / 3), shiftV = Math.floor((uvs[1] + uvs[3] + uvs[5]) / 3);
      corners.push(uvs[0] - shiftU, uvs[1] - shiftV, uvs[2] - shiftU, uvs[3] - shiftV, uvs[4] - shiftU, uvs[5] - shiftV);
    }
  }
  const roots = new Map<number, number>();
  const island = new Int32Array(ids.length);
  ids.forEach((id, triangle) => {
    const root = find(id);
    let value = roots.get(root);
    if (value === undefined) { value = roots.size; roots.set(root, value); }
    island[triangle] = value;
  });
  return { triangles: Float32Array.from(corners), island, count: roots.size };
}

const wrap = (value: number) => value - Math.floor(value);

function containsPoint(t: Float32Array, offset: number, u: number, v: number): boolean {
  const [ax, ay, bx, by, cx, cy] = t.subarray(offset, offset + 6);
  const d1 = (u - bx) * (ay - by) - (ax - bx) * (v - by);
  const d2 = (u - cx) * (by - cy) - (bx - cx) * (v - cy);
  const d3 = (u - ax) * (cy - ay) - (cx - ax) * (v - ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Islands with a triangle covering texture point (u, v), including tiled copies. */
export function islandsAt(islands: UvIslands, u: number, v: number): number[] {
  const found = new Set<number>();
  const pu = wrap(u), pv = wrap(v);
  for (let triangle = 0; triangle < islands.island.length; triangle++) {
    if (found.has(islands.island[triangle])) continue;
    for (const [du, dv] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1], [-1, 1]]) {
      if (containsPoint(islands.triangles, triangle * 6, pu + du, pv + dv)) { found.add(islands.island[triangle]); break; }
    }
  }
  return [...found];
}

/** Apply seeds in order: each adds or removes every island under its texture point. */
export function resolveRegion(islands: UvIslands, seeds: SkinRegionSeed[]): Set<number> {
  const selected = new Set<number>();
  for (const seed of seeds) {
    for (const island of islandsAt(islands, seed.u, seed.v)) {
      if (seed.remove) selected.delete(island); else selected.add(island);
    }
  }
  return selected;
}

function fillTriangle(target: Uint8Array, width: number, height: number, t: ArrayLike<number>) {
  const x0 = t[0] * width, y0 = t[1] * height, x1 = t[2] * width, y1 = t[3] * height, x2 = t[4] * width, y2 = t[5] * height;
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1, y2)));
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1, x2)));
  if (minX > maxX || minY > maxY) return;
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    const row = y * width;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
      if (w0 < 0) continue;
      const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
      if (w1 >= 0 && w0 + w1 <= 1) target[row + x] = 255;
    }
  }
}

function rasterize(islands: UvIslands, include: (island: number) => boolean, width: number, height: number): Uint8Array {
  const target = new Uint8Array(width * height);
  const shifted = new Float32Array(6);
  for (let triangle = 0; triangle < islands.island.length; triangle++) {
    if (!include(islands.island[triangle])) continue;
    const t = islands.triangles.subarray(triangle * 6, triangle * 6 + 6);
    const spansU = Math.min(t[0], t[2], t[4]) < 0 || Math.max(t[0], t[2], t[4]) > 1;
    const spansV = Math.min(t[1], t[3], t[5]) < 0 || Math.max(t[1], t[3], t[5]) > 1;
    for (const du of spansU ? [-1, 0, 1] : [0]) for (const dv of spansV ? [-1, 0, 1] : [0]) {
      for (let corner = 0; corner < 3; corner++) { shifted[corner * 2] = t[corner * 2] + du; shifted[corner * 2 + 1] = t[corner * 2 + 1] + dv; }
      fillTriangle(target, width, height, shifted);
    }
  }
  return target;
}

/** Every texel some triangle of the material covers. Selections never grow outside it. */
export function rasterizeUsed(islands: UvIslands, width: number, height: number): Uint8Array {
  return rasterize(islands, () => true, width, height);
}

/** Texels covering every island under (u, v). */
export function rasterizeIslandsAt(islands: UvIslands, u: number, v: number, width: number, height: number): Uint8Array {
  const found = new Set(islandsAt(islands, u, v));
  return rasterize(islands, (island) => found.has(island), width, height);
}

const LINEAR = Float32Array.from({ length: 256 }, (_, value) => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const labF = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

/** CIELAB (D65) of every sRGB texel, three floats each. Dark textures need it: their colors sit close together in RGB. */
export function texelsToLab(pixels: ArrayLike<number>): Float32Array {
  const lab = new Float32Array(pixels.length / 4 * 3);
  for (let index = 0; index * 4 < pixels.length; index++) {
    const r = LINEAR[pixels[index * 4]], g = LINEAR[pixels[index * 4 + 1]], b = LINEAR[pixels[index * 4 + 2]];
    const x = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const y = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const z = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[index * 3] = 116 * y - 16; lab[index * 3 + 1] = 500 * (x - y); lab[index * 3 + 2] = 200 * (y - z);
  }
  return lab;
}

/**
 * Texels connected to (x, y) through `allowed` whose color is within `tolerance` (CIELAB delta E) of
 * the clicked texel's. Comparing against the clicked color, not each neighbour, keeps a soft
 * gradient from leaking across a whole garment.
 */
export function floodFillTexels(lab: Float32Array, allowed: Uint8Array, width: number, height: number, x: number, y: number, tolerance: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const start = y * width + x;
  if (x < 0 || y < 0 || x >= width || y >= height || !allowed[start]) return mask;
  const reach = tolerance * tolerance;
  const l = lab[start * 3], a = lab[start * 3 + 1], b = lab[start * 3 + 2];
  const close = (index: number) => (lab[index * 3] - l) ** 2 + (lab[index * 3 + 1] - a) ** 2 + (lab[index * 3 + 2] - b) ** 2 <= reach;
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = start; mask[start] = 255;
  while (top) {
    const index = stack[--top];
    const px = index % width;
    for (const next of [px > 0 ? index - 1 : -1, px + 1 < width ? index + 1 : -1, index - width, index + width]) {
      if (next < 0 || next >= mask.length || mask[next] || !allowed[next] || !close(next)) continue;
      mask[next] = 255;
      stack[top++] = next;
    }
  }
  return mask;
}

const texel = (value: number, size: number) => Math.min(size - 1, Math.floor((value - Math.floor(value)) * size));

export const DEFAULT_COLOR_RANGE = 8;

/**
 * One seed's texels: its UV islands, or with `by: 'color'` the similar colors connected to it inside
 * those islands. Atlases pack islands closer than a texel apart, so a fill must not cross them.
 */
export function rasterizeSeed(islands: UvIslands, seed: SkinRegionSeed, width: number, height: number, lab: Float32Array | null): Uint8Array {
  const pieces = rasterizeIslandsAt(islands, seed.u, seed.v, width, height);
  if (seed.by !== 'color') return pieces;
  if (!lab) return new Uint8Array(width * height);
  return floodFillTexels(lab, pieces, width, height, texel(seed.u, width), texel(seed.v, height), seed.tolerance ?? DEFAULT_COLOR_RANGE);
}

/** Grow a mask into texels no triangle uses, so filtering and mips do not pull the unedited color in at seams. */
export function padMask(mask: Uint8Array, used: Uint8Array, width: number, height: number, padding: number): Uint8Array {
  let frontier = mask;
  for (let pass = 0; pass < padding; pass++) {
    const next = frontier.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (frontier[index] || used[index]) continue;
      if ((x > 0 && frontier[index - 1]) || (x + 1 < width && frontier[index + 1])
        || (y > 0 && frontier[index - width]) || (y + 1 < height && frontier[index + width])) next[index] = 255;
    }
    frontier = next;
  }
  return frontier;
}

/**
 * Bake seeds to a 0/255 mask at `width` x `height`, in the texture's row order. Seeds apply in
 * order, each adding or removing its texels. `lab` (from `texelsToLab` at the same size) is only
 * read by color seeds; without it they select nothing.
 */
export function rasterizeSeeds(islands: UvIslands, seeds: SkinRegionSeed[], width: number, height: number, lab: Float32Array | null, padding = 2): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const seed of seeds) {
    const texels = rasterizeSeed(islands, seed, width, height, lab);
    for (let index = 0; index < mask.length; index++) {
      if (texels[index]) mask[index] = seed.remove ? 0 : 255;
    }
  }
  return padding ? padMask(mask, rasterizeUsed(islands, width, height), width, height, padding) : mask;
}

/** Bake whole islands to a mask. Kept for previews that already know which islands they want. */
export function rasterizeRegion(islands: UvIslands, selected: Set<number>, width: number, height: number, padding = 2): Uint8Array {
  const mask = rasterize(islands, (island) => selected.has(island), width, height);
  return padding && selected.size ? padMask(mask, rasterizeUsed(islands, width, height), width, height, padding) : mask;
}

/** Mask texels on the boundary of the selection, for an outline that reads at any fill strength. */
export function regionOutline(mask: Uint8Array, width: number, height: number, thickness = 1): Uint8Array {
  let edge = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x;
    if (!mask[index]) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[index - 1] || !mask[index + 1] || !mask[index - width] || !mask[index + width]) edge[index] = 255;
  }
  for (let pass = 1; pass < thickness; pass++) {
    const next = edge.slice();
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (edge[index] || !mask[index]) continue;
      if ((x > 0 && edge[index - 1]) || (x + 1 < width && edge[index + 1]) || (y > 0 && edge[index - width]) || (y + 1 < height && edge[index + width])) next[index] = 255;
    }
    edge = next;
  }
  return edge;
}

/** `base` takes `edited`'s color where the mask is white. Alpha stays the base's, like the export. */
export function blendRegionPixels(base: Uint8ClampedArray | Uint8Array, edited: Uint8ClampedArray | Uint8Array, mask: Uint8Array): void {
  for (let pixel = 0; pixel < mask.length; pixel++) {
    const weight = mask[pixel] / 255;
    if (!weight) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      base[offset + channel] = Math.round(base[offset + channel] + (edited[offset + channel] - base[offset + channel]) * weight);
    }
  }
}

/** Regions are kept once picked, even before they change anything, so a selection is never lost. */
export function hasRegionSelection(region: SkinPartRegion): boolean {
  return region.seeds.some((seed) => !seed.remove);
}

export function newRegionId(existing: SkinPartRegion[]): string {
  for (let index = existing.length + 1; ; index++) {
    const id = `r${index}`;
    if (!existing.some((region) => region.id === id)) return id;
  }
}

/** A region's name, or "Area N" from its id, which stays put when other areas are deleted. */
export function regionLabel(region: SkinPartRegion, t: (key: string, options?: Record<string, unknown>) => string): string {
  return region.name?.trim() || t('foundry.skin.region.areaName', { index: region.id.replace(/^r/, '') });
}
