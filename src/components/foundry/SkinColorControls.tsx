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
    <fieldset disabled={disabled || !tintable} className="space-y-2 disabled:opacity-40">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-xs text-text-secondary">{t('foundry.skin.tint')}</span>
        {!edit?.repaint && <Toggle label={t('foundry.skin.colorize')} checked={edit?.colorize !== false}
          onChange={(colorize) => onChange({ colorize, tint: edit?.tint ?? color })} />
        }
      </div>
      <Toggle label={t('foundry.skin.repaint')} checked={!!edit?.repaint}
        disabled={!adjustable} onChange={(repaint) => onChange({ repaint, tint: edit?.tint ?? color })} />
      {edit?.repaint && <p className="text-xs text-text-secondary">{t('foundry.skin.repaintHint')}</p>}
      <div className="flex justify-between gap-1" aria-label={t('foundry.skin.swatches')}>
        {SWATCHES.map((swatch) => <button key={swatch} type="button" disabled={disabled || !tintable} aria-label={swatch}
          title={swatch} aria-pressed={edit?.tint?.toLowerCase() === swatch} onClick={() => onChange({ tint: swatch })}
          className="h-5 w-5 rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-accent"
          style={{ backgroundColor: swatch }} />)}
      </div>
      <div inert={disabled || !tintable} className="px-2 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={(tint) => onChange({ tint })} style={{ width: '100%', height: 88 }} />
      </div>
      <label className="flex items-center gap-2 rounded-sm border border-border bg-bg-tertiary px-2">
        <input type="color" value={color} disabled={disabled || !tintable} aria-label={t('foundry.skin.tint')}
          className="h-8 w-8 shrink-0 cursor-pointer border-0 bg-transparent" onChange={(event) => onChange({ tint: event.target.value })} />
        <HexColorInput color={color} onChange={(value) => { const hex = value.replace('#', ''); onChange({ tint: `#${hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex}` }); }} prefixed disabled={disabled || !tintable}
          aria-label={t('foundry.skin.hex')} className="h-8 min-w-0 flex-1 bg-transparent text-sm uppercase tabular-nums text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      </label>
    </fieldset>
    <fieldset disabled={disabled || !adjustable} className="space-y-3 border-t border-border pt-3 disabled:opacity-40">
      {sliders.map(({ key, label, min, max, step }) => <label key={key} className="block space-y-1 text-xs text-text-secondary">
        <span className="flex items-center justify-between gap-2">
          <span>{label}</span>
          <input type="number" aria-label={t('foundry.skin.exactValue', { control: label })} min={min} max={max} step={step} value={adjustments[key]}
            className="w-16 rounded-sm border border-border bg-bg-tertiary px-1 py-1 text-right text-xs tabular-nums text-text-primary"
            onChange={(event) => { if (event.target.value !== '') onChange({ adjustments: { ...adjustments, [key]: Math.min(max, Math.max(min, Number(event.target.value))) } }); }} />
        </span>
        <input type="range" aria-label={label} min={min} max={max} step={step} value={adjustments[key]}
          className="h-7 w-full accent-accent" onChange={(event) => onChange({ adjustments: { ...adjustments, [key]: Number(event.target.value) } })} />
      </label>)}
    </fieldset>
    {!tintable && <p className="text-xs text-text-secondary">{t('foundry.skin.tintUnsupported')}</p>}
  </div>;
}
