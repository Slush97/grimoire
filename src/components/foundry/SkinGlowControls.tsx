import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { SegmentedControl, Toggle } from '../common/ui';
import { GLOW_STRENGTH } from '../../lib/skinFinishes';
import type { SkinGlowAnimation, SkinPartGlow } from '../../types/skinEditor';

/** Brightness, speed and "glow in paint colors" for one glow. */
export function SkinGlowExtras({ value, disabled, onChange }: { value: SkinPartGlow; disabled: boolean; onChange: (glow: SkinPartGlow) => void }) {
  const { t } = useTranslation();
  const slider = (key: 'strength' | 'speed', min: number, max: number, step: number, fallback: number) => {
    const current = value[key] ?? fallback;
    return <label className="block space-y-2 text-xs text-text-secondary">
      <span className="flex items-center justify-between gap-2"><span>{t(`foundry.skin.glow.${key}`)}</span>
        <span className="tabular-nums text-text-primary">{key === 'speed' ? `${current.toFixed(2)}x` : current.toFixed(1)}</span></span>
      <input type="range" min={min} max={max} step={step} value={current} disabled={disabled} aria-label={t(`foundry.skin.glow.${key}`)}
        className="h-7 w-full accent-accent" onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} />
    </label>;
  };
  return <div className="space-y-3">
    {slider('strength', 0.5, 20, 0.5, GLOW_STRENGTH)}
    {value.animation !== 'steady' && slider('speed', 0.25, 4, 0.25, 1)}
    <Toggle label={t('foundry.skin.glow.paintColors')} checked={!!value.paintColors} disabled={disabled}
      onChange={(paintColors) => onChange({ ...value, paintColors: paintColors || undefined })} />
    {!value.paintColors && value.animation !== 'rainbow' && <div className="[&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
      <HexColorPicker color={value.color} onChange={(color) => onChange({ ...value, color })} style={{ width: '100%', height: 120 }} />
    </div>}
  </div>;
}

/** Glow over the whole part: off, steady, pulsing or cycling through colors, with the extras once on. */
export function SkinGlowControls({ value, color, disabled, blockedTitle, onChange }: {
  value?: SkinPartGlow; color: string; disabled: boolean;
  /** Why glow is off limits here, shown as a tooltip: the part already glows where it was painted. */
  blockedTitle?: string;
  onChange: (glow: SkinPartGlow | undefined) => void;
}) {
  const { t } = useTranslation();
  return <fieldset disabled={disabled || !!blockedTitle} title={blockedTitle} className="min-w-0 space-y-3 disabled:opacity-40">
    <legend className="mb-2 text-xs text-text-secondary">{t('foundry.skin.paint.glow')}</legend>
    <SegmentedControl<'off' | SkinGlowAnimation> fill disabled={disabled || !!blockedTitle} label={t('foundry.skin.paint.glow')} value={value?.animation ?? 'off'}
      options={[{ value: 'off', label: t('foundry.skin.glowOff') },
        ...(['steady', 'pulse', 'rainbow'] as const).map((animation) => ({ value: animation, label: t(`foundry.skin.paint.glows.${animation}`) }))]}
      onChange={(animation) => onChange(animation === 'off' ? undefined : { ...value, color: value?.color ?? color, animation })} />
    {value && <SkinGlowExtras value={value} disabled={disabled || !!blockedTitle} onChange={onChange} />}
  </fieldset>;
}
