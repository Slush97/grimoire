import { describe, expect, it } from 'vitest';
import { Vector3 } from '../numerics';
import { ParticleColorBlendType } from './enums';
import { applyColorBlend, convertColorScale, type Rgba } from './colorBlend';
import { LightFalloff } from './lightFalloff';
import { catmullRom, catmullRomTangent, catmullRomV } from './renderRopes';
import { quadBasis, screenAlignedBasis, worldZAlignedBasis } from './renderSprites';
import { VTexFlags, VTexFormat, getSequenceIndex, readParticleTextureInfo, sequenceIdCount, type ParticleSheet } from './sheet';
import { ParticleSheetCache, pairSample, resample, toUnorm16 } from './sheetCache';
import { DEADLOCK_BASE_POST, VRF_DEFAULT_TONEMAP, applyTonemapping, exposureForDisplay, postSettingsFromVpost, tonemapChannel } from './post/sourcePostProcess';
import { decodesSrgb, gradientTexels } from './textures';
import type { RenderView } from './view';

/** Builds a compiled texture resource: the resource header, one DATA block, and the VTEX header with its extra data. */
function vtexResource(options: { format: number; flags?: number; mips?: number; sheet?: Uint8Array; motionVectors?: number }): Uint8Array {
  const extras: { type: number; bytes: Uint8Array }[] = [];

  if (options.sheet) {
    extras.push({ type: 2, bytes: options.sheet });
  }

  if (options.motionVectors !== undefined) {
    const metadata = new Uint8Array(128);
    new DataView(metadata.buffer).setInt16(6, options.motionVectors, true);
    extras.push({ type: 3, bytes: metadata });
  }

  const headerSize = 16 + 12;
  const textureHeader = 40;
  const extraTable = extras.length * 12;
  const payload = extras.reduce((sum, extra) => sum + extra.bytes.length, 0);
  const bytes = new Uint8Array(headerSize + textureHeader + extraTable + payload);
  const view = new DataView(bytes.buffer);

  view.setUint32(0, bytes.length, true);
  view.setUint16(4, 12, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, 8, true); // the block table starts right after this offset field's pair
  view.setUint32(12, 1, true);

  const block = 16;
  bytes.set([68, 65, 84, 65], block); // DATA
  const data = headerSize;
  view.setUint32(block + 4, data - (block + 4), true);
  view.setUint32(block + 8, textureHeader + extraTable + payload, true);

  view.setUint16(data, 1, true);
  view.setUint16(data + 2, options.flags ?? 0, true);
  view.setUint16(data + 20, 64, true);
  view.setUint16(data + 22, 32, true);
  view.setUint16(data + 24, 1, true);
  view.setUint8(data + 26, options.format);
  view.setUint8(data + 27, options.mips ?? 7);
  const table = data + textureHeader;
  view.setUint32(data + 32, table - (data + 32), true);
  view.setUint32(data + 36, extras.length, true);

  let cursor = table + extraTable;

  extras.forEach((extra, i) => {
    const entry = table + i * 12;
    view.setUint32(entry, extra.type, true);
    view.setUint32(entry + 4, cursor - (entry + 4), true);
    view.setUint32(entry + 8, extra.bytes.length, true);
    bytes.set(extra.bytes, cursor);
    cursor += extra.bytes.length;
  });

  return bytes;
}

