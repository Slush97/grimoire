// Ported from ValveResourceFormat (MIT): Renderer/Particles/ParticleSheetCache.cs.
//
// One texture shared by the renderers of a tree that holds the sheet sequences of every texture they
// draw, resampled into rows the spritecard vertex shader looks frames up in.
//
// Each sequence takes three rows of COLUMNS texels, laid out as pairs of texels that each stand for
// one sample of the sequence's timeline:
// - The first row holds, in the first texel of a pair, the blend from frame A to frame B at that
//   sample, the sequence length in sixteenths of a second, whether it clamps, and the blend at the
//   next sample when that sample is still on frame A. The second texel is unused.
// - The second row holds frame A's tile narrowed to the window both frames' art covers, then that
//   window in tile units.
// - The third row holds frame B's tile narrowed to the same window.
// Only the first image of a frame is kept. Rows are handed out on first use and kept for the life of
// the cache, which grows when it runs out of rows.
//
// VRF stores the texels as RGBA16 unorm. WebGL2 has no unorm16 color texture without an extension,
// so they are stored as floats holding exactly what the unorm16 texel reads back as.

import * as THREE from 'three';
import { toInt } from '../numerics';
import type { ParticleSheet, ParticleSheetImage, ParticleSheetSequence } from './sheet';

const f32 = Math.fround;

/** How many texels wide every row is. */
export const SHEET_COLUMNS = 512;

const PAIRS_PER_ROW = SHEET_COLUMNS / 2;
const ROWS_PER_SEQUENCE = 3;
const CHANNELS_PER_TEXEL = 4;
const MINIMUM_ROWS = 3 * 64;
const USHORT_MAX = 65535;

/** How many samples a sequence of more than one frame is resampled into before every fourth is kept. */
const SAMPLE_COUNT = 1024;

const EMPTY_IMAGE: ParticleSheetImage = { croppedMin: [0, 0], croppedMax: [0, 0], uncroppedMin: [0, 0], uncroppedMax: [0, 0] };

/** Where a texture's sequences start in the cache and how many it has (0 for a texture without a sheet). */
export interface SheetRows {
  firstRow: number;
  sequenceCount: number;
}

const NO_ROWS: SheetRows = { firstRow: 0, sequenceCount: 0 };

interface Sample {
  frameA: number;
  frameB: number;
  blend: number;
}

export class ParticleSheetCache {
  private readonly rowsBySheet = new Map<ParticleSheet, SheetRows>();
  /** The texels as unorm16 integers, as VRF keeps them. */
  private texels = new Uint16Array(0);
  private usedRows = 0;
  private height = 0;

  /** The texture the rows live in, or null until a sheet has been added. Replaced when it grows. */
  texture: THREE.DataTexture | null = null;

  /** The rows of `sheet`, resampling and uploading it the first time it is asked for. */
  getRows(sheet: ParticleSheet | null | undefined): SheetRows {
    if (!sheet || sheet.sequences.length === 0) {
      return NO_ROWS;
    }

    let rows = this.rowsBySheet.get(sheet);

    if (!rows) {
      rows = this.add(sheet);
      this.rowsBySheet.set(sheet, rows);
    }

    return rows;
  }

  dispose(): void {
    this.texture?.dispose();
    this.texture = null;
  }

  private add(sheet: ParticleSheet): SheetRows {
    const firstRow = this.usedRows;
    const rowCount = sheet.sequences.length * ROWS_PER_SEQUENCE;

    this.ensureCapacity(firstRow + rowCount);

    sheet.sequences.forEach((sequence, index) => this.writeSequence(sequence, firstRow + index * ROWS_PER_SEQUENCE));

    this.usedRows += rowCount;
    this.upload();

    return { firstRow, sequenceCount: sheet.sequences.length };
  }

