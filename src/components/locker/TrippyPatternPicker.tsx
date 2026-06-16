import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { previewTrippySprite } from '../../lib/api';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import TrippySpriteSwatch from './TrippySpriteSwatch';
import {
  TRIPPY_STYLES,
  type TrippySpriteResult,
  type TrippyStyleName,
} from '../../types/mod';

const pct = (x: number): number => Math.round(x * 100);

/** Quantize to the same 2 decimals the main process keys its caches by, so the
 *  preview params match what an apply would bake. */
const q = (x: number): number => Math.round(x * 100) / 100;

interface TrippyPatternPickerProps {
  style: TrippyStyleName;
  /** Pattern strength, 0..1. */
  intensity: number;
  /** Pattern/hue starting point, 0..1. */
  phase: number;
  /** Whatever knob drives motion for the consuming surface (skin scroll or
   *  VFX animation intensity); only feeds the preview loop speed. */
  loopScroll: number;
  busy: boolean;
  /** Bold params line next to the big swatch, e.g. "Confetti · 100% · scroll 100%". */
  summary: ReactNode;
  /** Smaller applied-state line under the summary. */
  status?: ReactNode;
  onStyle: (style: TrippyStyleName) => void;
  onIntensity: (intensity: number) => void;
  onPhase: (phase: number) => void;
}

/**
 * The shared trippy-pattern surface: a big live swatch tracking the sliders,
 * the per-style swatch strip, and the intensity/phase knobs every trippy paint
 * has. Surface-specific knobs (skin scroll/targets, VFX animation) stay with
 * the consumer; this component owns all sprite fetching and caching concerns.
 * The swatches are the REAL pattern function (rendered by the bundled vpkmerge
 * as a sprite strip), not a CSS approximation, so what loops here is what bakes.
 */
export default function TrippyPatternPicker({
  style,
  intensity,
  phase,
  loopScroll,
  busy,
  summary,
  status,
  onStyle,
  onIntensity,
  onPhase,
}: TrippyPatternPickerProps) {
  const { t } = useTranslation();
  // One small sprite per style for the picker strip (fixed params, fetched
  // once; the main process caches them on disk), plus the big swatch that
  // tracks the sliders (debounced).
  const [styleSprites, setStyleSprites] = useState<
    Partial<Record<TrippyStyleName, TrippySpriteResult>>
  >({});
  const [mainSprite, setMainSprite] = useState<TrippySpriteResult | null>(null);
  const [spriteFailed, setSpriteFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Style strip sprites: fixed params so the disk cache makes this a one-time
  // cost ever, not per hero or per visit.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      TRIPPY_STYLES.map((s) =>
        previewTrippySprite({ style: s, phase: 0, scroll: 1, intensity: 1, frames: 12, size: 48 })
          .then((sprite) => [s, sprite] as const)
          .catch(() => null),
      ),
    ).then((entries) => {
      if (cancelled || !mounted.current) return;
      const next: Partial<Record<TrippyStyleName, TrippySpriteResult>> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setStyleSprites(next);
      if (entries.every((e) => e === null)) setSpriteFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Big swatch tracks the sliders, debounced.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      previewTrippySprite({
        style,
        phase: q(phase),
        scroll: q(loopScroll),
        intensity: q(intensity),
        frames: 24,
        size: 128,
      })
        .then((sprite) => {
          if (!cancelled && mounted.current) {
            setMainSprite(sprite);
            setSpriteFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled && mounted.current) setSpriteFailed(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [style, phase, loopScroll, intensity]);

  return (
    <>
      {/* Live pattern swatch + current params */}
      <div className="flex items-center gap-3">
        <TrippySpriteSwatch
          sprite={mainSprite}
          className="h-20 w-20 flex-shrink-0 rounded-md border border-border object-cover shadow-inner"
        />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">{summary}</div>
          {status && <div className="text-[11px] text-text-secondary">{status}</div>}
          {spriteFailed && (
            <div className="text-[11px] text-amber-400/90">
              {t('locker.trippyPattern.swatchUnavailable')}
            </div>
          )}
        </div>
      </div>

      {/* Style strip: every style as a small looping swatch. */}
      <div className="flex flex-wrap gap-1.5">
        {TRIPPY_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => onStyle(s)}
            title={TRIPPY_STYLE_LABELS[s]}
            aria-label={TRIPPY_STYLE_LABELS[s]}
            className={`overflow-hidden rounded-md border transition-transform hover:scale-105 disabled:cursor-not-allowed ${
              style === s ? 'border-text-primary ring-2 ring-accent/60' : 'border-border'
            }`}
          >
            <TrippySpriteSwatch sprite={styleSprites[s] ?? null} className="h-9 w-9" />
          </button>
        ))}
      </div>

      {/* Pattern strength: 0 keeps the original texture, 1 is full paint. */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-text-secondary">
          {t('locker.trippyPattern.intensity')}{' '}
          <span className="tabular-nums text-text-secondary/70">{pct(intensity)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct(intensity)}
          disabled={busy}
          onChange={(e) => onIntensity(Number(e.target.value) / 100)}
          className="h-3 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary disabled:cursor-not-allowed"
        />
      </label>

      {/* Phase: shifts the pattern/hue starting point. */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-text-secondary">
          {t('locker.trippyPattern.phase')}{' '}
          <span className="tabular-nums text-text-secondary/70">{pct(phase)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct(phase)}
          disabled={busy}
          onChange={(e) => onPhase(Number(e.target.value) / 100)}
          className="h-3 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary disabled:cursor-not-allowed"
        />
      </label>
    </>
  );
}
