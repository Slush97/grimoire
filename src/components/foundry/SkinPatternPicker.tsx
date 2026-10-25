import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw } from 'lucide-react';
import TrippySpriteSwatch from '../locker/TrippySpriteSwatch';
import { previewTrippySprite } from '../../lib/api';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import { TRIPPY_STYLES, type TrippyStyleName, type TrippySpriteResult } from '../../types/mod';
import type { SkinPartPattern } from '../../types/skinEditor';

export function SkinPatternPicker({ value, disabled, onChange }: {
  value: SkinPartPattern | null; disabled: boolean; onChange: (value: SkinPartPattern | null) => void;
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
        aria-label={TRIPPY_STYLE_LABELS[style]} title={TRIPPY_STYLE_LABELS[style]} onClick={() => onChange({ style, intensity: value?.intensity ?? 1, phase: value?.phase ?? 0, scroll: value?.scroll ?? 0 })}
        className={`min-w-0 overflow-hidden rounded-sm border p-1 text-2xs transition-colors disabled:opacity-40 ${value?.style === style ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-tertiary text-text-secondary hover:bg-hl/5'}`}>
        <TrippySpriteSwatch sprite={sprites[style] ?? null} className="h-6 w-full rounded-sm" />
        <span className="mt-1 block truncate">{TRIPPY_STYLE_LABELS[style]}</span>
      </button>)}
    </div>
    {value && <div className="space-y-2">
      {(['intensity', 'phase', 'scroll'] as const).map((field) => <label key={field} className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="w-16 shrink-0">{labels[field]}</span>
        <input type="range" min={0} max={field === 'scroll' ? 400 : 100} value={Math.round(value[field] * 100)} disabled={disabled}
          aria-label={labels[field]} className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onChange({ ...value, [field]: Number(event.target.value) / 100 })} />
        <span className="w-9 text-right tabular-nums">{Math.round(value[field] * 100)}%</span>
      </label>)}
    </div>}
  </div>;
}