/** A SHEET block with the given sequences, each a list of frames of one image. */
function sheetBlock(sequences: { id: number; clamp?: boolean; name: string; totalTime: number; frames: { time: number; rect: number[] }[] }[]): Uint8Array {
  const sequenceSize = 32;
  const names = sequences.map((s) => new TextEncoder().encode(`${s.name}\0`));
  const frameBytes = sequences.map((s) => s.frames.length * 12);
  const imageBytes = sequences.map((s) => s.frames.length * 32);
  const size = 8 + sequences.length * sequenceSize + frameBytes.reduce((a, b) => a + b, 0) + imageBytes.reduce((a, b) => a + b, 0) + names.reduce((a, b) => a + b.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 8, true);
  view.setUint32(4, sequences.length, true);

  let cursor = 8 + sequences.length * sequenceSize;

  sequences.forEach((sequence, s) => {
    const header = 8 + s * sequenceSize;
    view.setUint32(header, sequence.id, true);
    view.setUint8(header + 4, sequence.clamp ? 1 : 0);
    view.setInt32(header + 8, cursor - (header + 8), true);
    view.setUint32(header + 12, sequence.frames.length, true);
    view.setFloat32(header + 16, sequence.totalTime, true);

    const frames = cursor;
    cursor += sequence.frames.length * 12;

    sequence.frames.forEach((frame, f) => {
      const at = frames + f * 12;
      view.setFloat32(at, frame.time, true);
      view.setInt32(at + 4, cursor - (at + 4), true);
      view.setUint32(at + 8, 1, true);
      frame.rect.forEach((v, i) => view.setFloat32(cursor + i * 4, v, true));
      cursor += 32;
    });

    view.setInt32(header + 20, cursor - (header + 20), true);
    bytes.set(names[s], cursor);
    cursor += names[s].length;
    view.setInt32(header + 24, 0, true);
    view.setUint32(header + 28, 0, true);
  });

  return bytes;
}

describe('readParticleTextureInfo', () => {
  it('reads the header, the mip count, the motion vector distance and the sheet', () => {
    const sheet = sheetBlock([
      {
        id: 0,
        clamp: true,
        name: 'CDmeSheetSequence',
        totalTime: 1,
        frames: [
          { time: 0.5, rect: [0, 0, 0.5, 1, 0, 0, 0.5, 1] },
          { time: 0.5, rect: [0.5, 0, 1, 1, 0.5, 0, 1, 1] },
        ],
      },
      { id: 7, name: '3', totalTime: 2, frames: [{ time: 2, rect: [0, 0, 1, 1, 0, 0, 1, 1] }] },
    ]);
    const info = readParticleTextureInfo(vtexResource({ format: VTexFormat.DXT5, flags: VTexFlags.SUGGEST_CLAMPS, mips: 1, sheet, motionVectors: 12 }));

    expect(info).not.toBeNull();
    expect(info!.width).toBe(64);
    expect(info!.height).toBe(32);
    expect(info!.format).toBe(VTexFormat.DXT5);
    expect(info!.flags).toBe(VTexFlags.SUGGEST_CLAMPS);
    expect(info!.mipLevels).toBe(1);
    expect(info!.motionVectorsMaxDistance).toBe(12);

    const sequences = info!.sheet!.sequences;
    expect(sequences).toHaveLength(2);
    expect(sequences[0]).toMatchObject({ id: 0, clamp: true, name: 'CDmeSheetSequence', totalTime: 1 });
    expect(sequences[0].frames.map((frame) => frame.displayTime)).toEqual([0.5, 0.5]);
    expect(sequences[0].frames[1].images[0].uncroppedMin).toEqual([0.5, 0]);
    expect(sequences[1]).toMatchObject({ id: 7, name: '3', totalTime: 2 });
  });

  it('is null for a buffer that is not a resource', () => {
    expect(readParticleTextureInfo(new Uint8Array(32))).toBeNull();
  });

  it('throws on an offset that leaves the buffer', () => {
    const bytes = vtexResource({ format: VTexFormat.BC7 });
    new DataView(bytes.buffer).setUint32(16 + 4, 100000, true);
    expect(() => readParticleTextureInfo(bytes)).toThrow(RangeError);
  });
});

