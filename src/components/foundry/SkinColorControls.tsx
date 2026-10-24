import { HexColorPicker, HexColorInput } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import { Toggle } from '../common/ui';
import { ORIGINAL_SKIN_COLOR } from '../../lib/skinColorAdjustments';
import type { SkinPartEdit } from '../../types/skinEditor';

const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#84cc16', '#2dd4bf', '#3b82f6', '#a855f7', '#ec4899', '#eeeeee', '#252525'];

export function SkinColorControls({ color, edit, tintable, adjustable, disabled, onChange }: {
  color: string; edit?: SkinPartEdit; tintable: boolean; adjustable: boolean; disabled: boolean;
  onChange: (patch: Partial<SkinPartEdit>) => void;
}) {
  const { t } = useTranslation();
  const adjustments = edit?.adjustments ?? ORIGINAL_SKIN_COLOR;
  const sliders = [
    { key: 'hue', label: t('foundry.skin.hue'), min: -180, max: 180, step: 1 },
    { key: 'saturation', label: t('foundry.skin.saturation'), min: 0, max: 2, step: 0.01 },
    { key: 'brightness', label: t('foundry.skin.brightness'), min: 0, max: 2, step: 0.01 },
  ] satisfies Array<{ key: keyof typeof adjustments; label: string; min: number; max: number; step: number }>;
  return <div className="space-y-3">
    <fieldset disabled={disabled || !adjustable} className="space-y-1 disabled:opacity-40">
      {sliders.map(({ key, label, min, max, step }) => <label key={key} className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-16 shrink-0">{label}</span>
        <input type="range" aria-label={label} min={min} max={max} step={step} value={adjustments[key]}
          className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onChange({ adjustments: { ...adjustments, [key]: Number(event.target.value) } })} />
        <input type="number" aria-label={t('foundry.skin.exactValue', { control: label })} min={min} max={max} step={step} value={adjustments[key]}
          className="w-14 rounded-sm border border-border bg-bg-tertiary px-1 py-1 text-right text-xs tabular-nums text-text-primary"
          onChange={(event) => { if (event.target.value !== '') onChange({ adjustments: { ...adjustments, [key]: Math.min(max, Math.max(min, Number(event.target.value))) } }); }} />
      </label>)}
    </fieldset>
    <fieldset disabled={disabled || !tintable} className="space-y-2 border-t border-border pt-3 disabled:opacity-40">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-text-secondary">{t('foundry.skin.tint')}</span>
        <Toggle label={t('foundry.skin.colorize')} checked={edit?.colorize !== false}
          onChange={(colorize) => onChange({ colorize, tint: edit?.tint ?? color })} />
      </div>
      <div className="flex justify-between gap-1" aria-label={t('foundry.skin.swatches')}>
        {SWATCHES.map((swatch) => <button key={swatch} type="button" disabled={disabled || !tintable} aria-label={swatch}
          title={swatch} aria-pressed={edit?.tint?.toLowerCase() === swatch} onClick={() => onChange({ tint: swatch })}
          className="h-5 w-5 rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-accent"
          style={{ backgroundColor: swatch }} />)}
      </div>
      <div inert={disabled || !tintable} className="[&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={(tint) => onChange({ tint })} style={{ width: '100%', height: 100 }} />
      </div>
      <label className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-2">
        <input type="color" value={color} disabled={disabled || !tintable} aria-label={t('foundry.skin.tint')}
          className="h-9 w-8 shrink-0 cursor-pointer border-0 bg-transparent" onChange={(event) => onChange({ tint: event.target.value })} />
        <HexColorInput color={color} onChange={(value) => { const hex = value.replace('#', ''); onChange({ tint: `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}` }); }} prefixed disabled={disabled || !tintable}
          aria-label={t('foundry.skin.hex')} className="min-w-0 flex-1 bg-transparent py-2 text-sm uppercase tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      </label>
    </fieldset>
    {!tintable && <p className="text-xs text-text-secondary">{t('foundry.skin.tintUnsupported')}</p>}
  </div>;
}
