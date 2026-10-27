import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, X } from 'lucide-react';
import { Button, IconButton, Toggle } from '../common/ui';
import TrippySpriteSwatch from '../locker/TrippySpriteSwatch';
import { previewTrippySprite } from '../../lib/api';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import { TRIPPY_STYLES, type TrippyStyleName, type TrippySpriteResult } from '../../types/mod';
import type { SkinPartPattern } from '../../types/skinEditor';

// Moo saves patch density (vpkmerge draws 9 x scale patches across), so a bigger scale means smaller patches.
// The slider shows patch size instead: right is bigger, and each step changes the size by the same ratio.
const MOO_MIN_SCALE = 0.25, MOO_MAX_SCALE = 8;
const mooScaleAt = (position: number) =>
  Math.round(MOO_MAX_SCALE * (MOO_MIN_SCALE / MOO_MAX_SCALE) ** (position / 100) * 100) / 100;
const mooSizePosition = (scale: number) =>
  Math.round(100 * Math.log(scale / MOO_MAX_SCALE) / Math.log(MOO_MIN_SCALE / MOO_MAX_SCALE));

/** `still` hides the scroll speed, for areas of a part: scrolling moves the whole material. */
export function SkinPatternPicker({ value, color, disabled, still = false, onChange }: {
  value: SkinPartPattern | null; color: string; disabled: boolean; still?: boolean; onChange: (value: SkinPartPattern | null) => void;
}) {
  const { t } = useTranslation();
  const labels = { intensity: t('foundry.skin.intensity'), phase: t('foundry.skin.phase'), scroll: t('foundry.skin.scroll') };
  const [sprites, setSprites] = useState<Partial<Record<TrippyStyleName, TrippySpriteResult>>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(TRIPPY_STYLES.map(async (style) => {
      try { return { style, sprite: await previewTrippySprite({ style, intensity: 1, phase: 0, scroll: 0, frames: 1, size: 64 }) }; }
      catch { return null; }
    })).then((entries) => {
      if (cancelled) return;
      const next: Partial<Record<TrippyStyleName, TrippySpriteResult>> = {};
      for (const entry of entries) if (entry) next[entry.style] = entry.sprite;
      setSprites(next);
    });
    return () => { cancelled = true; };
  }, []);
  return <div className="space-y-3">
    <div className="grid grid-cols-4 gap-1">
      <button type="button" disabled={disabled} aria-pressed={value === null} onClick={() => onChange(null)}
        className={`min-w-0 rounded-sm border p-1 text-2xs ${value === null ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-tertiary text-text-secondary'}`}>
        <span className="flex h-6 items-center justify-center"><RotateCcw className="h-4 w-4" /></span>
        <span className="mt-1 block truncate">{t('foundry.skin.noPattern')}</span>
      </button>
      {TRIPPY_STYLES.map((style) => <button key={style} type="button" aria-pressed={value?.style === style} disabled={disabled}
        aria-label={TRIPPY_STYLE_LABELS[style]} title={TRIPPY_STYLE_LABELS[style]} onClick={() => onChange({ style, intensity: value?.intensity ?? 1, phase: value?.phase ?? 0, scroll: still ? 0 : value?.scroll ?? 0.5,
          colors: value?.colors, scale: style === 'moo' ? value?.style === 'moo' ? value.scale ?? 1 : 1 : undefined })}
        className={`min-w-0 overflow-hidden rounded-sm border p-1 text-2xs transition-colors disabled:opacity-40 ${value?.style === style ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-tertiary text-text-secondary hover:bg-hl/5'}`}>
        <TrippySpriteSwatch sprite={sprites[style] ?? null} className="h-6 w-full rounded-sm" />
        <span className="mt-1 block truncate">{TRIPPY_STYLE_LABELS[style]}</span>
      </button>)}
    </div>
    {value && <div className="space-y-2">
      {value.style === 'moo' && <label className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-16 shrink-0">{t('foundry.skin.patchSize')}</span>
        <input type="range" min={0} max={100} step={1} value={mooSizePosition(value.scale ?? 1)} disabled={disabled}
          aria-label={t('foundry.skin.patchSize')} className="h-7 min-w-0 flex-1 accent-accent"
          onChange={(event) => onChange({ ...value, scale: mooScaleAt(Number(event.target.value)) })} />
        <span className="w-9 text-right tabular-nums">{Number((1 / (value.scale ?? 1)).toPrecision(2))}×</span>
      </label>}
      <Toggle label={t('foundry.skin.customPatternColors')} checked={!!value.colors} disabled={disabled}
        onChange={(custom) => onChange({ ...value, colors: custom ? [color, '#ffffff'] : undefined })} />
      {value.colors && <div className="space-y-2">
        <div aria-hidden className="h-2 rounded-sm" style={{ background: `linear-gradient(to right, ${value.colors.join(',')})` }} />
        <div className="flex flex-wrap gap-2">
          {value.colors.map((stop, index) => <div key={index} className="flex items-center gap-1">
            <input type="color" value={stop} disabled={disabled} aria-label={t('foundry.skin.patternColor', { index: index + 1 })}
              className="h-8 w-8 cursor-pointer border-0 bg-transparent" onChange={(event) => onChange({ ...value,
                colors: value.colors?.map((existing, i) => i === index ? event.target.value : existing) })} />
            {value.colors && value.colors.length > 2 && <IconButton size="sm" icon={X} disabled={disabled}
              label={t('foundry.skin.removePatternColor', { index: index + 1 })}
              onClick={() => onChange({ ...value, colors: value.colors?.filter((_, i) => i !== index) })} />}
          </div>)}
          {value.colors.length < 4 && <Button size="sm" icon={Plus} variant="ghost" disabled={disabled}
            onClick={() => onChange({ ...value, colors: [...(value.colors ?? []), '#ffffff'] })}>{t('foundry.skin.addPatternColor')}</Button>}
        </div>
        <p className="text-xs text-text-secondary">{t('foundry.skin.patternColorsHint')}</p>
      </div>}
      {(still ? ['intensity', 'phase'] as const : ['intensity', 'phase', 'scroll'] as const).map((field) => <label key={field} className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-16 shrink-0">{labels[field]}</span>
        <input type="range" min={0} max={field === 'scroll' ? 400 : 100} value={Math.round(value[field] * 100)} disabled={disabled}
          aria-label={labels[field]} className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onChange({ ...value, [field]: Number(event.target.value) / 100 })} />
        <span className="w-9 text-right tabular-nums">{Math.round(value[field] * 100)}%</span>
      </label>)}
    </div>}
  </div>;
}
