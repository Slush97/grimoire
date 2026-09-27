import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Eye, ThumbsUp, Volume2, VolumeX, AlertTriangle, Clock, Power, Play } from 'lucide-react';
import type { GameBananaMod } from '../../types/gamebanana';
import { getModThumbnail, getSoundPreviewUrl, formatDate, isModOutdated } from '../../types/gamebanana';
import ModThumbnail from '../ModThumbnail';
import ImageContextMenu from '../ImageContextMenu';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import { Tag } from '../common/ui';
import { IconText } from '../common/IconText';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition } from '../../lib/lockerUtils';
import {
  BROWSE_READABLE_CARD_GOLDEN,
  getReadableCardTargetWidth,
  getReadableDensity,
  type BrowseCardDesign,
  type ViewMode,
} from './cardGeometry';
import { BROWSE_READABLE_MAX_VISIBLE_CHIPS, BrowseReadableChipRow } from './cardChips';
import {
  BrowseArtParallaxCard,
  BrowseDownloadSpinner,
  BrowseReadableAction,
  BrowseReadableStatsRow,
  BrowseReadableUpdatedLine,
  BrowseSoundPlaceholder,
  BrowseStatItem,
} from './cardParts';
import { formatCount, getReadableCardChips } from './cardUtils';

// Treat Enter/Space as a click on role="button" divs (keyboard navigation).
function handleCardKeyDown(e: React.KeyboardEvent, onClick: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}

// Below this card width the "last updated" line moves to its own row under the
// author instead of sharing the stats row, so it never squashes likes/views.
const BROWSE_READABLE_UPDATED_INLINE_MIN = 300;

