/**
 * DEV-ONLY pose-authoring tool (slice 4).
 *
 * A gated panel where the developer dials in, per hero, the camera framing +
 * which pose to bake for that hero's 3D Locker card snapshot, previews it live,
 * and commits it to the checked-in per-hero config (writeHeroPoseAuthoring). The
 * separate bake feature consumes that config; this page only authors it.
 *
 * Gating: reached only via the Sidebar entry, which is shown only when
 * `import.meta.env.DEV` AND settings.experimentalPoseAuthoring (see Sidebar +
 * Settings). The config writeback is refused by the main process in a packaged
 * build regardless, so a stray navigation here in a binary just fails to commit.
 *
 * 3D: a SINGLE WebGL context (one r3f Canvas) mirroring HeroPoseViewer's setup
 * (fov 40, alpha + ACESFilmic + exposure 0.8, IBL probe). It uses the SHARED
 * heroPoseScene helpers (applyFraming, loadIblEnvironment, normalizeModel,
 * disposeScene, framingCameraPosition) so what is previewed frames + lights
 * identically to the bake. The preview camera is DRIVEN BY the framing controls
 * (not free orbit) so what you see is what bakes; an optional "inspect" orbit
 * mode writes the released yaw/pitch/distance/target back into the controls.
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { getHeroPoseAuthoring, writeHeroPoseAuthoring } from '../lib/api';
import {
  HERO_NAMES_SORTED,
  groupModsByCategory,
  isLockerManagedMod,
} from '../lib/lockerUtils';
import {
  DEFAULT_CAMERA_FRAMING,
} from '../lib/heroPoseScene';
import { Card, Button } from '../components/common/ui';
import { PageHeader } from '../components/common/PageComponents';
import Tx from '../components/translation/Tx';
import type {
  HeroCameraFraming,
  HeroPoseAuthoringEntry,
  HeroPoseAuthoringMap,
  HeroPoseSelection,
  HeroPoseSkinSource,
} from '../types/portrait';

// The r3f preview is heavy (three.js); only pull the chunk once this dev page
// mounts. Keeps the chunk off the critical path for normal users.
const PoseAuthorPreview = lazy(() => import('../components/locker/PoseAuthorPreview'));

/** Synthetic hero ids: groupModsByCategory keys mods by category id, so we hand
 *  it a stable id-per-display-name list and map the selected hero back by id. */
const HERO_LIST = HERO_NAMES_SORTED.map((name, index) => ({ id: index + 1, name }));
const HERO_ID_BY_NAME = new Map(HERO_LIST.map((h) => [h.name, h.id]));

type CommitState = 'idle' | 'saving' | 'saved' | 'error';

