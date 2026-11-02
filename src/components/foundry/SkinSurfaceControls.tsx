import { useTranslation } from 'react-i18next';
import { Button, SegmentedControl } from '../common/ui';
import type { SkinPartSurface } from '../../types/skinEditor';

export function SkinSurfaceControls({ value, disabled, onChange }: {
  value?: SkinPartSurface; disabled: boolean; onChange: (surface: SkinPartSurface | undefined) => void;
}) {
  const { t } = useTranslation();
  if (value?.mode === 'ghost') return <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-40">
    <legend className="mb-2 text-xs text-text-secondary">{t('foundry.skin.transparency')}</legend>
    <p className="text-xs text-text-secondary">{t('foundry.skin.ghostUnsupported')}</p>
    <div className="grid grid-cols-2 gap-2">
      <Button size="sm" variant="secondary" onClick={() => onChange(undefined)}>{t('foundry.skin.originalFinish')}</Button>
      <Button size="sm" variant="secondary" onClick={() => onChange({ mode: 'translucent', opacity: value.opacity })}>{t('foundry.skin.translucent')}</Button>
    </div>
  </fieldset>;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-40">
    <legend className="mb-2 text-xs text-text-secondary">{t('foundry.skin.transparency')}</legend>
    <SegmentedControl<'original' | 'translucent'> fill disabled={disabled} label={t('foundry.skin.transparency')} value={value?.mode ?? 'original'}
      options={[{ value: 'original', label: t('foundry.skin.originalFinish') },
        { value: 'translucent', label: t('foundry.skin.translucent') }]}
      onChange={(mode) => onChange(mode === 'original' ? undefined : { mode, opacity: value?.opacity ?? 0.35 })} />
    {value && <label className="block space-y-2 text-xs text-text-secondary">
      <span className="flex items-center justify-between gap-2"><span>{t('foundry.skin.opacity')}</span>
        <span className="tabular-nums text-text-primary">{Math.round(value.opacity * 100)}%</span></span>
      <input type="range" min="0" max="1" step="0.01" aria-label={t('foundry.skin.opacity')} value={value.opacity}
        className="h-7 w-full accent-accent" onChange={(event) => onChange({ ...value, opacity: Number(event.target.value) })} />
    </label>}
  </fieldset>;
}
