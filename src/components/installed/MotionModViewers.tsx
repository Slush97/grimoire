import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pause, Play } from 'lucide-react';
import { IconButton, SegmentedControl } from '../common/ui';
import HeroPoseViewer from '../locker/HeroPoseViewer';
import { exportAnimationModPreview } from '../../lib/api';
import type { MovementFxChoice } from '../../lib/movementFx';

/** The hero Installed previews of dash and heavy melee effects play on. */
export const MOVEMENT_PREVIEW_HERO = 'Lash';

function Status({ failed }: { failed: boolean }): ReactNode {
  const { t } = useTranslation();
  return <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
    {failed
      ? <p className="text-center text-xs text-text-secondary">{t('installed.preview.unavailable')}</p>
      : <Loader2 className="h-6 w-6 animate-spin text-text-secondary" aria-label={t('foundry.skin.loading')} />}
  </div>;
}

/** A Door Stuck movement effect, rebuilt from the settings saved with the mod and played on Lash. */
export function MovementModViewer({ choice, active, turn }: { choice: MovementFxChoice; active: boolean; turn: RefObject<number | null> }) {
  const choiceKey = JSON.stringify(choice);
  // choiceKey carries the choice's contents; the object itself is rebuilt on every mods refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const preview = useMemo(() => ({ kind: choice.kind, revision: 0, loop: true, request: { choice, heroName: MOVEMENT_PREVIEW_HERO } }), [choiceKey]);
  return <HeroPoseViewer heroName={MOVEMENT_PREVIEW_HERO} compact active={active} turn={turn} movementPreview={preview} />;
}

const ALL = '';
/** `melee_in_air_dash` -> `Melee in air dash`. */
const clipLabel = (name: string) => name.replace(/_+/g, ' ').trim().replace(/^./, (first) => first.toUpperCase());

/** An animation mod's clips, played back to back on its hero. Expanded (the pinned panel), a strip picks one
 *  clip to loop and pauses. */
export function AnimationModViewer({ metaKey, active, turn, expanded = false }: { metaKey: string; active: boolean; turn: RefObject<number | null>; expanded?: boolean }) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<{ heroName: string; key: string; clips: string[]; meshGroup: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [clip, setClip] = useState(ALL);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let cancelled = false;
    exportAnimationModPreview(metaKey).then((value) => {
      if (cancelled) return;
      if (value) setPreview(value); else setFailed(true);
    }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [metaKey]);
  if (!preview) return <Status failed={failed} />;
  const strip = expanded && preview.clips.length > 1;
  return <div className="flex h-full flex-col">
    <div className="relative min-h-0 flex-1">
      <HeroPoseViewer heroName={preview.heroName} compact active={active} turn={turn} meshGroup={preview.meshGroup ?? undefined}
        clipOverride={{ key: preview.key, url: `grimoire-hero://a/${preview.key}/clips.glb`, clip: clip || null, paused }} />
    </div>
    {strip && <div className="flex max-h-24 shrink-0 items-start gap-2 overflow-y-auto border-t border-border px-6 py-2">
      <IconButton size="sm" icon={paused ? Play : Pause} label={t(paused ? 'audioPreview.play' : 'audioPreview.pause')} onClick={() => setPaused(!paused)} />
      <SegmentedControl label={t('installed.preview.clips')} value={clip} onChange={(value) => { setClip(value); setPaused(false); }}
        options={[{ value: ALL, label: t('installed.preview.allClips') },
          ...preview.clips.map((name) => ({ value: name, label: clipLabel(name), title: name }))]} />
    </div>}
  </div>;
}
