import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Palette,
  Loader2,
  AlertCircle,
  Check,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Blend,
  Waves,
} from 'lucide-react';
import {
  applyHeroColor,
  applyHeroPrism,
  applyTrippyVfx,
  previewHeroColor,
  revertHeroColor,
  getActiveHeroColor,
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
import { TRIPPY_ANIMATION_LABELS as ANIMATION_LABELS, TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import TrippyPatternPicker from './TrippyPatternPicker';
import {
  TRIPPY_ANIMATION_STYLES,
  type TrippyVfxChoice,
  type TrippyStyleName,
  type TrippyAnimationStyle,
  type TrippyVfxTargets,
} from '../../types/mod';

interface HeroColorPickerProps {
  heroName: string;
  /** Lets the parent surface toggle show an applied dot for this surface. */
  onAppliedChange?: (applied: boolean) => void;
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
  /** Stable identifier used as the React key and the i18n lookup key. */
  label: string;
}

/** i18n key for a preset's displayed name (the `label` is a stable identifier). */
const PRESET_LABEL_KEYS: Record<string, string> = {
  Red: 'locker.colors.presets.red',
  Orange: 'locker.colors.presets.orange',
  Gold: 'locker.colors.presets.gold',
  Green: 'locker.colors.presets.green',
  Cyan: 'locker.colors.presets.cyan',
  'Light Blue': 'locker.colors.presets.lightBlue',
  Blue: 'locker.colors.presets.blue',
  Purple: 'locker.colors.presets.purple',
  Pink: 'locker.colors.presets.pink',
};

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

type ColorMode = 'hue' | 'prism' | 'gradient' | 'trippy';

/** Defaults for a fresh Trippy abilities pick: an animated cycle so the effect
 *  visibly moves in game out of the box (the showiest of the animation styles). */
const TRIPPY_DEFAULTS: TrippyVfxChoice = {
  style: 'confetti',
  intensity: 1,
  phase: 0,
  animationStyle: 'cycle',
  animationIntensity: 1,
  targets: 'all',
};

/** Quantize to the 2 decimals the main process keys its trippy caches by, so the
 *  dirty check compares like with like. */
const q = (x: number): number => Math.round(x * 100) / 100;

/**
 * The Abilities surface of the Effects panel: repaint a hero's ability VFX
 * (particles + color textures + baked vertex colors). Three modes over the SAME
 * selection slot (one recolor per hero, applying any mode replaces the others):
 *  - hue: a single picked color (hue + saturation scale + brightness scale, so
 *    pale/pastel colors are reachable, not just a flat hue rotation)
 *  - prism: spread the existing colors across the rainbow
 *  - gradient: spread them over a chosen ramp
 * The slot can also hold a trippy VFX paint; that mode has no picker here for
 * now (deliberately shelved), but an already-applied one still reads back as
 * the applied state and is replaced/removed like any other pick.
 * The pick is baked by the bundled vpkmerge and isolated into a single
 * Locker-managed VPK that wins by load order; remove it to revert to vanilla.
 * Rendered only when the parent has confirmed hero support (pinned recipe).
 */
export default function HeroColorPicker({ heroName, onAppliedChange }: HeroColorPickerProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The target currently applied in-game (null when none), and the live picks.
  const [activeHue, setActiveHue] = useState<number | null>(null);
  const [activeSaturation, setActiveSaturation] = useState<number | null>(null);
  const [activeBrightness, setActiveBrightness] = useState<number | null>(null);
  const [hue, setHue] = useState(DEFAULT_HUE);
  const [saturation, setSaturation] = useState(DEFAULT_SCALE);
  const [brightness, setBrightness] = useState(DEFAULT_SCALE);
  // Recolor mode: a single picked color, the rainbow prism, or a custom
  // gradient. All three share the one-per-hero slot.
  const [mode, setMode] = useState<ColorMode>('hue');
  const [animated, setAnimated] = useState(false);
  // Gradient mode: the chosen preset name (or 'custom') and the custom editor stops.
  const [gradientPreset, setGradientPreset] = useState<string>(GRADIENT_PRESETS[0].name);
  const [customStops, setCustomStops] = useState<GStop[]>(DEFAULT_CUSTOM_STOPS);
  // Trippy mode: a procedural pattern paint over the same slot (style + strength
  // + phase, plus how the particles animate at runtime and which sets to touch).
  const [trippyStyle, setTrippyStyle] = useState<TrippyStyleName>(TRIPPY_DEFAULTS.style);
  const [trippyIntensity, setTrippyIntensity] = useState(TRIPPY_DEFAULTS.intensity);
  const [trippyPhase, setTrippyPhase] = useState(TRIPPY_DEFAULTS.phase);
  const [trippyAnimStyle, setTrippyAnimStyle] = useState<TrippyAnimationStyle>(
    TRIPPY_DEFAULTS.animationStyle,
  );
  const [trippyAnimIntensity, setTrippyAnimIntensity] = useState(TRIPPY_DEFAULTS.animationIntensity);
  const [trippyTargets, setTrippyTargets] = useState<TrippyVfxTargets>(TRIPPY_DEFAULTS.targets);
  // What's applied in-game: the mode (null = nothing; 'trippy' is read-only
  // here), its animated flag, gradient, and the trippy params when applicable.
  const [activeMode, setActiveMode] = useState<ColorMode | 'trippy' | null>(null);
  const [activeAnimated, setActiveAnimated] = useState(false);
  const [activeGradient, setActiveGradient] = useState<string | null>(null);
  const [activeTrippy, setActiveTrippy] = useState<TrippyVfxChoice | null>(null);
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
    setTrippyStyle(TRIPPY_DEFAULTS.style);
    setTrippyIntensity(TRIPPY_DEFAULTS.intensity);
    setTrippyPhase(TRIPPY_DEFAULTS.phase);
    setTrippyAnimStyle(TRIPPY_DEFAULTS.animationStyle);
    setTrippyAnimIntensity(TRIPPY_DEFAULTS.animationIntensity);
    setTrippyTargets(TRIPPY_DEFAULTS.targets);
    Promise.all([
      getActiveHeroColor(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([active, status]) => {
        if (!mounted.current) return;
        const activeM = active ? (active.mode ?? 'hue') : null;
        setActiveMode(activeM);
        setActiveHue(active?.hue ?? null);
        setActiveSaturation(active?.saturation ?? null);
        setActiveBrightness(active?.brightness ?? null);
        setActiveAnimated(active?.animated ?? false);
        setActiveGradient(active?.gradient ?? null);
        setActiveTrippy(activeM === 'trippy' ? (active?.trippy ?? null) : null);
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
        } else if (active && activeM === 'trippy') {
          // Trippy holds the slot: reflect its params so the picker reads back.
          setMode('trippy');
          const t = active.trippy ?? TRIPPY_DEFAULTS;
          setTrippyStyle(t.style);
          setTrippyIntensity(t.intensity);
          setTrippyPhase(t.phase);
          setTrippyAnimStyle(t.animationStyle);
          setTrippyAnimIntensity(t.animationIntensity);
          setTrippyTargets(t.targets);
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

  const applied = activeMode !== null;
  useEffect(() => {
    onAppliedChange?.(applied);
  }, [applied, onAppliedChange]);

  // Live preview: render the real recolored ability texture, debounced so the
  // sliders stay smooth. Best-effort: if it can't render (no game path, old
  // binary) we silently fall back to the approximate CSS swatch.
  useEffect(() => {
    // Prism / gradient / trippy have no per-pixel swatch to bake; they show a
    // CSS chip or the live pattern sprite instead.
    if (loading || busy || previewUnavailable || mode !== 'hue') return;
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
  }, [heroName, hue, saturation, brightness, loading, busy, previewUnavailable, mode]);

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
      if (mode === 'trippy') {
        const result = await applyTrippyVfx(heroName, {
          style: trippyStyle,
          intensity: trippyIntensity,
          phase: trippyPhase,
          animationStyle: trippyAnimStyle,
          animationIntensity: trippyAnimIntensity,
          targets: trippyTargets,
        });
        if (!mounted.current) return;
        setActiveMode('trippy');
        setActiveTrippy(result);
        // Trippy owns the slot now: any prior hue/prism/gradient is gone.
        setActiveHue(null);
        setActiveSaturation(null);
        setActiveBrightness(null);
        setActiveAnimated(false);
        setActiveGradient(null);
        // Mirror the normalized bake back into the sliders so the dirty check
        // settles to "Applied" instead of staying armed on rounding.
        setTrippyStyle(result.style);
        setTrippyIntensity(result.intensity);
        setTrippyPhase(result.phase);
        setTrippyAnimStyle(result.animationStyle);
        setTrippyAnimIntensity(result.animationIntensity);
        setTrippyTargets(result.targets);
      } else if (mode === 'prism' || mode === 'gradient') {
        const grad = mode === 'gradient' ? gradientSpecOf(gradientPreset, customStops) : null;
        const result = await applyHeroPrism(heroName, hue, saturation, brightness, animated, grad);
        if (!mounted.current) return;
        setActiveMode(mode);
        setActiveTrippy(null);
        setActiveHue(result.hue);
        setActiveSaturation(result.saturation);
        setActiveBrightness(result.brightness);
        setActiveAnimated(result.animated);
        setActiveGradient(result.gradient);
      } else {
        const result = await applyHeroColor(heroName, hue, saturation, brightness);
        if (!mounted.current) return;
        setActiveMode('hue');
        setActiveTrippy(null);
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
      setActiveTrippy(null);
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

  const gradientSpec = gradientSpecOf(gradientPreset, customStops);
  const gradientStops = selectedGradientStops(gradientPreset, customStops);
  const gradientLabel =
    gradientPreset === 'custom'
      ? t('locker.colors.custom')
      : (GRADIENT_PRESETS.find((g) => g.name === gradientPreset)?.label ?? gradientPreset);
  const spectrumDirty =
    activeAnimated !== animated ||
    activeHue !== hue ||
    activeSaturation !== saturation ||
    activeBrightness !== brightness;
  const trippyDirty =
    activeMode !== 'trippy' ||
    !activeTrippy ||
    activeTrippy.style !== trippyStyle ||
    activeTrippy.intensity !== q(trippyIntensity) ||
    activeTrippy.phase !== q(trippyPhase) ||
    activeTrippy.animationStyle !== trippyAnimStyle ||
    activeTrippy.animationIntensity !== q(trippyAnimIntensity) ||
    activeTrippy.targets !== trippyTargets;
  const dirty =
    mode === 'trippy'
      ? trippyDirty
      : mode === 'gradient'
        ? activeMode !== 'gradient' || activeGradient !== gradientSpec || spectrumDirty
        : mode === 'prism'
          ? activeMode !== 'prism' || spectrumDirty
          : activeMode !== 'hue' ||
            activeHue !== hue ||
            activeSaturation !== saturation ||
            activeBrightness !== brightness;

  const animatedSuffix = (on: boolean) => (on ? ` ${t('locker.colors.animatedSuffix')}` : '');
  const appliedLabel = !applied
    ? null
    : activeMode === 'prism'
      ? t('locker.colors.applied.rainbow', {
          animated: animatedSuffix(activeAnimated),
          rot: activeHue ?? 0,
        })
      : activeMode === 'gradient'
        ? t('locker.colors.applied.gradient', {
            label:
              activeGradient && GRADIENT_PRESETS.some((g) => g.name === activeGradient)
                ? (GRADIENT_PRESETS.find((g) => g.name === activeGradient)?.label ??
                  t('locker.colors.modes.gradient'))
                : t('locker.colors.custom'),
            animated: animatedSuffix(activeAnimated),
          })
        : activeMode === 'trippy'
          ? t('locker.colors.applied.trippy', {
              style: activeTrippy ? TRIPPY_STYLE_LABELS[activeTrippy.style] : '',
              animation: activeTrippy ? ANIMATION_LABELS[activeTrippy.animationStyle] : '',
              targets: activeTrippy?.targets ?? '',
            })
          : t('locker.colors.applied.single', {
              hue: activeHue,
              sat: pct(activeSaturation ?? 1),
              bright: pct(activeBrightness ?? 1),
            });

  const swatchCss = approxSwatch(hue, saturation, brightness);

  const modeBtn = (selected: boolean) =>
    `flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors disabled:cursor-not-allowed ${
      selected
        ? 'border border-accent/40 bg-accent/10 text-text-primary'
        : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
    }`;

  const segBtn = (selected: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
      selected
        ? 'border border-accent/40 bg-accent/10 text-text-primary'
        : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
    }`;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('locker.colors.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 py-2 text-xs text-state-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span className="break-words">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        {t('locker.colors.intro', { hero: heroName })}
      </p>

      {/* Mode toggle: three looks over the same one-per-hero slot. */}
      <div className="inline-flex flex-wrap rounded-md border border-border p-0.5 text-xs">
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('hue')}
          className={modeBtn(mode === 'hue')}
        >
          <Palette className="h-3.5 w-3.5" /> {t('locker.colors.modes.singleColor')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('prism')}
          className={modeBtn(mode === 'prism')}
        >
          <Sparkles className="h-3.5 w-3.5" /> {t('locker.colors.modes.rainbow')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('gradient')}
          className={modeBtn(mode === 'gradient')}
        >
          <Blend className="h-3.5 w-3.5" /> {t('locker.colors.modes.gradient')}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setMode('trippy')}
          className={modeBtn(mode === 'trippy')}
        >
          <Waves className="h-3.5 w-3.5" /> {t('locker.colors.modes.trippy')}
        </button>
      </div>

      {mode !== 'trippy' && (
      <>
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
                  ? t('locker.colors.swatchAria.prism', {
                      animated: animated ? `, ${t('locker.colors.animatedWord')}` : '',
                    })
                  : mode === 'gradient'
                    ? t('locker.colors.swatchAria.gradient', {
                        label: gradientLabel,
                        animated: animated ? `, ${t('locker.colors.animatedWord')}` : '',
                      })
                    : t('locker.colors.swatchAria.single', {
                        hue,
                        sat: pct(saturation),
                        bright: pct(brightness),
                      })
              }
            >
              {mode === 'hue' && previewUrl && !previewFailed && (
                <img
                  src={previewUrl}
                  alt={t('locker.colors.abilityColorPreview')}
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
                  ? t('locker.colors.target.rainbow', {
                      animated: animatedSuffix(animated),
                      rot: hue,
                      sat: pct(saturation),
                      bright: pct(brightness),
                    })
                  : mode === 'gradient'
                    ? t('locker.colors.target.gradient', {
                        label: gradientLabel,
                        animated: animatedSuffix(animated),
                        rot: hue,
                        sat: pct(saturation),
                        bright: pct(brightness),
                      })
                    : t('locker.colors.target.single', {
                        hue,
                        sat: pct(saturation),
                        bright: pct(brightness),
                      })}
              </div>
              <div className="text-[11px] text-text-secondary">
                {!applied
                  ? t('locker.colors.noRecolorApplied')
                  : !dirty
                    ? t('locker.colors.appliedStatus')
                    : appliedLabel}
              </div>
            </div>
          </div>

          {/* Hue slider over a rainbow track. In prism mode it rotates where the
              spectrum starts rather than picking one color. */}
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-text-secondary">
              {mode === 'hue' ? t('locker.colors.hue') : t('locker.colors.rotation')}
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
              {t('locker.colors.saturation')}{' '}
              <span className="tabular-nums text-text-secondary/70">{pct(saturation)}%</span>
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
              {t('locker.colors.brightness')}{' '}
              <span className="tabular-nums text-text-secondary/70">{pct(brightness)}%</span>
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
                const presetName = t(PRESET_LABEL_KEYS[p.label] ?? p.label);
                return (
                  <button
                    key={p.label}
                    type="button"
                    disabled={busy}
                    onClick={() => applyPreset(p)}
                    title={t('locker.colors.presetTitle', {
                      name: presetName,
                      hue: p.hue,
                      sat: pct(p.saturation),
                      bright: pct(p.brightness),
                    })}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 disabled:cursor-not-allowed ${
                      selected ? 'border-text-primary ring-2 ring-accent/60' : 'border-border'
                    }`}
                    style={{ backgroundColor: approxSwatch(p.hue, p.saturation, p.brightness) }}
                    aria-label={presetName}
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
                <span className="font-medium text-text-primary">
                  {t('locker.colors.animated')}
                </span>
                <span>{t('locker.colors.sweepSpectrum')}</span>
              </label>
              <p className="text-[11px] text-text-secondary/80">
                {t('locker.colors.prismDescription', { hero: heroName })}
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
                    style={{ background: gradientCss(g.stops, hue, saturation, brightness) }}
                    aria-label={g.label}
                  />
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setGradientPreset('custom')}
                  title={t('locker.colors.customGradient')}
                  className={`flex h-7 items-center rounded border px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed ${
                    gradientPreset === 'custom'
                      ? 'border-text-primary text-text-primary ring-2 ring-accent/60'
                      : 'border-border text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {t('locker.colors.custom')}
                </button>
              </div>

              {gradientPreset === 'custom' && (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-bg-secondary/40 p-2">
                  {customStops.map((st, i) => (
                    <label key={i} className="block space-y-0.5">
                      <span className="text-[10px] font-medium text-text-secondary">
                        {t('locker.colors.stop', { n: i + 1 })}{' '}
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
                <span className="font-medium text-text-primary">
                  {t('locker.colors.animated')}
                </span>
                <span>{t('locker.colors.sweepGradient')}</span>
              </label>
              <p className="text-[11px] text-text-secondary/80">
                {t('locker.colors.gradientDescription', { hero: heroName })}
              </p>
            </div>
          )}
      </>
      )}

      {mode === 'trippy' && (
        <div className="space-y-3">
          <TrippyPatternPicker
            style={trippyStyle}
            intensity={trippyIntensity}
            phase={trippyPhase}
            loopScroll={trippyAnimStyle === 'off' ? 0 : trippyAnimIntensity}
            busy={busy}
            summary={
              <>
                {TRIPPY_STYLE_LABELS[trippyStyle]}
                <span className="text-text-secondary">
                  {' '}
                  · {pct(trippyIntensity)}% · {ANIMATION_LABELS[trippyAnimStyle]}
                </span>
              </>
            }
            status={
              !applied
                ? t('locker.colors.noRecolorApplied')
                : !dirty
                  ? t('locker.colors.appliedStatus')
                  : appliedLabel
            }
            onStyle={setTrippyStyle}
            onIntensity={setTrippyIntensity}
            onPhase={setTrippyPhase}
          />

          {/* How the particles move at runtime. 'off' bakes a still paint. */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-text-secondary">
              {t('locker.colors.animation')}
            </span>
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {TRIPPY_ANIMATION_STYLES.map((a) => (
                <button
                  key={a}
                  type="button"
                  disabled={busy}
                  onClick={() => setTrippyAnimStyle(a)}
                  className={segBtn(trippyAnimStyle === a)}
                >
                  {ANIMATION_LABELS[a]}
                </button>
              ))}
            </div>
          </div>
          {trippyAnimStyle !== 'off' && (
            <p className="text-[11px] text-text-secondary/70">
              {t('locker.colors.swatchAnimationHint')}
            </p>
          )}

          {/* Animation strength (how strongly the motion reads); off when static. */}
          {trippyAnimStyle !== 'off' && (
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-text-secondary">
                {t('locker.colors.animationStrength')}{' '}
                <span className="tabular-nums text-text-secondary/70">{pct(trippyAnimIntensity)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={300}
                step={10}
                value={pct(trippyAnimIntensity)}
                disabled={busy}
                onChange={(e) => setTrippyAnimIntensity(Number(e.target.value) / 100)}
                className="h-3 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary disabled:cursor-not-allowed"
              />
            </label>
          )}

          {/* Which effect sets the paint touches. */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-text-secondary">
              {t('locker.colors.paint')}
            </span>
            <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
              {(['all', 'abilities', 'weapons'] as const).map((tgt) => (
                <button
                  key={tgt}
                  type="button"
                  disabled={busy}
                  onClick={() => setTrippyTargets(tgt)}
                  className={segBtn(trippyTargets === tgt)}
                >
                  {tgt === 'all'
                    ? t('locker.colors.targets.all')
                    : tgt === 'abilities'
                      ? t('locker.colors.targets.abilities')
                      : t('locker.colors.targets.weapons')}
                </button>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-text-secondary/80">
            {t('locker.colors.trippyDescription', { hero: heroName })}
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
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {applied && !dirty
            ? t('locker.colors.appliedStatus')
            : mode === 'prism'
              ? t('locker.colors.applyRainbow')
              : mode === 'gradient'
                ? t('locker.colors.applyGradient')
                : mode === 'trippy'
                  ? t('locker.colors.applyTrippy')
                  : t('locker.colors.applyColor')}
        </button>
        {applied && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('common.actions.remove')}
          </button>
        )}
      </div>

      {busy && (
        <p className="text-[11px] text-text-secondary/80">
          {t('locker.colors.bakingHint')}
        </p>
      )}

      {actionError && (
        <div className="flex items-start gap-2 py-1 text-xs text-state-danger">
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
              ? t('locker.colors.restartHint')
              : t('locker.colors.savedHint')}
          </span>
        </div>
      )}
    </div>
  );
}
