import { afterEach, describe, expect, it, vi } from 'vitest';
import { gifDimensions, gifFramePalette, GIF_RECORDING, recordViewerGif } from './viewerGif';

describe('Viewer GIF resource bounds', () => {
  it('maps faint white and colored edges to transparency while retaining opaque color', () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 0, 255, 255, 255, 1, 255, 255, 255, 120,
      230, 40, 210, 127, 230, 40, 210, 128, 255, 255, 255, 255,
    ]);
    const frame = gifFramePalette(data);
    expect(Array.from(frame.indices.slice(0, 4))).toEqual(Array(4).fill(frame.transparentIndex));
    expect(frame.indices[4]).not.toBe(frame.transparentIndex);
    expect(frame.indices[5]).not.toBe(frame.transparentIndex);
    expect(frame.palette[frame.indices[5]].slice(0, 3)).toEqual([255, 255, 255]);
  });
  it('bounds the palette reduction input for a full-size high-entropy frame', () => {
    const data = new Uint8ClampedArray(480 * 480 * 4);
    let state = 123456789;
    for (let i = 0; i < data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        data[i + channel] = state >>> 24;
      }
      data[i + 3] = 255;
    }
    const frame = gifFramePalette(data);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    expect(colors.size).toBeLessThanOrEqual(512);
    expect(frame.palette.length).toBeLessThanOrEqual(256);
    expect(frame.indices.length).toBe(480 * 480);
  });
  it('bounds both portrait and landscape captures without stretching or enlarging', () => {
    expect(gifDimensions(1920, 1080)).toEqual([480, 270]);
    expect(gifDimensions(1080, 1920)).toEqual([270, 480]);
    expect(gifDimensions(100, 50)).toEqual([100, 50]);
    expect(GIF_RECORDING.maxSeconds * GIF_RECORDING.fps).toBe(48);
  });
  it.each([0, -1, Infinity, NaN])('rejects an invalid canvas dimension %s', (size) => {
    expect(() => gifDimensions(size, 100)).toThrow();
  });
});

describe('Viewer GIF lifecycle', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function setup() {
    const sample = { width: 0, height: 0, getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]) }) }) };
    vi.stubGlobal('document', { createElement: () => sample });
    return { sample, canvas: { width: 2, height: 1 } as HTMLCanvasElement };
  }
  it('finishes a stopped recording and permits an independent repeat', async () => {
    vi.useFakeTimers();
    const { canvas, sample } = setup();
    for (let recording = 0; recording < 2; recording++) {
      const result = recordViewerGif(canvas, { signal: new AbortController().signal, shouldStop: () => true });
      await vi.runAllTimersAsync();
      const bytes = await result;
      expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
      expect(bytes.at(-1)).toBe(0x3b);
      expect([sample.width, sample.height]).toEqual([0, 0]);
    }
  });
  it('cancels pending recording without returning a partial download', async () => {
    const { canvas, sample } = setup();
    const controller = new AbortController();
    const result = recordViewerGif(canvas, { signal: controller.signal, shouldStop: () => false });
    controller.abort();
    await expect(result).rejects.toThrow();
    expect([sample.width, sample.height]).toEqual([0, 0]);
  });
});
