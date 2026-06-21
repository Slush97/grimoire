import { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as THREE from 'three';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Box,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Shuffle,
  UploadCloud,
  X,
} from 'lucide-react';
import { importSpiritUrnGlb, previewSpiritUrnGlb, showOpenDialog } from '../../lib/api';
import { parseGltfPreview } from '../../lib/loadGltfPreview';
import { computeSceneStats, deriveNameFromPath, TRIANGLE_WARN_THRESHOLD } from '../../lib/soulImport';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';
import { FormField, Input } from '../common/forms';
import SoulImportPreview from './SoulImportPreview';
import { SOUL_BACKDROP_COUNT } from './soulBackdrops';
import { disposeScene } from './soulModel';

type UrnOrientMode = 'y-up' | 'z-up' | 'flip-y' | 'auto';

interface SpiritUrnImportModalProps {
  onClose: () => void;
  onImported: (mods: Mod[]) => void;
  /** Enabled urn imports already installed (conflict handling). */
  existingUrnImports: Mod[];
  /** Optional pre-resolved GLB path (e.g. from a drop onto the page). */
  initialGlbPath?: string;
}

const ORIENT_OPTIONS: { value: UrnOrientMode; labelKey: string }[] = [
  { value: 'y-up', labelKey: 'locker.soulImport.orient.yUp' },
  { value: 'z-up', labelKey: 'locker.soulImport.orient.zUp' },
  { value: 'flip-y', labelKey: 'locker.soulImport.orient.flipY' },
  { value: 'auto', labelKey: 'locker.soulImport.orient.auto' },
];

// Default urn size in Source units (matches the CLI's `--span` default). The
// real urn is bigger than a soul orb, so this is the size yardstick.
const DEFAULT_SPAN = 28;

function describeScene(
  scene: THREE.Object3D,
  t: TFunction
): { meshCount: number; triangleCount: number; label: string } {
  const stats = computeSceneStats(scene);
  if (!stats.meshCount || !stats.hasBounds) {
    return {
      meshCount: stats.meshCount,
      triangleCount: stats.triangleCount,
      label: t('locker.soulImport.preview.noMeshGeometry'),
    };
  }
  return {
    meshCount: stats.meshCount,
    triangleCount: stats.triangleCount,
    label: t('locker.soulImport.preview.statsLabel', {
      count: stats.meshCount,
      verts: stats.vertexCount.toLocaleString(),
      span: stats.span.toFixed(2),
    }),
  };
}

