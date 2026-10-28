import { describe, expect, it } from 'vitest';
import { blendRegionPixels, buildUvIslands, fillAcrossSeams, islandsFingerprint, rasterizeBrush, rasterizeIslandIds, texelsToLab, islandsAt, rasterizeSeeds, regionOutline, removeRegion, sameSeed, strokeSeeds, compactLegacySeeds, type UvGeometry } from './skinRegions';
import { hasSkinPartEdit, keepSkinPartEdit } from './skinColorAdjustments';

const geometry: UvGeometry = {
  position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 3, 1, 0, 2, 1, 0, 1, 1, 0],
  uv: [0, 0, 0.5, 0, 0.5, 1, 0, 1, 0.5, 0, 1, 0, 1, 1, 0.5, 1, 0.5, 1],
  // The left quad's second triangle uses vertex 8, a split copy of vertex 2.
  index: [0, 1, 2, 0, 8, 3, 4, 5, 6, 4, 6, 7],
};

describe('UV islands', () => {
  it('welds split vertices and keeps UV islands apart', () => {
    const islands = buildUvIslands([geometry]);
    expect(islands.count).toBe(2);
    expect(islands.island[0]).toBe(islands.island[1]);
    expect(islands.island[2]).not.toBe(islands.island[0]);
  });
  it('resolves seeds by texture point, wrapping tiled coordinates', () => {
    const islands = buildUvIslands([geometry]);
    const [left] = islandsAt(islands, 0.2, 0.5);
    const [right] = islandsAt(islands, 0.8, 0.5);
    expect(left).not.toBe(right);
    expect(islandsAt(islands, 1.2, -0.5)).toEqual([left]);
    // Seeds apply in order: add both islands, then remove the left one again.
    const mask = rasterizeSeeds(islands, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }, { u: 0.2, v: 0.5, remove: true }], 4, 1, null, 0);
    expect([...mask].map(Boolean)).toEqual([false, false, true, true]);
  });
  it('ignores triangles with no area on the model, however far they stretch in UV', () => {
    // A collapsed triangle joining the two quads across the texture, like the ones hero meshes carry.
    const bridge: UvGeometry = { position: [0, 0, 0, 0, 0, 0, 1, 0, 0], uv: [0.1, 0.1, 0.9, 0.9, 0.1, 0.9], index: null };
    const islands = buildUvIslands([geometry, bridge]);
    expect(islands.count).toBe(2);
    expect(islands.island).toHaveLength(4);
  });
  it('ignores triangles with no UV area, which would contain every point', () => {
    // A real triangle on the model whose UVs all sit on one point, joined to the right quad.
    const pinched: UvGeometry = { position: [2, 0, 0, 3, 0, 0, 3, 1, 0], uv: [0.75, 0.25, 0.75, 0.25, 0.75, 0.25], index: null };
    const islands = buildUvIslands([geometry, pinched]);
    expect(islands.island).toHaveLength(4);
    expect(islandsAt(islands, 0.2, 0.5)).toHaveLength(1);
  });
  it('fingerprints the texture layout, not the triangle order of anything else', () => {
    const moved: UvGeometry = { ...geometry, uv: Array.from(geometry.uv, (value, index) => index === 2 ? 0.55 : value) };
    expect(islandsFingerprint(buildUvIslands([geometry]))).toBe(islandsFingerprint(buildUvIslands([geometry])));
    expect(islandsFingerprint(buildUvIslands([geometry]))).not.toBe(islandsFingerprint(buildUvIslands([moved])));
  });
  it('selects every island on shared texels, like mirrored sleeves', () => {
    const mirrored: UvGeometry = { position: [5, 0, 0, 6, 0, 0, 6, 1, 0], uv: [0, 0, 0.5, 0, 0.5, 1], index: null };
    const islands = buildUvIslands([geometry, mirrored]);
    expect(islands.count).toBe(3);
    expect(islandsAt(islands, 0.4, 0.2)).toHaveLength(2);
  });
});