describe('getSequenceIndex', () => {
  const sheet = (names: [number, string][]): ParticleSheet => ({
    sequences: names.map(([id, name]) => ({ id, name, clamp: false, alphaCrop: false, noColor: false, noAlpha: false, frames: [], totalTime: 1, floatParams: {} })),
  });

  it('answers an unnamed sequence to its id and a digit name to its number', () => {
    const s = sheet([
      [4, 'CDmeSheetSequence'],
      [9, '2'],
      [1, 'fire'],
    ]);

    expect(getSequenceIndex(s, 4)).toBe(0);
    expect(getSequenceIndex(s, 2)).toBe(1);
    expect(getSequenceIndex(s, 9)).toBe(-1);
    expect(getSequenceIndex(s, 1)).toBe(-1);
    expect(getSequenceIndex(s, -1)).toBe(-1);
    expect(sequenceIdCount(s)).toBe(5);
  });
});

describe('decodesSrgb', () => {
  it('decodes colour reads of formats with an sRGB variant only', () => {
    expect(decodesSrgb({ format: VTexFormat.DXT5 }, true)).toBe(true);
    expect(decodesSrgb({ format: VTexFormat.BC7 }, true)).toBe(true);
    expect(decodesSrgb({ format: VTexFormat.RGBA8888 }, true)).toBe(true);
    expect(decodesSrgb({ format: VTexFormat.DXT5 }, false)).toBe(false);
    expect(decodesSrgb({ format: VTexFormat.ATI2N }, true)).toBe(false);
    expect(decodesSrgb({ format: VTexFormat.RGBA16161616F }, true)).toBe(false);
    expect(decodesSrgb({ format: VTexFormat.PNG_RGBA8888 }, true)).toBe(false);
  });
});

describe('sheet cache', () => {
  it('stores values as unorm16 reads them, truncated and wrapped', () => {
    expect(toUnorm16(0)).toBe(0);
    expect(toUnorm16(1)).toBe(65535);
    expect(toUnorm16(0.5)).toBe(32767);
    expect(toUnorm16(1.5)).toBe(98302 & 0xffff);
  });

  it('keeps every fourth of 1024 samples, wrapping a looping sequence and holding a clamped one', () => {
    expect(pairSample(0, false, false)).toBe(0);
    expect(pairSample(255, false, false)).toBe(1020);
    expect(pairSample(256, false, false)).toBe(0);
    expect(pairSample(256, true, false)).toBe(1023);
    expect(pairSample(9, false, true)).toBe(0);
  });

  it('resamples between frame starts, and a clamped end onto a full blend to the last frame', () => {
    const starts = [0, 256, 512, 768];
    expect(resample(starts, 1024, 128, false)).toEqual({ frameA: 0, frameB: 1, blend: 0.5 });
    expect(resample(starts, 1024, 896, false)).toEqual({ frameA: 3, frameB: 0, blend: 0.5 });
    expect(resample(starts, 1023, 900, true)).toEqual({ frameA: 2, frameB: 3, blend: 1 });
  });

  it('hands out three rows per sequence, once per sheet', () => {
    const cache = new ParticleSheetCache();
    const frame = { displayTime: 1, images: [{ croppedMin: [0, 0], croppedMax: [1, 1], uncroppedMin: [0, 0], uncroppedMax: [1, 1] }] } as const;
    const sequence = { id: 0, name: 'CDmeSheetSequence', clamp: false, alphaCrop: false, noColor: false, noAlpha: false, totalTime: 1, floatParams: {} };
    const a: ParticleSheet = { sequences: [{ ...sequence, frames: [frame as never] }, { ...sequence, id: 1, frames: [frame as never] }] };
    const b: ParticleSheet = { sequences: [{ ...sequence, frames: [frame as never] }] };

    expect(cache.getRows(a)).toEqual({ firstRow: 0, sequenceCount: 2 });
    expect(cache.getRows(b)).toEqual({ firstRow: 6, sequenceCount: 1 });
    expect(cache.getRows(a)).toEqual({ firstRow: 0, sequenceCount: 2 });
    expect(cache.getRows(null)).toEqual({ firstRow: 0, sequenceCount: 0 });
    expect(cache.texture!.image.height).toBe(192);
    cache.dispose();
  });
});

