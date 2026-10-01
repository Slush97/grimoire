import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { Button, IconButton } from '../common/ui';
import { GIF_RECORDING } from '../../lib/viewerGif';
import type { ViewerGifControls } from '../../lib/useViewerGif';

export function ViewerGifReview({ gif }: { gif: ViewerGifControls }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const capture = gif.capture;
  const [start, end] = gif.trim;
  useEffect(() => {
    const target = canvas.current;
    if (!capture || !target) return;
    target.width = capture.width; target.height = capture.height;
    const context = target.getContext('2d');
    if (!context) return;
    let frame = start;
    const draw = () => {
      context.putImageData(new ImageData(new Uint8ClampedArray(capture.frames[frame]), capture.width, capture.height), 0, 0);
      frame = frame + 1 >= end ? start : frame + 1;
    };
    draw();
    const timer = playing ? window.setInterval(draw, 1000 / GIF_RECORDING.fps) : null;
    return () => { if (timer !== null) window.clearInterval(timer); target.width = target.height = 0; };
  }, [capture, start, end, playing]);
  if (!capture) return null;
  const encoding = gif.status === 'encoding';
  return (
    <div className="pointer-events-auto w-80 max-w-full space-y-2 rounded-sm border border-hl/10 bg-bg-secondary/95 p-3 shadow-lg backdrop-blur-sm">
      <canvas ref={canvas} aria-label={t('locker.pose.gifPreview')} className="h-36 w-full rounded-sm bg-bg-sunken object-contain" />
      <div className="flex items-center gap-2">
        <IconButton size="sm" icon={playing ? Pause : Play} label={playing ? t('locker.pose.pauseAnimation') : t('locker.pose.resumeAnimation')} onClick={() => setPlaying(!playing)} />
        <span className="text-xs tabular-nums text-text-secondary">{(start / GIF_RECORDING.fps).toFixed(2)} / {(end / GIF_RECORDING.fps).toFixed(2)} s</span>
      </div>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-8 shrink-0">{t('locker.pose.gifStart')}</span>
        <input type="range" min={0} max={end - 1} step={1} value={start} disabled={encoding} onChange={(e) => gif.onTrim(Number(e.target.value), end)} className="h-7 min-w-0 flex-1 accent-accent" />
      </label>
      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-8 shrink-0">{t('locker.pose.gifEnd')}</span>
        <input type="range" min={start + 1} max={capture.frames.length} step={1} value={end} disabled={encoding} onChange={(e) => gif.onTrim(start, Number(e.target.value))} className="h-7 min-w-0 flex-1 accent-accent" />
      </label>
      <div className="flex gap-2">
        <Button size="sm" isLoading={encoding} disabled={encoding} onClick={() => { void gif.save(); }}>{t('locker.pose.gifSave')}</Button>
        <Button size="sm" variant="ghost" disabled={encoding} onClick={() => { gif.cancel(); void gif.toggle(); }}>{t('locker.pose.gifRetake')}</Button>
        <Button size="sm" variant="ghost" onClick={gif.cancel}>{t('locker.pose.cancelGif')}</Button>
      </div>
    </div>
  );
}
