import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play } from 'lucide-react';
import { Button, IconButton } from '../common/ui';
import { GIF_RECORDING } from '../../lib/viewerGif';
import { ViewerGifTimeline } from './ViewerGifTimeline';
import type { ViewerGifControls } from '../../lib/useViewerGif';

export function ViewerGifReview({ gif }: { gif: ViewerGifControls }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [current, setCurrent] = useState(0);
  const capture = gif.capture;
  const [start, end] = gif.trim;
  const position = Math.max(start, Math.min(end - 1, current));
  const onSeek = (frame: number) => { setPlaying(false); setCurrent(frame); };
  useEffect(() => {
    const target = canvas.current;
    if (!capture || !target) return;
    target.width = capture.width; target.height = capture.height;
    const context = target.getContext('2d');
    if (!context) return;
    context.putImageData(new ImageData(new Uint8ClampedArray(capture.frames[position]), capture.width, capture.height), 0, 0);
    return () => { target.width = target.height = 0; };
  }, [capture, position]);
  useEffect(() => {
    if (!playing || !capture) return;
    const timer = window.setInterval(() => setCurrent((frame) => {
      const clamped = Math.max(start, Math.min(end - 1, frame));
      return clamped + 1 >= end ? start : clamped + 1;
    }), 1000 / GIF_RECORDING.fps);
    return () => window.clearInterval(timer);
  }, [capture, start, end, playing]);
  if (!capture) return null;
  const encoding = gif.status === 'encoding';
  return (
    <div className="pointer-events-auto w-80 max-w-full space-y-2 rounded-sm border border-hl/10 bg-bg-secondary/95 p-3 shadow-lg backdrop-blur-sm">
      <canvas ref={canvas} aria-label={t('locker.pose.gifPreview')} className="h-36 w-full rounded-sm bg-bg-sunken object-contain" />
      <div className="flex items-center gap-2">
        <IconButton size="sm" icon={playing ? Pause : Play} label={playing ? t('locker.pose.pauseAnimation') : t('locker.pose.resumeAnimation')} onClick={() => setPlaying(!playing)} />
        <span className="text-xs tabular-nums text-text-secondary">{(position / GIF_RECORDING.fps).toFixed(2)} / {((end - start) / GIF_RECORDING.fps).toFixed(2)} s</span>
      </div>
      <ViewerGifTimeline capture={capture} start={start} end={end} position={position} disabled={encoding} onTrim={gif.onTrim} onSeek={onSeek} />
      <div className="flex gap-2">
        <Button size="sm" isLoading={encoding} disabled={encoding} onClick={() => { void gif.save(); }}>{t('locker.pose.gifSave')}</Button>
        <Button size="sm" variant="ghost" disabled={encoding} onClick={() => { gif.cancel(); void gif.toggle(); }}>{t('locker.pose.gifRetake')}</Button>
        <Button size="sm" variant="ghost" onClick={gif.cancel}>{t('locker.pose.cancelGif')}</Button>
      </div>
    </div>
  );
}
