import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Expand, Pause, Play, RotateCcw, Settings2 } from 'lucide-react';
import { Button, IconButton, Toggle } from '../common/ui';
import { Select } from '../common/forms';

export type HeroViewerScene = 'midtown' | 'studio' | 'transparent';

interface Props {
  animated: boolean;
  clips: string[];
  clip: string;
  paused: boolean;
  speed: number;
  spinPaused: boolean;
  cloth: boolean;
  bloom: boolean;
  particles: boolean;
  scene: HeroViewerScene;
  status: string | null;
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
}

export function HeroViewerToolbar(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-col items-start gap-2">
      {open && (
        <div id={panelId} className="max-h-80 w-64 overflow-y-auto rounded-sm border border-hl/10 bg-bg-secondary/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="space-y-3">
            <Toggle label={t('locker.pose.animated')} checked={p.animated} onChange={p.onAnimated} />
            {p.clips.length > 0 && (
              <label className="block space-y-1 text-xs text-text-secondary">
                <span>{t('locker.pose.animation')}</span>
                <Select inputSize="sm" value={p.clip} onChange={(e) => p.onClip(e.target.value)}>
                  {p.clips.map((clip) => <option key={clip} value={clip}>{clip.replace(/_/g, ' ')}</option>)}
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
            <Toggle label={t('locker.pose.autoRotate')} checked={!p.spinPaused} onChange={(v) => p.onSpinPaused(!v)} />
            <Toggle label={t('locker.pose.physics')} description={t('locker.pose.physicsHint')} checked={p.cloth} onChange={p.onCloth} />
            <Toggle label={t('locker.pose.bloom')} checked={p.bloom} onChange={p.onBloom} />
            <Toggle label={t('locker.pose.particles')} checked={p.particles} onChange={p.onParticles} />
            <p className="text-xs text-text-secondary">{t('locker.pose.cameraHint')}</p>
          </div>
        </div>
      )}
      {p.status && <p role="status" className="max-w-64 rounded-sm bg-bg-secondary/95 px-3 py-2 text-xs text-text-secondary">{p.status}</p>}
      <div className="flex gap-1 rounded-sm border border-hl/10 bg-bg-secondary/95 p-1 backdrop-blur-sm">
        <Button size="sm" variant={open ? 'primary' : 'secondary'} icon={Settings2} aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>{t('locker.pose.controls')}</Button>
        <IconButton size="sm" icon={p.paused ? Play : Pause} label={p.paused ? t('locker.pose.resumeAnimation') : t('locker.pose.pauseAnimation')} disabled={!p.animated} onClick={() => p.onPaused(!p.paused)} />
        <IconButton size="sm" icon={RotateCcw} label={t('locker.pose.resetView')} onClick={p.onReset} />
        <IconButton size="sm" icon={Camera} label={t('locker.pose.screenshot')} onClick={p.onScreenshot} />
        <IconButton size="sm" icon={Expand} label={t('locker.pose.fullscreen')} onClick={p.onFullscreen} />
      </div>
    </div>
  );
}
