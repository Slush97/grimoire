import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export const GIF_RECORDING = { maxSeconds: 4, fps: 12, maxEdge: 480, maxBytes: 24 * 1024 * 1024 } as const;
export interface GifCapture { width: number; height: number; frames: Uint8ClampedArray[] }

/** Weighted median cuts adapt at most 512 quantizer input colors to the image.
 * Original pixels are preserved for mapping and preview. */
function paletteSamples(data: Uint8ClampedArray) {
  const histogram = new Map<number, { rgb: number[]; count: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | data[i + 2] >> 3;
    const bin = histogram.get(key);
    if (bin) { bin.count++; for (let c = 0; c < 3; c++) bin.rgb[c] += data[i + c]; }
    else histogram.set(key, { rgb: Array.from(data.slice(i, i + 3)), count: 1 });
  }
  type Bin = { rgb: number[]; count: number };
  const bins = Array.from(histogram.values(), (bin) => ({ rgb: bin.rgb.map((v) => v / bin.count), count: bin.count }));
  const box = (entries: Bin[]) => {
    const ranges = [0, 1, 2].map((c) => {
      let min = 255, max = 0;
      for (const bin of entries) { min = Math.min(min, bin.rgb[c]); max = Math.max(max, bin.rgb[c]); }
      return max - min;
    });
    const axis = ranges.indexOf(Math.max(...ranges));
    const count = entries.reduce((sum, bin) => sum + bin.count, 0);
    return { entries, axis, count, score: entries.length > 1 ? ranges[axis] * Math.sqrt(count) : 0 };
  };
  const boxes = bins.length ? [box(bins)] : [];
  while (boxes.length < 512) {
    let selected = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].score > (selected < 0 ? 0 : boxes[selected].score)) selected = i;
    if (selected < 0) break;
    const current = boxes[selected];
    current.entries.sort((a, b) => a.rgb[current.axis] - b.rgb[current.axis]);
    let split = 1, count = current.entries[0].count;
    while (split < current.entries.length - 1 && count < current.count / 2) count += current.entries[split++].count;
    boxes.splice(selected, 1, box(current.entries.slice(0, split)), box(current.entries.slice(split)));
  }
  const samples: number[] = [];
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  for (const current of boxes) {
    const rgb = [0, 1, 2].map((c) => Math.round(current.entries.reduce((sum, bin) => sum + bin.rgb[c] * bin.count, 0) / current.count));
    for (let n = 0; n < Math.max(1, Math.round(current.count / total * 8192)); n++) samples.push(...rgb, 255);
  }
  return new Uint8ClampedArray(samples);
}

export function gifFramePalette(data: Uint8ClampedArray, width = data.length / 4) {
  const hasAlpha = data.some((value, i) => i % 4 === 3 && value < 128);
  const samples = paletteSamples(data);
  const colors = samples.length ? quantize(samples, hasAlpha ? 255 : 256, { format: 'rgb565' }) : [[0, 0, 0]];
  const mapped = new Uint8ClampedArray(data);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let i = 0; i < mapped.length; i += 4) {
    const pixel = i / 4;
    const offset = (bayer[(Math.floor(pixel / width) % 4) * 4 + pixel % width % 4] - 7.5) * 0.75;
    for (let c = 0; c < 3; c++) mapped[i + c] = data[i + c] + offset;
    mapped[i + 3] = 255;
  }
  const indices = applyPalette(mapped, colors, 'rgb565');
  if (hasAlpha) for (let i = 0; i < indices.length; i++) indices[i] = data[i * 4 + 3] < 128 ? 0 : indices[i] + 1;
  const palette = hasAlpha ? [[0, 0, 0, 0], ...colors.map((color) => [...color.slice(0, 3), 255])] : colors;
  return { palette, indices, transparentIndex: hasAlpha ? 0 : -1 };
}

export function gifDimensions(width: number, height: number): [number, number] {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('Invalid canvas size');
  const scale = Math.min(1, GIF_RECORDING.maxEdge / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}
export function gifTrimBounds(count: number, start: number, end: number): [number, number] {
  if (!Number.isInteger(count) || count < 1) throw new Error('Empty recording');
  const first = Math.max(0, Math.min(count - 1, Number.isFinite(start) ? Math.floor(start) : 0));
  return [first, Math.max(first + 1, Math.min(count, Number.isFinite(end) ? Math.ceil(end) : count))];
}
function yieldCapture(signal: AbortSignal, delay = 0) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve(); }, delay);
    signal.addEventListener('abort', aborted, { once: true });
  });
}
export async function captureViewerGif(canvas: HTMLCanvasElement, options: { signal: AbortSignal; shouldStop: () => boolean }): Promise<GifCapture> {
  const [width, height] = gifDimensions(canvas.width, canvas.height);
  const sample = document.createElement('canvas');
  sample.width = width; sample.height = height;
  const frames: Uint8ClampedArray[] = [];
  const recordingStart = performance.now();
  try {
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Canvas capture unavailable');
    for (let frame = 0; frame < GIF_RECORDING.maxSeconds * GIF_RECORDING.fps; frame++) {
      options.signal.throwIfAborted();
      if (frame > 0 && (options.shouldStop() || performance.now() - recordingStart >= GIF_RECORDING.maxSeconds * 1000)) break;
      const start = performance.now();
      context.clearRect(0, 0, width, height);
      context.drawImage(canvas, 0, 0, width, height);
      frames.push(context.getImageData(0, 0, width, height).data);
      await yieldCapture(options.signal, Math.max(0, 1000 / GIF_RECORDING.fps - (performance.now() - start)));
    }
    options.signal.throwIfAborted();
    return { width, height, frames };
  } finally { sample.width = sample.height = 0; }
}
export async function encodeViewerGif(capture: GifCapture, start: number, end: number, signal: AbortSignal): Promise<Uint8Array> {
  const [first, last] = gifTrimBounds(capture.frames.length, start, end);
  const gif = GIFEncoder();
  for (let frame = first; frame < last; frame++) {
    await yieldCapture(signal);
    const { palette, indices, transparentIndex } = gifFramePalette(capture.frames[frame], capture.width);
    gif.writeFrame(indices, capture.width, capture.height, { palette, delay: 1000 / GIF_RECORDING.fps, repeat: 0,
      transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex), dispose: 2 });
    if (gif.bytesView().byteLength > GIF_RECORDING.maxBytes) throw new Error('Recording size limit exceeded');
  }
  signal.throwIfAborted();
  gif.finish();
  return gif.bytes();
}
export async function recordViewerGif(canvas: HTMLCanvasElement, options: { signal: AbortSignal; shouldStop: () => boolean }) {
  const capture = await captureViewerGif(canvas, options);
  return encodeViewerGif(capture, 0, capture.frames.length, options.signal);
}