/** Round a slider/number value to 2 decimals so authored configs stay tidy. */
function q(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function PoseAuthoring() {
  const { t } = useTranslation();
  const mods = useAppStore((s) => s.mods);
  const loadMods = useAppStore((s) => s.loadMods);
  const modsLoaded = useAppStore((s) => s.modsLoaded);

  useEffect(() => {
    if (!modsLoaded) void loadMods({ silent: true });
  }, [modsLoaded, loadMods]);

  // The committed config + a monotonic version. The version bumps on every load
  // / successful commit and is folded into the editor's `key`, which remounts it
  // so it re-initializes from the latest entry without a setState-in-effect.
  const [authoringMap, setAuthoringMap] = useState<HeroPoseAuthoringMap>({});
  const [mapVersion, setMapVersion] = useState(0);
  const [heroName, setHeroName] = useState<string>(HERO_NAMES_SORTED[0] ?? 'Abrams');

  // Load the committed config once.
  useEffect(() => {
    let cancelled = false;
    void getHeroPoseAuthoring()
      .then((map) => {
        if (cancelled) return;
        setAuthoringMap(map);
        setMapVersion((v) => v + 1);
      })
      .catch(() => {
        // A missing/empty config is fine: the editor falls back to defaults.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Skin sources for the selected hero: every currently enabled visual VPK
  // mapped to this hero, highest priority first (mirrors LockerHero so the
  // preview stack matches what the user sees in the Locker).
  const heroMods = useMemo(() => {
    const managed = mods.filter(isLockerManagedMod);
    const { map } = groupModsByCategory(managed, HERO_LIST);
    const id = HERO_ID_BY_NAME.get(heroName);
    return id ? map.get(id) ?? [] : [];
  }, [mods, heroName]);

  const skinSources = useMemo<HeroPoseSkinSource[]>(
    () =>
      heroMods
        .filter((mod) => mod.enabled)
        .map((mod) => ({ metaKey: mod.metaKey, priority: mod.priority }))
        .sort((a, b) => b.priority - a.priority || a.metaKey.localeCompare(b.metaKey)),
    [heroMods]
  );

  const fallbackSkinMetaKey = useMemo(
    () => heroMods.find((mod) => mod.enabled)?.metaKey,
    [heroMods]
  );

  const handleCommitted = useCallback((updated: HeroPoseAuthoringMap) => {
    setAuthoringMap(updated);
    setMapVersion((v) => v + 1);
  }, []);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <PageHeader
        title={<Tx k="locker.poseAuthor.title" fallback="Pose Authoring" />}
        description={
          <Tx
            k="locker.poseAuthor.subtitle"
            fallback="Dev-only: dial in the per-hero camera framing and pose for the 3D card snapshot, then commit it to the checked-in config."
          />
        }
      />

      {/* Hero picker lives in the outer component so changing hero keeps the
          editor's remount-on-key behavior (the editor is keyed by hero). */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-secondary">
            {t('locker.poseAuthor.hero')}
          </span>
          <select
            value={heroName}
            onChange={(e) => setHeroName(e.target.value)}
            className="rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {HERO_NAMES_SORTED.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span className="pb-2 text-[11px] text-text-secondary">
          {skinSources.length > 0
            ? t('locker.poseAuthor.skinStack', { count: skinSources.length })
            : t('locker.poseAuthor.vanillaStack')}
        </span>
      </div>

      <HeroPoseEditor
        key={`${heroName}:${mapVersion}`}
        heroName={heroName}
        initialEntry={authoringMap[heroName]}
        skinSources={skinSources}
        fallbackSkinMetaKey={fallbackSkinMetaKey}
        onCommitted={handleCommitted}
      />
    </div>
  );
}

/**
 * The per-hero editor: all framing/pose state + the live preview + commit. It is
 * remounted (via a `key` on hero + map version) whenever the selection or the
 * loaded config changes, so it initializes lazily from `initialEntry` with no
 * prefill effect (which would trip react-hooks/set-state-in-effect).
 */
function HeroPoseEditor({
  heroName,
  initialEntry,
  skinSources,
  fallbackSkinMetaKey,
  onCommitted,
}: {
  heroName: string;
  initialEntry: HeroPoseAuthoringEntry | undefined;
  skinSources: HeroPoseSkinSource[];
  fallbackSkinMetaKey?: string;
  onCommitted: (map: HeroPoseAuthoringMap) => void;
}) {
  const { t } = useTranslation();

  const initialCam = initialEntry?.camera ?? DEFAULT_CAMERA_FRAMING;
  const [framing, setFraming] = useState<HeroCameraFraming>({
    yawDeg: initialCam.yawDeg,
    pitchDeg: initialCam.pitchDeg,
    distance: initialCam.distance,
    target: [initialCam.target[0], initialCam.target[1], initialCam.target[2]],
  });
  const [modelYawDeg, setModelYawDeg] = useState<number>(initialEntry?.modelYawDeg ?? 0);
  const [clip, setClip] = useState<string>(initialEntry?.pose?.clip ?? '');
  const [frame, setFrame] = useState<number>(initialEntry?.pose?.frame ?? 0);

  const [inspect, setInspect] = useState<boolean>(false);
  const [commitState, setCommitState] = useState<CommitState>('idle');
  const [commitError, setCommitError] = useState<string>('');

  // The pose selection object passed to export. Omitting it (no clip) keeps the
  // default menu/idle pose AND a byte-identical cache key to the legacy stills.
  const poseSelection = useMemo<HeroPoseSelection | undefined>(() => {
    const trimmed = clip.trim();
    if (!trimmed) return undefined;
    return frame > 0 ? { clip: trimmed, frame } : { clip: trimmed };
  }, [clip, frame]);

  const currentEntry = useMemo<HeroPoseAuthoringEntry>(() => {
    const entry: HeroPoseAuthoringEntry = {
      camera: {
        yawDeg: q(framing.yawDeg),
        pitchDeg: q(framing.pitchDeg),
        distance: q(framing.distance),
        target: [q(framing.target[0]), q(framing.target[1]), q(framing.target[2])],
      },
    };
    if (modelYawDeg !== 0) entry.modelYawDeg = q(modelYawDeg);
    if (poseSelection) entry.pose = poseSelection;
    return entry;
  }, [framing, modelYawDeg, poseSelection]);

  const handleCommit = useCallback(async () => {
    setCommitState('saving');
    setCommitError('');
    try {
      const updated = await writeHeroPoseAuthoring(heroName, currentEntry);
      setCommitState('saved');
      onCommitted(updated);
    } catch (err) {
      setCommitState('error');
      setCommitError(err instanceof Error ? err.message : String(err));
    }
  }, [heroName, currentEntry, onCommitted]);

  const handleResetDefaults = useCallback(() => {
    setFraming({ ...DEFAULT_CAMERA_FRAMING });
    setModelYawDeg(0);
    setClip('');
    setFrame(0);
    setCommitState('idle');
  }, []);

  // Orbit-mode release writes the resolved camera back into the framing controls
  // so leaving inspect mode keeps what you framed by hand.
  const handleInspectCommit = useCallback((next: HeroCameraFraming) => {
    setFraming({
      yawDeg: q(next.yawDeg),
      pitchDeg: q(next.pitchDeg),
      distance: q(next.distance),
      target: [q(next.target[0]), q(next.target[1]), q(next.target[2])],
    });
  }, []);

  return (
    <div className="grid flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* Live preview pane */}
      <Card title={<Tx k="locker.poseAuthor.previewTitle" fallback="Live preview" />} icon={Camera}>
        <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black/40">
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/70" />
              </div>
            }
          >
            <PoseAuthorPreview
              heroName={heroName}
              skinSources={skinSources}
              fallbackSkinMetaKey={fallbackSkinMetaKey}
              pose={poseSelection}
              framing={framing}
              modelYawDeg={modelYawDeg}
              inspect={inspect}
              onInspectCommit={handleInspectCommit}
            />
          </Suspense>
        </div>
        <p className="mt-3 text-xs text-text-secondary">
          <Tx
            k="locker.poseAuthor.previewNote"
            fallback="The camera follows the framing controls so what you see is what bakes. Turn on Inspect to orbit freely; releasing the orbit writes the result back into the controls."
          />
        </p>
      </Card>

      {/* Controls pane */}
      <Card title={<Tx k="locker.poseAuthor.controlsTitle" fallback="Controls" />}>
        <div className="space-y-5">
          {/* Camera framing */}
          <FramingSlider
              label={t('locker.poseAuthor.yaw')}
              value={framing.yawDeg}
              min={-180}
              max={180}
              step={1}
              onChange={(yawDeg) => setFraming((f) => ({ ...f, yawDeg }))}
            />
            <FramingSlider
              label={t('locker.poseAuthor.pitch')}
              value={framing.pitchDeg}
              min={-89}
              max={89}
              step={1}
              onChange={(pitchDeg) => setFraming((f) => ({ ...f, pitchDeg }))}
            />
            <FramingSlider
              label={t('locker.poseAuthor.distance')}
              value={framing.distance}
              min={1}
              max={8}
              step={0.05}
              onChange={(distance) => setFraming((f) => ({ ...f, distance }))}
            />
            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label={t('locker.poseAuthor.targetX')}
                value={framing.target[0]}
                step={0.05}
                onChange={(v) => setFraming((f) => ({ ...f, target: [v, f.target[1], f.target[2]] }))}
              />
              <NumberField
                label={t('locker.poseAuthor.targetY')}
                value={framing.target[1]}
                step={0.05}
                onChange={(v) => setFraming((f) => ({ ...f, target: [f.target[0], v, f.target[2]] }))}
              />
              <NumberField
                label={t('locker.poseAuthor.targetZ')}
                value={framing.target[2]}
                step={0.05}
                onChange={(v) => setFraming((f) => ({ ...f, target: [f.target[0], f.target[1], v] }))}
              />
            </div>

            <FramingSlider
              label={t('locker.poseAuthor.modelYaw')}
              value={modelYawDeg}
              min={-180}
              max={180}
              step={1}
              onChange={setModelYawDeg}
            />

            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={inspect}
                onChange={(e) => setInspect(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-input text-accent focus:ring-accent"
              />
              {t('locker.poseAuthor.inspectMode')}
            </label>

            <div className="h-px bg-white/5" />

            {/* Pose selection. For now this is a free-text clip + numeric frame.
                TODO: populate from `vpkmerge model clips` once exposed in
                Grimoire so this becomes a dropdown. CRITICAL when wiring that:
                clip discovery MUST use the SAME model selector the export uses
                (the pinned `--entry` for reworked heroes, else `--hero`), or the
                listed clips will not match what actually bakes. */}
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-text-secondary">
                {t('locker.poseAuthor.clip')}
              </span>
              <input
                type="text"
                value={clip}
                onChange={(e) => setClip(e.target.value)}
                placeholder={t('locker.poseAuthor.clipPlaceholder')}
                className="w-full rounded-md border border-white/10 bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
              />
            </label>
            <NumberField
              label={t('locker.poseAuthor.frame')}
              value={frame}
              step={1}
              min={0}
              disabled={clip.trim().length === 0}
              onChange={(v) => setFrame(Math.max(0, Math.round(v)))}
            />

            <div className="h-px bg-white/5" />

            {/* Commit + reset */}
            <div className="flex items-center gap-2">
              <Button onClick={handleCommit} disabled={commitState === 'saving'} className="flex-1">
                {commitState === 'saving' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : commitState === 'saved' ? (
                  <Check className="mr-1.5 h-4 w-4" />
                ) : null}
                {t('locker.poseAuthor.commit')}
              </Button>
              <Button variant="secondary" onClick={handleResetDefaults} title={t('locker.poseAuthor.resetDefaults')}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
            {commitState === 'saved' && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {t('locker.poseAuthor.committed', { hero: heroName })}
              </p>
            )}
            {commitState === 'error' && (
              <p className="flex items-start gap-1.5 text-xs text-red-400">
                <X className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t('locker.poseAuthor.commitFailed')}
                  {commitError ? ` (${commitError})` : ''}
                </span>
              </p>
            )}
          </div>
        </Card>
    </div>
  );
}

/** A labeled slider with a synced numeric input. */
function FramingSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <input
          type="number"
          value={q(value)}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) onChange(next);
          }}
          className="w-20 rounded-md border border-white/10 bg-input px-2 py-1 text-right text-xs text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </label>
  );
}

/** A labeled numeric input. */
function NumberField({
  label,
  value,
  step,
  min,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <input
        type="number"
        value={q(value)}
        step={step}
        min={min}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        className="w-full rounded-md border border-white/10 bg-input px-2 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-40"
      />
    </label>
  );
}