describe('region masks', () => {
  it('fills the selected island and pads only into unused texels', () => {
    const narrow: UvGeometry = { position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 0.25, 0, 0.25, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] };
    const neighbour: UvGeometry = { position: [5, 0, 0, 6, 0, 0, 6, 1, 0, 5, 1, 0], uv: [0.75, 0, 1, 0, 1, 1, 0.75, 1], index: [0, 1, 2, 0, 2, 3] };
    const islands = buildUvIslands([narrow, neighbour]);
    const mask = rasterizeSeeds(islands, [{ u: 0.1, v: 0.5 }], 8, 4, null, 2);
    // Columns 0-1 are the island, 2-3 its padding into the gutter; column 6-7 belong to the neighbour.
    expect([...mask.subarray(8, 16)]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(rasterizeSeeds(islands, [{ u: 0.1, v: 0.5 }], 8, 4, null, 0).subarray(8, 16)).toEqual(Uint8Array.from([255, 255, 0, 0, 0, 0, 0, 0]));
  });
  it('outlines only the selection boundary', () => {
    const mask = new Uint8Array(25);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) mask[y * 5 + x] = 255;
    const edge = regionOutline(mask, 5, 5);
    expect(edge[12]).toBe(0);
    expect(edge[6]).toBe(255);
    expect(edge[0]).toBe(0);
  });
  it('draws no outline along a UV seam', () => {
    // Columns 0-1 are the left island and 2-3 the right one; select the left island only.
    const islands = buildUvIslands([geometry]);
    const mask = Uint8Array.from({ length: 16 }, (_, index) => index % 4 < 2 ? 255 : 0);
    // Column 1 meets the right island across the seam: an edge in texture space, not on the model.
    expect(regionOutline(mask, 4, 4, 1)[5]).toBe(255);
    expect(regionOutline(mask, 4, 4, 1, rasterizeIslandIds(islands, 4, 4))[5]).toBe(0);
  });
  it('blends color through the mask and keeps the base alpha', () => {
    const base = Uint8Array.from([100, 100, 100, 7, 100, 100, 100, 9]);
    blendRegionPixels(base, Uint8Array.from([200, 0, 50, 255, 200, 0, 50, 255]), Uint8Array.from([255, 128]));
    expect([...base]).toEqual([200, 0, 50, 7, 150, 50, 75, 9]);
  });
});

describe('color selection', () => {
  // A 4x2 texture: red, red, near-red, blue on top; red, blue, red, red below.
  const colors = [[255, 0, 0], [255, 0, 0], [240, 10, 10], [0, 0, 255], [255, 0, 0], [0, 0, 255], [255, 0, 0], [255, 0, 0]];
  const pixels = colors.flatMap((rgb) => [...rgb, 255]);
  const lab = texelsToLab(pixels);
  const sheet = buildUvIslands([{ position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] }]);
  it('fills connected texels close to the clicked color', () => {
    // The near-red texel joins at range 10 and leads on to the reds below it.
    expect([...fillAcrossSeams(sheet, lab, 4, 2, 0, 0, 10)].map(Boolean)).toEqual([true, true, true, false, true, false, true, true]);
    expect([...fillAcrossSeams(sheet, lab, 4, 2, 0, 0, 1)].map(Boolean)).toEqual([true, true, false, false, true, false, false, false]);
  });
  it('applies piece and color seeds in order', () => {
    const quad: UvGeometry = { position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 1, 0, 1, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] };
    const islands = buildUvIslands([quad]);
    const mask = rasterizeSeeds(islands, [{ u: 0.5, v: 0.5 }, { u: 0.1, v: 0.9, by: 'color', tolerance: 10, remove: true }], 4, 2, lab, 0);
    // The whole quad, minus every red texel connected to the bottom-left one: only the blues stay.
    expect([...mask].map(Boolean)).toEqual([false, false, false, true, false, true, false, false]);
    expect(rasterizeSeeds(islands, [{ u: 0.1, v: 0.1, by: 'color' }], 4, 2, null, 0).every((value) => !value)).toBe(true);
  });
});