  private ensureCapacity(rows: number): void {
    if (rows <= this.height) {
      return;
    }

    let newHeight = Math.max(MINIMUM_ROWS, this.height * 2);

    while (newHeight < rows) {
      newHeight *= 2;
    }

    const texels = new Uint16Array(newHeight * SHEET_COLUMNS * CHANNELS_PER_TEXEL);
    texels.set(this.texels);
    this.texels = texels;
    this.height = newHeight;

    this.texture?.dispose();
    this.texture = null;
  }

  private upload(): void {
    if (this.texture === null) {
      const data = new Float32Array(this.height * SHEET_COLUMNS * CHANNELS_PER_TEXEL);
      const texture = new THREE.DataTexture(data, SHEET_COLUMNS, this.height, THREE.RGBAFormat, THREE.FloatType);
      texture.minFilter = THREE.NearestFilter;
      texture.magFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.colorSpace = THREE.NoColorSpace;
      texture.name = 'Particle sheet cache';
      this.texture = texture;
    }

    const data = this.texture.image.data as Float32Array;

    for (let i = 0; i < this.texels.length; i++) {
      data[i] = this.texels[i] / USHORT_MAX;
    }

    this.texture.needsUpdate = true;
  }

  private writeSequence(sequence: ParticleSheetSequence, row: number): void {
    const frames = sequence.frames;
    const clamp = sequence.clamp;
    const singleFrame = frames.length === 1;

    // A clamped timeline spans one sample fewer, so its last sample lands on the end
    const timelineScale = clamp ? SAMPLE_COUNT - 1 : SAMPLE_COUNT;
    const totalTime = sequence.totalTime > 0 ? f32(sequence.totalTime) : 1;

    const startTimes = new Array<number>(frames.length);
    let elapsed = 0;

    for (let frame = 0; frame < frames.length; frame++) {
      startTimes[frame] = f32(f32(elapsed / totalTime) * timelineScale);
      elapsed = f32(elapsed + f32(frames[frame].displayTime));
    }

    const length = frames.length > 0 ? elapsed : 1;

    // The length is kept in sixteenths of a second and wraps past 4096 seconds
    const lengthTexel = toUshort(toInt(f32(length * 16)));
    const clampTexel = clamp ? USHORT_MAX : 0;

    for (let pair = 0; pair < PAIRS_PER_ROW; pair++) {
      const sample = resample(startTimes, timelineScale, pairSample(pair, clamp, singleFrame), clamp);

      // The blend at the next sample is only kept while that sample is still on frame A, and a
      // looping sequence never looks past its last pair
      let nextBlend = USHORT_MAX;

      if (pair < PAIRS_PER_ROW - 1 || clamp) {
        const next = resample(startTimes, timelineScale, pairSample(pair + 1, clamp, singleFrame), clamp);

        if (next.frameA === sample.frameA) {
          nextBlend = toUnorm16(next.blend);
        }
      }

      this.setTexel(row, pair * 2, toUnorm16(sample.blend), lengthTexel, clampTexel, nextBlend);

      if (frames.length === 0) {
        continue;
      }

      const imageA = firstImage(frames[sample.frameA].images);
      const imageB = firstImage(frames[sample.frameB].images);
      const windowA = cropWindow(imageA);
      const windowB = cropWindow(imageB);
      const windowMin: [number, number] = [Math.min(windowA.min[0], windowB.min[0]), Math.min(windowA.min[1], windowB.min[1])];
      const windowMax: [number, number] = [Math.max(windowA.max[0], windowB.max[0]), Math.max(windowA.max[1], windowB.max[1])];

      this.setRect(row + 1, pair * 2, narrowTile(imageA, windowMin), narrowTile(imageA, windowMax));
      this.setRect(row + 1, pair * 2 + 1, windowMin, windowMax);
      this.setRect(row + 2, pair * 2, narrowTile(imageB, windowMin), narrowTile(imageB, windowMax));
    }
  }

  private setRect(row: number, column: number, min: [number, number], max: [number, number]): void {
    this.setTexel(row, column, toUnorm16(min[0]), toUnorm16(min[1]), toUnorm16(max[0]), toUnorm16(max[1]));
  }

