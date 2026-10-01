import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';
import { GIF_RECORDING, type GifCapture } from '../../lib/viewerGif';

type Target = 'start' | 'end' | 'position';
interface Props {
  capture: GifCapture;
  start: number;
  end: number;
  position: number;
  disabled: boolean;
  onTrim: (start: number, end: number) => void;
  onSeek: (frame: number) => void;
}

export function ViewerGifTimeline({ capture, start, end, position, disabled, onTrim, onSeek }: Props) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const thumbnails = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; target: Target; element: HTMLElement; initialX: number; initialValue: number } | null>(null);
  const count = capture.frames.length;
  useEffect(() => {
    const canvas = thumbnails.current;
    if (!canvas) return;
    canvas.width = 480; canvas.height = 64;
    const context = canvas.getContext('2d');
    if (!context) return;
    const source = document.createElement('canvas');
    source.width = capture.width; source.height = capture.height;
    const sample = source.getContext('2d');
    if (sample) for (let i = 0; i < 6; i++) {
      sample.putImageData(new ImageData(new Uint8ClampedArray(capture.frames[Math.round(i * (count - 1) / 5)]), capture.width, capture.height), 0, 0);
      context.drawImage(source, i * 80, 0, 80, 64);
    }
    source.width = source.height = 0;
    return () => { canvas.width = canvas.height = 0; };
  }, [capture, count]);
  useEffect(() => () => {
    const active = drag.current;
    if (active?.element.hasPointerCapture(active.id)) active.element.releasePointerCapture(active.id);
    drag.current = null;
  }, []);
  const change = (target: Target, value: number) => {
    if (disabled) return;
    if (target === 'start') {
      const first = Math.max(0, Math.min(end - 1, value));
      onTrim(first, end); onSeek(first);
    } else if (target === 'end') {
      const last = Math.max(start + 1, Math.min(count, value));
      onTrim(start, last); onSeek(last - 1);
    } else onSeek(Math.max(start, Math.min(end - 1, value)));
  };
  const updatePointer = (event: PointerEvent<HTMLElement>, target: Target) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const active = drag.current;
    const value = active && target !== 'position'
      ? active.initialValue + Math.round((event.clientX - active.initialX) / rect.width * count)
      : Math.round((event.clientX - rect.left) / rect.width * count);
    change(target, value);
  };
  const down = (event: PointerEvent<HTMLElement>, target: Target) => {
    if (disabled || event.button !== 0 || drag.current) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, target, element: event.currentTarget, initialX: event.clientX, initialValue: target === 'start' ? start : target === 'end' ? end : position };
    if (target === 'position') updatePointer(event, target);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (active?.id === event.pointerId) { event.stopPropagation(); updatePointer(event, active.target); }
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (active?.id !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const keyboard = (event: KeyboardEvent<HTMLElement>, target: Target, value: number, min: number, max: number) => {
    const step = event.shiftKey ? GIF_RECORDING.fps : 1;
    const next = event.key === 'Home' ? min : event.key === 'End' ? max
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? value - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? value + step : null;
    if (next === null || disabled) return;
    event.preventDefault(); event.stopPropagation(); change(target, next);
  };
  const time = (frame: number) => `${(frame / GIF_RECORDING.fps).toFixed(2)} s`;
  const pointerEvents = { onPointerMove: move, onPointerUp: finish, onPointerCancel: finish, onLostPointerCapture: finish };
  const percent = (frame: number) => `${frame / count * 100}%`;
  return (
    <div className="px-3 pt-2">
      <div ref={track} role="slider" tabIndex={disabled ? -1 : 0} aria-label={t('locker.pose.gifPosition')}
        aria-valuemin={start} aria-valuemax={end - 1} aria-valuenow={position} aria-valuetext={time(position)} aria-disabled={disabled}
        className="relative h-10 touch-none rounded-sm bg-bg-sunken outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onPointerDown={(event) => down(event, 'position')} {...pointerEvents}
        onKeyDown={(event) => keyboard(event, 'position', position, start, end - 1)}>
        <canvas ref={thumbnails} aria-hidden="true" className="pointer-events-none h-full w-full rounded-sm opacity-50" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-y-2 border-accent bg-accent/15" style={{ left: percent(start), width: percent(end - start) }} />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-1 -top-2 w-0.5 bg-text-primary" style={{ left: percent(position + 0.5) }}>
          <span className="absolute -left-1 -top-1 h-2 w-2 rounded-sm bg-text-primary" />
        </div>
        {(['start', 'end'] as const).map((target) => {
          const first = target === 'start';
          const value = first ? start : end;
          const min = first ? 0 : start + 1;
          const max = first ? end - 1 : count;
          return <div key={target} role="slider" tabIndex={disabled ? -1 : 0} aria-label={first ? t('locker.pose.gifStart') : t('locker.pose.gifEnd')}
            aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={time(value)} aria-disabled={disabled}
            className={`absolute inset-y-0 flex w-3 touch-none cursor-ew-resize items-center justify-center rounded-sm bg-accent text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-text-primary ${first ? '-translate-x-full' : ''}`}
            style={{ left: percent(value) }} onPointerDown={(event) => down(event, target)} {...pointerEvents}
            onKeyDown={(event) => keyboard(event, target, value, min, max)}>
            <GripVertical className="h-4 w-3" aria-hidden="true" />
          </div>;
        })}
      </div>
      <div className="mt-2 flex justify-between text-2xs tabular-nums text-text-secondary" aria-hidden="true">
        <span>{time(start)}</span><span>{time(end)}</span>
      </div>
    </div>
  );
}
