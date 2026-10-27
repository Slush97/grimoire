import { describe, expect, it } from 'vitest';
import { blendRegionPixels, buildUvIslands, floodFillTexels, texelsToLab, islandsAt, rasterizeRegion, rasterizeSeeds, regionOutline, resolveRegion, type UvGeometry } from './skinRegions';
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
    expect([...resolveRegion(islands, [{ u: 0.2, v: 0.5 }, { u: 0.8, v: 0.5 }, { u: 0.2, v: 0.5, remove: true }])]).toEqual([right]);
  });
  it('ignores triangles with no area on the model, however far they stretch in UV', () => {
    // A collapsed triangle joining the two quads across the texture, like the ones hero meshes carry.
    const bridge: UvGeometry = { position: [0, 0, 0, 0, 0, 0, 1, 0, 0], uv: [0.1, 0.1, 0.9, 0.9, 0.1, 0.9], index: null };
    const islands = buildUvIslands([geometry, bridge]);
    expect(islands.count).toBe(2);
    expect(islands.island).toHaveLength(4);
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
    const selected = resolveRegion(islands, [{ u: 0.1, v: 0.5 }]);
    const mask = rasterizeRegion(islands, selected, 8, 4, 2);
    const row = [...mask.subarray(8, 16)];
    // Columns 0-1 are the island, 2-3 its padding into the gutter; column 6-7 belong to the neighbour.
    expect(row).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
    expect(rasterizeRegion(islands, selected, 8, 4, 0).subarray(8, 16)).toEqual(Uint8Array.from([255, 255, 0, 0, 0, 0, 0, 0]));
  });
  it('outlines only the selection boundary', () => {
    const mask = new Uint8Array(25);
    for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) mask[y * 5 + x] = 255;
    const edge = regionOutline(mask, 5, 5);
    expect(edge[12]).toBe(0);
    expect(edge[6]).toBe(255);
    expect(edge[0]).toBe(0);
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
  const all = new Uint8Array(8).fill(255);
  it('fills connected texels close to the clicked color', () => {
    // The near-red texel joins at range 10 and leads on to the reds below it.
    expect([...floodFillTexels(lab, all, 4, 2, 0, 0, 10)].map(Boolean)).toEqual([true, true, true, false, true, false, true, true]);
    expect([...floodFillTexels(lab, all, 4, 2, 0, 0, 1)].map(Boolean)).toEqual([true, true, false, false, true, false, false, false]);
  });
  it('stops at texels no triangle uses', () => {
    const used = Uint8Array.from([255, 0, 255, 255, 255, 0, 255, 255]);
    expect([...floodFillTexels(lab, used, 4, 2, 0, 0, 10)].map(Boolean)).toEqual([true, false, false, false, true, false, false, false]);
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

describe('region edits', () => {
  it('keeps unedited regions without counting them as changes', () => {
    const edit = { material: 'coat.vmat', hidden: false, tint: null, regions: [{ id: 'r1', seeds: [{ u: 0, v: 0 }] }] };
    expect(hasSkinPartEdit(edit)).toBe(false);
    expect(keepSkinPartEdit(edit)).toBe(true);
    expect(hasSkinPartEdit({ ...edit, regions: [{ ...edit.regions[0], paint: '#ff0000' }] })).toBe(true);
  });
});