  private setTexel(row: number, column: number, x: number, y: number, z: number, w: number): void {
    const start = (row * SHEET_COLUMNS + column) * CHANNELS_PER_TEXEL;
    this.texels[start] = x;
    this.texels[start + 1] = y;
    this.texels[start + 2] = z;
    this.texels[start + 3] = w;
  }
}

/**
 * The sample a texel pair stands for. Every fourth of the 1024 samples is kept; a looping sequence
 * wraps past the last one and a clamped one holds it.
 */
export function pairSample(pair: number, clamp: boolean, singleFrame: boolean): number {
  if (singleFrame) {
    return 0;
  }

  const sample = Math.trunc(f32(f32(f32(1.0 / PAIRS_PER_ROW) * pair) * SAMPLE_COUNT));
  return clamp ? Math.min(sample, SAMPLE_COUNT - 1) : sample & (SAMPLE_COUNT - 1);
}

/**
 * The frames sample `sample` sits between, given each frame's start on the sampled timeline, and how
 * far it has crossed from the first to the second. From the start of the last frame on, a clamped
 * sequence keeps the second to last frame as frame A with a full blend to the last, so a draw that
 * does not blend frames never shows the last frame.
 */
export function resample(startTimes: readonly number[], timelineScale: number, sample: number, clamp: boolean): Sample {
  const count = startTimes.length;
  let started = 0;

  while (started < count && startTimes[started] <= sample) {
    started++;
  }

  const last = count - 1;

  if (started === 0) {
    return { frameA: 0, frameB: count > 1 ? 1 : 0, blend: 0 };
  }

  if (started < count) {
    const from = started - 1;
    const blend = f32(f32(sample - startTimes[from]) / f32(startTimes[started] - startTimes[from]));
    return { frameA: from, frameB: started, blend };
  }

  if (clamp) {
    return { frameA: count > 1 ? count - 2 : last, frameB: last, blend: 1 };
  }

  const wrapBlend = f32(f32(sample - startTimes[last]) / f32(f32(timelineScale - startTimes[last]) + startTimes[0]));
  return { frameA: last, frameB: 0, blend: wrapBlend };
}

function firstImage(images: readonly ParticleSheetImage[]): ParticleSheetImage {
  return images.length > 0 ? images[0] : EMPTY_IMAGE;
}

/** The part of its tile a frame's cropped art covers, in tile units. */
function cropWindow(image: ParticleSheetImage): { min: [number, number]; max: [number, number] } {
  const sizeX = f32(image.uncroppedMax[0] - image.uncroppedMin[0]);
  const sizeY = f32(image.uncroppedMax[1] - image.uncroppedMin[1]);

  return {
    min: [f32(f32(image.croppedMin[0] - image.uncroppedMin[0]) / sizeX), f32(f32(image.croppedMin[1] - image.uncroppedMin[1]) / sizeY)],
    max: [f32(f32(image.croppedMax[0] - image.uncroppedMin[0]) / sizeX), f32(f32(image.croppedMax[1] - image.uncroppedMin[1]) / sizeY)],
  };
}

/** A point of a frame's tile given in tile units, in atlas coordinates. */
function narrowTile(image: ParticleSheetImage, tilePoint: [number, number]): [number, number] {
  return [
    f32(image.uncroppedMin[0] + f32(tilePoint[0] * f32(image.uncroppedMax[0] - image.uncroppedMin[0]))),
    f32(image.uncroppedMin[1] + f32(tilePoint[1] * f32(image.uncroppedMax[1] - image.uncroppedMin[1]))),
  ];
}

/** A value the texture reads back as unsigned normalized, truncated and not clamped ((ushort)(int)x). */
export function toUnorm16(value: number): number {
  return toUshort(toInt(f32(value * USHORT_MAX)));
}

function toUshort(value: number): number {
  return value & 0xffff;
}
