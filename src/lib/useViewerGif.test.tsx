import { useEffect } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { create, act } from '@react-three/test-renderer';
import { useViewerGif, type ViewerGifControls } from './useViewerGif';
import { captureViewerGif, encodeViewerGif } from './viewerGif';
vi.mock('./viewerGif', async (original) => ({ ...await original<typeof import('./viewerGif')>(), captureViewerGif: vi.fn(), encodeViewerGif: vi.fn() }));
let controls: ViewerGifControls;
const canvas = { current: { width:1,height:1 } as HTMLCanvasElement };
const onError = vi.fn();
function Probe({ captureKey = 'hero' }: { captureKey?: string }) {
  const value = useViewerGif(canvas, captureKey, 'Hero', onError);
  useEffect(() => { controls = value; });
  return null;
}
afterEach(() => { vi.clearAllMocks(); });
it('reviews without downloading, cancels, repeats, and aborts on unmount', async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(captureViewerGif).mockImplementation(async (_, options) => {
    signal = options.signal;
    return {width:1,height:1,frames:[new Uint8ClampedArray([0,0,0,255])]};
  });
  const renderer = await create(<Probe />);
  await act(async () => { await controls.toggle(); });
  expect(controls.status).toBe('review');
  expect(encodeViewerGif).not.toHaveBeenCalled();
  await act(async () => { controls.cancel(); });
  expect(controls.capture).toBeNull();
  await act(async () => { await controls.toggle(); });
  expect(controls.status).toBe('review');
  vi.mocked(captureViewerGif).mockImplementation(async (_, options) => {
    signal = options.signal;
    await new Promise<void>((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), {once:true}));
    throw new Error('unreachable');
  });
  let pending: Promise<void>;
  await act(async () => { controls.cancel(); pending = controls.toggle(); });
  expect(controls.status).toBe('recording');
  await renderer.unmount();
  expect(signal?.aborted).toBe(true);
  await pending!;
  expect(onError).not.toHaveBeenCalled();
});
it('cancels recording when the source changes and ignores the stale completion', async () => {
  let resolve: (value: Awaited<ReturnType<typeof captureViewerGif>>) => void = () => {};
  let signal: AbortSignal | undefined;
  vi.mocked(captureViewerGif).mockImplementation((_, options) => {
    signal=options.signal;
    return new Promise((done) => { resolve=done; });
  });
  const renderer = await create(<Probe />);
  let pending: Promise<void>;
  await act(async () => { pending=controls.toggle(); });
  await renderer.update(<Probe captureKey="other" />);
  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve({width:1,height:1,frames:[new Uint8ClampedArray(4)]}); await pending; });
  expect(controls.status).toBe('idle');
  expect(controls.capture).toBeNull();
  await renderer.unmount();
});

it('cancels encoding and discards review without downloading a stale result', async () => {
  vi.mocked(captureViewerGif).mockResolvedValue({width:1,height:1,frames:[new Uint8ClampedArray(4)]});
  let signal: AbortSignal | undefined;
  vi.mocked(encodeViewerGif).mockImplementation(async (_, _start, _end, pending) => {
    signal = pending;
    await new Promise<void>((_, reject) => pending.addEventListener('abort', () => reject(pending.reason), {once:true}));
    return new Uint8Array();
  });
  const renderer = await create(<Probe />);
  await act(async () => { await controls.toggle(); });
  let pending: Promise<void>;
  await act(async () => { pending = controls.save(); });
  expect(controls.status).toBe('encoding');
  await act(async () => { controls.cancel(); await pending; });
  expect(signal?.aborted).toBe(true);
  expect(controls.capture).toBeNull();
  expect(controls.status).toBe('idle');
  expect(onError).not.toHaveBeenCalled();
  await renderer.unmount();
});
