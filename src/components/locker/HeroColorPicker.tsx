import { useEffect, useRef, useState } from 'react';
import { Palette, Loader2, AlertCircle, Check, RefreshCw, RotateCcw, Sparkles, Blend } from 'lucide-react';
import {
  applyHeroColor,
  applyHeroPrism,
  previewHeroColor,
  revertHeroColor,
  getActiveHeroColor,
  getHeroColorSupport,
  getGameRunningStatus,
} from '../../lib/api';
import {
  GRADIENT_PRESETS,
  DEFAULT_CUSTOM_STOPS,
  gradientCss,
  rainbowCss,
  gradientSpecOf,
  selectedGradientStops,
  parseGradientSpec,
  type GStop,
} from '../../lib/abilityColorPreview';

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
  // Recolor mode: a single picked color, the rainbow prism, or a custom gradient.
  const [mode, setMode] = useState<'hue' | 'prism' | 'gradient'>('hue');
  const [animated, setAnimated] = useState(false);
  // Gradient mode: the chosen preset name (or 'custom') and the custom editor stops.
  const [gradientPreset, setGradientPreset] = useState<string>(GRADIENT_PRESETS[0].name);
  const [customStops, setCustomStops] = useState<GStop[]>(DEFAULT_CUSTOM_STOPS);
  // What's applied in-game: the mode (null = nothing), its animated flag, and gradient.
  const [activeMode, setActiveMode] = useState<'hue' | 'prism' | 'gradient' | null>(null);
  const [activeAnimated, setActiveAnimated] = useState(false);
  const [activeGradient, setActiveGradient] = useState<string | null>(null);
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
    // Fresh hero: drop any prior hero's preview + mode state.
    setPreviewUrl(null);
    setPreviewFailed(false);
    setPreviewUnavailable(false);
    setMode('hue');
    setAnimated(false);
    setGradientPreset(GRADIENT_PRESETS[0].name);
    setCustomStops(DEFAULT_CUSTOM_STOPS);
    Promise.all([
      getHeroColorSupport(heroName),
      getActiveHeroColor(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([isSupported, active, status]) => {
        if (!mounted.current) return;
        setSupported(isSupported);
        const activeM = active ? (active.mode ?? 'hue') : null;
        setActiveMode(activeM);
        setActiveHue(active?.hue ?? null);
        setActiveSaturation(active?.saturation ?? null);
        setActiveBrightness(active?.brightness ?? null);
        setActiveAnimated(active?.animated ?? false);
        setActiveGradient(active?.gradient ?? null);
        if (active && (activeM === 'prism' || activeM === 'gradient')) {
          setMode(activeM);
          setAnimated(active.animated ?? false);
          setHue(active.hue);
          setSaturation(active.saturation);
          setBrightness(active.brightness);
          if (activeM === 'gradient') {
            const parsed = parseGradientSpec(active.gradient);
            setGradientPreset(parsed.preset);
            setCustomStops(parsed.stops);
          }
        } else if (active) {
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
    // Prism / gradient have no per-pixel swatch to bake; they show a CSS chip instead.
    if (!supported || busy || previewUnavailable || mode !== 'hue') return;
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
  }, [heroName, hue, saturation, brightness, supported, busy, previewUnavailable, mode]);

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
      if (mode === 'prism' || mode === 'gradient') {
        const grad = mode === 'gradient' ? gradientSpecOf(gradientPreset, customStops) : null;
        const result = await applyHeroPrism(heroName, hue, saturation, brightness, animated, grad);
        if (!mounted.current) return;
        setActiveMode(mode);
        setActiveHue(result.hue);
        setActiveSaturation(result.saturation);
        setActiveBrightness(result.brightness);
        setActiveAnimated(result.animated);
        setActiveGradient(result.gradient);
      } else {
        const result = await applyHeroColor(heroName, hue, saturation, brightness);
        if (!mounted.current) return;
        setActiveMode('hue');
        setActiveHue(result.hue);
        setActiveSaturation(result.saturation);
        setActiveBrightness(result.brightness);
      }
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
      setActiveMode(null);
      setActiveHue(null);
      setActiveSaturation(null);
      setActiveBrightness(null);
      setActiveAnimated(false);
      setActiveGradient(null);
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

  const applied = activeMode !== null;
  const gradientSpec = gradientSpecOf(gradientPreset, customStops);
  const gradientStops = selectedGradientStops(gradientPreset, customStops);
  const gradientLabel =
    gradientPreset === 'custom'
      ? 'Custom'
      : (GRADIENT_PRESETS.find((g) => g.name === gradientPreset)?.label ?? gradientPreset);
  const spectrumDirty =
    activeAnimated !== animated ||
    activeHue !== hue ||
    activeSaturation !== saturation ||
    activeBrightness !== brightness;
  const dirty =
    mode === 'gradient'
      ? activeMode !== 'gradient' || activeGradient !== gradientSpec || spectrumDirty
      : mode === 'prism'
        ? activeMode !== 'prism' || spectrumDirty
        : activeMode !== 'hue' ||
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
            Recolor {heroName}&apos;s ability effects (particles, projectiles, and the ult body).
            Pick a single color, a rainbow, or spread the VFX over a gradient.
          </p>

          {/* Mode toggle: a single picked color vs the rainbow prism. */}
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('hue')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed ${
                mode === 'hue'
                  ? 'border border-accent/40 bg-accent/10 text-text-primary'
                  : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              <Palette className="h-3.5 w-3.5" /> Single Color
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('prism')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed ${
                mode === 'prism'
                  ? 'border border-accent/40 bg-accent/10 text-text-primary'
                  : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" /> Rainbow
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('gradient')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed ${
                mode === 'gradient'
                  ? 'border border-accent/40 bg-accent/10 text-text-primary'
                  : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              }`}
            >
              <Blend className="h-3.5 w-3.5" /> Gradient
            </button>
          </div>

          {/* Live recolored preview + current target */}
          <div className="flex items-center gap-3">
            <div
              className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md border border-border shadow-inner"
              style={
                mode === 'prism'
                  ? { background: rainbowCss(hue, saturation, brightness) }
                  : mode === 'gradient'
                    ? { background: gradientCss(gradientStops, hue, saturation, brightness) }
                    : { backgroundColor: swatchCss }
              }
              aria-label={
                mode === 'prism'
                  ? `Rainbow prism${animated ? ', animated' : ''}`
                  : mode === 'gradient'
                    ? `${gradientLabel} gradient${animated ? ', animated' : ''}`
                    : `Hue ${hue}, saturation ${pct(saturation)}%, brightness ${pct(brightness)}%`
              }
            >
              {mode === 'hue' && previewUrl && !previewFailed && (
                <img
                  src={previewUrl}
                  alt="Ability color preview"
                  className="h-full w-full object-cover"
                  style={{ imageRendering: 'auto' }}
                />
              )}
              {mode === 'hue' && previewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Loader2 className="h-4 w-4 animate-spin text-white/80" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary tabular-nums">
                {mode === 'prism'
                  ? `Rainbow${animated ? ' (animated)' : ''} · rot ${hue}° · S ${pct(saturation)}% · B ${pct(brightness)}%`
                  : mode === 'gradient'
                    ? `${gradientLabel}${animated ? ' (animated)' : ''} · rot ${hue}° · S ${pct(saturation)}% · B ${pct(brightness)}%`
                    : `${hue}° · S ${pct(saturation)}% · B ${pct(brightness)}%`}
              </div>
              <div className="text-[11px] text-text-secondary">
                {!applied
                  ? 'No color applied'
                  : !dirty
                    ? 'Applied'
                    : activeMode === 'prism'
                      ? `Applied: Rainbow${activeAnimated ? ' (animated)' : ''} · rot ${activeHue ?? 0}°`
                      : activeMode === 'gradient'
                        ? `Applied: ${activeGradient && GRADIENT_PRESETS.some((g) => g.name === activeGradient) ? (GRADIENT_PRESETS.find((g) => g.name === activeGradient)?.label ?? 'Gradient') : 'Custom'} gradient${activeAnimated ? ' (animated)' : ''}`
                        : `Applied: ${activeHue}° / S ${pct(activeSaturation ?? 1)}% / B ${pct(activeBrightness ?? 1)}%`}
              </div>
            </div>
          </div>

          {/* Hue slider over a rainbow track. In prism mode it rotates where the
              spectrum starts rather than picking one color. */}
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">
              {mode === 'hue' ? 'Hue' : 'Rotation'}
            </span>
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

          {/* Preset colors (single-color mode only; each sets hue + saturation + brightness) */}
          {mode === 'hue' && (
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
          )}

          {mode === 'prism' && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={animated}
                  disabled={busy}
                  onChange={(e) => setAnimated(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent disabled:cursor-not-allowed"
                />
                <span className="font-medium text-text-primary">Animated</span>
                <span>sweep the spectrum over each effect&apos;s lifetime</span>
              </label>
              <p className="text-[11px] text-text-secondary/80">
                Prism spreads {heroName}&apos;s existing ability colors across a rainbow instead of
                one hue. Use the sliders above to rotate the spectrum and tune its saturation /
                brightness. Animated adds a moving sweep on the showy effects (glow, beams, trails).
              </p>
            </div>
          )}

          {mode === 'gradient' && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {GRADIENT_PRESETS.map((g) => (
                  <button
                    key={g.name}
                    type="button"
                    disabled={busy}
                    onClick={() => setGradientPreset(g.name)}
                    title={g.label}
                    className={`h-7 w-10 rounded border transition-transform hover:scale-105 disabled:cursor-not-allowed ${
                      gradientPreset === g.name
                        ? 'border-text-primary ring-2 ring-accent/60'
                        : 'border-border'
                    }`}
                    style={{ background: gradientCss(g.stops, 0, 1, 1) }}
                    aria-label={g.label}
                  />
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setGradientPreset('custom')}
                  title="Custom gradient"
                  className={`flex h-7 items-center rounded border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
                    gradientPreset === 'custom'
                      ? 'border-text-primary text-text-primary ring-2 ring-accent/60'
                      : 'border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Custom
                </button>
              </div>

              {gradientPreset === 'custom' && (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-bg-secondary/40 p-2">
                  {customStops.map((st, i) => (
                    <label key={i} className="block space-y-0.5">
                      <span className="text-[10px] font-medium text-text-secondary">
                        Stop {i + 1}{' '}
                        <span className="tabular-nums text-text-secondary/70">
                          {Math.round(st.hue)}&deg;
                        </span>
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={359}
                        step={1}
                        value={Math.round(st.hue)}
                        disabled={busy}
                        onChange={(e) => {
                          const hueVal = Number(e.target.value);
                          setCustomStops((prev) =>
                            prev.map((s, j) => (j === i ? { ...s, hue: hueVal } : s)),
                          );
                        }}
                        className="h-2.5 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed"
                        style={{
                          background:
                            'linear-gradient(to right, hsl(0,85%,55%), hsl(60,85%,55%), hsl(120,85%,55%), hsl(180,85%,55%), hsl(240,85%,55%), hsl(300,85%,55%), hsl(360,85%,55%))',
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={animated}
                  disabled={busy}
                  onChange={(e) => setAnimated(e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent disabled:cursor-not-allowed"
                />
                <span className="font-medium text-text-primary">Animated</span>
                <span>sweep the gradient over each effect&apos;s lifetime</span>
              </label>
              <p className="text-[11px] text-text-secondary/80">
                Gradient spreads {heroName}&apos;s ability colors over a chosen ramp instead of the
                full rainbow. Pick a preset or Custom (a hue per stop); the sliders above rotate and
                tune it.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || !dirty}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {applied && !dirty
                ? 'Applied'
                : mode === 'prism'
                  ? 'Apply Rainbow'
                  : mode === 'gradient'
                    ? 'Apply Gradient'
                    : 'Apply Color'}
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