describe('brush', () => {
  // Two unit quads that touch on the model at x = 1, but sit in opposite halves of the texture.
  const left: UvGeometry = { position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 0.25, 0, 0.25, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] };
  const right: UvGeometry = { position: [1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0], uv: [0.75, 0, 1, 0, 1, 1, 0.75, 1], index: [0, 1, 2, 0, 2, 3] };
  // A quad far away on the model, right next to the left quad in the texture.
  const far: UvGeometry = { position: [9, 0, 0, 10, 0, 0, 10, 1, 0, 9, 1, 0], uv: [0.25, 0, 0.5, 0, 0.5, 1, 0.25, 1], index: [0, 1, 2, 0, 2, 3] };
  const islands = buildUvIslands([left, right, far]);
  const columns = (mask: Uint8Array) => [...mask.subarray(8 * 4, 8 * 5)].map(Boolean);
  it('follows the surface across a UV seam but not to pieces that are only neighbours in the texture', () => {
    // Centred on the left quad's right edge (u 0.24, y 0.5 on the model), reaching 0.6 units.
    expect(columns(rasterizeBrush(islands, 0.24, 0.5, 0.6, 8, 8))).toEqual([false, true, false, false, false, false, true, false]);
  });
  it('selects nothing for a point no triangle draws', () => {
    expect(rasterizeBrush(islands, 0.6, 0.5, 5, 8, 8).some(Boolean)).toBe(false);
  });
  it('paints the wrapped part of a triangle that crosses the edge of the texture', () => {
    // One quad spanning U 0.75..1.25: half at the right edge, half wrapped to the left edge.
    const wrapped = buildUvIslands([{ position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0.75, 0, 1.25, 0, 1.25, 1, 0.75, 1], index: [0, 1, 2, 0, 2, 3] }]);
    const painted = rasterizeBrush(wrapped, 0.9, 0.5, 5, 16, 16);
    expect(painted.filter(Boolean).length).toBe(rasterizeIslandIds(wrapped, 16, 16).filter(Boolean).length);
  });
  it('stores a stroke as one seed that paints the same texels as its dabs', () => {
    const dabs = [0.05, 0.12, 0.2, 0.8, 0.9].map((u) => ({ u, v: 0.5, by: 'brush' as const, radius: 0.3 }));
    const packed = strokeSeeds(dabs, 6);
    // Two more dabs fit per seed at this path limit; a remove dab never joins a paint stroke.
    expect(packed.map((seed) => seed.path?.length ?? 0)).toEqual([6, 3]);
    // Packed seeds are marked, so later strokes append instead of rewriting them.
    expect(compactLegacySeeds(packed, 765)).toBe(packed);
    expect(strokeSeeds([...dabs.slice(0, 2), { ...dabs[2], remove: true }], 765)).toHaveLength(2);
    expect(rasterizeSeeds(islands, packed, 8, 8, null, 0)).toEqual(rasterizeSeeds(islands, dabs, 8, 8, null, 0));
    expect(sameSeed(packed[0], { ...packed[0], path: [...packed[0].path!] })).toBe(true);
    expect(sameSeed(packed[0], { ...packed[0], path: packed[0].path!.slice(3) })).toBe(false);
  });
  it('compacts a draft saved with a seed per dab without changing what it paints', () => {
    const cut = (u: number, from: string) => ({ u, v: 0.5, by: 'brush' as const, radius: 0.2, remove: true as const, from });
    const saved = [{ u: 0.5, v: 0.5, by: 'color' as const }, cut(0.05, 'r2'), cut(0.1, 'r2'), cut(0.15, 'r3'), cut(0.2, 'r3')];
    const compact = compactLegacySeeds(saved, 765);
    // Cuts from different areas stay apart, so removing one area still takes back only its own.
    expect(compact.map((seed) => seed.from ?? null)).toEqual([null, 'r2', 'r3']);
    expect(rasterizeSeeds(islands, compact, 8, 8, null, 0)).toEqual(rasterizeSeeds(islands, saved, 8, 8, null, 0));
    expect(compactLegacySeeds(compact, 765)).toBe(compact);
  });
});

