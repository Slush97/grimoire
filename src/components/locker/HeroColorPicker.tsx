import { useEffect, useRef, useState } from 'react';
import { Palette, Loader2, AlertCircle, Check, RefreshCw, RotateCcw } from 'lucide-react';
import {
  applyHeroColor,
  revertHeroColor,
  getActiveHeroColor,
  getHeroColorSupport,
  getGameRunningStatus,
} from '../../lib/api';

interface HeroColorPickerProps {
  heroName: string;
}

/** Default hue when nothing is applied yet: 280 (purple), the in-game-verified
 *  reference color the recolor work was proven against. */
const DEFAULT_HUE = 280;

/** Quick-pick hues so a user doesn't have to drag for a common color. */
const PRESET_HUES: ReadonlyArray<{ hue: number; label: string }> = [
  { hue: 0, label: 'Red' },
  { hue: 30, label: 'Orange' },
  { hue: 55, label: 'Gold' },
  { hue: 120, label: 'Green' },
  { hue: 190, label: 'Cyan' },
  { hue: 215, label: 'Blue' },
  { hue: 280, label: 'Purple' },
  { hue: 320, label: 'Pink' },
];

/** Indicative swatch color for a hue. The recolor keeps each source pixel's
 *  saturation/value, so this is a representative chip, not the exact result. */
function swatch(hue: number): string {
  return `hsl(${hue}, 85%, 55%)`;
}

/**
 * EXPERIMENTAL: recolor a hero's ability VFX (particles + color textures + baked
 * vertex colors) to a single hue. The pick is baked by the bundled vpkmerge
 * `recolor-hero` and isolated into a single Locker-managed VPK that wins by load
 * order; remove it to revert to vanilla. Only heroes with a pinned recipe are
 * supported (Paige today); others show a coming-soon notice.
 */
export default function HeroColorPicker({ heroName }: HeroColorPickerProps) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The hue currently applied in-game (null when none), and the slider's value.
  const [activeHue, setActiveHue] = useState<number | null>(null);
  const [hue, setHue] = useState(DEFAULT_HUE);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    Promise.all([
      getHeroColorSupport(heroName),
      getActiveHeroColor(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([isSupported, active, status]) => {
        if (!mounted.current) return;
        setSupported(isSupported);
        setActiveHue(active?.hue ?? null);
        if (active) setHue(active.hue);
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
      const result = await applyHeroColor(heroName, hue);
      if (!mounted.current) return;
      setActiveHue(result.hue);
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
      setChanged(true);
      await refreshGameRunning();
    } catch (err) {
      if (mounted.current) setActionError(String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const dirty = activeHue !== hue;

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
            a single color. Pick a hue and apply it; remove to go back to vanilla.
          </p>

          {/* Preview swatch + current hue */}
          <div className="flex items-center gap-3">
            <div
              className="h-12 w-12 flex-shrink-0 rounded-md border border-border shadow-inner"
              style={{ backgroundColor: swatch(hue) }}
              aria-label={`Hue ${hue}`}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary tabular-nums">{hue}&deg;</div>
              <div className="text-[11px] text-text-secondary">
                {activeHue === null
                  ? 'No color applied'
                  : activeHue === hue
                    ? 'Applied'
                    : `Applied: ${activeHue}°`}
              </div>
            </div>
          </div>

          {/* Hue slider over a rainbow track */}
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

          {/* Preset hues */}
          <div className="flex flex-wrap gap-1.5">
            {PRESET_HUES.map((p) => (
              <button
                key={p.hue}
                type="button"
                disabled={busy}
                onClick={() => setHue(p.hue)}
                title={`${p.label} (${p.hue}°)`}
                className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 disabled:cursor-not-allowed ${
                  hue === p.hue ? 'border-text-primary ring-2 ring-accent/60' : 'border-border'
                }`}
                style={{ backgroundColor: swatch(p.hue) }}
                aria-label={p.label}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleApply}
              disabled={busy || (!dirty && activeHue !== null)}
              className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {activeHue !== null && !dirty ? 'Applied' : 'Apply Color'}
            </button>
            {activeHue !== null && (
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
