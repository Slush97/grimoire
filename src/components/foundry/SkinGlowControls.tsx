import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { SegmentedControl } from '../common/ui';
import type { SkinGlowAnimation, SkinPartGlow } from '../../types/skinEditor';

/** Glow over the whole part: off, steady, pulsing or cycling through colors. */
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
      onChange={(animation) => onChange(animation === 'off' ? undefined : { color: value?.color ?? color, animation })} />
    {value && value.animation !== 'rainbow' && <div className="[&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
      <HexColorPicker color={value.color} onChange={(next) => onChange({ ...value, color: next })} style={{ width: '100%', height: 120 }} />
    </div>}
  </fieldset>;
}
