import { useEffect, useId, useState, type RefObject, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Film, Pause, Play, RotateCcw, RotateCw, Settings2, Square, X } from 'lucide-react';
import { IconButton, Toggle } from '../common/ui';
import { Select } from '../common/forms';
import { ViewerGifReview } from './ViewerGifReview';
import { ViewerFullscreenButton } from './ViewerFullscreenButton';
import type { ViewerGifControls } from '../../lib/useViewerGif';
import { clampAnimationTime, groupHeroClips, heroClipLabel, type HeroPlaybackProgress } from '../../lib/heroViewerPlayback';

export type HeroViewerScene = 'midtown' | 'studio' | 'transparent';

interface Props {
  heroName?: string;
  animated: boolean;
  clips: string[];
  clip: string;
  paused: boolean;
  speed: number;
  progressRef: RefObject<HeroPlaybackProgress>;
  onSeek: (value: number) => void;
  spinPaused: boolean;
  cloth: boolean;
  bloom: boolean;
  particles: boolean;
  scene: HeroViewerScene;
  status: string | null;
  backdropControls?: ReactNode;
  onAnimated: (value: boolean) => void;
  onClip: (value: string) => void;
  onPaused: (value: boolean) => void;
  onSpeed: (value: number) => void;
  onSpinPaused: (value: boolean) => void;
  onCloth: (value: boolean) => void;
  onBloom: (value: boolean) => void;
  onParticles: (value: boolean) => void;
  onScene: (value: HeroViewerScene) => void;
  onReset: () => void;
  onScreenshot: () => void;
  onFullscreen: () => void;
  gifAvailable: boolean;
  gif: ViewerGifControls;
  onGif: () => void;
}

function AnimationTimeline({ progressRef, onSeek }: Pick<Props, 'progressRef' | 'onSeek'>) {
  const { t } = useTranslation();
  const [position, setPosition] = useState<HeroPlaybackProgress>({ time: 0, duration: 0 });
  useEffect(() => {
    // Only this small control samples playback, keeping React out of the scene's
    // per-frame animation path. Unmounting the controls stops the timer.
    const timer = window.setInterval(() => {
      const { time, duration } = progressRef.current;
      setPosition((old) => old.time === time && old.duration === duration ? old : { time, duration });
    }, 100);
    return () => window.clearInterval(timer);
  }, [progressRef]);
  return (
    <div className="flex items-center gap-2">
      <input type="range" min={0} max={position.duration || 1} step={0.01}
        disabled={position.duration <= 0} value={clampAnimationTime(position.time, position.duration)}
        aria-label={t('locker.pose.seek')} aria-valuetext={`${position.time.toFixed(2)} / ${position.duration.toFixed(2)}`}
        className="h-7 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-60"
        onChange={(event) => {
          const time = clampAnimationTime(Number(event.target.value), position.duration);
          setPosition((p) => ({ ...p, time }));
          onSeek(time);
        }} />
      <span className="shrink-0 text-2xs tabular-nums text-text-secondary" aria-hidden="true">
        {position.time.toFixed(1)} / {position.duration.toFixed(1)}
      </span>
    </div>
  );
}

