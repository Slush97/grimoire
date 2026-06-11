import { lazy, Suspense, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Star,
  Music,
  Shirt,
  Images,
  Box,
  Loader2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import HeroSkinsPanel from '../components/locker/HeroSkinsPanel';
import HeroCardPicker from '../components/locker/HeroCardPicker';
import HeroSoundPicker from '../components/locker/HeroSoundPicker';
import HeroEffectsPanel from '../components/locker/HeroEffectsPanel';
// three.js viewer is heavy; only pull the chunk when the user flips to 3D.
const HeroPoseViewer = lazy(() => import('../components/locker/HeroPoseViewer'));
import type { Mod } from '../types/mod';
import type { HeroPoseSkinSource } from '../types/portrait';
import {
  countLockerSkins,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  type HeroCategory,
} from '../lib/lockerUtils';

interface LockerHeroViewProps {
  hero: HeroCategory;
  skinList: Mod[];
  /** Sound-section mods mapped to this hero. Optional because the gallery
   *  view in `Locker.tsx` keeps the same prop surface and may not split sounds
   *  out yet. Empty/undefined hides the Sounds section entirely. */
  soundList?: Mod[];
  skinCount: number;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onSelect: (modId: string) => void | Promise<void>;
  onToggleVariant: (modId: string) => void | Promise<void>;
  hideNsfwPreviews?: boolean;
}

type SectionId = 'skins' | 'sounds' | 'cards' | 'effects';

function poseSkinSelectionKey(mod: Mod): string {
  if (typeof mod.gameBananaId === 'number') {
    return [
      'gb',
      mod.gameBananaId,
      mod.gameBananaFileId ?? mod.sourceFileName ?? mod.sha256 ?? mod.id,
    ].join(':');
  }
  if (mod.sha256) return `sha:${mod.sha256}`;
  if (mod.sourceFileName) return `source:${mod.sourceFileName.toLowerCase()}`;
  return `id:${mod.id}`;
}

export function LockerHeroView({
  hero,
  skinList,
  soundList = [],
  skinCount,
  isFavorite,
  onBack,
  onToggleFavorite,
  onSelect,
  onToggleVariant,
  hideNsfwPreviews = false,
}: LockerHeroViewProps) {
  const [renderFallbackStep, setRenderFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);
  const [view3d, setView3d] = useState(false);
  const [section, setSection] = useState<SectionId>('skins');
  const [poseSkinSelection, setPoseSkinSelection] = useState<{
    heroId: number;
    key: string;
  } | null>(null);
  const selectedPoseSkinKey =
    poseSkinSelection?.heroId === hero.id ? poseSkinSelection.key : null;

  // Single-skin fallback: prefer the last skin the user enabled in this view,
  // then fall back to the first enabled skin.
  const fallbackPoseSkinMetaKey = useMemo(() => {
    const selected = selectedPoseSkinKey
      ? skinList.find((mod) => poseSkinSelectionKey(mod) === selectedPoseSkinKey && mod.enabled)
      : null;
    return (selected ?? skinList.find((mod) => mod.enabled))?.metaKey;
  }, [skinList, selectedPoseSkinKey]);

  // Default 3D preview source: every currently enabled visual VPK for this hero.
  // The main process uses priority to build a preview merge that matches game
  // load order, and falls back to fallbackPoseSkinMetaKey if the stack cannot export.
  const activeSkinSources = useMemo<HeroPoseSkinSource[]>(
    () =>
      skinList
        .filter((mod) => mod.enabled)
        .map((mod) => ({ metaKey: mod.metaKey, priority: mod.priority }))
        .sort((a, b) => b.priority - a.priority || a.metaKey.localeCompare(b.metaKey)),
    [skinList]
  );
  const activeSkinSourceKey =
    activeSkinSources.map((source) => `${source.priority}:${source.metaKey}`).join('|') ||
    'vanilla';
  const hasSounds = soundList.length > 0;
  // If the active section runs out of mods (e.g. user deleted their last
  // sound for this hero) drop back to skins so the panel isn't stuck empty.
  const activeSection: SectionId = section === 'sounds' && !hasSounds ? 'skins' : section;
  // Group sound variants the same way skins are counted so the count matches
  // the gallery/list cards and the grouped rows rendered below.
  const soundCount = countLockerSkins(soundList);

  // Section rows, formatted like the Global view's type selector: label +
  // count, with empty sections disabled rather than hidden.
  const sections: Array<{
    id: SectionId;
    label: string;
    icon: LucideIcon;
    count: number | null;
    disabled?: boolean;
  }> = [
    { id: 'skins', label: 'Skins', icon: Shirt, count: skinCount },
    { id: 'sounds', label: 'Sounds', icon: Music, count: soundCount, disabled: !hasSounds },
    { id: 'cards', label: 'Cards', icon: Images, count: null },
    { id: 'effects', label: 'Effects', icon: Sparkles, count: null },
  ];

  const renderSrc =
    renderFallbackStep === 0
      ? getHeroRenderPath(hero.name)
      : renderFallbackStep === 1
        ? getHeroWikiUrl(hero.name)
        : renderFallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '';

  const handleRenderError = () => {
    if (renderFallbackStep === 0) {
      setRenderFallbackStep(1);
      return;
    }
    if (renderFallbackStep === 1 && hero.iconUrl) {
      setRenderFallbackStep(2);
      return;
    }
    setRenderFallbackStep(3);
  };

  const rememberPoseSkinSelection = (modId: string) => {
    const mod = skinList.find((entry) => entry.id === modId);
    if (!mod) return;
    const key = poseSkinSelectionKey(mod);

    setPoseSkinSelection((current) => {
      const currentKey = current?.heroId === hero.id ? current.key : null;
      if (mod.enabled) {
        return currentKey === key ? null : current;
      }
      return { heroId: hero.id, key };
    });
  };

  const handleSelect = async (modId: string) => {
    rememberPoseSkinSelection(modId);
    await onSelect(modId);
  };

  const handleToggleVariant = async (modId: string) => {
    rememberPoseSkinSelection(modId);
    await onToggleVariant(modId);
  };

  // Content-pane heading, Global-view style (section title + count). The Cards
  // and Effects panels render their own headers, so they skip it.
  const contentHeading =
    activeSection === 'skins'
      ? {
          title: 'Skins',
          count: skinCount > 0 ? `${skinCount} skin${skinCount !== 1 ? 's' : ''}` : 'No skins',
        }
      : activeSection === 'sounds'
        ? {
            title: 'Sounds',
            count:
              soundCount > 0 ? `${soundCount} sound${soundCount !== 1 ? 's' : ''}` : 'No sounds',
          }
        : null;

  const selectionPanel =
    activeSection === 'cards' ? (
      <HeroCardPicker heroName={hero.name} />
    ) : activeSection === 'effects' ? (
      <HeroEffectsPanel key={hero.name} heroName={hero.name} />
    ) : activeSection === 'sounds' ? (
      <HeroSoundPicker heroName={hero.name} soundList={soundList} onSelect={onSelect} />
    ) : (
      <HeroSkinsPanel
        mods={skinList}
        onSelect={handleSelect}
        onToggleVariant={handleToggleVariant}
        hideNsfwPreviews={hideNsfwPreviews}
        categoryId={hero.id}
        showDownloadable
        heroName={hero.name}
        emptyMessage="Download a skin for this hero to manage it here."
      />
    );

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Hero backdrop (2D portrait or live 3D pose) — full-bleed behind every
          panel so it can bleed through the frosted-glass rail + selection
          column. The image is sized to the window height with natural aspect
          ratio (h-full w-auto) so wider viewports don't force object-cover to
          scale it up and chop the head/feet off. Anchored to the right edge;
          whatever space is left to the left of the image shows the solid
          bg-primary, which the frosted overlay reads as a dark frosted panel:
          same look as if the portrait extended that far. */}
      <div className="hidden lg:block absolute inset-0 bg-bg-primary animate-hero-zoom-in overflow-hidden">
        {view3d ? (
          <Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/80" />
              </div>
            }
          >
            <HeroPoseViewer
              key={`${hero.name}:${activeSkinSourceKey}:${fallbackPoseSkinMetaKey ?? ''}`}
              heroName={hero.name}
              skinSources={activeSkinSources}
              fallbackSkinMetaKey={fallbackPoseSkinMetaKey}
            />
          </Suspense>
        ) : renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className="absolute top-0 right-0 h-full w-auto max-w-none"
            onError={handleRenderError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-2xl">
            {hero.name}
          </div>
        )}
        {/* Bottom gradient for depth (2D only; the 3D viewer owns its frame) */}
        {!view3d && (
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
        )}
      </div>

      {/* 2D portrait <-> live 3D pose toggle. lg+ only, matching the backdrop;
          sits above the frosted panels so it's always clickable. */}
      <button
        type="button"
        onClick={() => setView3d((v) => !v)}
        aria-pressed={view3d}
        title={view3d ? 'Show 2D portrait' : 'Show live 3D pose'}
        className={`hidden lg:flex absolute top-4 right-4 z-20 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
          view3d
            ? 'border-accent/60 bg-accent/20 text-text-primary'
            : 'border-border/70 bg-bg-secondary/70 text-text-secondary hover:text-text-primary backdrop-blur'
        }`}
      >
        <Box className="h-3.5 w-3.5" />
        {view3d ? '2D' : '3D'}
      </button>

      {/* Progressive frosted-glass background — every layer (including the
          base heavy blur) is masked with a long, smooth taper so nothing has
          a hard right edge. Stacking blurs compounds: a region under all
          three layers is much more blurred than one under only the lightest.
          So as the lighter layers fade out first, the effective blur softens
          from "very heavy" through "medium" to "nothing" without ever
          dropping off a cliff. The container is intentionally much wider
          than the panels it backs (rail + selection is ~640/710px; container
          is ~1000/1100px) so the gradient has runway to feather all the way
          to clear. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden lg:block lg:w-[1040px] xl:w-[1160px]"
      >
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(48px) saturate(135%)',
            WebkitBackdropFilter: 'blur(48px) saturate(135%)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 42%, transparent 94%)',
            maskImage: 'linear-gradient(to right, black 0%, black 42%, transparent 94%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 32%, transparent 78%)',
            maskImage: 'linear-gradient(to right, black 0%, black 32%, transparent 78%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            WebkitMaskImage: 'linear-gradient(to right, black 0%, black 26%, transparent 60%)',
            maskImage: 'linear-gradient(to right, black 0%, black 26%, transparent 60%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, var(--color-bg-secondary) 0%, rgba(26,26,26,0.95) 40%, rgba(26,26,26,0.75) 58%, rgba(26,26,26,0.4) 74%, rgba(26,26,26,0.15) 87%, transparent 97%)',
          }}
        />
      </div>

      {/* Left sidebar: hero identity + section nav, formatted like the Global
          view's type selector (Back, title + count, full-width rows). Solid bg
          below lg; transparent on lg so the feathered glass shows through. */}
      <div className="relative z-10 flex w-[260px] flex-shrink-0 flex-col gap-6 overflow-y-auto scrollbar-glass bg-bg-secondary p-6 animate-slide-in-left lg:w-[300px] lg:bg-transparent xl:w-[340px]">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex w-fit items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={onToggleFavorite}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
              isFavorite
                ? 'border-yellow-400/60 bg-yellow-400/20 text-yellow-300'
                : 'border-border/70 text-text-secondary hover:text-text-primary'
            }`}
          >
            <Star className="w-4 h-4" />
            {isFavorite ? 'Favorite' : 'Save'}
          </button>
        </div>

        {/* Hero Name */}
        {nameFailed ? (
          <h2 className="text-2xl font-bold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
            {hero.name}
          </h2>
        ) : (
          <img
            src={getHeroNamePath(hero.name)}
            alt={hero.name}
            className="h-8 w-auto self-start object-contain"
            onError={() => setNameFailed(true)}
          />
        )}

        <nav aria-label="Locker sections" className="flex flex-col gap-1.5">
          {sections.map(({ id, label, icon: Icon, count, disabled }) => {
            const isActive = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setSection(id)}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  disabled
                    ? 'cursor-default border-transparent opacity-40'
                    : isActive
                      ? 'border-accent/60 bg-accent/15 cursor-pointer'
                      : 'border-transparent hover:bg-white/10 cursor-pointer'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-white/80" />
                <span className="flex-1 truncate text-sm font-medium text-white">{label}</span>
                {count !== null && <span className="text-xs text-white/50">{count}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Right pane: the active section's content. Width-capped on lg+ so the
          hero stays visible to its right (unlike the Global view, the backdrop
          here IS the subject, not scenery to overlay). */}
      <div className="relative z-10 min-w-0 flex-1 overflow-y-auto scrollbar-glass bg-bg-primary lg:flex-none lg:w-[480px] lg:bg-transparent xl:w-[540px]">
        <div className="space-y-4 p-6">
          {contentHeading && (
            <div className="flex items-baseline gap-2">
              <h3 className="text-base font-semibold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                {contentHeading.title}
              </h3>
              <span className="text-xs text-white/60">{contentHeading.count}</span>
            </div>
          )}
          {selectionPanel}
        </div>
      </div>
    </div>
  );
}
