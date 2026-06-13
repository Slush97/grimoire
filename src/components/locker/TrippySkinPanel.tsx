import { useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, Check, RefreshCw, RotateCcw } from 'lucide-react';
import {
  applyTrippySkin,
  getActiveTrippySkin,
  getGameRunningStatus,
  revertTrippySkin,
} from '../../lib/api';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import TrippyPatternPicker from './TrippyPatternPicker';
import { useTrippyPreviewStore } from '../../stores/trippyPreviewStore';
import type { ActiveTrippySkin, TrippySkinTargets, TrippyStyleName } from '../../types/mod';

interface TrippySkinPanelProps {
  heroName: string;
  /** Whether the Body + Gun surface is the one on screen. The panel stays
   *  mounted while hidden (to keep in-flight slider state), so this gates the
   *  live 3D preview push: only the visible surface should paint the model. */
  active?: boolean;
  /** Lets the parent surface toggle show an applied dot for this surface. */
  onAppliedChange?: (applied: boolean) => void;
}

const pct = (x: number): number => Math.round(x * 100);

/** Quantize to the same 2 decimals the main process keys its caches by, so the
 *  dirty check compares like with like. */
const q = (x: number): number => Math.round(x * 100) / 100;

const segBtn = (selected: boolean) =>
  `rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
    selected
      ? 'border border-accent/40 bg-accent/10 text-text-primary'
      : 'border border-transparent text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
  }`;

/**
 * The Body + Gun surface of the Effects panel: paints a hero's body/weapon
 * material textures with a procedural trippy pattern plus a runtime UV-scroll,
 * via the bundled `vpkmerge trippy-skin`. Lives in its own managed VPK (pak04)
 * and touches only material paths, so it composes with whatever the Abilities
 * surface has applied (color, gradient, prism, or trippy VFX).
 * Rendered only when the parent has confirmed hero support.
 */
export default function TrippySkinPanel({
  heroName,
  active = true,
  onAppliedChange,
}: TrippySkinPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [style, setStyle] = useState<TrippyStyleName>('confetti');
  const [intensity, setIntensity] = useState(1);
  const [phase, setPhase] = useState(0);
  const [scroll, setScroll] = useState(1);
  const [targets, setTargets] = useState<TrippySkinTargets>('all');

  const [activeSkin, setActiveSkin] = useState<ActiveTrippySkin | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [gameRunning, setGameRunning] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    setError(null);
    setActionError(null);
    Promise.all([
      getActiveTrippySkin(heroName),
      getGameRunningStatus().catch(() => ({ running: false })),
    ])
      .then(([skin, status]) => {
        if (!mounted.current) return;
        setActiveSkin(skin);
        setGameRunning(status.running);
        // Reflect whatever is applied so the sliders read back.
        if (skin) {
          setStyle(skin.style);
          setIntensity(skin.intensity);
          setPhase(skin.phase);
          setScroll(skin.scroll);
          setTargets(skin.targets);
        }
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

  const applied = activeSkin !== null;
  useEffect(() => {
    onAppliedChange?.(applied);
  }, [applied, onAppliedChange]);

  // Feed the live slider state to the floating 3D viewer so it can preview the
  // paint animated on the body in real time. Cleared when the panel unmounts
  // (user leaves the Body + Gun trippy surface) so the model snaps back.
  const setTrippyPreview = useTrippyPreviewStore((s) => s.setPreview);
  const clearTrippyPreview = useTrippyPreviewStore((s) => s.clearPreview);
  useEffect(() => {
    if (loading || !active) {
      clearTrippyPreview();
      return;
    }
    setTrippyPreview({ heroName, style, intensity, phase, scroll, targets });
  }, [
    active,
    loading,
    heroName,
    style,
    intensity,
    phase,
    scroll,
    targets,
    setTrippyPreview,
    clearTrippyPreview,
  ]);
  useEffect(() => clearTrippyPreview, [clearTrippyPreview]);

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
      const result = await applyTrippySkin(heroName, { style, intensity, scroll, phase, targets });
      if (!mounted.current) return;
      if (result.style !== null) {
        setActiveSkin({
          style: result.style,
          intensity: result.intensity ?? 1,
          scroll: result.scroll ?? 1,
          phase: result.phase ?? 0,
          targets: result.targets ?? 'all',
        });
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
      await revertTrippySkin(heroName);
      if (!mounted.current) return;
      setActiveSkin(null);
      setChanged(true);
      await refreshGameRunning();
    } catch (err) {
      if (mounted.current) setActionError(String(err));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const dirty =
    !activeSkin ||
    activeSkin.style !== style ||
    activeSkin.intensity !== q(intensity) ||
    activeSkin.scroll !== q(scroll) ||
    activeSkin.phase !== q(phase) ||
    activeSkin.targets !== targets;

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-text-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 py-2 text-xs text-red-400">
        <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span className="break-words">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary">
        Paint {heroName}&apos;s body and gun textures with a flowing procedural pattern: the paint
        scrolls in game. This composes with anything applied on the Abilities surface.
      </p>

      <TrippyPatternPicker
        style={style}
        intensity={intensity}
        phase={phase}
        loopScroll={scroll}
        busy={busy}
        summary={
          <>
            {TRIPPY_STYLE_LABELS[style]}
            <span className="text-text-secondary">
              {' '}
              · {pct(intensity)}% · scroll {pct(scroll)}%
            </span>
          </>
        }
        status={
          !applied
            ? 'No trippy skin applied'
            : !dirty
              ? 'Applied'
              : `Applied: ${TRIPPY_STYLE_LABELS[activeSkin.style]} · ${pct(activeSkin.intensity)}% · ${activeSkin.targets}`
        }
        onStyle={setStyle}
        onIntensity={setIntensity}
        onPhase={setPhase}
      />

      {/* Runtime UV-scroll speed (how fast the paint flows in game). */}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium text-text-secondary">
          Scroll speed <span className="tabular-nums text-text-secondary/70">{pct(scroll)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={400}
          step={10}
          value={pct(scroll)}
          disabled={busy}
          onChange={(e) => setScroll(Number(e.target.value) / 100)}
          className="h-3 w-full cursor-pointer appearance-none rounded-full bg-bg-tertiary disabled:cursor-not-allowed"
        />
      </label>

      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-text-secondary">Paint</span>
        <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {(['all', 'body', 'weapons'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => setTargets(t)}
              className={segBtn(targets === t)}
            >
              {t === 'all' ? 'Body + Gun' : t === 'body' ? 'Body' : 'Gun'}
            </button>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleApply}
          disabled={busy || !dirty}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {applied && !dirty ? 'Applied' : 'Apply Paint'}
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
          Baking the paint. The first time for a given combination can take a while (it re-encodes
          the affected textures); the same combination is instant after that.
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
              ? 'Restart Deadlock for this change to take effect (addons mount at game start).'
              : 'Saved. This paint mounts the next time you Launch Modded.'}
          </span>
        </div>
      )}
    </div>
  );
}