describe('colour blend', () => {
  it('converts the scale per blend type and saturates the result to bytes', () => {
    expect(convertColorScale(ParticleColorBlendType.PARTICLE_COLOR_BLEND_MULTIPLY2X, [0.5, 1, 2])).toEqual([1, 2, 4]);
    expect(convertColorScale(ParticleColorBlendType.PARTICLE_COLOR_BLEND_ADD, [1, 0, 0])).toEqual([255, 0, 0]);
    expect(convertColorScale(ParticleColorBlendType.PARTICLE_COLOR_BLEND_SCREEN, [1, 0.5, 0])).toEqual([0, 0.5, 1]);

    const out: Rgba = [0, 0, 0, 0];
    expect(applyColorBlend(ParticleColorBlendType.PARTICLE_COLOR_BLEND_MULTIPLY, [200, 100, 50, 255], [2, 0.5, 1, 0.5], out)).toEqual([255, 50, 50, 127.5]);
    expect(applyColorBlend(ParticleColorBlendType.PARTICLE_COLOR_BLEND_DIVIDE, [100, 100, 100, 255], [0, 2, 1, 1], out)).toEqual([0, 50, 100, 255]);
  });
});

describe('LightFalloff', () => {
  it('falls to half at the fifty percent distance, bending the fit toward a line where it would turn back', () => {
    const falloff = LightFalloff.solve(50, 200);
    expect(1 / falloff.denominator(50)).toBeCloseTo(0.5, 5);
    expect(falloff.denominator(200)).toBeGreaterThan(falloff.denominator(50));

    // Points the parabola fits without turning back are met exactly
    const gentle = LightFalloff.solve(100, 400);
    expect(1 / gentle.denominator(100)).toBeCloseTo(0.5, 5);
    expect(gentle.isFinite).toBe(true);
  });

  it('cuts a curve without a constant term where it falls to a thousandth of the luminance', () => {
    const falloff = new LightFalloff(0, 0, 1);
    const cutoff = falloff.cutoffFor([1, 1, 1]);
    expect(cutoff.range).toBeCloseTo(Math.sqrt(1000), 2);
    expect(falloff.evaluate(cutoff.range * cutoff.range * 1.01, cutoff)).toBe(0);
  });
});

describe('gradient ramp', () => {
  it('matches the texels VRF generates for the same stops', () => {
    // MaterialLoader.SampleGradient over these stops, as the render oracle's --gradient-test prints it
    const expected =
      '0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 ' +
      '0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 0,0,0 5,1,0 26,6,1 48,11,2 69,16,4 91,21,5 112,25,6 ' +
      '134,30,7 155,35,8 176,42,11 189,61,19 202,79,28 215,98,37 228,116,45 242,135,54 255,153,63 255,159,71 255,166,78 255,172,86 ' +
      '255,179,94 255,186,102 255,192,110 255,199,118 255,205,126 255,212,134 255,218,141 255,225,149 255,232,157 255,238,165 ' +
      '253,240,177 251,240,190 249,241,203';
    const texels = gradientTexels([
      { position: 0.294574, color: [0, 0, 0] },
      { position: 0.511628, color: [0, 0, 0] },
      { position: 0.638243, color: [174, 40, 10] },
      { position: 0.73385, color: [255, 153, 63] },
      { position: 0.940568, color: [255, 240, 167] },
      { position: 1, color: [248, 242, 217] },
    ]);
    const actual = Array.from({ length: 64 }, (_, x) => `${texels[x * 4]},${texels[x * 4 + 1]},${texels[x * 4 + 2]}`).join(' ');

    expect(actual).toBe(expected);
    expect(gradientTexels([])[3]).toBe(255);
  });
});