export function HeroViewerToolbar(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const clipGroups = groupHeroClips(p.clips, p.heroName);
  const clipGroupLabel = {
    idle: t('locker.pose.clipGroups.idle'),
    movement: t('locker.pose.clipGroups.movement'),
    combat: t('locker.pose.clipGroups.combat'),
    other: t('locker.pose.clipGroups.other'),
  };
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex flex-col items-start gap-2">
      {open && (
        <div id={panelId} className="pointer-events-auto max-h-80 w-64 max-w-full overflow-y-auto rounded-sm border border-hl/10 bg-bg-secondary/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="space-y-3">
            <Toggle label={t('locker.pose.animated')} checked={p.animated} onChange={p.onAnimated} />
            {p.clips.length > 0 && (
              <label className="block space-y-1 text-xs text-text-secondary">
                <span>{t('locker.pose.animation')}</span>
                <Select inputSize="sm" value={p.clip} onChange={(e) => p.onClip(e.target.value)}>
                  {clipGroups.map(({ group, clips }) => (
                    <optgroup key={group} label={clipGroupLabel[group]}>
                      {clips.map((clip) => <option key={clip} value={clip}>{heroClipLabel(clip, t, p.heroName)}</option>)}
                    </optgroup>
                  ))}
                </Select>
              </label>
            )}
            <label className="block space-y-1 text-xs text-text-secondary">
              <span>{t('locker.pose.speed')}</span>
              <Select inputSize="sm" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))}>
                {[0.25, 0.5, 1, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
              </Select>
            </label>
            <label className="block space-y-1 text-xs text-text-secondary">
              <span>{t('locker.pose.scene')}</span>
              <Select inputSize="sm" value={p.scene} onChange={(e) => p.onScene(e.target.value as HeroViewerScene)}>
                <option value="midtown">{t('locker.pose.midtown')}</option>
                <option value="studio">{t('locker.pose.studio')}</option>
                <option value="transparent">{t('locker.pose.transparent')}</option>
              </Select>
            </label>
            {p.backdropControls}
            <Toggle label={t('locker.pose.autoRotate')} checked={!p.spinPaused} onChange={(v) => p.onSpinPaused(!v)} />
            <Toggle label={t('locker.pose.physics')} checked={p.cloth} onChange={p.onCloth} />
            <Toggle label={t('locker.pose.bloom')} checked={p.bloom} onChange={p.onBloom} />
            <Toggle label={t('locker.pose.particles')} checked={p.particles} onChange={p.onParticles} />
          </div>
        </div>
      )}
      {p.gif.capture && <ViewerGifReview gif={p.gif} />}
      {p.status && <p role="status" className="pointer-events-auto max-w-64 rounded-sm bg-bg-secondary/95 px-3 py-2 text-xs text-text-secondary">{p.status}</p>}
      <div className="pointer-events-auto w-80 max-w-full rounded-sm border border-hl/10 bg-bg-secondary/95 backdrop-blur-sm">
        {p.animated && p.clips.length > 0 && (
          <div className="px-2 pt-1">
            <AnimationTimeline progressRef={p.progressRef} onSeek={p.onSeek} />
          </div>
        )}
        <div className="flex flex-nowrap items-center justify-between gap-1 p-1">
        <IconButton size="sm" icon={Settings2} label={t('locker.pose.controls')} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)} />
        <IconButton size="sm" icon={p.paused ? Play : Pause} label={p.paused ? t('locker.pose.resumeAnimation') : t('locker.pose.pauseAnimation')} disabled={!p.animated || p.clips.length === 0} onClick={() => p.onPaused(!p.paused)} />
        <IconButton size="sm" icon={RotateCw} label={t('locker.pose.autoRotate')} aria-pressed={!p.spinPaused} className="aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent" onClick={() => p.onSpinPaused(!p.spinPaused)} />
        <IconButton size="sm" icon={RotateCcw} label={t('locker.pose.resetView')} onClick={p.onReset} />
        <IconButton size="sm" icon={Camera} label={t('locker.pose.screenshot')} onClick={p.onScreenshot} />
        <IconButton size="sm" icon={p.gif.recording ? Square : Film} label={p.gif.recording ? t('locker.pose.stopGif') : t('locker.pose.recordGif')} aria-pressed={p.gif.recording} disabled={!p.gifAvailable || p.gif.status === 'encoding' || p.gif.status === 'review'} className="aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent" onClick={p.onGif} />
        <IconButton size="sm" icon={X} label={t('locker.pose.cancelGif')} disabled={p.gif.status === 'idle'} onClick={p.gif.cancel} />
        <ViewerFullscreenButton onRequest={p.onFullscreen} />
        </div>
      </div>
    </div>
  );
}