function ReadableBrowseModCard({
  mod,
  installed,
  installedDisabled,
  downloading,
  queuePosition,
  cardSize,
  cardWidth,
  cardHeight,
  section,
  volume,
  onVolumeChange,
  hideNsfwPreviews,
  isPlaying,
  suppressHoverIntentRef,
  onPlayingChange,
  onClick,
  onQuickDownload,
  onEnable,
}: ModCardProps) {
  const { t } = useTranslation();
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);
  const inferredHero = inferHeroFromTitle(mod.name);
  const heroRenderUrl = isSoundSection && inferredHero ? getHeroRenderPath(inferredHero) : undefined;
  const heroFacePosX = getHeroFacePosition(inferredHero).x;
  const shouldHideNsfw = Boolean(mod.nsfw && hideNsfwPreviews);
  const readableCardWidth = cardWidth ?? getReadableCardTargetWidth(cardSize);
  const readableDensity = getReadableDensity(readableCardWidth);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [audioControlsActive, setAudioControlsActive] = useState(false);
  const readableScale = readableCardWidth / BROWSE_READABLE_CARD_GOLDEN;
  const chipRowWidth = Math.round(readableCardWidth - 24 * readableScale);
  const chips = getReadableCardChips(mod, section, inferredHero);
  const showChips = readableDensity !== 'micro';
  const showAuthor = readableDensity !== 'micro';
  // "Last updated" sits in the stats row when the card is wide enough; on
  // narrower cards it drops to its own line under the author so it can't
  // squash the likes/views counts.
  const showUpdated = readableDensity === 'full';
  const updatedInline = showUpdated && readableCardWidth >= BROWSE_READABLE_UPDATED_INLINE_MIN;
  const updatedOwnLine = showUpdated && !updatedInline;
  const isMicro = readableDensity === 'micro';
  const isCompactReadable = readableDensity === 'compact';
  const actionIconOnly = readableCardWidth < 220;
  const showInlineAudioPreview = isSoundSection && hasAudioPreview;
  const cardFrameStyle = typeof cardHeight === 'number' ? { height: `${cardHeight}px` } : undefined;
  const mediaHeightClass = isMicro
    ? 'aspect-[16/9]'
    : isCompactReadable
      ? 'h-[56cqw]'
      : 'h-[57.1429cqw]';
  const bodyPaddingClass = isMicro
    ? 'px-[clamp(8px,5cqw,10px)] pb-[clamp(7px,4.6429cqw,9px)] pt-[clamp(7px,4.6429cqw,9px)]'
    : isCompactReadable
      ? 'px-[clamp(12px,5cqw,14px)] pb-[clamp(12px,5cqw,14px)] pt-[clamp(12px,5cqw,14px)]'
      : 'px-[clamp(14px,5cqw,16px)] pb-[clamp(14px,5cqw,16px)] pt-[clamp(14px,5cqw,16px)]';
  // Chips moved onto the thumbnail overlay, so the title is now the first body
  // row in every density and needs no top margin.
  const titleMarginClass = 'mt-0';
  const footerMarginClass = isMicro
    ? 'mt-[clamp(6px,3.5714cqw,8px)]'
    : 'mt-[clamp(7px,3.5714cqw,11px)]';
  const footerHeightClass = isMicro
    ? 'h-6'
    : 'h-[clamp(24px,10cqw,32px)]';
  const media = isSoundSection ? (
    <div className="relative h-full w-full overflow-hidden bg-bg-tertiary">
      {heroRenderUrl ? (
        shouldHideNsfw ? (
          <img
            src={heroRenderUrl}
            alt={inferredHero ?? mod.name}
            loading="lazy"
            decoding="async"
            className="browse-card-media-zoom h-full w-full object-cover scale-105 blur-lg saturate-75"
            style={{ objectPosition: `${heroFacePosX}% 20%` }}
          />
        ) : (
          <ImageContextMenu src={heroRenderUrl} alt={inferredHero ?? mod.name}>
            <img
              src={heroRenderUrl}
              alt={inferredHero ?? mod.name}
              loading="lazy"
              decoding="async"
              className="browse-card-media-zoom h-full w-full object-cover"
              style={{ objectPosition: `${heroFacePosX}% 20%` }}
            />
          </ImageContextMenu>
        )
      ) : thumbnail ? (
        <ModThumbnail
          src={thumbnail}
          alt={mod.name}
          nsfw={mod.nsfw}
          hideNsfw={hideNsfwPreviews}
          className="h-full w-full"
          imageFit="cover"
          imagePosition="center top"
          imageClassName="browse-card-media-zoom"
        />
      ) : (
        <BrowseSoundPlaceholder title={mod.name} />
      )}
      {shouldHideNsfw && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg-primary/55 text-state-danger">
          <AlertTriangle className="h-5 w-5" />
          <span className="mt-1 text-2xs font-semibold">{t('browse.card.nsfwHidden')}</span>
        </div>
      )}
    </div>
  ) : (
    <ModThumbnail
      src={thumbnail}
      alt={mod.name}
      nsfw={mod.nsfw}
      hideNsfw={hideNsfwPreviews}
      className="h-full w-full bg-bg-tertiary"
      imageFit="cover"
      imagePosition="center top"
      imageClassName="browse-card-media-zoom"
    />
  );

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => handleCardKeyDown(e, onClick)}
      onMouseEnter={() => {
        if (!suppressHoverIntentRef?.current) setAudioControlsActive(true);
      }}
      onMouseLeave={() => {
        if (!isPlaying) setAudioControlsActive(false);
      }}
      onFocus={() => setAudioControlsActive(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !isPlaying) {
          setAudioControlsActive(false);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open details for ${mod.name}`}
      style={cardFrameStyle}
      className={`browse-card-hover-surface browse-readable-card premium-card-glow group flex w-full flex-col overflow-hidden rounded-xl border bg-bg-sunken text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] cursor-pointer focus-visible:border-accent focus-visible:outline-none [container-type:inline-size] ${
        isPlaying
          ? 'border-state-danger/70 ring-2 ring-state-danger/35 shadow-lg shadow-state-danger/15'
          : downloading
            ? 'border-accent/40'
            : installed && !installedDisabled
              ? 'border-hl/[0.07] premium-card-glow-active'
              : 'border-hl/[0.07]'
      }`}
    >
      <div className={`browse-readable-card-media relative ${mediaHeightClass} overflow-hidden rounded-t-xl bg-bg-tertiary`}>
        {media}
        {showChips && chips.length > 0 && (
          <div className="browse-readable-card-chips pointer-events-none absolute inset-x-0 bottom-0 z-[3] flex items-end bg-gradient-to-t from-black/75 via-black/30 to-transparent px-[clamp(8px,4cqw,12px)] pb-[clamp(7px,3.5cqw,10px)] pt-8">
            <div className="pointer-events-auto min-w-0">
              <BrowseReadableChipRow
                chips={chips}
                availableWidth={chipRowWidth}
                maxVisible={readableDensity === 'compact' ? 2 : BROWSE_READABLE_MAX_VISIBLE_CHIPS}
                onImage
              />
            </div>
          </div>
        )}
      </div>

      <div
        className={`browse-readable-card-body relative flex flex-none flex-col ${bodyPaddingClass}`}
      >
        <div className={`${titleMarginClass} min-w-0`}>
          {/* font-semibold, not font-bold: Reaver ships only a 600 face, so
              bolder weights get synthetic (smeared, blurry) emboldening. */}
          <h3
            className={`block truncate font-mod-title font-semibold text-mod-title ${
              isMicro
                ? 'text-[13px] leading-4'
                : 'text-[clamp(11px,5.3571cqw,17px)] leading-[1.28] pb-px'
            }`}
            title={mod.name}
          >
            {mod.name}
          </h3>
          {showAuthor && (
            <p className="mt-0 truncate text-[clamp(10px,4.2857cqw,13px)] font-normal leading-[1.12] text-text-secondary/85">
              by {mod.submitter?.name ?? t('browse.card.unknownAuthor')}
            </p>
          )}
          {updatedOwnLine && <BrowseReadableUpdatedLine timestamp={mod.dateModified} variant="block" />}
        </div>

        {showInlineAudioPreview && (
          <div
            className={`mt-[clamp(8px,3.5714cqw,10px)] flex items-center rounded-[clamp(9px,3.5714cqw,12px)] border border-hl/10 bg-bg-primary/55 px-[clamp(7px,2.8571cqw,9px)] text-text-secondary shadow-[0_1px_0_rgba(255,255,255,0.03)] ${
              isMicro ? 'h-7' : 'h-[clamp(33px,12.8571cqw,41px)]'
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            {audioControlsActive ? (
              <>
                <AudioPreviewPlayer
                  src={audioPreview!}
                  compact
                  variant="inline"
                  volume={volume}
                  onPlayingChange={onPlayingChange}
                  className="min-w-0 flex-1"
                />
                <div className="relative ml-[clamp(6px,2.1429cqw,8px)] flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowVolumeSlider((value) => !value)}
                    className="flex h-[clamp(24px,8.5714cqw,28px)] w-[clamp(24px,8.5714cqw,28px)] items-center justify-center rounded-full border border-hl/10 bg-hl/5 text-white/80 transition-colors hover:bg-hl/10 hover:text-white cursor-pointer"
                    title={showVolumeSlider ? 'Hide volume slider' : 'Show volume slider'}
                    aria-label={showVolumeSlider ? 'Hide volume slider' : 'Show volume slider'}
                    aria-expanded={showVolumeSlider}
                  >
                    {volume > 0 ? (
                      <Volume2 className="h-[clamp(13px,4.2857cqw,15px)] w-[clamp(13px,4.2857cqw,15px)]" />
                    ) : (
                      <VolumeX className="h-[clamp(13px,4.2857cqw,15px)] w-[clamp(13px,4.2857cqw,15px)]" />
                    )}
                  </button>
                  {showVolumeSlider && (
                    <div className="absolute bottom-[calc(100%+8px)] right-0 flex items-center rounded-full border border-hl/10 bg-bg-glass/92 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(volume * 100)}
                        onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                        className="w-24 h-1 accent-accent cursor-pointer"
                        title={`Volume: ${Math.round(volume * 100)}%`}
                        aria-label={t('browse.card.volume')}
                      />
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className={`flex min-w-0 flex-1 items-center ${isMicro ? 'gap-2' : 'gap-4'}`}>
                <span
                  className={`flex flex-shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/25 text-text-primary shadow-sm ${
                    isMicro ? 'h-5 w-5' : 'h-8 w-8'
                  }`}
                >
                  <Play className={`${isMicro ? 'h-3 w-3' : 'h-4 w-4'} ml-0.5 fill-current`} />
                </span>
                <span className="h-1.5 min-w-0 flex-1 rounded-full bg-bg-primary" />
                {!isMicro && (
                  <>
                    <span className="flex-shrink-0 text-[10px] tabular-nums text-text-secondary">0:00</span>
                    <span className="flex h-[clamp(24px,8.5714cqw,28px)] w-[clamp(24px,8.5714cqw,28px)] flex-shrink-0 items-center justify-center rounded-full border border-hl/10 bg-hl/5 text-white/80">
                      <Volume2 className="h-[clamp(13px,4.2857cqw,15px)] w-[clamp(13px,4.2857cqw,15px)]" />
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        <div className={`${footerMarginClass} flex ${footerHeightClass} items-center justify-between gap-[clamp(6px,4.2857cqw,14px)]`}>
          <BrowseReadableStatsRow mod={mod} density={readableDensity} showUpdated={updatedInline} />
          <BrowseReadableAction
            modName={mod.name}
            installed={installed}
            installedDisabled={installedDisabled}
            downloading={downloading}
            queuePosition={queuePosition}
            density={readableDensity}
            iconOnlyOverride={actionIconOnly}
            onQuickDownload={onQuickDownload}
            onEnable={onEnable}
          />
        </div>
      </div>
    </div>
  );
}

interface ModCardProps {
  mod: GameBananaMod;
  installed: boolean;
  /** True when the local install for this GB mod is currently disabled.
   *  Drives the inline Enable affordance shown after a fresh download. */
  installedDisabled?: boolean;
  downloading: boolean;
  queuePosition?: number;
  viewMode: ViewMode;
  cardDesign: BrowseCardDesign;
  cardSize: number;
  cardWidth?: number;
  cardHeight?: number;
  section: string;
  volume: number;
  onVolumeChange: (v: number) => void;
  hideNsfwPreviews: boolean;
  isPlaying: boolean;
  /** Shared "user is scrolling" flag from the grid. A ref, not a boolean, so
   *  scroll start/stop never re-renders cards; event handlers read .current.
   *  Hover visuals are suppressed separately in CSS via browse-is-scrolling. */
  suppressHoverIntentRef?: React.RefObject<boolean>;
  enableModId?: string;
  actionContextKey?: string;
  onPlayingChange: (playing: boolean) => void;
  onClick: () => void;
  onQuickDownload: (anchor?: HTMLElement) => void;
  /** Toggle the local mod's enabled state. Provided only when there's an
   *  installed-but-disabled mod to enable. */
  onEnable?: () => void;
}

export function ModCardSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="bg-bg-secondary border border-border rounded-lg p-3 flex items-center gap-4">
        <div className="bg-bg-tertiary skeleton-shimmer w-32 h-20 flex-shrink-0 rounded-md" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="bg-bg-tertiary skeleton-shimmer h-4 rounded w-2/3" />
          <div className="bg-bg-tertiary skeleton-shimmer h-3 rounded w-1/3" />
        </div>
      </div>
    );
  }
  return (
    <div className="relative bg-bg-tertiary border border-border rounded-lg overflow-hidden aspect-[3/2]">
      <div className="absolute inset-0 skeleton-shimmer bg-bg-secondary" />
      <div className="absolute bottom-0 left-0 right-0 p-3 space-y-2">
        <div className="h-3.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-3/4" />
        <div className="h-2.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-1/2" />
      </div>
    </div>
  );
}

function ModCard({ mod, installed, installedDisabled, downloading, queuePosition, viewMode, cardDesign, cardSize, cardWidth, cardHeight, section, volume, onVolumeChange, hideNsfwPreviews, isPlaying, suppressHoverIntentRef, onPlayingChange, onClick, onQuickDownload, onEnable }: ModCardProps) {
  const { t } = useTranslation();
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  // At the smallest grid sizes the bottom overlay (title + stats + author) eats
  // most of a classic card, burying the art it's drawn over. Below this width
  // we collapse to just the title at rest and reveal the rest on hover/focus.
  // Keyed off the real card width so it tracks the card-size slider.
  const minimalChrome =
    cardDesign === 'classic' && typeof cardWidth === 'number' && cardWidth > 0 && cardWidth < 205;
  const isList = viewMode === 'list';
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);
  // Sound mods don't carry hero info in the API, so guess from the title.
  // Used to swap in the locker hero portrait as the card backdrop.
  const inferredHero = isSoundSection ? inferHeroFromTitle(mod.name) : null;
  const heroRenderUrl = inferredHero ? getHeroRenderPath(inferredHero) : undefined;
  const heroFacePosX = getHeroFacePosition(inferredHero).x;
  const [audioControlsActive, setAudioControlsActive] = useState(false);

  // List view keeps original layout
  if (isList) {
    return (
      <div
        onClick={onClick}
        onKeyDown={(e) => handleCardKeyDown(e, onClick)}
        onMouseEnter={() => {
          if (!suppressHoverIntentRef?.current) setAudioControlsActive(true);
        }}
        onMouseLeave={() => {
          if (!isPlaying) setAudioControlsActive(false);
        }}
        onFocus={() => setAudioControlsActive(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !isPlaying) {
            setAudioControlsActive(false);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${mod.name}`}
        className={`browse-card-hover-surface relative bg-bg-secondary border rounded-xl overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer flex items-center gap-4 p-3 ${
          isPlaying
            ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
            : 'border-border hover:border-accent/50'
        }`}
      >
        <div className="relative bg-bg-tertiary w-32 h-20 flex-shrink-0 rounded-lg overflow-hidden">
          {isSoundSection ? (
            heroRenderUrl ? (
              <ImageContextMenu src={heroRenderUrl} alt={inferredHero ?? mod.name}>
                <img
                  src={heroRenderUrl}
                  alt={inferredHero ?? mod.name}
                  loading="lazy"
                  decoding="async"
                  className="browse-card-media-zoom w-full h-full object-cover"
                  style={{ objectPosition: `${heroFacePosX}% 25%` }}
                />
              </ImageContextMenu>
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary flex items-center justify-center">
                <div className="flex items-center gap-1 px-2 py-1 rounded-full border border-accent/40 bg-accent/10 text-text-primary text-[10px] font-semibold">
                  <Volume2 className="w-3 h-3" />
                  {t('browse.card.sound')}
                </div>
              </div>
            )
          ) : (
            <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-mod-title font-medium truncate flex-1">{mod.name}</h3>
            {installed && installedDisabled && onEnable ? (
              <button
                onClick={(e) => { e.stopPropagation(); onEnable(); }}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 h-7 bg-state-warning/15 hover:bg-state-warning/25 border border-state-warning/40 text-state-warning rounded-full text-xs font-semibold transition-colors cursor-pointer"
                title={t('browse.actions.enableDisabledTitle')}
              >
                <Power className="w-3 h-3" />
                Enable
              </button>
            ) : installed ? (
              <Tag tone="success" variant="overlay" title={t('nav.installed')} className="flex-shrink-0">
                <span aria-hidden>✓</span>
                {t('nav.installed')}
              </Tag>
            ) : downloading ? (
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-bg-primary/80 rounded-full">
                <BrowseDownloadSpinner className="text-accent" />
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onQuickDownload(e.currentTarget); }}
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-full shadow-lg transition-colors cursor-pointer"
                title={t('browse.card.install')}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <BrowseStatItem type="likes" icon={ThumbsUp} value={formatCount(mod.likeCount)} title={`${mod.likeCount ?? 0} likes`} />
            <BrowseStatItem type="views" icon={Eye} value={formatCount(mod.viewCount)} title={`${mod.viewCount ?? 0} views`} />
            {mod.nsfw && <Tag tone="danger">18+</Tag>}
          </div>
          {mod.submitter && <p className="text-text-secondary mt-1 truncate text-xs">by {mod.submitter.name}</p>}
          {mod.dateModified > 0 && (
            <IconText
              icon={isModOutdated(mod.dateModified) ? AlertTriangle : Clock}
              className={`mt-1 max-w-full text-xs ${isModOutdated(mod.dateModified) ? 'text-state-warning' : 'text-text-secondary'}`}
              iconClassName="browse-meta-icon"
            >
              <span className="truncate">{isModOutdated(mod.dateModified) ? t('browse.card.outdatedPrefix') : ''}{formatDate(mod.dateModified)}</span>
            </IconText>
          )}
        </div>

        {/* Right-side audio cluster for sound mods — fills the empty space on wide rows */}
        {isSoundSection && hasAudioPreview && (
          <div
            className="flex-shrink-0 w-72 hidden md:flex items-center gap-3 bg-bg-tertiary/50 rounded-full border border-border px-3 py-1.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 min-w-0">
              {audioControlsActive ? (
                <AudioPreviewPlayer src={audioPreview!} compact variant="inline" volume={volume} onPlayingChange={onPlayingChange} />
              ) : (
                <div className="flex items-center gap-3 text-text-secondary">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/25 text-text-primary">
                    <Play className="h-4 w-4 ml-0.5 fill-current" />
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 rounded-full bg-bg-primary" />
                  <span className="shrink-0 text-[10px] tabular-nums">0:00</span>
                </div>
              )}
            </div>
            <div className="w-px h-4 bg-border flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <Volume2 className="w-3.5 h-3.5 text-text-secondary" />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                className="w-14 h-1 accent-accent cursor-pointer"
                aria-label={t('browse.card.volume')}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Grid: overlay card. Image fills card, info overlaid at bottom
  if (cardDesign === 'readable') {
    return (
      <BrowseArtParallaxCard>
        <ReadableBrowseModCard
          mod={mod}
          installed={installed}
          installedDisabled={installedDisabled}
          downloading={downloading}
          queuePosition={queuePosition}
          viewMode={viewMode}
          cardDesign={cardDesign}
          cardSize={cardSize}
          cardWidth={cardWidth}
          cardHeight={cardHeight}
          section={section}
          volume={volume}
          onVolumeChange={onVolumeChange}
          hideNsfwPreviews={hideNsfwPreviews}
          isPlaying={isPlaying}
          suppressHoverIntentRef={suppressHoverIntentRef}
          onPlayingChange={onPlayingChange}
          onClick={onClick}
          onQuickDownload={onQuickDownload}
          onEnable={onEnable}
        />
      </BrowseArtParallaxCard>
    );
  }

  const isOutdated = mod.dateModified > 0 && isModOutdated(mod.dateModified);
  return (
    <BrowseArtParallaxCard>
      <div
        onClick={onClick}
        onKeyDown={(e) => handleCardKeyDown(e, onClick)}
        onMouseEnter={() => {
          if (!suppressHoverIntentRef?.current) setAudioControlsActive(true);
        }}
        onMouseLeave={() => {
          if (!isPlaying) setAudioControlsActive(false);
        }}
        onFocus={() => setAudioControlsActive(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !isPlaying) {
            setAudioControlsActive(false);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open details for ${mod.name}`}
        className={`browse-card-hover-surface premium-card-glow relative isolate bg-bg-tertiary border rounded-xl overflow-hidden focus-visible:border-accent focus-visible:outline-none text-left cursor-pointer group aspect-[3/2] ${
          isPlaying
            ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
            : downloading
              ? 'border-accent ring-2 ring-accent/40 ring-offset-0'
              : installed
                ? `border-state-success/40 hover:border-state-success/70 ${!installedDisabled ? 'premium-card-glow-active' : ''}`
                : 'border-border hover:border-accent/50'
        }`}
      >
      {/* Full-bleed image */}
      <div className="absolute inset-0">
        {isSoundSection ? (
          <div className="w-full h-full relative">
            {heroRenderUrl ? (
              <ImageContextMenu src={heroRenderUrl} alt={inferredHero ?? mod.name}>
                <img
                  src={heroRenderUrl}
                  alt={inferredHero ?? mod.name}
                  loading="lazy"
                  decoding="async"
                  className="browse-card-media-zoom w-full h-full object-cover"
                  style={{ objectPosition: `${heroFacePosX}% 20%` }}
                />
              </ImageContextMenu>
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" imageClassName="browse-card-media-zoom" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary" />
            )}
            {!hasAudioPreview && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/40 bg-accent/10 text-text-primary font-medium shadow-lg backdrop-blur-sm text-sm">
                  <Volume2 className="w-4 h-4" />
                  <span>{t('browse.card.sound')}</span>
                </div>
              </div>
            )}
            {!thumbnail && !heroRenderUrl && hasAudioPreview && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-end gap-0.5 h-10">
                  {[3, 5, 8, 12, 16, 12, 8, 14, 10, 6, 9, 14, 11, 7, 4, 6, 10, 8, 5, 3].map((h, i) => (
                    <div key={i} className="w-1 bg-accent/60 rounded-full transition-all" style={{ height: `${h * 2}px` }} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" imageClassName="browse-card-media-zoom" />
        )}
      </div>

      {/* Gradient: for sound cards with audio preview, darken TOP (title) and BOTTOM (player).
          For other cards, the classic bottom-darkest gradient. On minimal-chrome
          cards the rest state uses a short fade (just enough for the title line)
          so the art stays visible; the fuller scrim fades back in on hover below. */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={
          isSoundSection && hasAudioPreview
            ? {
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.9) 100%)',
              }
            : minimalChrome
              ? {
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.55) 22%, rgba(0,0,0,0.08) 45%, transparent 64%)',
                }
              : {
                  background:
                    'linear-gradient(to top, rgba(0,0,0,0.97) 0%, rgba(0,0,0,0.86) 30%, rgba(0,0,0,0.5) 55%, rgba(0,0,0,0.12) 78%, transparent 100%)',
                }
        }
      />
      {/* Hover-only fuller scrim for minimal cards, so the revealed stats/author
          stay legible once they slide up. */}
      {minimalChrome && (
        <div
          className="absolute inset-0 pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.96) 0%, rgba(0,0,0,0.82) 28%, rgba(0,0,0,0.4) 55%, transparent 80%)',
          }}
        />
      )}

      {/* Info: moved to TOP for audio-preview sound cards so it stops covering the player.
          State tags (NSFW/Installed/Outdated) live inside this block too, on a row
          ABOVE the title. The default top-left overlay covers the title text on this
          variant because the title is anchored at top:0 instead of bottom:0. */}
      {isSoundSection && hasAudioPreview ? (
        <div className="absolute top-0 left-0 right-0 pointer-events-none p-3 pr-12">
          {(mod.nsfw || installed || isOutdated) && (
            <div className="flex flex-wrap items-center gap-1 mb-1.5">
              {mod.nsfw && <Tag tone="danger" variant="overlay">18+</Tag>}
              {installed && (
                <Tag tone="success" variant="overlay">
                  <span aria-hidden>✓</span>
                  Installed
                </Tag>
              )}
              {!installed && isOutdated && (
                <Tag
                  tone="warning"
                  variant="overlay"
                  icon={AlertTriangle}
                  title={`Last updated ${formatDate(mod.dateModified)}`}
                >
                  {t('browse.card.outdated')}
                </Tag>
              )}
            </div>
          )}
          <h3 className="font-mod-title font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] text-base">{mod.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] text-xs">
            <BrowseStatItem type="likes" icon={ThumbsUp} value={formatCount(mod.likeCount)} title={`${mod.likeCount ?? 0} likes`} />
            <BrowseStatItem type="views" icon={Eye} value={formatCount(mod.viewCount)} title={`${mod.viewCount ?? 0} views`} />
            {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
          </div>
        </div>
      ) : (
        <div className={`absolute bottom-0 left-0 right-0 ${minimalChrome ? 'p-2' : 'p-3'}`}>
          <h3 className={`font-mod-title font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${minimalChrome ? 'text-sm' : 'text-base'}`}>{mod.name}</h3>
          {/* Stats / author / outdated. On minimal cards this group is collapsed
              to zero height at rest and slides up on hover or keyboard focus. */}
          <div
            className={
              minimalChrome
                ? 'overflow-hidden transition-all duration-200 ease-out max-h-0 opacity-0 group-hover:max-h-20 group-hover:opacity-100 group-focus-within:max-h-20 group-focus-within:opacity-100'
                : ''
            }
          >
            <div className="mt-1 flex flex-wrap items-center gap-3 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] text-sm">
              <BrowseStatItem type="likes" icon={ThumbsUp} value={formatCount(mod.likeCount)} title={`${mod.likeCount ?? 0} likes`} />
              <BrowseStatItem type="views" icon={Eye} value={formatCount(mod.viewCount)} title={`${mod.viewCount ?? 0} views`} />
              {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
            </div>
            {mod.dateModified > 0 && isModOutdated(mod.dateModified) && (
              <IconText
                icon={AlertTriangle}
                className="mt-1 max-w-full text-state-warning text-sm"
                iconClassName="browse-meta-icon"
              >
                <span className="truncate">{t('browse.card.outdatedPrefix')}{formatDate(mod.dateModified)}</span>
              </IconText>
            )}
          </div>
        </div>
      )}

      {/* State tag stack — top-left. Stacks NSFW / INSTALLED / OUTDATED so the
          card is decodable without relying on icon color alone. Skipped for
          sound+audio cards because those render the same tags inline above the
          title (the title moves to top:0 on that variant and the absolute
          overlay would cover it). */}
      {!(isSoundSection && hasAudioPreview) && (
        <div className="absolute top-2 left-2 z-10 flex flex-col gap-1 items-start">
          {mod.nsfw && <Tag tone="danger" variant="overlay">18+</Tag>}
          {installed && (
            <Tag tone="success" variant="overlay">
              <span aria-hidden>✓</span>
              Installed
            </Tag>
          )}
          {!installed && isOutdated && (
            <Tag
              tone="warning"
              variant="overlay"
              icon={AlertTriangle}
              title={`Last updated ${formatDate(mod.dateModified)}`}
            >
              {t('browse.card.outdated')}
            </Tag>
          )}
        </div>
      )}

      {/* Audio preview + volume, pinned to bottom with its own pointer-events layer.
          z-20 keeps it above the gradient + any overlays so clicks always land.
          Single spacious pill: [play + progress + time] | divider | [volume icon + slider] */}
      {isSoundSection && hasAudioPreview && (
        <div
          className="absolute bottom-0 left-0 right-0 z-20 p-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 backdrop-blur-md bg-bg-primary/85 rounded-full border border-hl/10 px-3 py-2 shadow-lg">
            <div className="flex-1 min-w-0">
              {audioControlsActive ? (
                <AudioPreviewPlayer
                  src={audioPreview!}
                  compact
                  variant="inline"
                  volume={volume}
                  onPlayingChange={onPlayingChange}
                />
              ) : (
                <div className="flex items-center gap-3 text-text-secondary">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/50 bg-accent/25 text-text-primary">
                    <Play className="h-4 w-4 ml-0.5 fill-current" />
                  </span>
                  <span className="h-1.5 min-w-0 flex-1 rounded-full bg-bg-primary" />
                  <span className="shrink-0 text-[10px] tabular-nums">0:00</span>
                </div>
              )}
            </div>
            <div className="w-px h-5 bg-hl/20 flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onVolumeChange(volume > 0 ? 0 : 1);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-hl/10 bg-hl/5 text-white/70 transition-colors hover:bg-hl/10 hover:text-white cursor-pointer"
                title={volume > 0 ? 'Mute' : 'Unmute'}
                aria-label={volume > 0 ? 'Mute' : 'Unmute'}
              >
                {volume > 0 ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(volume * 100)}
                onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                className="w-16 h-1 accent-accent cursor-pointer"
                title={`Volume: ${Math.round(volume * 100)}%`}
                aria-label={t('browse.card.volume')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Download / Enable button overlay — top right with backdrop */}
      <div className="absolute top-2 right-2">
        {installed && installedDisabled && onEnable ? (
          // Mod just installed but still in the disabled folder. Surface an
          // inline Enable affordance right where the user's eye is rather
          // than forcing them to the Installed tab.
          <button
            onClick={(e) => { e.stopPropagation(); onEnable(); }}
            className="flex items-center gap-1.5 rounded-full bg-state-warning/90 hover:bg-state-warning text-bg-primary backdrop-blur-sm ring-1 ring-border shadow-md font-semibold transition-colors cursor-pointer h-8 px-2.5 text-xs"
            title={t('browse.actions.enableDisabledTitle')}
          >
            <Power className="w-3.5 h-3.5" />
            Enable
          </button>
        ) : installed ? (
          <span
            className="flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md text-state-success w-8 h-8 text-base"
            title={t('browse.card.installedAndEnabled')}
          >
            ✓
          </span>
        ) : downloading ? (
          <div className="browse-download-badge flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md w-8 h-8" title={t('browse.card.downloading')}>
            <BrowseDownloadSpinner className="text-accent" size="large" />
          </div>
        ) : queuePosition ? (
          <div
            className="flex items-center justify-center bg-accent text-bg-primary rounded-full font-bold ring-1 ring-border shadow-md w-8 h-8 text-xs"
            title={`Queued #${queuePosition}`}
          >
            {queuePosition}
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onQuickDownload(e.currentTarget); }}
            className="flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md text-accent hover:bg-accent/20 hover:text-text-primary hover:ring-accent/60 transition-all cursor-pointer w-8 h-8"
            title={t('browse.card.install')}
          >
            <Download className="w-5 h-5" />
          </button>
        )}
      </div>
      </div>
    </BrowseArtParallaxCard>
  );
}

export const MemoizedModCard = React.memo(ModCard, (prev, next) => (
  prev.mod === next.mod &&
  prev.installed === next.installed &&
  prev.installedDisabled === next.installedDisabled &&
  prev.downloading === next.downloading &&
  prev.queuePosition === next.queuePosition &&
  prev.viewMode === next.viewMode &&
  prev.cardDesign === next.cardDesign &&
  prev.cardSize === next.cardSize &&
  prev.cardWidth === next.cardWidth &&
  prev.cardHeight === next.cardHeight &&
  prev.section === next.section &&
  prev.volume === next.volume &&
  prev.hideNsfwPreviews === next.hideNsfwPreviews &&
  prev.isPlaying === next.isPlaying &&
  prev.suppressHoverIntentRef === next.suppressHoverIntentRef &&
  prev.enableModId === next.enableModId &&
  prev.actionContextKey === next.actionContextKey
));
