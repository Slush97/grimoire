import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, SegmentedControl } from '../components/common/ui';
import {
  ArrowLeft,
  Star,
  Music,
  Shirt,
  Images,
  Box,
  Sparkles,
  ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import HeroSkinsPanel, { SkinLoadOrderStrip } from '../components/locker/HeroSkinsPanel';
import { HeroNavigation } from '../components/locker/HeroNavigation';
import { LockerModImagePicker } from '../components/locker/LockerModImagePicker';
import HeroCardPicker from '../components/locker/HeroCardPicker';
import HeroSoundPicker from '../components/locker/HeroSoundPicker';
import HeroEffectsPanel from '../components/locker/HeroEffectsPanel';
import { lockerViewerLoaded, useLockerViewer, useLockerViewerRequest } from '../stores/lockerViewerStore';
import { useAppStore } from '../stores/appStore';
import { hideoutReadyNow, openingViewerScene, refreshHideoutReady, storedViewerScene } from '../lib/hideoutDefault';
import { preloadHideout } from '../lib/hideoutPreload';
import { useTrippyPreviewStore } from '../stores/trippyPreviewStore';
import type { Mod } from '../types/mod';
import type { HeroPoseSkinSource } from '../types/portrait';
import {
  activeLockerSkin,
  countLockerSkins,
  getHeroNamePath,
  getHeroRenderPath,
  getHeroWikiUrl,
  getLockerSkinKey,
  type HeroCategory,
} from '../lib/lockerUtils';
import type { VariantChoice } from '../lib/lockerRandomizer';

interface LockerHeroViewProps {
  hero: HeroCategory;
  navigation: Omit<ComponentProps<typeof HeroNavigation<HeroCategory>>, 'children'>;
  skinList: Mod[];
  /** Sound-section mods mapped to this hero. Optional because the gallery
   *  view in `Locker.tsx` keeps the same prop surface and may not split sounds
   *  out yet. Empty/undefined hides the Sounds section entirely. */
  soundList?: Mod[];
  skinCount: number;
  isFavorite: boolean;
  onBack: () => void;
  onToggleFavorite: () => void;
  onSelect: (modId: string) => Promise<boolean> | void;
  onToggleVariant: (modId: string) => Promise<boolean> | void;
  /** Reorder the load order of this hero's enabled skins. `orderedModIds` is
   *  the new desired order of enabled skin VPK ids (lower index = loads first). */
  onReorderSkins?: (orderedModIds: string[]) => void | Promise<void>;
  /** Request deletion of a skin group (all its variant VPKs). The page owns the
   *  confirmation dialog and the actual delete. */
  onRequestDeleteSkin?: (modIds: string[], name: string) => void;
  hideNsfwPreviews?: boolean;
  /** Launch-shuffle pool set + toggle, threaded to the skins panel cards. */
  includedSkinKeys?: Set<string>;
  onToggleShuffleIncluded?: (skinKey: string) => void;
  shuffleVariantChoices?: ReadonlyMap<string, VariantChoice>;
  onSetShuffleVariant?: (skinKey: string, choice: VariantChoice | null) => void;
  /** Whether the master shuffle switch is armed (keeps per-skin toggles visible). */
  shuffleArmed?: boolean;
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
  navigation,
  skinList,
  soundList = [],
  skinCount,
  isFavorite,
  onBack,
  onToggleFavorite,
  onSelect,
  onToggleVariant,
  onReorderSkins,
  onRequestDeleteSkin,
  hideNsfwPreviews = false,
  includedSkinKeys,
  onToggleShuffleIncluded,
  shuffleVariantChoices,
  onSetShuffleVariant,
  shuffleArmed,
}: LockerHeroViewProps) {
  const { t } = useTranslation();
  const viewRef = useRef<HTMLDivElement>(null);
  // The full-screen layer starts below any app banners, including while a
  // banner is dismissed or arrives after this view has already opened.
  useLayoutEffect(() => {
    const layer = viewRef.current?.closest<HTMLElement>('[data-locker-hero-overlay]');
    const viewport = viewRef.current?.closest<HTMLElement>('[data-app-content-viewport]');
    if (!layer || !viewport) return;
    const update = () => { layer.style.top = Math.max(0, viewport.getBoundingClientRect().top) + 'px'; };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  // Issue #208: the backdrop reflects the active skin's chosen Locker image, if
  // the user picked one (set per skin in the skins list below).
  const lockerModThumbnails = useAppStore((s) => s.lockerModThumbnails);
  const workshopEnabled = useAppStore((s) => s.settings?.experimentalFoundry === true);
  const hideoutDefault = useAppStore((s) => s.settings?.experimentalHideoutDefault === true);
  // Known before the 3D button is pressed, so the viewer opens on the right scene.
  useEffect(() => { if (hideoutDefault) refreshHideoutReady(); }, [hideoutDefault]);
  const lockerModBackgrounds = useAppStore((s) => s.lockerModBackgrounds);
  const lockerBgHideHeroName = useAppStore((s) => s.lockerBgHideHeroName);
  const activeSkin = useMemo(() => activeLockerSkin(skinList), [skinList]);
  const activeSkinKey = activeSkin ? getLockerSkinKey(activeSkin) : undefined;
  // The "Locker image" (grid-thumbnail surface) the picker mirrors from.
  const thumbnailImage = activeSkinKey ? lockerModThumbnails[activeSkinKey] : undefined;
  // The full-bleed backdrop is its own per-skin image (issue #208), independent
  // of the 3:4 card image. Unset = the hero render. The card image is shown only
  // on the grid card, never here.
  const backdropImage = activeSkinKey ? lockerModBackgrounds[activeSkinKey] : undefined;
  // Hide the hero name logo when the active skin's backdrop already shows the
  // name (only meaningful when a custom backdrop is in play).
  const hideHeroName = activeSkinKey ? Boolean(lockerBgHideHeroName[activeSkinKey]) : false;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renderFallbackStep, setRenderFallbackStep] = useState(0);
  const [nameFailed, setNameFailed] = useState(false);
  // Shared by every hero: switching heroes keeps the viewer open and loaded.
  const view3d = useLockerViewer((state) => state.open);
  const setView3d = useLockerViewer((state) => state.setOpen);
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionId>('skins');
  const sectionPanelId = useId();
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

  // Live Body + Gun trippy params, pushed by TrippySkinPanel. Only feed the
  // viewer when it targets the hero currently shown so a stale entry from
  // another hero never paints the wrong model.
  const trippyPreview = useTrippyPreviewStore((s) => s.preview);
  const matchedTrippyPreview =
    trippyPreview && trippyPreview.heroName === hero.name ? trippyPreview : undefined;
  // The live 3D panel itself is LockerViewerPanel, above this per-hero view (see Locker.tsx).
  useLockerViewerRequest(view3d, {
    heroName: hero.name,
    skinSources: activeSkinSources,
    fallbackSkinMetaKey: fallbackPoseSkinMetaKey,
    trippyPreview: matchedTrippyPreview,
  });
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
    { id: 'skins', label: t('locker.hero.skins'), icon: Shirt, count: skinCount },
    { id: 'sounds', label: t('locker.hero.sounds'), icon: Music, count: soundCount, disabled: !hasSounds },
    { id: 'cards', label: t('locker.hero.cards'), icon: Images, count: null },
    { id: 'effects', label: t('locker.hero.effects'), icon: Sparkles, count: null },
  ];

  const renderSrc =
    backdropImage ??
    (renderFallbackStep === 0
      ? getHeroRenderPath(hero.name)
      : renderFallbackStep === 1
        ? getHeroWikiUrl(hero.name)
        : renderFallbackStep === 2
          ? (hero.iconUrl ?? '')
          : '');

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

  const handleSelect = (modId: string) => {
    rememberPoseSkinSelection(modId);
    return onSelect(modId);
  };

  const handleToggleVariant = (modId: string) => {
    rememberPoseSkinSelection(modId);
    return onToggleVariant(modId);
  };

  // Content-pane heading, Global-view style (section title + count). The Cards
  // and Effects panels render their own headers, so they skip it.
  const contentHeading =
    activeSection === 'skins'
      ? {
          title: t('locker.hero.skins'),
          count: skinCount > 0 ? t('locker.hero.skinCount', { count: skinCount }) : t('locker.hero.noSkins'),
        }
      : activeSection === 'sounds'
        ? {
            title: t('locker.hero.sounds'),
            count:
              soundCount > 0 ? t('locker.hero.soundCount', { count: soundCount }) : t('locker.hero.noSounds'),
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
        onRequestDelete={onRequestDeleteSkin}
        hideNsfwPreviews={hideNsfwPreviews}
        categoryId={hero.id}
        showDownloadable
        heroName={hero.name}
        emptyMessage={t('locker.hero.downloadASkinForThisHero')}
        layout="cards"
        includedSkinKeys={includedSkinKeys}
        onToggleShuffleIncluded={onToggleShuffleIncluded}
        shuffleVariantChoices={shuffleVariantChoices}
        onSetShuffleVariant={onSetShuffleVariant}
        shuffleArmed={shuffleArmed}
      />
    );

  return (
    <div ref={viewRef} data-locker-hero-view className="relative flex h-full overflow-hidden">
      {/* Hero backdrop (2D portrait or live 3D pose) — full-bleed behind every
          panel so it can bleed through the frosted-glass rail + selection
          column. The image is sized to the window height with natural aspect
          ratio (h-full w-auto) so wider viewports don't force object-cover to
          scale it up and chop the head/feet off. Anchored to the right edge;
          whatever space is left to the left of the image shows the solid
          bg-primary, which the frosted overlay reads as a dark frosted panel:
          same look as if the portrait extended that far. */}
      <div className="hidden lg:block absolute inset-0 bg-bg-primary animate-hero-zoom-in overflow-hidden">
        {renderSrc ? (
          <img
            src={renderSrc}
            alt={hero.name}
            className={
              backdropImage
                ? 'absolute inset-0 h-full w-full object-cover'
                : 'absolute top-0 right-0 h-full w-auto max-w-none'
            }
            onError={backdropImage ? undefined : handleRenderError}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-2xl">
            {hero.name}
          </div>
        )}
        {/* Bottom gradient for depth. */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/50 to-transparent" />
      </div>

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
        className="pointer-events-none absolute inset-y-0 left-0 z-[5] hidden lg:block lg:w-[976px] xl:w-[1096px]"
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
        <div className="locker-hero-glass absolute inset-0" />
      </div>

      <div className="relative z-10 flex min-h-0 w-full max-w-[56rem] flex-col bg-bg-primary lg:bg-transparent">
        <header className="flex shrink-0 animate-slide-in-left flex-col gap-4 px-6 pb-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>{t('locker.hero.back')}</Button>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={onToggleFavorite} aria-pressed={isFavorite}
                title={isFavorite ? t('locker.hero.unfavorite') : t('locker.hero.favorite')}
                aria-label={isFavorite ? t('locker.hero.unfavorite') : t('locker.hero.favorite')}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${isFavorite
                  ? 'border-accent/60 bg-accent/20 text-text-primary'
                  : 'border-border/70 bg-bg-secondary/70 text-text-secondary backdrop-blur hover:text-text-primary'}`}>
                <Star className={`h-3.5 w-3.5 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
              {activeSkin && activeSkinKey && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  title={t('locker.hero.lockerImages')}
                  aria-label={t('locker.hero.lockerImages')}
                  className="flex items-center gap-1.5 rounded-full border border-border/70 bg-bg-secondary/70 px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary backdrop-blur cursor-pointer"
                >
                  <ImageIcon className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  // Start reading the hideout while the viewer's code and hero load.
                  const { settings } = useAppStore.getState();
                  if (!view3d && !lockerViewerLoaded() && openingViewerScene(storedViewerScene(settings, `viewer:${hero.name}:view`), 'midtown',
                    settings?.experimentalHideoutDefault === true, hideoutReadyNow()) === 'hideout') preloadHideout(`viewer:${hero.name}:view`);
                  setView3d(!view3d);
                }}
                aria-pressed={view3d}
                title={view3d ? t('locker.hero.hide3dModel') : t('locker.hero.showLive3dModel')}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  view3d
                    ? 'border-accent/60 bg-accent/20 text-text-primary'
                    : 'border-border/70 bg-bg-secondary/70 text-text-secondary hover:text-text-primary backdrop-blur'
                }`}
              >
                <Box className="h-3.5 w-3.5" />
                3D
              </button>
            </div>
          </div>
            <div className="mx-auto w-80 max-w-full">
              <HeroNavigation {...navigation} plain>
                {hideHeroName && backdropImage ? null : nameFailed ? (
                  <h2 className="truncate text-2xl font-bold text-text-primary drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] light:drop-shadow-none">
                    {hero.name}
                  </h2>
                ) : (
                  <img
                    src={getHeroNamePath(hero.name)}
                    alt={hero.name}
                    className="h-12 w-auto max-w-full object-contain light:invert"
                    onError={() => setNameFailed(true)}
                  />
                )}
              </HeroNavigation>
            </div>
          <SegmentedControl variant="joined" framed={false} fill value={activeSection} onChange={setSection}
            label={t('locker.hero.lockerSections')} panelId={sectionPanelId}
            options={sections.map(({ id, label, icon: Icon, count, disabled }) => ({ value: id, disabled,
              label: <><Icon className="h-4 w-4 shrink-0" /><span className="truncate text-sm">{label}</span>
                {count !== null && <span className="text-xs tabular-nums text-text-secondary">{count}</span>}</>,
            }))} />
        </header>
        <div id={sectionPanelId} role="tabpanel" aria-labelledby={sectionPanelId + '-tab-' + activeSection}
          className="min-h-0 flex-1 overflow-y-auto scrollbar-glass">
          <div key={activeSection} className="space-y-4 animate-slide-in-left px-6 pb-6 pt-2">
            {contentHeading && <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-base font-semibold text-text-primary">{contentHeading.title}</h3>
                <span className="text-xs text-text-secondary">{contentHeading.count}</span>
              </div>
              {workshopEnabled && activeSection === 'skins' && <Button variant="secondary" size="sm"
                onClick={() => navigate('/foundry', { state: { heroName: hero.name, skinSources: activeSkinSources } })}>
                {t('foundry.skin.editInWorkshop')}
              </Button>}
            </div>}
            {activeSection === 'skins' && onReorderSkins && <SkinLoadOrderStrip mods={skinList}
              onReorder={onReorderSkins} hideNsfwPreviews={hideNsfwPreviews} />}
            {selectionPanel}
          </div>
        </div>
      </div>

      {/* Unified per-skin image picker (issue #208): tabbed for the 3:4 grid
          thumbnail, the 16:9 skin-panel card and the 16:9 backdrop, opening on
          the thumbnail tab. */}
      {pickerOpen && activeSkin && activeSkinKey && (
        <LockerModImagePicker
          mod={activeSkin}
          skinKey={activeSkinKey}
          heroName={hero.name}
          lockerImageDataUrl={thumbnailImage}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
