import { afterEach, describe, expect, it, vi } from 'vitest';
import { quantize } from 'gifenc';
import { captureViewerGif, encodeViewerGif, gifTrimBounds, gifDimensions, gifFramePalette, GIF_RECORDING, recordViewerGif } from './viewerGif';

vi.mock('gifenc', async (original) => {
  const actual = await original<typeof import('gifenc')>();
  return { ...actual, quantize: vi.fn(actual.quantize) };
});

describe('Viewer GIF resource bounds', () => {
  it('reserves transparency separately from all 512 opaque three-bit cube colors', () => {
    const data = new Uint8ClampedArray(513*4);
    let pixel = 1;
    for (let r = 0; r < 8; r++) for (let g = 0; g < 8; g++) for (let b = 0; b < 8; b++) {
      data.set([r, g, b].map((n) => Math.round(n*255/7)).concat(255), pixel++*4);
    }
    const frame = gifFramePalette(data);
    expect(frame.transparentIndex).toBe(0); expect(frame.indices[0]).toBe(0);
    expect(frame.palette[0]).toEqual([0, 0, 0, 0]); expect(frame.palette.length).toBeLessThanOrEqual(256);
    expect(Array.from(frame.indices.slice(1)).every((index) => index > 0 && frame.palette[index][3] === 255)).toBe(true);
  });
  it('keeps an entirely transparent frame representable', () => {
    const frame = gifFramePalette(new Uint8ClampedArray(16));
    expect(Array.from(frame.indices)).toEqual([0, 0, 0, 0]); expect(frame.palette[0][3]).toBe(0);
  });
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
    const samples = vi.mocked(quantize).mock.calls.at(-1)![0];
    for (let i = 0; i < samples.length; i += 4) colors.add((samples[i] << 16) | (samples[i + 1] << 8) | samples[i + 2]);
    expect(colors.size).toBeLessThanOrEqual(512);
    expect(frame.palette.length).toBeLessThanOrEqual(256);
    expect(frame.indices.length).toBe(480 * 480);
  });
  it('preserves substantially more than eight shading levels without modifying readback', () => {
    const data = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) data.set([i, i, i, 255], i * 4);
    const original = data.slice();
    const frame = gifFramePalette(data, 256);
    expect(data).toEqual(original);
    expect(new Set(frame.palette.map((rgb) => rgb[0])).size).toBeGreaterThan(24);
    let error = 0;
    for (let i = 0; i < 256; i++) error += Math.abs(frame.palette[frame.indices[i]][0] - i);
    expect(error / 256).toBeLessThan(5);
  });
  it('keeps opaque black separate from transparency', () => {
    const frame = gifFramePalette(new Uint8ClampedArray([0,0,0,0,0,0,0,255]));
    expect(frame.indices[0]).toBe(0);
    expect(frame.indices[1]).toBeGreaterThan(0);
    expect(frame.palette[frame.indices[1]]).toEqual([0,0,0,255]);
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


describe('Viewer GIF trim', () => {
  it.each([[-3, 60, [0,48]], [47,47,[47,48]], [9.8,12.2,[9,13]], [NaN,Infinity,[0,48]], [60,-9,[47,48]]])('bounds %s to %s', (start,end,expected) => {
    expect(gifTrimBounds(48,start as number,end as number)).toEqual(expected);
  });
  it('rejects empty captures', () => expect(() => gifTrimBounds(0,0,0)).toThrow());
  it('encodes only selected frames and cancels an encoding between frames', async () => {
    const frames = [0,1,2].map((n) => new Uint8ClampedArray([n*80,0,0,255]));
    const capture = { width:1,height:1,frames };
    const bytes = await encodeViewerGif(capture,1,2,new AbortController().signal);
    expect(Array.from(bytes).filter((n,i) => n === 0x21 && bytes[i+1] === 0xf9).length).toBe(1);
    const controller = new AbortController();
    const result = encodeViewerGif(capture,0,3,controller.signal);
    controller.abort();
    await expect(result).rejects.toThrow();
    expect((await encodeViewerGif(capture,0,3,new AbortController().signal)).at(-1)).toBe(0x3b);
  });
  it('captures without quantizing during recording', async () => {
    const sample = { width:0,height:0,getContext: () => ({ clearRect:vi.fn(),drawImage:vi.fn(),getImageData: () => ({data:new Uint8ClampedArray([0,0,0,255])}) }) };
    vi.stubGlobal('document',{ createElement: () => sample });
    vi.mocked(quantize).mockClear();
    try {
      const capture = await captureViewerGif({width:1,height:1} as HTMLCanvasElement,{signal:new AbortController().signal,shouldStop:()=>true});
      expect(capture.frames).toHaveLength(1);
      expect(quantize).not.toHaveBeenCalled();
      expect(sample.width).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
});
