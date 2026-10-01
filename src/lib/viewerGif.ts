import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export const GIF_RECORDING = { maxSeconds: 4, fps: 12, maxEdge: 480, maxBytes: 24 * 1024 * 1024 } as const;

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
      const hasAlpha = data.some((value, index) => index % 4 === 3 && value < 128);
      const format = hasAlpha ? 'rgba4444' : 'rgb565';
      const palette = quantize(data, 256, { format, oneBitAlpha: hasAlpha });
      const transparentIndex = palette.findIndex((color) => color[3] === 0);
      gif.writeFrame(applyPalette(data, palette, format), width, height, {
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
