import { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as THREE from 'three';
import {
  AlertTriangle,
  Boxes,
  Loader2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  UploadCloud,
  X,
} from 'lucide-react';
import { importSoulContainerGlb, previewSoulContainerGlb, showOpenDialog } from '../../lib/api';
import { parseGltfPreview } from '../../lib/loadGltfPreview';
import type { Mod } from '../../types/mod';
import SoulImportPreview from './SoulImportPreview';
import { disposeScene } from './soulModel';

type SoulOrientMode = 'y-up' | 'z-up' | 'flip-y' | 'auto';
type GlowMode = 'recolor' | 'base' | 'off';

interface SoulContainerImportModalProps {
  onClose: () => void;
  onImported: (mods: Mod[]) => void;
  /** Enabled soul-container imports already installed (conflict handling). */
  existingSoulImports: Mod[];
  /** Optional pre-resolved GLB path (e.g. from a drop onto the page). */
  initialGlbPath?: string;
}

const ORIENT_OPTIONS: { value: SoulOrientMode; labelKey: string }[] = [
  { value: 'y-up', labelKey: 'locker.soulImport.orient.yUp' },
  { value: 'z-up', labelKey: 'locker.soulImport.orient.zUp' },
  { value: 'flip-y', labelKey: 'locker.soulImport.orient.flipY' },
  { value: 'auto', labelKey: 'locker.soulImport.orient.auto' },
];

const GLOW_OPTIONS: { value: GlowMode; labelKey: string; hintKey: string }[] = [
  { value: 'recolor', labelKey: 'locker.soulImport.glow.recolor', hintKey: 'locker.soulImport.glow.recolorHint' },
  { value: 'base', labelKey: 'locker.soulImport.glow.base', hintKey: 'locker.soulImport.glow.baseHint' },
  { value: 'off', labelKey: 'locker.soulImport.glow.off', hintKey: 'locker.soulImport.glow.offHint' },
];

function deriveNameFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const stem = base.replace(/\.glb$/i, '');
  return stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function describeScene(scene: THREE.Object3D, t: TFunction): { meshCount: number; label: string } {
  let meshCount = 0;
  let vertexCount = 0;
  const box = new THREE.Box3();
  let hasBounds = false;

  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    const position = mesh.geometry?.attributes?.position;
    vertexCount += position?.count ?? 0;
    const meshBox = new THREE.Box3().setFromObject(mesh);
    if (!meshBox.isEmpty()) {
      if (hasBounds) box.union(meshBox);
      else box.copy(meshBox);
      hasBounds = true;
    }
  });

  if (!meshCount || !hasBounds) return { meshCount, label: t('locker.soulImport.preview.noMeshGeometry') };

  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  return {
    meshCount,
    label: t('locker.soulImport.preview.statsLabel', {
      count: meshCount,
      verts: vertexCount.toLocaleString(),
      span: span.toFixed(2),
    }),
  };
}

