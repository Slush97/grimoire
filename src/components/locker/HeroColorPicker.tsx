import { useEffect, useRef, useState } from 'react';
import { Palette, Loader2, AlertCircle, Check, RefreshCw, RotateCcw } from 'lucide-react';
import {
  applyHeroColor,
  previewHeroColor,
  revertHeroColor,
  getActiveHeroColor,
  getHeroColorSupport,
  getGameRunningStatus,
} from '../../lib/api';

interface HeroColorPickerProps {
  heroName: string;
}

/** Default target when nothing is applied yet: 280 (purple) at source
 *  saturation/brightness, the in-game-verified reference the recolor was proven
 *  against. */
const DEFAULT_HUE = 280;
const DEFAULT_SCALE = 1;

/** Saturation/brightness slider bounds (scales), matching heroColors.ts. */
const SAT_MIN = 0;
const SAT_MAX = 3;
const BRIGHT_MIN = 0.2;
const BRIGHT_MAX = 2;

interface Preset {
  hue: number;
  saturation: number;
  brightness: number;
  label: string;
}

/** Quick-pick colors. Hue alone can't make a "light blue": the pale presets dial
 *  saturation down and brightness up. Each sets all three knobs at once. */
const PRESETS: ReadonlyArray<Preset> = [
  { hue: 0, saturation: 1, brightness: 1, label: 'Red' },
  { hue: 30, saturation: 1, brightness: 1, label: 'Orange' },
  { hue: 50, saturation: 1, brightness: 1.1, label: 'Gold' },
  { hue: 120, saturation: 1, brightness: 1, label: 'Green' },
  { hue: 190, saturation: 1, brightness: 1, label: 'Cyan' },
  { hue: 205, saturation: 0.6, brightness: 1.4, label: 'Light Blue' },
  { hue: 220, saturation: 1, brightness: 1, label: 'Blue' },
  { hue: 280, saturation: 1, brightness: 1, label: 'Purple' },
  { hue: 320, saturation: 0.85, brightness: 1.15, label: 'Pink' },
];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** A rough CSS chip for a target, used for the preset buttons and as a fallback
 *  while/if the real recolored preview can't be rendered. Not the exact in-game
 *  color (that's what the live preview thumbnail is for). */
function approxSwatch(hue: number, saturation: number, brightness: number): string {
  const s = clamp(Math.round(72 * saturation), 0, 100);
  const l = clamp(Math.round(52 * brightness), 8, 92);
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

const pct = (scale: number): number => Math.round(scale * 100);

/**
 * EXPERIMENTAL: recolor a hero's ability VFX (particles + color textures + baked
 * vertex colors) to a chosen color. The target is hue + a saturation scale + a
 * brightness scale, so pale/pastel colors (e.g. light blue) are reachable, not
 * just a flat hue rotation. The pick is baked by the bundled vpkmerge
 * `recolor-hero` and isolated into a single Locker-managed VPK that wins by load
 * order; remove it to revert to vanilla. Only heroes with a pinned recipe are
 * supported (Paige today); others show a coming-soon notice.
 */
export default function HeroColorPicker({ heroName }: HeroColorPickerProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The target currently applied in-game (null when none), and the live picks.
  const [activeHue, setActiveHue] = useState<number | null>(null);
  const [activeSaturation, setActiveSaturation] = useState<number | null>(null);
  const [activeBrightness, setActiveBrightness] = useState<number | null>(null);
  const [hue, setHue] = useState(DEFAULT_HUE);
  const [saturation, setSaturation] = useState(DEFAULT_SCALE);
  const [brightness, setBrightness] = useState(DEFAULT_SCALE);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  // Live recolored swatch (a real ability texture run through the recolor).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  // Set when this hero has no live preview (e.g. particle-only heroes carry no
  // color texture to swatch); we then stop attempting it and show the CSS chip.
  const [previewUnavailable, setPreviewUnavailable] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    // Fresh hero: drop any prior hero's preview state.
    setPreviewUrl(null);
    setPreviewFailed(false);
    setPreviewUnavailable(false);
    Promise.all([
      getHeroColorSupport(heroName),
      getActiveHeroColor(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([isSupported, active, status]) => {
        if (!mounted.current) return;
        setSupported(isSupported);
        setActiveHue(active?.hue ?? null);
        setActiveSaturation(active?.saturation ?? null);
        setActiveBrightness(active?.brightness ?? null);
        if (active) {
          setHue(active.hue);
          setSaturation(active.saturation);
          setBrightness(active.brightness);
        }
        setGameRunning(status.running);
      })
      .catch((err) => {
        if (mounted.current) setError(String(err));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [heroName]);

  // Live preview: render the real recolored ability texture, debounced so the
  // sliders stay smooth. Best-effort: if it can't render (no game path, old
  // binary) we silently fall back to the approximate CSS swatch.
  useEffect(() => {
    if (!supported || busy || previewUnavailable) return;
    let cancelled = false;
    setPreviewLoading(true);
    const handle = setTimeout(() => {
      previewHeroColor(heroName, hue, saturation, brightness)
        .then((url) => {
          if (cancelled || !mounted.current) return;
          setPreviewUrl(url);
          setPreviewFailed(false);
        })
        .catch((err) => {
          if (cancelled || !mounted.current) return;
          setPreviewFailed(true);
          // A particle-only hero has no swatch to render: stop retrying every
          // tick and just show the CSS chip. Other (transient) errors keep trying.
          if (String(err).includes('particle-only')) setPreviewUnavailable(true);
        })
        .finally(() => {
          if (!cancelled && mounted.current) setPreviewLoading(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [heroName, hue, saturation, brightness, supported, busy, previewUnavailable]);

  const refreshGameRunning = async () => {
    try {
      setGameRunning((await getGameRunningStatus()).running);
    } catch {
      // keep prior value
    }
  };

  const handleApply = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const result = await applyHeroColor(heroName, hue, saturation, brightness);
      if (!mounted.current) return;
      setActiveHue(result.hue);
      setActiveSaturation(result.saturation);
      setActiveBrightness(result.brightness);
      setChanged(true);
      await refreshGameRunning();
    } catch (err) {
      if (mounted.current) setActionError(String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await revertHeroColor(heroName);
      if (!mounted.current) return;
      setActiveHue(null);
      setActiveSaturation(null);
      setActiveBrightness(null);
      setChanged(true);
      await refreshGameRunning();
    } catch (err) {
      if (mounted.current) setActionError(String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const applyPreset = (p: Preset) => {
    setHue(p.hue);
    setSaturation(p.saturation);
    setBrightness(p.brightness);
  };

  const applied = activeHue !== null;
  const dirty =
    !applied ||
    activeHue !== hue ||
    activeSaturation !== saturation ||
    activeBrightness !== brightness;

  const swatchCss = approxSwatch(hue, saturation, brightness);

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center gap-2">
        <Palette className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold text-text-primary">Ability Color</h3>
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
          Experimental
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading...
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 py-2 text-xs text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!loading && !error && supported === false && (
        <p className="text-xs text-text-secondary">
          Ability color recolor isn&apos;t available for {heroName} yet. It&apos;s currently
          supported for Paige; more heroes are coming.
        </p>
      )}

      {!loading && !error && supported && (
        <>
          <p className="text-xs text-text-secondary">
            Recolor {heroName}&apos;s ability effects (particles, projectiles, and the ult body) to
            a color. Adjust hue, saturation, and brightness; the preview shows a real ability
            texture recolored to your pick.
          </p>

          {/* Live recolored preview + current target */}
          <div className="flex items-center gap-3">
            <div
              className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border border-border shadow-inner"
              style={{ backgroundColor: swatchCss }}
              aria-label={`Hue ${hue}, saturation ${pct(saturation)}%, brightness ${pct(brightness)}%`}
            >
              {previewUrl && !previewFailed && (
                <img
                  src={previewUrl}
                  alt="Ability color preview"
                  className="h-full w-full object-cover"
                  style={{ imageRendering: 'auto' }}
                />
              )}
              {previewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Loader2 className="h-4 w-4 animate-spin text-white/80" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary tabular-nums">
                {hue}&deg; &middot; S {pct(saturation)}% &middot; B {pct(brightness)}%
              </div>
              <div className="text-[11px] text-text-secondary">
                {!applied
                  ? 'No color applied'
                  : !dirty
                    ? 'Applied'
                    : `Applied: ${activeHue}° / S ${pct(activeSaturation ?? 1)}% / B ${pct(activeBrightness ?? 1)}%`}
              </div>
            </div>
          </div>

          {/* Hue slider over a rainbow track */}
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">Hue</span>
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={hue}
              disabled={busy}
              onChange={(e) => setHue(Number(e.target.value))}
              className="h-3 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
              style={{
                background:
                  'linear-gradient(to right, hsl(0,85%,55%), hsl(60,85%,55%), hsl(120,85%,55%), hsl(180,85%,55%), hsl(240,85%,55%), hsl(300,85%,55%), hsl(360,85%,55%))',
              }}
            />
          </label>

          {/* Saturation slider: gray -> full chroma at the current hue */}
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">
              Saturation <span className="tabular-nums text-text-secondary/70">{pct(saturation)}%</span>
            </span>
            <input
              type="range"
              min={SAT_MIN * 100}
              max={SAT_MAX * 100}
              step={5}
              value={pct(saturation)}
              disabled={busy}
              onChange={(e) => setSaturation(Number(e.target.value) / 100)}
              className="h-3 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(to right, hsl(${hue},0%,55%), hsl(${hue},90%,50%))`,
              }}
            />
          </label>

          {/* Brightness slider: dark -> light at the current hue */}
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">
              Brightness <span className="tabular-nums text-text-secondary/70">{pct(brightness)}%</span>
            </span>
            <input
              type="range"
              min={BRIGHT_MIN * 100}
              max={BRIGHT_MAX * 100}
              step={5}
              value={pct(brightness)}
              disabled={busy}
              onChange={(e) => setBrightness(Number(e.target.value) / 100)}
              className="h-3 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
              style={{
                background: `linear-gradient(to right, hsl(${hue},70%,12%), hsl(${hue},70%,55%), hsl(${hue},60%,85%))`,
              }}
            />
          </label>

          {/* Preset colors (each sets hue + saturation + brightness) */}
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const selected =
                hue === p.hue && saturation === p.saturation && brightness === p.brightness;
              return (
                <button
                  key={p.label}
                  type="button"
                  disabled={busy}
                  onClick={() => applyPreset(p)}
                  title={`${p.label} (${p.hue}°, S ${pct(p.saturation)}%, B ${pct(p.brightness)}%)`}
                  className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 disabled:cursor-not-allowed ${
                    selected ? 'border-text-primary ring-2 ring-accent/60' : 'border-border'
                  }`}
                  style={{ backgroundColor: approxSwatch(p.hue, p.saturation, p.brightness) }}
                  aria-label={p.label}
                />
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || !dirty}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {applied && !dirty ? 'Applied' : 'Apply Color'}
            </button>
            {applied && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Remove
              </button>
            )}
          </div>

          {busy && (
            <p className="text-[11px] text-text-secondary/80">
              Baking the recolor. The first time for a given color can take up to a minute (it
              re-encodes every effect texture); the same color is instant after that.
            </p>
          )}

          {actionError && (
            <div className="flex items-start gap-2 py-1 text-xs text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="break-words">{actionError}</span>
            </div>
          )}

          {changed && (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                gameRunning
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-border bg-bg-secondary/70 text-text-secondary'
              }`}
            >
              <RefreshCw className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>
                {gameRunning
                  ? 'Restart Deadlock for this color change to take effect (addons mount at game start).'
                  : 'Saved. This color mounts the next time you Launch Modded.'}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