export default function SpiritUrnImportModal({
  onClose,
  onImported,
  existingUrnImports,
  initialGlbPath = '',
}: SpiritUrnImportModalProps) {
  const { t } = useTranslation();
  const toggleMod = useAppStore((s) => s.toggleMod);
  const [glbPath, setGlbPath] = useState<string>(initialGlbPath);
  const [name, setName] = useState<string>(initialGlbPath ? deriveNameFromPath(initialGlbPath) : '');
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [orientMode, setOrientMode] = useState<UrnOrientMode>('auto');
  const [rotate, setRotate] = useState<[number, number, number]>([0, 0, 0]);
  const [span, setSpan] = useState<number>(DEFAULT_SPAN);
  const [ground, setGround] = useState<boolean>(false);
  const [resolvedOrient, setResolvedOrient] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(true);
  const [nsfw, setNsfw] = useState(false);
  const [notes, setNotes] = useState('');
  // When another urn is already enabled, default to disabling it (single in-game
  // slot) rather than overwriting it: the old one stays in the library, just off.
  const [disableExisting, setDisableExisting] = useState(true);
  const [backdropIndex, setBackdropIndex] = useState(() =>
    Math.floor(Math.random() * SOUL_BACKDROP_COUNT)
  );
  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewStats, setPreviewStats] = useState<string | null>(null);
  const [triangleCount, setTriangleCount] = useState(0);

  const captureRef = useRef<(() => string | null) | null>(null);
  // Track the live scene so we can dispose its GPU resources on swap/unmount.
  const sceneRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    return () => {
      if (sceneRef.current) disposeScene(sceneRef.current);
    };
  }, []);

  const hasRotation = rotate[0] !== 0 || rotate[1] !== 0 || rotate[2] !== 0;

  // Preview the actual built artifact: vpkmerge imports the source GLB into an
  // urn override VPK, then exports that model back to GLB for three.js.
  useEffect(() => {
    if (!glbPath) return;
    let cancelled = false;
    setBuilding(true);
    setError(null);
    setResolvedOrient(null);
    setPreviewStats(null);
    setTriangleCount(0);

    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const preview = await previewSpiritUrnGlb({
            glbPath,
            orient: orientMode,
            rotate: hasRotation ? rotate : undefined,
            ground,
            span,
          });
          const gltf = await parseGltfPreview(preview.glb);
          if (cancelled) {
            disposeScene(gltf.scene);
            return;
          }
          if (sceneRef.current) disposeScene(sceneRef.current);
          sceneRef.current = gltf.scene;
          setScene(gltf.scene);
          setResolvedOrient(preview.orient);
          const stats = describeScene(gltf.scene, t);
          setPreviewStats(stats.label);
          setTriangleCount(stats.triangleCount);
          if (stats.meshCount === 0) setError(t('locker.soulImport.errors.noMeshGeometry'));
        } catch (err) {
          if (!cancelled) {
            if (sceneRef.current) disposeScene(sceneRef.current);
            sceneRef.current = null;
            setScene(null);
            setPreviewStats(null);
            setTriangleCount(0);
            setError(t('locker.urnImport.errors.previewFailed', { error: String(err) }));
          }
        } finally {
          if (!cancelled) setBuilding(false);
        }
      })();
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [glbPath, orientMode, rotate, span, ground, hasRotation, t]);

  const acceptGlbPath = (picked: string) => {
    setError(null);
    setGlbPath(picked);
    if (!name.trim()) setName(deriveNameFromPath(picked));
  };

  const pickGlb = async () => {
    const picked = await showOpenDialog({
      title: t('locker.soulImport.dialog.title'),
      filters: [{ name: t('locker.soulImport.dialog.filterName'), extensions: ['glb'] }],
    });
    if (picked) acceptGlbPath(picked);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.glb$/i.test(file.name)) {
      setError(t('locker.soulImport.errors.expectedGlb', { name: file.name }));
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError(t('locker.soulImport.errors.dropPathUnresolved'));
      return;
    }
    acceptGlbPath(path);
  };

  const bumpAxis = (axis: 0 | 1 | 2, delta: number) => {
    setRotate((r) => {
      const next: [number, number, number] = [...r];
      next[axis] = ((next[axis] + delta) % 360 + 360) % 360;
      return next;
    });
  };

  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    setRotate((r) => {
      const next: [number, number, number] = [...r];
      next[axis] = Number.isFinite(value) ? value : 0;
      return next;
    });
  };

  const rerollBackdrop = () => {
    setBackdropIndex((current) => {
      if (SOUL_BACKDROP_COUNT <= 1) return current;
      let next = current;
      while (next === current) next = Math.floor(Math.random() * SOUL_BACKDROP_COUNT);
      return next;
    });
  };

  const modeLabel = hasRotation
    ? resolvedOrient
      ? t('locker.soulImport.orient.customRotationResolved', { orient: resolvedOrient })
      : t('locker.soulImport.orient.customRotation')
    : (resolvedOrient ?? orientMode);

  const canSubmit = !!glbPath && !!scene && !!name.trim() && span > 0 && !submitting && !building;
  const highPoly = triangleCount > TRIANGLE_WARN_THRESHOLD;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const thumbnailDataUrl = captureRef.current?.() ?? undefined;
      const mods = await importSpiritUrnGlb({
        glbPath,
        name: name.trim(),
        orient: orientMode,
        rotate: hasRotation ? rotate : undefined,
        ground,
        span,
        status: 'untested',
        notes: notes.trim() || undefined,
        nsfw,
        thumbnailDataUrl,
      });
      // The new import lands enabled. When the user chose to disable the old one
      // (single in-game slot), turn off the previously enabled urns; they stay in
      // the library, just off. "Keep both" skips this.
      if (disableExisting) {
        for (const existing of existingUrnImports) {
          if (existing.enabled) await toggleMod(existing.id);
        }
      }
      onImported(mods);
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <Box className="w-5 h-5" />
            {t('locker.urnImport.title')}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
            aria-label={t('common.actions.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Left: source picker + live preview */}
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                {t('locker.soulImport.fields.source')}
              </label>
              <div
                role="button"
                tabIndex={0}
                aria-label={glbPath ? t('locker.soulImport.dropzone.ariaSelected', { path: glbPath }) : t('locker.soulImport.dropzone.ariaBrowse')}
                onClick={pickGlb}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    void pickGlb();
                  }
                }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(true); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDragActive(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
                onDrop={handleDrop}
                className={`flex flex-col items-center justify-center gap-1 px-4 py-3 rounded-lg border border-dashed text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  dragActive
                    ? 'border-accent bg-accent/10'
                    : glbPath
                      ? 'border-accent/40 bg-bg-tertiary/60 cursor-pointer hover:bg-bg-tertiary'
                      : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
                }`}
              >
                <UploadCloud className="w-5 h-5 text-text-secondary" aria-hidden />
                {glbPath ? (
                  <span className="text-sm text-text-primary font-medium truncate max-w-full">
                    {glbPath.split(/[\\/]/).pop()}
                  </span>
                ) : (
                  <span className="text-sm text-text-primary font-medium">
                    {t('locker.soulImport.dropzone.prompt')}
                  </span>
                )}
              </div>
            </div>

            {/* Preview surface: kept square so the urn reads consistently and the
                canvas never stretches. */}
            <div className="relative w-full aspect-square rounded-lg border border-border bg-bg-tertiary/40 overflow-hidden">
              {scene ? (
                <Suspense fallback={null}>
                  <SoulImportPreview
                    scene={scene}
                    orientMode="y-up"
                    rotate={[0, 0, 0]}
                    showVanilla={false}
                    spinning={spinning}
                    backdropIndex={backdropIndex}
                    captureRef={captureRef}
                  />
                </Suspense>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-xs text-text-secondary">
                  {!glbPath && (
                    <>
                      <Box className="w-8 h-8 text-text-secondary/40" aria-hidden />
                      <span>{t('locker.urnImport.dropzone.previewEmpty')}</span>
                    </>
                  )}
                </div>
              )}
              {building && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <Loader2 className="w-6 h-6 animate-spin text-white/80" />
                </div>
              )}
              {scene && (
                <>
                  {previewStats && (
                    <span
                      className="absolute top-2 left-2 z-10 max-w-[60%] truncate px-2 py-0.5 rounded bg-black/50 text-[11px] text-text-secondary"
                      title={previewStats}
                    >
                      {previewStats}
                    </span>
                  )}

                  <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSpinning((s) => !s)}
                      className="p-1 rounded bg-black/50 text-text-secondary hover:text-text-primary cursor-pointer"
                      title={spinning ? t('locker.soulImport.preview.pause') : t('locker.soulImport.preview.play')}
                      aria-label={spinning ? t('locker.soulImport.preview.pause') : t('locker.soulImport.preview.play')}
                    >
                      {spinning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={rerollBackdrop}
                      className="p-1 rounded bg-black/50 text-text-secondary hover:text-text-primary cursor-pointer"
                      title={t('locker.soulImport.preview.shuffleBackdrop')}
                      aria-label={t('locker.soulImport.preview.shuffleBackdrop')}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Up/down quarter-turn the pre-swizzle pitch (rotate X) to
                      upright the mesh. */}
                  <button
                    type="button"
                    onClick={() => bumpAxis(0, 90)}
                    className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 p-1 rounded-full bg-black/45 text-white/80 hover:bg-black/70 hover:text-white cursor-pointer"
                    aria-label={t('locker.soulImport.orient.tiltUp')}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => bumpAxis(0, -90)}
                    className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10 p-1 rounded-full bg-black/45 text-white/80 hover:bg-black/70 hover:text-white cursor-pointer"
                    aria-label={t('locker.soulImport.orient.tiltDown')}
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>

                  <div className="absolute bottom-2 left-2 right-2 z-10 flex items-center justify-between gap-2 text-[11px]">
                    <span className="px-2 py-0.5 rounded bg-black/50 text-text-secondary truncate">
                      {t('locker.soulImport.preview.orientationLabel')} <span className="text-text-primary">{modeLabel}</span>
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="space-y-4">
            <FormField label={t('locker.soulImport.fields.name')} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('locker.urnImport.fields.namePlaceholder')}
              />
            </FormField>

            {/* Orientation */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('locker.soulImport.orient.label')}</label>
              <div className="grid grid-cols-4 gap-1.5 mb-2">
                {ORIENT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setOrientMode(opt.value)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      orientMode === opt.value
                        ? 'border-accent/60 bg-accent/15 text-text-primary'
                        : 'border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>

              {/* Rotation nudges */}
              <div className="space-y-1.5">
                {(['X', 'Y', 'Z'] as const).map((axisLabel, axis) => (
                  <div key={axisLabel} className="flex items-center gap-1.5">
                    <span className="w-4 text-xs font-mono text-text-secondary">{axisLabel}</span>
                    <button
                      onClick={() => bumpAxis(axis as 0 | 1 | 2, -90)}
                      className="p-1.5 rounded border border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary cursor-pointer"
                      aria-label={t('locker.soulImport.orient.rotateMinus', { axis: axisLabel })}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => bumpAxis(axis as 0 | 1 | 2, 90)}
                      className="p-1.5 rounded border border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary cursor-pointer"
                      aria-label={t('locker.soulImport.orient.rotatePlus', { axis: axisLabel })}
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      value={rotate[axis]}
                      onChange={(e) => setAxis(axis as 0 | 1 | 2, parseFloat(e.target.value))}
                      step={15}
                      className="w-16 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                      aria-label={t('locker.soulImport.orient.axisDegrees', { axis: axisLabel })}
                    />
                    <span className="text-[11px] text-text-secondary">{t('locker.soulImport.orient.deg')}</span>
                  </div>
                ))}
                <div className="flex gap-1.5 pt-0.5">
                  <button
                    onClick={() => bumpAxis(0, 180)}
                    className="flex-1 px-2 py-1 rounded border border-border bg-bg-tertiary/60 text-xs text-text-secondary hover:bg-bg-tertiary cursor-pointer"
                  >
                    {t('locker.soulImport.orient.flipVertical')}
                  </button>
                  <button
                    onClick={() => setRotate([0, 0, 0])}
                    className="flex-1 px-2 py-1 rounded border border-border bg-bg-tertiary/60 text-xs text-text-secondary hover:bg-bg-tertiary cursor-pointer flex items-center justify-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" /> {t('common.actions.reset')}
                  </button>
                </div>
              </div>
            </div>

            {/* Size: largest-axis span in Source units + ground toggle */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                {t('locker.urnImport.size.label')}
              </label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="range"
                  min={6}
                  max={64}
                  step={1}
                  value={span}
                  onChange={(e) => setSpan(parseFloat(e.target.value) || DEFAULT_SPAN)}
                  className="flex-1 accent-accent cursor-pointer"
                  aria-label={t('locker.urnImport.size.label')}
                />
                <input
                  type="number"
                  value={span}
                  min={1}
                  step={1}
                  onChange={(e) => setSpan(parseFloat(e.target.value) || 0)}
                  className="w-16 px-2 py-1 bg-bg-tertiary border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
                  aria-label={t('locker.urnImport.size.label')}
                />
                <span className="text-[11px] text-text-secondary">{t('locker.urnImport.size.units')}</span>
                <button
                  type="button"
                  onClick={() => setSpan(DEFAULT_SPAN)}
                  disabled={span === DEFAULT_SPAN}
                  className="p-1.5 rounded border border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={t('common.actions.reset')}
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <p className="text-[11px] text-text-secondary mb-2">{t('locker.urnImport.size.hint')}</p>
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ground}
                  onChange={(e) => setGround(e.target.checked)}
                  className="accent-accent cursor-pointer"
                />
                <span>{t('locker.urnImport.ground.label')}</span>
              </label>
            </div>

            <FormField
              label={
                <>
                  {t('locker.soulImport.fields.notes')}{' '}
                  <span className="text-text-secondary font-normal">{t('locker.soulImport.fields.notesOptional')}</span>
                </>
              }
            >
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('locker.soulImport.fields.notesPlaceholder')}
              />
            </FormField>

            <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
              <input
                type="checkbox"
                checked={nsfw}
                onChange={(e) => setNsfw(e.target.checked)}
                className="w-4 h-4 accent-accent cursor-pointer"
              />
              {t('locker.soulImport.fields.nsfw')}
            </label>
          </div>
        </div>

        {/* High-poly + error notices, full width above the footer. */}
        <div className="px-5 space-y-3">
          {highPoly && (
            <div className="flex items-start gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>
                {t('locker.urnImport.highPolyWarning', {
                  count: triangleCount.toLocaleString(),
                  threshold: TRIANGLE_WARN_THRESHOLD.toLocaleString(),
                })}
              </span>
            </div>
          )}

          {error && (
            <div className="text-sm text-state-danger bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 p-5 border-t border-border mt-3">
          {existingUrnImports.length > 0 && (
            <div
              className="flex min-w-0 items-center gap-2 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2"
              title={t('locker.urnImport.conflict.body', { name: existingUrnImports[0].name })}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate text-amber-200/90">{t('locker.urnImport.conflict.heading')}</span>
              <div className="flex shrink-0 overflow-hidden rounded-md border border-amber-500/40">
                <button
                  onClick={() => setDisableExisting(true)}
                  className={`px-2.5 py-1 text-[11px] cursor-pointer transition-colors ${
                    disableExisting
                      ? 'bg-accent/25 text-text-primary'
                      : 'text-amber-200/70 hover:bg-amber-500/10'
                  }`}
                >
                  {t('locker.soulImport.conflict.disableCurrent')}
                </button>
                <button
                  onClick={() => setDisableExisting(false)}
                  className={`px-2.5 py-1 text-[11px] cursor-pointer border-l border-amber-500/40 transition-colors ${
                    !disableExisting
                      ? 'bg-accent/25 text-text-primary'
                      : 'text-amber-200/70 hover:bg-amber-500/10'
                  }`}
                >
                  {t('locker.soulImport.conflict.keepBoth')}
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-3 ml-auto shrink-0">
            <button
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer disabled:opacity-50"
            >
              {t('common.actions.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="px-4 py-2 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('locker.soulImport.submit')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