describe('card bases', () => {
  const view = { right: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1), forward: new Vector3(1, 0, 0) } as RenderView;

  it('rolls the camera axes without renormalizing', () => {
    const [right, up] = screenAlignedBasis(view, Math.PI / 2, 0);
    expect(right.x).toBeCloseTo(0);
    expect(right.z).toBeCloseTo(1);
    expect(up.y).toBeCloseTo(1);
  });

  it('lays a world Z aligned card flat', () => {
    const [right, up] = worldZAlignedBasis(0, 0);
    expect([right.x, right.y, right.z]).toEqual([0, -1, 0]);
    expect([up.x, up.y, up.z]).toEqual([1, 0, 0]);
  });

  it('turns only the right axis by the yaw', () => {
    const [right, up] = quadBasis(new Vector3(1, 0, 0), new Vector3(0, 0, 1), 0, Math.PI / 2);
    expect(Math.abs(right.x)).toBeLessThan(1e-6);
    expect(Math.abs(right.y)).toBeCloseTo(1, 6);
    expect([up.x, up.y, up.z]).toEqual([0, 0, 1]);
  });
});

describe('rope spline', () => {
  it('passes through its middle control points and has their chord as the tangent of a straight run', () => {
    const p = [new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, 0, 0), new Vector3(3, 0, 0)];
    expect(catmullRomV(p[0], p[1], p[2], p[3], 0).x).toBeCloseTo(1);
    expect(catmullRomV(p[0], p[1], p[2], p[3], 1).x).toBeCloseTo(2);
    expect(catmullRomTangent(p[0], p[1], p[2], p[3], 0.5).x).toBeCloseTo(1);
    expect(catmullRom(0, 1, 1, 0, 0.5)).toBeCloseTo(1.125);
  });
});

describe('post process', () => {
  it('maps the white point, in stops, to white', () => {
    const white = 2 ** DEADLOCK_BASE_POST.tonemap.whitePoint;
    const exposureForWhite = white / 2.8 / 2 ** DEADLOCK_BASE_POST.tonemap.exposureBias;
    expect(tonemapChannel(DEADLOCK_BASE_POST, exposureForWhite)).toBeCloseTo(1, 5);
    expect(tonemapChannel(DEADLOCK_BASE_POST, 0)).toBe(0);
    expect(applyTonemapping(VRF_DEFAULT_TONEMAP, 0)).toBeCloseTo(0, 6);
  });

  it('finds the exposure that shows a value at a display level', () => {
    const exposure = exposureForDisplay(DEADLOCK_BASE_POST, 0.18, 0.5);
    expect(tonemapChannel({ ...DEADLOCK_BASE_POST, exposure }, 0.18)).toBeCloseTo(0.5, 5);
  });

  it('reads a decoded vpost', () => {
    const settings = postSettingsFromVpost({
      m_bHasTonemapParams: true,
      m_toneMapParams: { m_flExposureBias: 1, m_flShoulderStrength: 0.2, m_flLinearStrength: 0.3, m_flLinearAngle: 0.1, m_flToeStrength: 0.5, m_flToeNum: 0, m_flToeDenom: 0.7, m_flWhitePoint: 3 },
      m_bHasBloomParams: true,
      m_bloomParams: { m_blendMode: 'BLOOM_BLEND_SCREEN', m_flBloomStrength: 0, m_flScreenBloomStrength: 0.7, m_flBlurBloomStrength: 0, m_flBloomThreshold: 1, m_flBloomThresholdWidth: 1, m_flBlurWeight: [0, 0.1, 0.2, 0.3, 0.4], m_vBlurTint: [[1, 0, 0], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]] },
    });
    expect(settings.tonemap.whitePoint).toBe(3);
    expect(settings.bloom?.blendMode).toBe('BLOOM_BLEND_SCREEN');
    expect(settings.bloom?.blurWeight[4]).toBe(0.4);
    expect(settings.bloom?.blurTint[0]).toEqual([1, 0, 0]);
    expect(postSettingsFromVpost({}).bloom).toBeNull();
  });
});