export default function SoulContainerImportModal({
  onClose,
  onImported,
  existingSoulImports,
  initialGlbPath = '',
}: SoulContainerImportModalProps) {
  const { t } = useTranslation();
  const [glbPath, setGlbPath] = useState<string>(initialGlbPath);
  const [name, setName] = useState<string>(initialGlbPath ? deriveNameFromPath(initialGlbPath) : '');
  const [scene, setScene] = useState<THREE.Object3D | null>(null);
  const [orientMode, setOrientMode] = useState<SoulOrientMode>('y-up');
  const [rotate, setRotate] = useState<[number, number, number]>([0, 0, 0]);
  const [resolvedOrient, setResolvedOrient] = useState<string | null>(null);
  const [glow, setGlow] = useState<GlowMode>('recolor');
  const [showVanilla, setShowVanilla] = useState(true);
  const [nsfw, setNsfw] = useState(false);
  const [notes, setNotes] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [building, setBuilding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [previewStats, setPreviewStats] = useState<string | null>(null);

  const captureRef = useRef<(() => string | null) | null>(null);
  // Track the live scene so we can dispose its GPU resources on swap/unmount.
  const sceneRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    return () => {
      if (sceneRef.current) disposeScene(sceneRef.current);
    };
  }, []);

  const hasRotation = rotate[0] !== 0 || rotate[1] !== 0 || rotate[2] !== 0;

  // Preview the actual built artifact: vpkmerge imports the source GLB into a
  // soul-container VPK, then exports that model back to GLB for Three.js.
  useEffect(() => {
    if (!glbPath) return;
    let cancelled = false;
    setBuilding(true);
    setError(null);
    setResolvedOrient(null);
    setPreviewStats(null);

    const handle = window.setTimeout(() => {
      (async () => {
        try {
          const preview = await previewSoulContainerGlb({
            glbPath,
            orient: orientMode,
            rotate: hasRotation ? rotate : undefined,
            glow,
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
          if (stats.meshCount === 0) setError(t('locker.soulImport.errors.noMeshGeometry'));
        } catch (err) {
          if (!cancelled) {
            if (sceneRef.current) disposeScene(sceneRef.current);
            sceneRef.current = null;
            setScene(null);
            setPreviewStats(null);
            setError(t('locker.soulImport.errors.previewFailed', { error: String(err) }));
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
  }, [glbPath, orientMode, rotate, glow, hasRotation, t]);

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
      next[axis] = norm360(next[axis] + delta);
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

  const modeLabel = hasRotation
    ? resolvedOrient
      ? t('locker.soulImport.orient.customRotationResolved', { orient: resolvedOrient })
      : t('locker.soulImport.orient.customRotation')
    : (resolvedOrient ?? orientMode);

  const canSubmit = !!glbPath && !!scene && !!name.trim() && !submitting && !building;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const thumbnailDataUrl = captureRef.current?.() ?? undefined;
      const replaceMetaKey =
        replaceExisting && existingSoulImports.length > 0
          ? existingSoulImports[0].metaKey
          : undefined;
      const mods = await importSoulContainerGlb({
        glbPath,
        name: name.trim(),
        orient: orientMode,
        rotate: hasRotation ? rotate : undefined,
        glow,
        status: 'untested',
        notes: notes.trim() || undefined,
        nsfw,
        thumbnailDataUrl,
        replaceMetaKey,
      });
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
            <Boxes className="w-5 h-5" />
            {t('locker.soulImport.title')}
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
          {/* Left: drop zone + live preview */}
          <div className="space-y-3">
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

            {/* Preview surface */}
            <div className="relative aspect-square w-full rounded-lg border border-border bg-bg-tertiary/40 overflow-hidden">
              {scene ? (
                <Suspense fallback={null}>
                  <SoulImportPreview
                    scene={scene}
                    orientMode="y-up"
                    rotate={[0, 0, 0]}
                    showVanilla={showVanilla}
                    captureRef={captureRef}
                  />
                </Suspense>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-text-secondary px-6 text-center">
                  {glbPath ? '' : t('locker.soulImport.dropzone.previewEmpty')}
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
                      className="absolute top-2 left-2 max-w-[calc(100%-1rem)] truncate px-2 py-0.5 rounded bg-black/50 text-[11px] text-text-secondary"
                      title={previewStats}
                    >
                      {previewStats}
                    </span>
                  )}
                <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-black/50 text-text-secondary">
                    {t('locker.soulImport.preview.orientationLabel')} <span className="text-text-primary">{modeLabel}</span>
                  </span>
                  <label className="px-2 py-0.5 rounded bg-black/50 text-text-secondary flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showVanilla}
                      onChange={(e) => setShowVanilla(e.target.checked)}
                      className="w-3 h-3 accent-accent cursor-pointer"
                    />
                    {t('locker.soulImport.preview.vanillaShell')}
                  </label>
                </div>
                </>
              )}
            </div>
          </div>

          {/* Right: controls */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                {t('locker.soulImport.fields.name')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('locker.soulImport.fields.namePlaceholder')}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
              />
            </div>

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

            {/* Glow */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">{t('locker.soulImport.glow.label')}</label>
              <div className="grid grid-cols-3 gap-1.5">
                {GLOW_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setGlow(opt.value)}
                    title={t(opt.hintKey)}
                    className={`px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                      glow === opt.value
                        ? 'border-accent/60 bg-accent/15 text-text-primary'
                        : 'border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'
                    }`}
                  >
                    {t(opt.labelKey)}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-text-secondary">
                {t('locker.soulImport.glow.notShownHint')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary mb-1.5">
                {t('locker.soulImport.fields.notes')} <span className="text-text-secondary font-normal">{t('locker.soulImport.fields.notesOptional')}</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('locker.soulImport.fields.notesPlaceholder')}
                className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
              />
            </div>

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

        {/* Conflict notice + error, full width above the footer */}
        <div className="px-5 space-y-3">
          {existingSoulImports.length > 0 && (
            <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4" />
                {t('locker.soulImport.conflict.heading')}
              </div>
              <p className="text-xs text-amber-200/90">
                {t('locker.soulImport.conflict.body', { name: existingSoulImports[0].name })}
              </p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => setReplaceExisting(true)}
                  className={`flex-1 px-2 py-1 rounded border text-xs cursor-pointer ${
                    replaceExisting
                      ? 'border-accent/60 bg-accent/15 text-text-primary'
                      : 'border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'
                  }`}
                >
                  {t('locker.soulImport.conflict.replace')}
                </button>
                <button
                  onClick={() => setReplaceExisting(false)}
                  className={`flex-1 px-2 py-1 rounded border text-xs cursor-pointer ${
                    !replaceExisting
                      ? 'border-accent/60 bg-accent/15 text-text-primary'
                      : 'border-border bg-bg-tertiary/60 text-text-secondary hover:bg-bg-tertiary'
                  }`}
                >
                  {t('locker.soulImport.conflict.addNew')}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-border mt-3">
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
    </div>,
    document.body
  );
}
