import { useTranslation } from 'react-i18next';
import { Button } from '../common/ui';
import { FINISHES } from '../../lib/skinFinishes';
import type { SkinPartFinish } from '../../types/skinEditor';

export function SkinFinishControls({ value, disabled, onChange }: {
  value?: SkinPartFinish; disabled: boolean; onChange: (finish: SkinPartFinish | undefined) => void;
}) {
  const { t } = useTranslation();
  return <fieldset disabled={disabled} className="min-w-0 space-y-4 disabled:opacity-40">
    <legend className="mb-2 text-xs text-text-secondary">{t('foundry.skin.finishTitle')}</legend>
    <div className="grid grid-cols-2 gap-2">
      <Button size="sm" variant="secondary" aria-pressed={!value} className="aria-pressed:border-accent aria-pressed:bg-accent/15"
        onClick={() => onChange(undefined)}>{t('foundry.skin.originalFinish')}</Button>
      {FINISHES.map(({ name, roughness, metalness }) => <Button key={name} size="sm"
        variant="secondary" aria-pressed={value?.roughness === roughness && value.metalness === metalness}
        className="aria-pressed:border-accent aria-pressed:bg-accent/15"
        onClick={() => onChange({ roughness, metalness })}>{t(`foundry.skin.finish.${name}`)}</Button>)}
    </div>
    {!value && <p className="text-xs text-text-secondary">{t('foundry.skin.originalFinishHint')}</p>}
    {value && (['roughness', 'metalness'] as const).map((key) => <label key={key} className="block space-y-2 text-xs text-text-secondary">
      <span className="flex items-center justify-between gap-2"><span>{t(`foundry.skin.${key}`)}</span>
        <span className="tabular-nums text-text-primary">{Math.round(value[key] * 100)}%</span></span>
      <input type="range" min="0" max="1" step="0.01" aria-label={t(`foundry.skin.${key}`)} value={value[key]}
        className="h-7 w-full accent-accent" onChange={(event) => onChange({ ...value, [key]: Number(event.target.value) })} />
    </label>)}
  </fieldset>;
}
