import { useEffect, useRef, type ChangeEvent } from 'react';
import { useThree } from '@react-three/fiber';
import { useTranslation } from 'react-i18next';
import * as THREE from 'three';
import { Button } from '../common/ui';
import { Select } from '../common/forms';
import type { ViewerBackground } from '../../lib/viewerBackgrounds';
import { backdropCover, VIEWER_BACKDROP_TYPES } from '../../lib/viewerBackdrop';

function setBackdrop(scene: THREE.Scene, texture: THREE.Texture | null) {
  const previous = scene.background;
  scene.background = texture;
  return () => { if (scene.background === texture) scene.background = previous; };
}

export function ViewerBackdrop({ texture }: { texture: THREE.Texture | null }) {
  const { scene, size } = useThree();
  useEffect(() => {
    if (!texture) return;
    return setBackdrop(scene, texture);
  }, [scene, texture]);
  useEffect(() => {
    if (!texture) return;
    const image = texture.image as HTMLImageElement;
    const crop = backdropCover(image.naturalWidth / image.naturalHeight, size.width / size.height);
    texture.repeat.set(crop.x, crop.y);
    texture.offset.set(crop.offsetX, crop.offsetY);
    texture.updateMatrix();
  }, [texture, size.width, size.height]);
  return null;
}

export function ViewerBackdropControls({ hasImage, loading, onFile, onClear, preset, onPreset }: {
  hasImage: boolean; loading: boolean; onFile: (file: File) => void; onClear: () => void;
  preset: ViewerBackground; onPreset: (value: ViewerBackground) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const presets = {
    broadway: t('locker.pose.backgrounds.broadway'),
    uptown: t('locker.pose.backgrounds.uptown'),
    timesSquare: t('locker.pose.backgrounds.timesSquare'),
  };
  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onFile(file);
  };
  return (
    <div className="space-y-1">
      <span className="block text-xs text-text-secondary">{t('locker.pose.background')}</span>
      <Select inputSize="sm" aria-label={t('locker.pose.background')} value={preset} onChange={(event) => onPreset(event.target.value as ViewerBackground)}>
        {Object.entries(presets).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        <option value="none">{t('locker.pose.backgrounds.none')}</option>
        {preset === 'custom' && <option value="custom">{t('locker.pose.backgrounds.custom')}</option>}
      </Select>
      <input ref={input} type="file" className="hidden" accept={VIEWER_BACKDROP_TYPES.join(',')} onChange={select} aria-label={t('locker.pose.openBackground')} />
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" isLoading={loading} onClick={() => input.current?.click()}>{t('locker.pose.openBackground')}</Button>
        {hasImage && <Button size="sm" variant="ghost" onClick={onClear}>{t('locker.pose.clearBackground')}</Button>}
      </div>
    </div>
  );
}
