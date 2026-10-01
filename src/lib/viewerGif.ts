import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export const GIF_RECORDING = { maxSeconds: 4, fps: 12, maxEdge: 480, maxBytes: 24 * 1024 * 1024 } as const;

/** GIF has one-bit alpha. Normalize the owned canvas readback before both
 * quantization and nearest-palette mapping so bright transparent edges cannot
 * select an opaque color. Three bits per RGB channel bound gifenc's histogram
 * to 512 opaque colors plus transparency, avoiding its expensive nearest-pair
 * reduction over tens of thousands of colors on detailed backgrounds.
 * No raw sequence or extra frame buffer is retained. */
export function gifFramePalette(data: Uint8ClampedArray) {
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 128) {
      data[i - 3] = data[i - 2] = data[i - 1] = data[i] = 0;
      hasAlpha = true;
    } else {
      data[i] = 255;
      for (let channel = i - 3; channel < i; channel++) data[channel] = Math.round(data[channel] * 7 / 255) * 255 / 7;
    }
  }
  const format = hasAlpha ? 'rgba4444' : 'rgb565';
  const palette = quantize(data, 256, { format, oneBitAlpha: hasAlpha });
  return { palette, indices: applyPalette(data, palette, format), transparentIndex: palette.findIndex((color) => color[3] === 0) };
}

export function gifDimensions(width: number, height: number): [number, number] {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error('Invalid canvas size');
  const scale = Math.min(1, GIF_RECORDING.maxEdge / Math.max(width, height));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Encode one frame at a time so recording never retains a raw frame sequence.
 * Yield between frames; cancellation and viewer teardown release the canvas. */
export async function recordViewerGif(canvas: HTMLCanvasElement, options: {
  signal: AbortSignal;
  shouldStop: () => boolean;
}): Promise<Uint8Array> {
  const [width, height] = gifDimensions(canvas.width, canvas.height);
  const sample = document.createElement('canvas');
  sample.width = width;
  sample.height = height;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas capture unavailable');
  const gif = GIFEncoder();
  const delay = 1000 / GIF_RECORDING.fps;
  const start = performance.now();
  try {
    for (let frame = 0; frame < GIF_RECORDING.maxSeconds * GIF_RECORDING.fps; frame++) {
      options.signal.throwIfAborted();
      if (frame > 0 && options.shouldStop()) break;
      const frameStart = performance.now();
      context.clearRect(0, 0, width, height);
      context.drawImage(canvas, 0, 0, width, height);
      const { data } = context.getImageData(0, 0, width, height);
      const { palette, indices, transparentIndex } = gifFramePalette(data);
      gif.writeFrame(indices, width, height, {
        palette, delay, repeat: 0, transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex), dispose: 2,
      });
      if (gif.bytesView().byteLength > GIF_RECORDING.maxBytes) throw new Error('Recording size limit exceeded');
      if (performance.now() - start > GIF_RECORDING.maxSeconds * 2000) break;
      await new Promise<void>((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(options.signal.reason); };
        const timer = setTimeout(() => { options.signal.removeEventListener('abort', aborted); resolve(); }, Math.max(0, delay - (performance.now() - frameStart)));
        options.signal.addEventListener('abort', aborted, { once: true });
      });
    }
    options.signal.throwIfAborted();
    gif.finish();
    return gif.bytes();
  } finally {
    sample.width = sample.height = 0;
  }
}