describe('fill across seams', () => {
  // Left and right quads touch on the model at x = 1 but sit in opposite halves of the texture; the far quad
  // sits next to the left one in the texture only.
  const left: UvGeometry = { position: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], uv: [0, 0, 0.25, 0, 0.25, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] };
  const right: UvGeometry = { position: [1, 0, 0, 2, 0, 0, 2, 1, 0, 1, 1, 0], uv: [0.75, 0, 1, 0, 1, 1, 0.75, 1], index: [0, 1, 2, 0, 2, 3] };
  const far: UvGeometry = { position: [9, 0, 0, 10, 0, 0, 10, 1, 0, 9, 1, 0], uv: [0.25, 0, 0.5, 0, 0.5, 1, 0.25, 1], index: [0, 1, 2, 0, 2, 3] };
  const islands = buildUvIslands([left, right, far]);
  const texture = (rightColor: number[]) => texelsToLab(Array.from({ length: 64 }, (_, index) => index % 8 >= 6 ? rightColor : [200, 30, 30]).flatMap((rgb) => [...rgb, 255]));
  const columns = (mask: Uint8Array) => [...mask.subarray(8 * 4, 8 * 5)].map(Boolean);
  it('continues into the piece across a seam when its color matches, but not into texture neighbours', () => {
    expect(columns(fillAcrossSeams(islands, texture([200, 30, 30]), 8, 8, 0, 4, 8))).toEqual([true, true, false, false, false, false, true, true]);
  });
  it('walks an island that shares its texels with another', () => {
    // A mirrored copy of the right quad, far away on the model, drawn on the same texels.
    const copy: UvGeometry = { ...right, position: [20, 0, 0, 21, 0, 0, 21, 1, 0, 20, 1, 0] };
    const shared = buildUvIslands([left, right, copy]);
    expect(columns(fillAcrossSeams(shared, texture([200, 30, 30]), 8, 8, 0, 4, 8))).toEqual([true, true, false, false, false, false, true, true]);
  });
  it('carries a color across any part of a seam, not just its middle', () => {
    // Only the top two rows are red, on both sides of the seam.
    const stripe = texelsToLab(Array.from({ length: 64 }, (_, index) => index < 16 ? [200, 30, 30] : [30, 30, 200]).flatMap((rgb) => [...rgb, 255]));
    const mask = fillAcrossSeams(islands, stripe, 8, 8, 0, 0, 8);
    expect([...mask.subarray(0, 8)].map(Boolean)).toEqual([true, true, false, false, false, false, true, true]);
    expect([...mask.subarray(16, 24)].some(Boolean)).toBe(false);
  });
  it('stops at the seam when the other side is a different color', () => {
    expect(columns(fillAcrossSeams(islands, texture([30, 30, 200]), 8, 8, 0, 4, 8))).toEqual([true, true, false, false, false, false, false, false]);
  });
});

describe('region edits', () => {
  it('keeps unedited regions without counting them as changes', () => {
    const edit = { material: 'coat.vmat', hidden: false, tint: null, regions: [{ id: 'r1', seeds: [{ u: 0, v: 0 }] }] };
    expect(hasSkinPartEdit(edit)).toBe(false);
    expect(keepSkinPartEdit(edit)).toBe(true);
    expect(hasSkinPartEdit({ ...edit, regions: [{ ...edit.regions[0], paint: '#ff0000' }] })).toBe(true);
  });
});

describe('removing an area', () => {
  it('takes back the cuts its paint made, so what it covered shows again', () => {
    const blue = { id: 'r1', paint: '#3b82f6', seeds: [{ u: 0.5, v: 0.5 }, { u: 0.2, v: 0.2, remove: true as const, from: 'r2' }, { u: 0.3, v: 0.3, remove: true as const }] };
    const red = { id: 'r2', paint: '#ef4444', seeds: [{ u: 0.2, v: 0.2 }] };
    // The eraser's cut has no owner and stays.
    expect(removeRegion([blue, red], 'r2')).toEqual([{ ...blue, seeds: [blue.seeds[0], blue.seeds[2]] }]);
  });
});
