import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Check,
  Search,
  Loader2,
  Download,
  Eye,
  ThumbsUp,
  X,
  Volume2,
  VolumeX,
  RefreshCw,
  LayoutGrid,
  Grid3x3,
  List,
  AlertTriangle,
  Clock,
  Package,
  Music,
  SlidersHorizontal,
  Power,
  Library,
  ChevronDown,
  Upload,
  Play,
  Maximize2,
  PanelRight,
  ArrowLeft,
  ExternalLink,
  Globe,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ComponentType } from 'react';
import {
  BlueskyIcon,
  CarrdIcon,
  DeviantartIcon,
  DiscordIcon,
  FacebookIcon,
  GithubIcon,
  InstagramIcon,
  KofiIcon,
  LinktreeIcon,
  MastodonIcon,
  PatreonIcon,
  RedditIcon,
  SoundcloudIcon,
  SpotifyIcon,
  SteamIcon,
  ThreadsIcon,
  TiktokIcon,
  TumblrIcon,
  TwitchIcon,
  XIcon,
  YoutubeIcon,
} from '../components/common/BrandIcons';
import {
  browseMods,
  getModDetails,
  getSubmitterLinks,
  downloadMod,
  getGamebananaSections,
  getGamebananaCategories,
  backfillGameBananaFileId,
} from '../lib/api';
import { getActiveDeadlockPath } from '../lib/appSettings';
import type {
  GameBananaMod,
  GameBananaModDetails,
  GameBananaSection,
  GameBananaCategoryNode,
  GameBananaArtistLink,
} from '../types/gamebanana';
import { getModThumbnail, getSoundPreviewUrl, getPrimaryFile, formatDate, isModOutdated } from '../types/gamebanana';
import {
  useAppStore,
} from '../stores/appStore';
import type { BrowseNsfwFilter, BrowseTimeRange, BrowseLayout, BrowseArtistRef } from '../stores/appStore';
import ModThumbnail from '../components/ModThumbnail';
import ImageContextMenu from '../components/ImageContextMenu';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import { DynamicSelect } from '../components/common/DynamicSelect';
import { HeroSelect } from '../components/common/HeroSelect';
import { Button, Tag } from '../components/common/ui';
import { IconText } from '../components/common/IconText';
import { EmptyState } from '../components/common/PageComponents';
import ModDetailsModal from '../components/ModDetailsModal';
import ImportCollectionModal from '../components/ImportCollectionModal';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition, getHeroChipIconPath } from '../lib/lockerUtils';
import { formatAbsoluteDate, formatRelativeDate } from '../lib/dates';

const DEFAULT_PER_PAGE = 36;
type SortOption = 'default' | 'popular' | 'recent' | 'updated' | 'views' | 'name';
// Effective render mode derived from layout + card size. 'compact' is no
// longer a user choice: it's what small cards become below the size threshold.
type ViewMode = 'grid' | 'compact' | 'list';
type BrowseCardDesign = 'classic' | 'readable';
// Where a clicked mod's details open: the centered overlay (default) or a
// docked right-side panel that lets the user keep browsing the grid. Persisted
// like the other Browse view preferences (card design/size).
type BrowseDetailsView = 'modal' | 'sidebar';
type ModDetailsNavigationDirection = 'previous' | 'next';
const SECTION_WHITELIST = new Set(['Mod', 'Sound']);
const BROWSE_CARD_DESIGN_STORAGE_KEY = 'browseCardDesign';
const BROWSE_DETAILS_VIEW_STORAGE_KEY = 'browseDetailsView';
// Below this window width the docked sidebar would crush the grid, so we force
// the centered modal regardless of the saved preference.
const BROWSE_SIDEBAR_MIN_WINDOW_WIDTH = 760;
const BROWSE_SIDEBAR_WIDTH_KEY = 'browseDetailsSidebarWidth';
const BROWSE_SIDEBAR_WIDTH_MIN = 320;
const BROWSE_SIDEBAR_WIDTH_MAX = 720;
const BROWSE_SIDEBAR_WIDTH_DEFAULT = 420;
// The grid always keeps at least this much room; the sidebar's effective width
// is capped so a wide drag (or a small window) can't starve the browse area.
const BROWSE_SIDEBAR_GRID_RESERVE = 360;

// Filled brand glyphs (see common/BrandIcons). Platform keys come from
// GameBanana's contact icon classes, lowercased by normalizeContactPlatform
// in the main process. Unknown platforms fall back to a generic globe.
type SocialIconComponent = ComponentType<{ className?: string }>;
const BROWSE_SOCIAL_ICONS: Record<string, SocialIconComponent> = {
  youtube: YoutubeIcon,
  twitter: XIcon,
  x: XIcon,
  twitch: TwitchIcon,
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  github: GithubIcon,
  discord: DiscordIcon,
  bluesky: BlueskyIcon,
  tiktok: TiktokIcon,
  patreon: PatreonIcon,
  kofi: KofiIcon,
  steam: SteamIcon,
  reddit: RedditIcon,
  spotify: SpotifyIcon,
  soundcloud: SoundcloudIcon,
  carrd: CarrdIcon,
  linktree: LinktreeIcon,
  tumblr: TumblrIcon,
  deviantart: DeviantartIcon,
  mastodon: MastodonIcon,
  threads: ThreadsIcon,
};

function browseSocialIcon(platform: string): SocialIconComponent {
  return BROWSE_SOCIAL_ICONS[platform] ?? Globe;
}

// Brand colors so the social symbols read as the real platforms. All chosen to
// contrast with a white glyph; unknown platforms fall back to the accent.
const BROWSE_SOCIAL_COLORS: Record<string, string> = {
  youtube: '#FF0000',
  twitter: '#111111',
  x: '#111111',
  twitch: '#9146FF',
  instagram: '#E4405F',
  facebook: '#1877F2',
  github: '#333333',
  discord: '#5865F2',
  bluesky: '#1185FE',
  tiktok: '#111111',
  patreon: '#FF424D',
  kofi: '#FF5E5B',
  steam: '#1B2838',
  reddit: '#FF4500',
  spotify: '#1DB954',
  soundcloud: '#FF5500',
  carrd: '#1F2D3D',
  linktree: '#43E660',
  tumblr: '#36465D',
  deviantart: '#05CC47',
  mastodon: '#6364FF',
  threads: '#111111',
};

function browseSocialColor(platform: string): string {
  return BROWSE_SOCIAL_COLORS[platform] ?? '#f97316';
}

function clampSidebarWidth(value: number): number {
  return clampNumber(value, BROWSE_SIDEBAR_WIDTH_MIN, BROWSE_SIDEBAR_WIDTH_MAX);
}

function readBrowseSidebarWidth(): number {
  if (typeof window === 'undefined') return BROWSE_SIDEBAR_WIDTH_DEFAULT;
  const stored = Number(window.localStorage.getItem(BROWSE_SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : BROWSE_SIDEBAR_WIDTH_DEFAULT;
}
// Persist filter UI inputs across page navigation. The store keeps these in
// memory so visiting Installed and coming back doesn't blow away the user's
// current search/filter context. Kept out of localStorage so a fresh launch
// starts clean — sessions, not preferences.

type CategoryOption = {
  id: number;
  label: string;
  itemCount: number;
};

type FlattenOptions = {
  excludeIds?: Set<number>;
  includeEmpty?: boolean;
};

function flattenCategories(
  nodes: GameBananaCategoryNode[],
  parentPath = '',
  options: FlattenOptions = {}
): CategoryOption[] {
  const results: CategoryOption[] = [];
  const excludeIds = options.excludeIds ?? new Set<number>();
  const includeEmpty = options.includeEmpty ?? false;

  for (const node of nodes) {
    if (excludeIds.has(node.id)) {
      continue;
    }

    const nextPath = parentPath ? `${parentPath} / ${node.name}` : node.name;
    if (includeEmpty || node.itemCount > 0) {
      results.push({ id: node.id, label: nextPath, itemCount: node.itemCount });
    }

    if (node.children && node.children.length > 0) {
      results.push(...flattenCategories(node.children, nextPath, options));
    }
  }

  return results;
}

// Abbreviate counts (1234 -> 1.2k, 98765 -> 99k). Falsy/non-finite inputs
// render as "0" — without this, undefined slips past every `<` check
// (NaN comparisons are always false) and falls through to the millions
// branch, producing "NaNm" on mods with no recorded likes/views/downloads.
function formatCount(n: number | null | undefined): string {
  if (!Number.isFinite(n) || (n as number) <= 0) return '0';
  const value = n as number;
  if (value < 1000) return String(value);
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

type BrowseReadableChipTone = 'neutral' | 'accent' | 'danger' | 'info';

type BrowseReadableChip = {
  label: string;
  tone?: BrowseReadableChipTone;
  /** When set, the chip renders as the hero's round icon instead of a text pill. */
  hero?: string;
};

type BrowseResultCacheEntry = {
  mods: GameBananaMod[];
  page: number;
  hasMore: boolean;
  totalCount: number;
  scrollTop: number;
};

type QueuedDownloadState = {
  position: number;
};

const BROWSE_READABLE_MAX_VISIBLE_CHIPS = 3;
const BROWSE_READABLE_CHIP_GAP_WIDTH = 6;
const BROWSE_READABLE_CHIP_OVERFLOW_WIDTH = 30;
const BROWSE_READABLE_HERO_CHIP_WIDTH = 24;
// Below this card width the "last updated" line moves to its own row under the
// author instead of sharing the stats row, so it never squashes likes/views.
const BROWSE_READABLE_UPDATED_INLINE_MIN = 300;
const BROWSE_READABLE_CARD_GOLDEN = 280;
const BROWSE_GRID_OVERSCAN_ROWS = 4;
const BROWSE_CARD_SIZE_MIN = 220;
const BROWSE_CARD_SIZE_BASE = 118;
const BROWSE_CARD_SIZE_VW = 0.07;
const BROWSE_CARD_SIZE_VH = 0.03;
const BROWSE_CARD_SIZE_MAX = 300;
const BROWSE_CARD_SIZE_MULTIPLIER_MIN = 0.8;
const BROWSE_CARD_SIZE_MULTIPLIER_MAX = 2;
const BROWSE_CARD_SIZE_MULTIPLIER_DEFAULT = 1;
const BROWSE_CARD_SIZE_MULTIPLIER_STEP = 0.1;
const BROWSE_CARD_SIZE_MULTIPLIER_KEY = 'browseCardSizeMultiplier';

type BrowseReadableDensity = 'micro' | 'compact' | 'full';
type BrowseViewportMetrics = {
  containerWidth: number;
  windowWidth: number;
  windowHeight: number;
};

const DEFAULT_BROWSE_VIEWPORT_METRICS: BrowseViewportMetrics = {
  containerWidth: 0,
  windowWidth: 0,
  windowHeight: 0,
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampBrowseCardSizeMultiplier(value: number): number {
  return clampNumber(value, BROWSE_CARD_SIZE_MULTIPLIER_MIN, BROWSE_CARD_SIZE_MULTIPLIER_MAX);
}

function readBrowseCardSizeMultiplier(): number {
  const stored = Number(localStorage.getItem(BROWSE_CARD_SIZE_MULTIPLIER_KEY));
  return Number.isFinite(stored) ? clampBrowseCardSizeMultiplier(stored) : BROWSE_CARD_SIZE_MULTIPLIER_DEFAULT;
}

function getBrowseCardSizeCss(multiplier: number): string {
  const nextMultiplier = clampBrowseCardSizeMultiplier(multiplier);
  return `clamp(${BROWSE_CARD_SIZE_MIN * nextMultiplier}px, calc(${BROWSE_CARD_SIZE_BASE * nextMultiplier}px + ${BROWSE_CARD_SIZE_VW * 100 * nextMultiplier}vw + ${BROWSE_CARD_SIZE_VH * 100 * nextMultiplier}vh), ${BROWSE_CARD_SIZE_MAX * nextMultiplier}px)`;
}

function getBrowseCardSizeGridStyle(multiplier: number): React.CSSProperties {
  return {
    '--card-size': getBrowseCardSizeCss(multiplier),
    gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-size), 1fr))',
  } as React.CSSProperties;
}

function getResponsiveBrowseCardSize(metrics: BrowseViewportMetrics, multiplier: number): number {
  const nextMultiplier = clampBrowseCardSizeMultiplier(multiplier);
  const windowWidth = metrics.windowWidth || BROWSE_CARD_SIZE_MAX;
  const windowHeight = metrics.windowHeight || BROWSE_CARD_SIZE_MAX;
  return clampNumber(
    (BROWSE_CARD_SIZE_BASE + windowWidth * BROWSE_CARD_SIZE_VW + windowHeight * BROWSE_CARD_SIZE_VH) * nextMultiplier,
    BROWSE_CARD_SIZE_MIN * nextMultiplier,
    BROWSE_CARD_SIZE_MAX * nextMultiplier
  );
}

function getReadableCardTargetWidth(cardSize: number): number {
  return Math.max(1, Math.round(cardSize));
}

function getReadableCardGridGap(targetWidth: number): number {
  if (targetWidth <= 180) return 8;
  if (targetWidth >= BROWSE_READABLE_CARD_GOLDEN) return 16;

  const progress = (targetWidth - 180) / (BROWSE_READABLE_CARD_GOLDEN - 180);
  return Math.round(8 + 8 * progress);
}

function getReadableDensity(targetWidth: number): BrowseReadableDensity {
  if (targetWidth < 180) return 'micro';
  if (targetWidth < 240) return 'compact';
  return 'full';
}

function estimateReadableCardBodyHeight(density: BrowseReadableDensity, section: string): number {
  const isSound = section === 'Sound';

  if (density === 'micro') {
    return 8 + 16 + (isSound ? 8 + 28 : 0) + 8 + 24 + 8;
  }

  if (density === 'compact') {
    return 12 + 22 + 5 + 29 + (isSound ? 10 + 22 : 0) + 10 + 24 + 2;
  }

  return 14 + 24 + 6 + 32 + (isSound ? 10 + 38 : 0) + 10 + 28 + 6;
}

function estimateBrowseRowHeight(
  columnWidth: number,
  layout: BrowseLayout,
  cardDesign: BrowseCardDesign,
  viewMode: ViewMode,
  section: string
): number {
  if (layout === 'list') return 112;
  if (cardDesign === 'classic') {
    return Math.ceil(columnWidth * (viewMode === 'compact' ? 0.75 : 2 / 3));
  }

  const density = getReadableDensity(columnWidth);
  const mediaHeight =
    density === 'micro'
      ? columnWidth * 0.5625
      : density === 'compact'
        ? columnWidth * 0.56
        : columnWidth * 0.571429;
  const bodyHeight = estimateReadableCardBodyHeight(density, section);

  return Math.ceil(mediaHeight + bodyHeight);
}

function readableChipTone(tone: BrowseReadableChipTone = 'neutral'): string {
  switch (tone) {
    case 'accent':
      return 'border-accent/14 bg-accent/[0.04] text-accent/72';
    case 'danger':
      return 'border-state-danger/20 bg-state-danger/[0.05] text-state-danger/80';
    case 'info':
      return 'border-state-info/14 bg-state-info/[0.04] text-state-info/72';
    default:
      return 'border-white/[0.06] bg-white/[0.018] text-text-tertiary/72';
  }
}

function normalizeReadableChipLabel(label: string | undefined): string | null {
  const cleaned = label?.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  if (lower === 'skins') return 'Skin';
  if (lower === 'sounds') return 'Sound';
  if (lower === 'mods') return 'Mod';
  if (lower === 'hud' || lower === 'huds') return 'HUD';
  if (lower === 'ui') return 'UI';
  return cleaned;
}

function addReadableChip(chips: BrowseReadableChip[], label: string | undefined, tone?: BrowseReadableChipTone) {
  const normalized = normalizeReadableChipLabel(label);
  if (!normalized) return;

  const exists = chips.some((chip) => chip.label.toLowerCase() === normalized.toLowerCase());
  if (!exists) chips.push({ label: normalized, tone });
}

function dedupeModsById(mods: GameBananaMod[]): GameBananaMod[] {
  const seen = new Set<number>();
  return mods.filter((mod) => {
    if (seen.has(mod.id)) return false;
    seen.add(mod.id);
    return true;
  });
}

function appendUniqueModsById(previous: GameBananaMod[], next: GameBananaMod[]): GameBananaMod[] {
  if (next.length === 0) return previous;

  const seen = new Set(previous.map((mod) => mod.id));
  const uniqueNext = next.filter((mod) => {
    if (seen.has(mod.id)) return false;
    seen.add(mod.id);
    return true;
  });

  return uniqueNext.length === 0 ? previous : [...previous, ...uniqueNext];
}

function getReadableCardChips(mod: GameBananaMod, section: string, inferredHero: string | null): BrowseReadableChip[] {
  const chips: BrowseReadableChip[] = [];
  const isSoundSection = section === 'Sound';
  const categoryLabel = mod.rootCategory?.name ?? section;

  addReadableChip(chips, categoryLabel, isSoundSection ? 'accent' : 'neutral');
  if (inferredHero) chips.push({ label: inferredHero, tone: 'info', hero: inferredHero });
  if (mod.nsfw) addReadableChip(chips, '18+', 'danger');

  // Hero icon stays leftmost as a consistent anchor across cards, then the
  // NSFW flag, then the rest (category, etc.). Sort is stable, so chips of
  // equal rank keep their insertion order.
  const rank = (chip: BrowseReadableChip) => (chip.hero ? 0 : chip.label === '18+' ? 1 : 2);
  chips.sort((a, b) => rank(a) - rank(b));

  return chips;
}

function estimateReadableChipWidth(label: string): number {
  return Math.ceil(label.length * 5.5 + 14);
}

function BrowseReadableChipBadge({ chip }: { chip: BrowseReadableChip }) {
  if (chip.hero) {
    return (
      <img
        src={getHeroChipIconPath(chip.hero)}
        alt={chip.label}
        title={chip.label}
        loading="lazy"
        draggable={false}
        className="h-6 w-6 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      title={chip.label}
      className={`inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-sm border px-2 text-[10px] font-medium leading-none ${readableChipTone(
        chip.tone
      )}`}
    >
      {chip.label}
    </span>
  );
}

function BrowseReadableChipRow({
  chips,
  availableWidth,
  maxVisible = BROWSE_READABLE_MAX_VISIBLE_CHIPS,
}: {
  chips: BrowseReadableChip[];
  availableWidth: number;
  maxVisible?: number;
}) {
  const visibleChips: BrowseReadableChip[] = [];
  let usedWidth = 0;
  const rowWidth = Math.max(48, availableWidth);
  const orderedChips = [...chips];

  for (const [index, chip] of orderedChips.entries()) {
    if (visibleChips.length >= maxVisible) break;

    const remainingAfter = orderedChips.length - index - 1;
    const chipWidth = chip.hero ? BROWSE_READABLE_HERO_CHIP_WIDTH : estimateReadableChipWidth(chip.label);
    const gapBefore = visibleChips.length > 0 ? BROWSE_READABLE_CHIP_GAP_WIDTH : 0;
    const overflowReserve = remainingAfter > 0 ? BROWSE_READABLE_CHIP_GAP_WIDTH + BROWSE_READABLE_CHIP_OVERFLOW_WIDTH : 0;

    if (usedWidth + gapBefore + chipWidth + overflowReserve > rowWidth) break;

    visibleChips.push(chip);
    usedWidth += gapBefore + chipWidth;
  }

  const hiddenChips = orderedChips.filter(
    (chip) => !visibleChips.some((visible) => visible.label === chip.label && visible.tone === chip.tone)
  );

  return (
    <div className="flex h-6 min-w-0 items-start gap-[clamp(5px,2.1429cqw,7px)] overflow-visible">
      {visibleChips.map((chip, index) => (
        <BrowseReadableChipBadge key={`${chip.label}-${index}`} chip={chip} />
      ))}
      {hiddenChips.length > 0 && (
        <div className="group/hidden relative shrink-0">
          <span
            title={`${hiddenChips.length} more`}
            className="inline-flex h-6 items-center rounded-sm border border-white/[0.06] bg-white/[0.018] px-2 text-[10px] font-medium leading-none text-text-tertiary/72"
          >
            +{hiddenChips.length}
          </span>
          <div className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-20 hidden min-w-max max-w-[180px] flex-wrap gap-1 rounded-md border border-white/[0.08] bg-bg-secondary/96 p-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md group-hover/hidden:flex">
            {hiddenChips.map((chip, index) => (
              <BrowseReadableChipBadge key={`${chip.label}-overflow-${index}`} chip={chip} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function gameBananaTimestampToIso(timestamp: number | undefined): string | null {
  if (!timestamp || timestamp <= 0) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function BrowseReadableUpdatedLine({
  timestamp,
  variant = 'inline',
}: {
  timestamp?: number;
  /** `inline` sits in the stats row; `block` is its own line under the author
   *  (used on narrow cards where the stats row has no room for it). */
  variant?: 'inline' | 'block';
}) {
  const iso = gameBananaTimestampToIso(timestamp);
  const relative = iso ? formatRelativeDate(iso).replace(/(\d+)\s+(mo|yr)\s+ago/g, '$1$2 ago') : null;
  const absolute = iso ? formatAbsoluteDate(iso) : null;
  const isOutdated = typeof timestamp === 'number' && timestamp > 0 && isModOutdated(timestamp);

  if (!relative) return null;

  const title = absolute ? `${isOutdated ? 'Outdated. ' : ''}Last updated on GameBanana: ${absolute}` : undefined;

  if (variant === 'block') {
    return (
      <p
        className={`mt-1 truncate text-[clamp(9px,3.5714cqw,11px)] font-normal leading-[1.05] ${
          isOutdated ? 'text-state-warning/70' : 'text-text-tertiary/55'
        }`}
        title={title}
      >
        ↻ {relative}
      </p>
    );
  }

  return (
    <span
      className={`inline-flex min-w-0 shrink items-center gap-0.5 truncate font-normal leading-none ${
        isOutdated ? 'text-state-warning/80' : 'text-text-tertiary/55'
      }`}
      title={title}
    >
      ↻ {relative}
    </span>
  );
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handleChange = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return prefersReducedMotion;
}

function BrowseArtParallaxCard({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const effectDisabled = disabled || prefersReducedMotion;

  const resetParallax = useCallback(() => {
    const element = cardRef.current;
    if (!element) return;

    element.style.setProperty('--browse-art-x', '0px');
    element.style.setProperty('--browse-art-y', '0px');
    element.style.setProperty('--browse-art-rotate', '0deg');
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (effectDisabled || event.pointerType !== 'mouse') return;

    const element = cardRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = (event.clientY - rect.top) / Math.max(rect.height, 1);
    const moveX = (0.5 - x) * 4;
    const moveY = (0.5 - y) * 4;
    const rotate = (x - 0.5) * 0.2;

    element.style.setProperty('--browse-art-x', `${moveX.toFixed(2)}px`);
    element.style.setProperty('--browse-art-y', `${moveY.toFixed(2)}px`);
    element.style.setProperty('--browse-art-rotate', `${rotate.toFixed(2)}deg`);
  }, [effectDisabled]);

  useEffect(() => {
    if (effectDisabled) resetParallax();
  }, [effectDisabled, resetParallax]);

  return (
    <div
      ref={cardRef}
      className="browse-art-parallax-card group relative w-full"
      data-parallax-disabled={effectDisabled ? 'true' : undefined}
      onPointerMove={handlePointerMove}
      onPointerCancel={resetParallax}
      onPointerLeave={resetParallax}
    >
      {children}
    </div>
  );
}

function BrowseStatItem({
  type,
  icon,
  value,
  title,
  align = 'start',
  emphasis = 'muted',
}: {
  type: 'likes' | 'views' | 'downloads';
  icon: LucideIcon;
  value: string;
  title: string;
  align?: 'start' | 'center' | 'end';
  emphasis?: 'muted' | 'strong';
}) {
  const alignmentClass =
    align === 'center' ? 'browse-stat-item--center' : align === 'end' ? 'browse-stat-item--end' : 'browse-stat-item--start';

  return (
    <IconText
      icon={icon}
      className={`browse-stat-item ${alignmentClass}`}
      title={title}
      iconClassName={`browse-stat-icon browse-stat-icon--${type}${emphasis === 'strong' ? ' browse-stat-icon--strong' : ''}`}
      valueClassName="browse-stat-value"
    >
      {value}
    </IconText>
  );
}

function BrowseReadableStatsRow({ mod, density, showUpdated }: { mod: GameBananaMod; density: BrowseReadableDensity; showUpdated: boolean }) {
  const isMicro = density === 'micro';
  const groupClass = isMicro
    ? 'grid w-full grid-cols-2 items-center text-[clamp(11px,4.3cqw,13px)] font-semibold text-text-tertiary/70'
    : 'flex h-5 min-w-0 flex-1 items-center gap-[clamp(5px,2.5cqw,10px)] text-[clamp(11px,4.3cqw,13px)] font-semibold text-text-tertiary/60';
  const itemEmphasis = isMicro ? 'strong' : 'muted';

  return (
    <div className={groupClass}>
      <BrowseStatItem
        type="likes"
        icon={ThumbsUp}
        value={formatCount(mod.likeCount)}
        title={`${mod.likeCount ?? 0} likes`}
        align="start"
        emphasis={itemEmphasis}
      />
      <BrowseStatItem
        type="views"
        icon={Eye}
        value={formatCount(mod.viewCount)}
        title={`${mod.viewCount ?? 0} views`}
        align="start"
        emphasis={itemEmphasis}
      />
      {showUpdated && <BrowseReadableUpdatedLine timestamp={mod.dateModified} variant="inline" />}
    </div>
  );
}

function BrowseSoundPlaceholder({ title }: { title: string }) {
  const bars = [22, 38, 54, 30, 68, 46, 34, 58, 26, 42, 62, 36, 48, 28];

  return (
    <div
      className="browse-sound-placeholder absolute inset-0 overflow-hidden bg-[radial-gradient(circle_at_24%_22%,rgba(249,115,22,0.22),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(96,165,250,0.16),transparent_28%),linear-gradient(135deg,#151312,#22242a_55%,#121416)]"
      role="img"
      aria-label={`${title} audio preview`}
    >
      <div className="absolute inset-x-8 top-[46%] flex h-12 -translate-y-1/2 items-center justify-center gap-1.5 opacity-35">
        {bars.map((height, index) => (
          <span
            key={`${title}-wave-${index}`}
            className="browse-sound-wave-bar w-1 rounded-full bg-text-secondary"
            style={{ height: `${height}%`, animationDelay: `${index * 38}ms` }}
          />
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-primary/55 to-transparent" />
    </div>
  );
}

function BrowseReadableAction({
  modName,
  installed,
  installedDisabled,
  downloading,
  queuePosition,
  density,
  iconOnlyOverride,
  onQuickDownload,
  onEnable,
}: {
  modName: string;
  installed: boolean;
  installedDisabled?: boolean;
  downloading: boolean;
  queuePosition?: number;
  density: BrowseReadableDensity;
  iconOnlyOverride?: boolean;
  onQuickDownload: () => void;
  onEnable?: () => void;
}) {
  const actionableEnable = installed && installedDisabled && !!onEnable;
  const action = actionableEnable
    ? 'enable'
    : installed
      ? 'installed'
      : downloading
        ? 'downloading'
        : queuePosition
          ? 'queued'
          : 'install';
  const label =
    action === 'enable'
      ? 'Enable'
      : action === 'installed'
        ? 'Installed'
        : action === 'downloading'
          ? 'Loading'
          : action === 'queued'
            ? `Queued ${queuePosition}`
            : 'Install';
  const iconOnly = iconOnlyOverride ?? density === 'micro';
  const className = iconOnly
    ? `browse-action-button browse-action-button--icon browse-action-button--${action}`
    : `browse-action-button browse-action-button--${action}`;
  const previousActionRef = useRef(action);
  const previousQueuePositionRef = useRef(queuePosition);
  const [completionPulse, setCompletionPulse] = useState(false);
  const [queueShift, setQueueShift] = useState(false);

  useEffect(() => {
    const previousAction = previousActionRef.current;
    const completedFromPending =
      (action === 'installed' || action === 'enable') &&
      (previousAction === 'downloading' || previousAction === 'queued');

    if (completedFromPending) {
      previousActionRef.current = action;
      let endTimeout: number | null = null;
      const startTimeout = window.setTimeout(() => {
        setCompletionPulse(true);
        endTimeout = window.setTimeout(() => setCompletionPulse(false), 620);
      }, 0);
      return () => {
        window.clearTimeout(startTimeout);
        if (endTimeout !== null) window.clearTimeout(endTimeout);
      };
    }

    previousActionRef.current = action;
    return undefined;
  }, [action]);

  useEffect(() => {
    const previousQueuePosition = previousQueuePositionRef.current;
    if (
      typeof queuePosition === 'number' &&
      typeof previousQueuePosition === 'number' &&
      queuePosition !== previousQueuePosition
    ) {
      previousQueuePositionRef.current = queuePosition;
      let endTimeout: number | null = null;
      const startTimeout = window.setTimeout(() => {
        setQueueShift(true);
        endTimeout = window.setTimeout(() => setQueueShift(false), 260);
      }, 0);
      return () => {
        window.clearTimeout(startTimeout);
        if (endTimeout !== null) window.clearTimeout(endTimeout);
      };
    }

    previousQueuePositionRef.current = queuePosition;
    return undefined;
  }, [queuePosition]);

  const motionClassName = [
    className,
    completionPulse ? 'browse-action-button--complete-pop' : '',
    queueShift ? 'browse-action-button--queue-shift' : '',
  ].filter(Boolean).join(' ');
  const icon =
    action === 'downloading'
      ? Loader2
      : action === 'installed'
        ? Check
        : action === 'enable'
          ? Power
          : action === 'queued'
            ? Clock
            : Download;
  const content = (
    iconOnly ? (
      <span className={`browse-action-button-icon browse-action-button-icon--${action}`}>
        {React.createElement(icon, { 'aria-hidden': true, className: action === 'downloading' ? 'animate-spin' : undefined })}
      </span>
    ) : (
      <>
        <span className={`browse-action-button-icon browse-action-button-icon--${action}`}>
          {React.createElement(icon, { 'aria-hidden': true, className: action === 'downloading' ? 'animate-spin' : undefined })}
        </span>
        <span className="browse-action-button-label">
          {action === 'queued' ? (
            <span key={queuePosition} className="browse-action-button-queue-value">{label}</span>
          ) : (
            label
          )}
        </span>
      </>
    )
  );

  if (action === 'install') {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onQuickDownload(); }}
        className={`${motionClassName} cursor-pointer`}
        title={`Install ${modName}`}
        aria-label={`Install ${modName}`}
      >
        {content}
      </button>
    );
  }

  if (action === 'enable' && onEnable) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onEnable(); }}
        className={`${motionClassName} cursor-pointer`}
        title="Enable this mod (currently in your disabled folder)"
        aria-label={`Enable ${modName}`}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={`${motionClassName} cursor-default`} title={label} aria-label={`${label} ${modName}`}>
      {content}
    </span>
  );
}

// Treat Enter/Space as a click on role="button" divs (keyboard navigation).
function handleCardKeyDown(e: React.KeyboardEvent, onClick: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}

// Render an error string with any embedded https:// URLs as clickable links.
function renderErrorWithLinks(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noreferrer noopener"
          className="underline text-accent hover:text-accent-hover"
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function findCategoryByName(
  nodes: GameBananaCategoryNode[],
  name: string
): GameBananaCategoryNode | null {
  for (const node of nodes) {
    if (node.name.toLowerCase() === name.toLowerCase()) {
      return node;
    }
    if (node.children) {
      const match = findCategoryByName(node.children, name);
      if (match) return match;
    }
  }
  return null;
}

export default function Browse() {
  const settings = useAppStore((s) => s.settings);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const loadMods = useAppStore((s) => s.loadMods);
  const deleteMod = useAppStore((s) => s.deleteMod);
  const installedMods = useAppStore((s) => s.mods);
  const soundVolume = useAppStore((s) => s.soundVolume);
  const setSoundVolume = useAppStore((s) => s.setSoundVolume);
  const browseUi = useAppStore((s) => s.browseUi);
  const setBrowseUi = useAppStore((s) => s.setBrowseUi);
  const browseSession = useAppStore((s) => s.browseSession);
  const setBrowseSession = useAppStore((s) => s.setBrowseSession);
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  // Filter inputs are mirrored from the store so they survive page nav.
  // `setBrowseUi({...})` is the write path; reads come straight from `browseUi`.
  const { search, layout, sort, section, nsfw, addedWithin, addedFrom, addedTo, heroCategoryId, categoryId, submitter } = browseUi;
  // Artist mode: the grid is scoped to one submitter's mods and Browse shows an
  // artist banner instead of the normal search/filter header.
  const artistMode = !!submitter;
  const [browseViewportMetrics, setBrowseViewportMetrics] = useState<BrowseViewportMetrics>(DEFAULT_BROWSE_VIEWPORT_METRICS);
  const [browseCardSizeMultiplier, setBrowseCardSizeMultiplierState] = useState(readBrowseCardSizeMultiplier);
  const browseCardSize = getResponsiveBrowseCardSize(browseViewportMetrics, browseCardSizeMultiplier);
  const browseCardSizeGridStyle = useMemo(
    () => getBrowseCardSizeGridStyle(browseCardSizeMultiplier),
    [browseCardSizeMultiplier]
  );
  // Effective render mode: List is structural; otherwise small cards get the
  // compact chrome automatically. ModCard/skeleton keep reading one ViewMode.
  const viewMode: ViewMode = layout === 'list' ? 'list' : 'grid';
  const setSearch = useCallback((v: string) => setBrowseUi({ search: v }), [setBrowseUi]);
  const setLayout = useCallback((v: BrowseLayout) => setBrowseUi({ layout: v }), [setBrowseUi]);
  const setSort = useCallback((v: SortOption) => setBrowseUi({ sort: v }), [setBrowseUi]);
  const setSection = useCallback((v: string) => setBrowseUi({ section: v }), [setBrowseUi]);
  const setNsfw = useCallback((v: BrowseNsfwFilter) => setBrowseUi({ nsfw: v }), [setBrowseUi]);
  const setAddedWithin = useCallback((v: BrowseTimeRange) => setBrowseUi({ addedWithin: v }), [setBrowseUi]);
  const setAddedFrom = useCallback((v: string) => setBrowseUi({ addedFrom: v }), [setBrowseUi]);
  const setAddedTo = useCallback((v: string) => setBrowseUi({ addedTo: v }), [setBrowseUi]);
  const setHeroCategoryId = useCallback((v: number | 'all' | 'none') => setBrowseUi({ heroCategoryId: v }), [setBrowseUi]);
  const setCategoryId = useCallback((v: number | 'all') => setBrowseUi({ categoryId: v }), [setBrowseUi]);
  const setBrowseCardSizeMultiplier = useCallback((nextMultiplier: number) => {
    const clampedMultiplier = clampBrowseCardSizeMultiplier(nextMultiplier);
    setBrowseCardSizeMultiplierState(clampedMultiplier);
    localStorage.setItem(BROWSE_CARD_SIZE_MULTIPLIER_KEY, String(clampedMultiplier));
  }, []);
  // Hydrate from session cache on mount so navigating away + back doesn't
  // wipe loaded results or scroll position. The cache stamp encodes current
  // filters; if filters changed in between (impossible today since they only
  // change on Browse, but defensive) we ignore the stale cache.
  const initialFilterStamp = `${browseUi.section}|${browseUi.search}|${browseUi.sort}|${browseUi.categoryId}|${browseUi.heroCategoryId}|${browseUi.nsfw}|${browseUi.addedWithin}|${browseUi.addedFrom}|${browseUi.addedTo}|${browseUi.submitter?.id ?? ''}`;
  const initialCache = browseSession && browseSession.stamp === initialFilterStamp
    ? browseSession
    : null;

  const [mods, setMods] = useState<GameBananaMod[]>(
    () => (initialCache?.mods as GameBananaMod[] | undefined) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(() => initialCache?.page ?? 1);
  const [_totalCount, setTotalCount] = useState(() => initialCache?.totalCount ?? 0);
  const perPage = DEFAULT_PER_PAGE; // Fixed value for infinite scroll
  const [sections, setSections] = useState<GameBananaSection[]>([]);
  const [categories, setCategories] = useState<GameBananaCategoryNode[]>([]);
  // Hero list comes from the Mod section's category tree (Mod -> Skins -> heroes).
  // Cached separately so hero filtering still works on the Sound tab, where the
  // current section's category tree has no Skins parent.
  const [modCategories, setModCategories] = useState<GameBananaCategoryNode[]>([]);
  const [selectedMod, setSelectedMod] = useState<GameBananaModDetails | null>(null);
  const [selectedModDates, setSelectedModDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  const [modalNavigation, setModalNavigation] = useState<{ direction: ModDetailsNavigationDirection; label: string } | null>(null);
  const modalNavigationRequestRef = useRef(0);
  const [downloading, setDownloading] = useState<{ modId: number; fileId: number } | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => initialCache?.hasMore ?? true);
  // A page>1 (or stale-results) fetch failure routes here instead of `error`
  // so the already-loaded grid stays on screen and only the load-more row
  // surfaces the failure. `error` stays reserved for the no-results case.
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  // Set when a browse fetch fails. Freezes the infinite-scroll observer so it
  // stops auto-advancing the page into an API that's already refusing requests.
  // Without this, a rate-limited fetch + auto-retry looped, flashing the grid
  // between results and the error state (issue #99). Lifted on filter change,
  // refresh, or an explicit retry.
  const [autoLoadPaused, setAutoLoadPaused] = useState(false);

  // Last fetch's identity stamp. Value-comparison gate: if the next call to
  // fetchMods/searchLocal would target the same (page + filters), skip it.
  // Initialized from the session cache so hydrated state isn't re-fetched.
  // Value-based (not "skip first run" ref) so it survives React StrictMode's
  // double effect run in dev — the second setup compares stamps and short-
  // circuits, instead of consuming a one-shot skip flag.
  const lastFetchedStampRef = useRef<string | null>(
    initialCache ? `${initialCache.page}|${browseUi.search}|${browseUi.sort}|${browseUi.section}|${browseUi.categoryId}|${browseUi.heroCategoryId}|${browseUi.nsfw}|${browseUi.addedWithin}|${browseUi.addedFrom}|${browseUi.addedTo}|${browseUi.submitter?.id ?? ''}` : null
  );
  // Monotonic guard for browse/search requests. Filter changes and newer
  // requests invalidate older responses so they cannot append stale pages into
  // the current grid after the user switches filters.
  const requestGenerationRef = useRef(0);
  const pendingPageResetStampRef = useRef<string | null>(null);
  const restoredCacheSkipStampRef = useRef<string | null>(null);
  // Cached scroll position waiting to be applied once the grid is mounted
  // and laid out. Cleared after restoration.
  const pendingScrollTopRef = useRef<number | null>(initialCache?.scrollTop ?? null);
  // The outer scroll container — same element with `h-full overflow-y-auto`.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // Live mirror of the scroll container's scrollTop. Updated from a scroll
  // listener so the unmount cleanup has a valid value to persist — by the
  // time a useEffect cleanup runs, React has already detached
  // `scrollContainerRef.current`, so reading scrollTop from the DOM ref
  // there always returned 0 and the saved position was useless.
  const latestScrollTopRef = useRef<number>(initialCache?.scrollTop ?? 0);
  const scrollCacheFrameRef = useRef<number | null>(null);
  const scrollHoverTimeoutRef = useRef<number | null>(null);
  const isBrowseScrollingRef = useRef(false);
  // When local search fails (e.g. SQLite error), this flips so the main fetch
  // effect falls back to the API path. Resets whenever filter inputs change.
  const [localSearchFailed, setLocalSearchFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [downloadQueue, setDownloadQueue] = useState<Array<{ modId: number; fileId: number; fileName: string }>>([]);
  const [playingModId, setPlayingModId] = useState<number | null>(null);
  const [isBrowseScrolling, setIsBrowseScrolling] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [importProfileOpen, setImportProfileOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const [browseCardDesign, setBrowseCardDesignState] = useState<BrowseCardDesign>(() => {
    if (typeof window === 'undefined') return 'readable';
    return window.localStorage.getItem(BROWSE_CARD_DESIGN_STORAGE_KEY) === 'classic' ? 'classic' : 'readable';
  });
  const setBrowseCardDesign = useCallback((design: BrowseCardDesign) => {
    setBrowseCardDesignState(design);
    window.localStorage.setItem(BROWSE_CARD_DESIGN_STORAGE_KEY, design);
  }, []);
  const [browseDetailsView, setBrowseDetailsViewState] = useState<BrowseDetailsView>(() => {
    if (typeof window === 'undefined') return 'modal';
    return window.localStorage.getItem(BROWSE_DETAILS_VIEW_STORAGE_KEY) === 'sidebar' ? 'sidebar' : 'modal';
  });
  const setBrowseDetailsView = useCallback((view: BrowseDetailsView) => {
    setBrowseDetailsViewState(view);
    window.localStorage.setItem(BROWSE_DETAILS_VIEW_STORAGE_KEY, view);
  }, []);
  // The sidebar only wins when there's room for it; on a narrow window it would
  // squeeze the grid into uselessness, so we fall back to the centered modal.
  const detailsSidebarActive =
    browseDetailsView === 'sidebar' &&
    browseViewportMetrics.windowWidth >= BROWSE_SIDEBAR_MIN_WINDOW_WIDTH;

  // Artist social/contact links for the banner. Loaded only when an artist is
  // highlighted (not on every mod open), and cached per member id main-side.
  const [artistSocials, setArtistSocials] = useState<GameBananaArtistLink[]>([]);
  // Falls back to the monogram when the banner avatar URL 404s or is blocked.
  // Reset per artist in the effect below so one dead URL doesn't stick.
  const [artistAvatarFailed, setArtistAvatarFailed] = useState(false);
  useEffect(() => {
    const memberId = submitter?.id;
    setArtistSocials([]);
    setArtistAvatarFailed(false);
    if (!memberId || memberId <= 0) return;
    let cancelled = false;
    getSubmitterLinks(memberId)
      .then((links) => { if (!cancelled) setArtistSocials(links); })
      .catch(() => { if (!cancelled) setArtistSocials([]); });
    return () => { cancelled = true; };
  }, [submitter?.id]);
  // User-resizable sidebar width, persisted. The effective width is also capped
  // so the grid keeps BROWSE_SIDEBAR_GRID_RESERVE px no matter how the user drags
  // or how small the window is.
  const [browseSidebarWidth, setBrowseSidebarWidthState] = useState<number>(readBrowseSidebarWidth);
  const sidebarWidthCeiling = browseViewportMetrics.windowWidth
    ? Math.max(BROWSE_SIDEBAR_WIDTH_MIN, browseViewportMetrics.windowWidth - BROWSE_SIDEBAR_GRID_RESERVE)
    : BROWSE_SIDEBAR_WIDTH_MAX;
  const effectiveSidebarWidth = Math.min(clampSidebarWidth(browseSidebarWidth), sidebarWidthCeiling);
  // Tears down an in-flight sidebar drag (listeners + body styles). Held in a ref
  // so an unmount can finish a drag that's still mid-gesture, instead of leaking
  // the window listeners and stranding the col-resize cursor on <body>.
  const sidebarResizeCleanupRef = useRef<(() => void) | null>(null);
  const startSidebarResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: PointerEvent) => {
      const ceiling = Math.max(BROWSE_SIDEBAR_WIDTH_MIN, window.innerWidth - BROWSE_SIDEBAR_GRID_RESERVE);
      const next = Math.min(clampSidebarWidth(window.innerWidth - ev.clientX), ceiling);
      setBrowseSidebarWidthState(next);
    };
    const cleanup = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      sidebarResizeCleanupRef.current = null;
    };
    const onUp = () => {
      cleanup();
      // Persist the raw width (not the window-capped value) so widening the
      // window later restores the size the user actually picked.
      setBrowseSidebarWidthState((w) => {
        window.localStorage.setItem(BROWSE_SIDEBAR_WIDTH_KEY, String(w));
        return w;
      });
    };
    sidebarResizeCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);
  // Drop a half-finished drag if Browse unmounts mid-gesture.
  useEffect(() => () => sidebarResizeCleanupRef.current?.(), []);

  // Load settings on mount (needed for hideNsfwPreviews)
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Close the filters popover on outside click or Escape
  useEffect(() => {
    if (!filtersOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(e.target as Node)) {
        setFiltersOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [filtersOpen]);

  // Close the import menu on outside click or Escape.
  useEffect(() => {
    if (!importMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (importMenuRef.current && !importMenuRef.current.contains(e.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImportMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [importMenuOpen]);

  // Close the view menu on outside click or Escape.
  useEffect(() => {
    if (!viewMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setViewMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [viewMenuOpen]);

  // Check if local cache is available for search
  const [hasLocalCache, setHasLocalCache] = useState(false);
  useEffect(() => {
    const checkLocalCache = async () => {
      try {
        const count = await window.electronAPI.getLocalModCount();
        setHasLocalCache(count > 100);
      } catch {
        setHasLocalCache(false);
      }
    };
    checkLocalCache();
  }, []);

  // Fetch initial download queue state on mount
  useEffect(() => {
    const fetchInitialQueueState = async () => {
      try {
        const [queue, currentDownload] = await Promise.all([
          window.electronAPI.getDownloadQueue(),
          window.electronAPI.getCurrentDownload(),
        ]);
        setDownloadQueue(queue);
        if (currentDownload) {
          setDownloading({ modId: currentDownload.modId, fileId: currentDownload.fileId });
        }
      } catch (err) {
        console.error('Failed to fetch initial queue state:', err);
      }
    };
    fetchInitialQueueState();
  }, []);

  // 'none' = client-side post-filter for Sound mods without a hero in the
  // title. The fetch path sees it as "no category filter" so the API doesn't
  // get a nonsense id; the actual exclusion happens against displayMods.
  const effectiveCategoryId =
    heroCategoryId === 'all' || heroCategoryId === 'none'
      ? (categoryId === 'all' ? undefined : categoryId)
      : heroCategoryId;

  // Debounce the search input: every keystroke previously fired a full FTS5
  // query + count + render, which felt slow even when the DB was fast. 250ms
  // is short enough that typing-to-results still feels responsive but long
  // enough to absorb fast typing into a single request.
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const effectiveSearch = debouncedSearch;

  // Custom-range date inputs (YYYY-MM-DD) -> inclusive Unix-second bounds for the
  // local query. Parsed as UTC to line up with date_added (a UTC timestamp).
  // Undefined when not in custom mode, blank, or unparseable.
  const customAddedFrom = useMemo(() => {
    if (addedWithin !== 'custom' || !addedFrom) return undefined;
    const t = Date.parse(`${addedFrom}T00:00:00Z`);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }, [addedWithin, addedFrom]);
  const customAddedTo = useMemo(() => {
    if (addedWithin !== 'custom' || !addedTo) return undefined;
    const t = Date.parse(`${addedTo}T23:59:59Z`);
    return Number.isFinite(t) ? Math.floor(t / 1000) : undefined;
  }, [addedWithin, addedTo]);

  const fetchFilterStamp = `${effectiveSearch}|${sort}|${section}|${effectiveCategoryId}|${heroCategoryId}|${nsfw}|${addedWithin}|${customAddedFrom ?? ''}|${customAddedTo ?? ''}|${perPage}|${submitter?.id ?? ''}`;
  const browseResultsCacheRef = useRef<Map<string, BrowseResultCacheEntry>>(new Map());
  const browseScrollCacheRef = useRef<Map<string, number>>(new Map());
  const activeFetchFilterStampRef = useRef(fetchFilterStamp);

  // Keep a fresh `mods` reference outside the fetch closures so they can check
  // "did the user already have results visible?" without making `mods` a
  // useCallback dep (that would self-trigger). Also doubles as the source
  // for the unmount-time cache save.
  const modsRef = useRef<GameBananaMod[]>(mods);
  const pageRef = useRef<number>(page);
  const hasMoreRef = useRef<boolean>(hasMore);
  const totalCountRef = useRef<number>(_totalCount);
  useEffect(() => {
    modsRef.current = mods;
  }, [mods]);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);
  useEffect(() => {
    totalCountRef.current = _totalCount;
  }, [_totalCount]);

  const cacheCurrentBrowseResults = useCallback((stamp: string) => {
    const cachedMods = modsRef.current;
    if (cachedMods.length === 0) return;
    const scrollTop =
      activeFetchFilterStampRef.current === stamp
        ? latestScrollTopRef.current
        : (browseScrollCacheRef.current.get(stamp) ?? 0);

    browseResultsCacheRef.current.set(stamp, {
      mods: cachedMods,
      page: pageRef.current,
      hasMore: hasMoreRef.current,
      totalCount: totalCountRef.current,
      scrollTop,
    });
    browseScrollCacheRef.current.set(stamp, scrollTop);
  }, []);

  useEffect(() => {
    if (!initialCache || mods.length === 0) return;
    browseResultsCacheRef.current.set(fetchFilterStamp, {
      mods,
      page,
      hasMore,
      totalCount: _totalCount,
      scrollTop: initialCache.scrollTop,
    });
    browseScrollCacheRef.current.set(fetchFilterStamp, initialCache.scrollTop);
    activeFetchFilterStampRef.current = fetchFilterStamp;
    lastFetchedStampRef.current = `${page}|${fetchFilterStamp}`;
    // Seed once from the route-level session cache; subsequent filter caches
    // are maintained explicitly when the active filter stamp changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restore cached scroll position once the first paint with hydrated mods
  // is on screen. useLayoutEffect (not useEffect) so we scroll before the
  // browser paints, avoiding a visible jump from 0 to the saved offset.
  useLayoutEffect(() => {
    const target = pendingScrollTopRef.current;
    if (target === null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = target;
    pendingScrollTopRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const updateMetrics = () => {
      const nextMetrics = {
        containerWidth: container.clientWidth,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
      };
      setBrowseViewportMetrics((currentMetrics) =>
        currentMetrics.containerWidth === nextMetrics.containerWidth &&
        currentMetrics.windowWidth === nextMetrics.windowWidth &&
        currentMetrics.windowHeight === nextMetrics.windowHeight
          ? currentMetrics
          : nextMetrics
      );
    };
    updateMetrics();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMetrics);
      return () => window.removeEventListener('resize', updateMetrics);
    }

    const observer = new ResizeObserver(updateMetrics);
    observer.observe(container);
    window.addEventListener('resize', updateMetrics);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, []);

  // Mirror scrollTop into a ref on every scroll. The unmount cleanup below
  // runs as a passive effect — by then React has already nulled
  // `scrollContainerRef.current`, so we can't read scrollTop off the DOM
  // there. The ref gives us the last-known value to persist instead.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const onScroll = () => {
      const nextScrollTop = container.scrollTop;
      latestScrollTopRef.current = nextScrollTop;
      if (!isBrowseScrollingRef.current) {
        isBrowseScrollingRef.current = true;
        setIsBrowseScrolling(true);
      }
      if (scrollHoverTimeoutRef.current !== null) {
        window.clearTimeout(scrollHoverTimeoutRef.current);
      }
      scrollHoverTimeoutRef.current = window.setTimeout(() => {
        scrollHoverTimeoutRef.current = null;
        isBrowseScrollingRef.current = false;
        setIsBrowseScrolling(false);
      }, 140);
      if (scrollCacheFrameRef.current !== null) return;
      scrollCacheFrameRef.current = window.requestAnimationFrame(() => {
        scrollCacheFrameRef.current = null;
        const cachedScrollTop = latestScrollTopRef.current;
        browseScrollCacheRef.current.set(activeFetchFilterStampRef.current, cachedScrollTop);
        const cached = browseResultsCacheRef.current.get(activeFetchFilterStampRef.current);
        if (cached) {
          cached.scrollTop = cachedScrollTop;
        }
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (scrollCacheFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollCacheFrameRef.current);
        scrollCacheFrameRef.current = null;
      }
      if (scrollHoverTimeoutRef.current !== null) {
        window.clearTimeout(scrollHoverTimeoutRef.current);
        scrollHoverTimeoutRef.current = null;
      }
      isBrowseScrollingRef.current = false;
    };
  }, []);

  // Persist session cache on unmount so navigating back resumes exactly
  // where the user left off. Refs feed the cleanup with current values
  // since the closure captures at first render.
  useEffect(() => {
    return () => {
      const ui = useAppStore.getState().browseUi;
      const stamp = `${ui.section}|${ui.search}|${ui.sort}|${ui.categoryId}|${ui.heroCategoryId}|${ui.nsfw}|${ui.addedWithin}|${ui.addedFrom}|${ui.addedTo}|${ui.submitter?.id ?? ''}`;
      const cachedMods = modsRef.current;
      // Don't cache an empty state — would just bypass the next fetch
      // unhelpfully. Clear instead so the next mount starts fresh.
      if (cachedMods.length === 0) {
        setBrowseSession(null);
        return;
      }
      // Read scrollTop from the live mirror — `scrollContainerRef.current` is
      // already null here (React detaches DOM refs before passive cleanups).
      const scrollTop = latestScrollTopRef.current;
      setBrowseSession({
        mods: cachedMods,
        page: pageRef.current,
        hasMore: hasMoreRef.current,
        totalCount: totalCountRef.current,
        scrollTop,
        stamp,
      });
    };
  }, [setBrowseSession]);

  // Derived (not state) so the right code path runs in the same render the
  // user picks a hero/types a query. Storing it in useState lagged a render,
  // which caused fetchMods (API, no hero filter) to race with searchLocal and
  // overwrite real results with an empty API response.
  const useLocalSearch = useMemo(() => {
    // Artist mode is a GameBanana-only filter (Generic_Submitter); the local
    // catalog mirror has no submitter column, so always go remote.
    if (submitter) return false;
    const hasSearchQuery = debouncedSearch.trim().length > 0;
    const hasHeroFilter = heroCategoryId !== 'all';
    // NSFW and recency filters only the local catalog mirror can satisfy: the
    // live API enriches NSFW after the fact and doesn't window by date, so route
    // those through local search (the cache is a full mirror of the index).
    const hasContentFilter = nsfw !== 'all' || addedWithin !== 'all';
    // The v11 API has no alphabetical sort token, so name ordering also has to
    // come from the local mirror (which sorts name COLLATE NOCASE ASC).
    const needsLocalSort = sort === 'name';
    return (hasSearchQuery || hasHeroFilter || hasContentFilter || needsLocalSort) && hasLocalCache && !localSearchFailed;
  }, [submitter, debouncedSearch, heroCategoryId, nsfw, addedWithin, sort, hasLocalCache, localSearchFailed]);

  // Reset the failure flag whenever the user changes filters so a one-off
  // backend error doesn't permanently disable local search.
  useEffect(() => {
    setLocalSearchFailed(false);
  }, [debouncedSearch, heroCategoryId, nsfw, addedWithin, section, sort]);

  const fetchMods = useCallback(async () => {
    // Don't fetch from API if we're using local search
    if (useLocalSearch) return;
    if (restoredCacheSkipStampRef.current === fetchFilterStamp) {
      restoredCacheSkipStampRef.current = null;
      return;
    }
    if (pendingPageResetStampRef.current === fetchFilterStamp && page !== 1) return;
    if (page === 1 && pendingPageResetStampRef.current === fetchFilterStamp) {
      pendingPageResetStampRef.current = null;
    }
    // Value-compare gate: skip when we'd be re-fetching the exact same state
    // we already loaded. Covers cache hydration on mount AND React
    // StrictMode's double-effect setup. Set BEFORE the network call so
    // a second setup hitting this line sees the stamp and returns.
    const stamp = `${page}|${fetchFilterStamp}`;
    if (lastFetchedStampRef.current === stamp) return;
    lastFetchedStampRef.current = stamp;
    const requestGeneration = ++requestGenerationRef.current;

    // On a fresh load (no results yet) show the skeleton; on a refetch keep
    // the stale list visible and just surface a soft progress indicator so
    // each keystroke doesn't repaint the whole grid as gray boxes.
    if (page === 1) {
      const hadResults = modsRef.current.length > 0;
      if (hadResults) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const response = await browseMods(
        page,
        perPage,
        // In artist mode the grid is scoped by submitter; text search and
        // category don't combine cleanly with that on the API, so they're
        // dropped while viewing an artist.
        submitter ? undefined : (effectiveSearch || undefined),
        section,
        submitter ? undefined : effectiveCategoryId,
        sort !== 'default' ? sort : undefined,
        submitter?.id
      );

      // Enrich results with cached NSFW status from local database
      // The API doesn't reliably return NSFW flags in list responses
      let enrichedRecords = response.records;
      if (response.records.length > 0) {
        try {
          const ids = response.records.map(m => m.id);
          const nsfwStatus = await window.electronAPI.getModsNsfwStatus(ids);
          enrichedRecords = response.records.map(mod => ({
            ...mod,
            nsfw: nsfwStatus[mod.id] ?? mod.nsfw ?? false,
          }));
        } catch (enrichErr) {
          // If enrichment fails, continue with original data
          console.warn('Failed to enrich NSFW status from cache:', enrichErr);
        }
      }

      if (requestGeneration !== requestGenerationRef.current || lastFetchedStampRef.current !== stamp) {
        return;
      }

      const nextMods =
        page === 1
          ? dedupeModsById(enrichedRecords)
          : appendUniqueModsById(modsRef.current, enrichedRecords);
      const nextHasMore = response.records.length === perPage && page * perPage < response.totalCount;

      setMods(nextMods);
      setTotalCount(response.totalCount);
      setHasMore(nextHasMore);
      modsRef.current = nextMods;
      pageRef.current = page;
      totalCountRef.current = response.totalCount;
      hasMoreRef.current = nextHasMore;
      const cachedScrollTop = browseScrollCacheRef.current.get(fetchFilterStamp) ?? latestScrollTopRef.current;
      browseResultsCacheRef.current.set(fetchFilterStamp, {
        mods: nextMods,
        page,
        hasMore: nextHasMore,
        totalCount: response.totalCount,
        scrollTop: cachedScrollTop,
      });
      browseScrollCacheRef.current.set(fetchFilterStamp, cachedScrollTop);
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current || lastFetchedStampRef.current !== stamp) {
        return;
      }
      const message = String(err);
      // Keep any already-loaded results on screen: route the failure to the
      // inline load-more row rather than `error`, which would blank the whole
      // grid. Only a truly empty list falls back to the full-page error state.
      if (modsRef.current.length > 0) {
        setLoadMoreError(message);
      } else {
        setError(message);
      }
      // Stop the observer from auto-retrying against an API that just refused.
      setAutoLoadPaused(true);
    } finally {
      if (requestGeneration === requestGenerationRef.current && lastFetchedStampRef.current === stamp) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [
    page,
    effectiveSearch,
    sort,
    section,
    perPage,
    effectiveCategoryId,
    fetchFilterStamp,
    useLocalSearch,
    submitter,
  ]);

  // Local search function using SQLite cache
  const searchLocal = useCallback(async () => {
    if (restoredCacheSkipStampRef.current === fetchFilterStamp) {
      restoredCacheSkipStampRef.current = null;
      return;
    }
    if (pendingPageResetStampRef.current === fetchFilterStamp && page !== 1) return;
    if (page === 1 && pendingPageResetStampRef.current === fetchFilterStamp) {
      pendingPageResetStampRef.current = null;
    }
    // Same value-compare gate as fetchMods so the shared stamp prevents
    // re-fetching cached state and survives StrictMode double-mount.
    const stamp = `${page}|${fetchFilterStamp}`;
    if (lastFetchedStampRef.current === stamp) return;
    lastFetchedStampRef.current = stamp;
    const requestGeneration = ++requestGenerationRef.current;
    // Same anti-flash logic as fetchMods: skeleton only on truly empty first
    // load. Subsequent refetches keep the previous result set visible until
    // the new one arrives.
    if (page === 1) {
      const hadResults = modsRef.current.length > 0;
      if (hadResults) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const sortMap: Record<SortOption, 'relevance' | 'likes' | 'date' | 'date_added' | 'views' | 'name'> = {
        default: 'relevance',
        popular: 'likes',
        recent: 'date_added',
        updated: 'date',
        views: 'views',
        name: 'name',
      };

      // Hero list lives under Mod -> Skins, but we want the filter to work on
      // any section (Sound mods include the hero name in the title), so always
      // resolve the hero from the Mod-category tree.
      const skinsCat = findCategoryByName(modCategories, 'Skins');
      const selectedHeroName = heroCategoryId !== 'all' && skinsCat?.children
        ? skinsCat.children.find(c => c.id === heroCategoryId)?.name
        : undefined;

      const result = await window.electronAPI.searchLocalMods({
        query: effectiveSearch.trim() || undefined,
        section: section,
        categoryId: effectiveCategoryId,
        // Enhanced hero search: pass hero name and skins parent ID
        heroName: selectedHeroName,
        skinsCategoryId: skinsCat?.id,
        sortBy: sortMap[sort] || 'relevance',
        nsfw,
        addedWithin,
        addedFrom: customAddedFrom,
        addedTo: customAddedTo,
        limit: perPage,
        offset: (page - 1) * perPage,
      });

      // Convert CachedMod to GameBananaMod format
      const convertedMods: GameBananaMod[] = result.mods.map(m => ({
        id: m.id,
        name: m.name,
        profileUrl: m.profileUrl,
        dateAdded: m.dateAdded,
        dateModified: m.dateModified,
        hasFiles: m.hasFiles,
        likeCount: m.likeCount,
        viewCount: m.viewCount,
        nsfw: m.isNsfw,
        rootCategory: m.categoryId ? { id: m.categoryId, name: m.categoryName || '' } : undefined,
        submitter: m.submitterName ? { id: m.submitterId || 0, name: m.submitterName } : undefined,
        previewMedia: (() => {
          let images: { baseUrl: string; file: string; file530: string }[] | undefined;
          if (m.thumbnailUrl) {
            const lastSlash = m.thumbnailUrl.lastIndexOf('/');
            if (lastSlash !== -1) {
              const baseUrl = m.thumbnailUrl.substring(0, lastSlash);
              const file = m.thumbnailUrl.substring(lastSlash + 1);
              if (baseUrl && file) {
                images = [{ baseUrl, file, file530: file }];
              }
            }
          }
          const metadata = m.audioUrl ? { audioUrl: m.audioUrl } : undefined;
          if (!images && !metadata) return undefined;
          return { images, metadata };
        })(),
      }));

      if (requestGeneration !== requestGenerationRef.current || lastFetchedStampRef.current !== stamp) {
        return;
      }

      const nextMods =
        page === 1
          ? dedupeModsById(convertedMods)
          : appendUniqueModsById(modsRef.current, convertedMods);
      const nextHasMore = convertedMods.length === perPage && page * perPage < result.totalCount;

      setMods(nextMods);
      setTotalCount(result.totalCount);
      setHasMore(nextHasMore);
      modsRef.current = nextMods;
      pageRef.current = page;
      totalCountRef.current = result.totalCount;
      hasMoreRef.current = nextHasMore;
      const cachedScrollTop = browseScrollCacheRef.current.get(fetchFilterStamp) ?? latestScrollTopRef.current;
      browseResultsCacheRef.current.set(fetchFilterStamp, {
        mods: nextMods,
        page,
        hasMore: nextHasMore,
        totalCount: result.totalCount,
        scrollTop: cachedScrollTop,
      });
      browseScrollCacheRef.current.set(fetchFilterStamp, cachedScrollTop);
    } catch (err) {
      if (requestGeneration !== requestGenerationRef.current || lastFetchedStampRef.current !== stamp) {
        return;
      }
      console.error('Local search failed, falling back to API:', err);
      lastFetchedStampRef.current = null;
      setLocalSearchFailed(true);
    } finally {
      if (requestGeneration === requestGenerationRef.current && lastFetchedStampRef.current === stamp) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [page, effectiveSearch, section, sort, perPage, effectiveCategoryId, heroCategoryId, nsfw, addedWithin, customAddedFrom, customAddedTo, modCategories, fetchFilterStamp]);

  // Value-compare gate for the filter-reset: remember what filters last
  // triggered a reset; only reset when the new combination is actually
  // different. This survives both initial cache hydration and React
  // StrictMode's double-effect run (the second setup sees the same stamp
  // and short-circuits, instead of consuming a one-shot skip flag).
  const lastResetFiltersRef = useRef<string | null>(
    fetchFilterStamp
  );
  useEffect(() => {
    const current = fetchFilterStamp;
    if (lastResetFiltersRef.current === current) return;
    cacheCurrentBrowseResults(activeFetchFilterStampRef.current);
    lastResetFiltersRef.current = current;
    activeFetchFilterStampRef.current = current;
    requestGenerationRef.current += 1;
    lastFetchedStampRef.current = null;

    const cached = browseResultsCacheRef.current.get(current);
    if (cached) {
      pendingPageResetStampRef.current = null;
      setMods(cached.mods);
      setPage(cached.page);
      setTotalCount(cached.totalCount);
      setHasMore(cached.hasMore);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setLoadMoreError(null);
      setAutoLoadPaused(false);
      lastFetchedStampRef.current = `${cached.page}|${current}`;
      restoredCacheSkipStampRef.current = current;
      latestScrollTopRef.current = cached.scrollTop;
      browseScrollCacheRef.current.set(current, cached.scrollTop);
      requestAnimationFrame(() => {
        if (activeFetchFilterStampRef.current !== current) return;
        const container = scrollContainerRef.current;
        if (container) container.scrollTop = cached.scrollTop;
      });
      return;
    }

    if (page !== 1) {
      pendingPageResetStampRef.current = current;
    }
    // Reset pagination when filters change but keep previous results visible
    // until the new query lands. Blanking mods here is what produced the
    // skeleton flash on every keystroke pre-debounce.
    setPage(1);
    setHasMore(true);
    // New filters: drop any prior load-more failure and re-enable
    // auto-pagination for the fresh result set.
    setLoadMoreError(null);
    setAutoLoadPaused(false);
  }, [cacheCurrentBrowseResults, fetchFilterStamp, page]);

  useEffect(() => {
    let active = true;
    getGamebananaCategories('ModCategory')
      .then((data) => {
        if (active) setModCategories(data);
      })
      .catch(() => {
        // Hero filter just won't be available; not fatal.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadSections = async () => {
      try {
        const data = await getGamebananaSections();
        const filtered = data.filter((entry) => SECTION_WHITELIST.has(entry.modelName));
        if (!active) return;
        if (filtered.length === 0) {
          setSections([{ pluralTitle: 'Mods', modelName: 'Mod', categoryModelName: 'ModCategory', itemCount: 0 }]);
          return;
        }
        setSections(filtered);
        if (!filtered.some((entry) => entry.modelName === section)) {
          setSection(filtered[0].modelName);
        }
      } catch (err) {
        if (active) {
          setError(String(err));
        }
      }
    };

    loadSections();

    return () => {
      active = false;
    };
    // Run once on mount: section selection is read inside but we don't want
    // refires on every tab switch (that would re-fetch the section list
    // unnecessarily). setSection is stable from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track whether `section` actually changed (vs. the effect just firing on
  // mount because deps populated for the first time). Without this guard the
  // hero/category filters were reset to 'all' on every remount, which then
  // triggered a refetch and threw away the cached scroll position.
  const lastLoadedSectionRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const selected = sections.find((entry) => entry.modelName === section);
    if (!selected) {
      setCategories([]);
      return () => {
        active = false;
      };
    }

    const sectionChanged = lastLoadedSectionRef.current !== null && lastLoadedSectionRef.current !== section;
    lastLoadedSectionRef.current = section;

    const loadCategories = async () => {
      try {
        const data = await getGamebananaCategories(selected.categoryModelName);
        if (!active) return;
        setCategories(data);
        // Only reset the hero/category filter when the user actually
        // switched sections — not on every remount.
        if (sectionChanged) {
          setHeroCategoryId('all');
          setCategoryId('all');
        }
      } catch (err) {
        if (active) {
          setError(String(err));
        }
      }
    };

    loadCategories();

    return () => {
      active = false;
    };
  }, [sections, section, setCategoryId, setHeroCategoryId]);

  useEffect(() => {
    if (useLocalSearch) {
      searchLocal();
    } else {
      fetchMods();
    }
  }, [fetchMods, searchLocal, useLocalSearch, refreshKey]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    const progressUnsub = window.electronAPI.onDownloadProgress((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloadProgress({
          downloaded: data.downloaded,
          total: data.total,
        });
      }
    });

    const extractingUnsub = window.electronAPI.onDownloadExtracting((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setExtracting(true);
      }
    });

    const completeUnsub = window.electronAPI.onDownloadComplete((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
        loadMods(); // Refresh installed mods
      }
    });

    const errorUnsub = window.electronAPI.onDownloadError((data) => {
      if (
        downloading &&
        data.modId === downloading.modId &&
        data.fileId === downloading.fileId
      ) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
        const fullMessage =
          data.helpUrl && !data.message.includes(data.helpUrl)
            ? `${data.message} ${data.helpUrl}`
            : data.message;
        setError(fullMessage);
      }
    });

    const queueUnsub = window.electronAPI.onDownloadQueueUpdated((data) => {
      setDownloadQueue(data.queue);
      // Sync local downloading state with backend - this is the source of truth
      if (data.currentDownload) {
        setDownloading({ modId: data.currentDownload.modId, fileId: data.currentDownload.fileId });
      } else {
        // Only clear if we don't have a current download from backend
        // Don't clear during race conditions - let the complete event handle that
      }
    });

    return () => {
      progressUnsub();
      extractingUnsub();
      completeUnsub();
      errorUnsub();
      queueUnsub();
    };
  }, [downloading, loadMods]);

  // Infinite scroll observer
  // Infinite scroll observer
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        // Load more when reaching bottom and not already loading. autoLoadPaused
        // gates this after a fetch failure so a refusing API isn't hammered in a
        // loop (the sentinel re-enters view when the grid shrinks).
        if (entries[0].isIntersecting && hasMore && !loading && !loadingMore && !autoLoadPaused) {
          setPage(prev => prev + 1);
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loading, loadingMore, autoLoadPaused]);

  // Background fetch download counts for visible mods (using global cache with TTL)
  // DISABLED: This makes N API calls per page load which is very slow and risks rate limiting.
  // Download counts are now only fetched when the modal is opened (via handleModClick).
  // To re-enable, uncomment the useEffect below.
  /*
  useEffect(() => {
    if (mods.length === 0) return;
    let cancelled = false;

    // Find mods that don't have download counts cached (or are stale)
    const missingMods = mods.filter((mod) => getDownloadCount(mod.id) === undefined);
    if (missingMods.length === 0) return;

    // Fetch in batches to avoid rate limiting
    const fetchBatch = async (batch: typeof missingMods) => {
      for (const mod of batch) {
        if (cancelled) return;
        try {
          const details = await getModDetails(mod.id, section);
          if (cancelled) return;
          // Sum download counts across all files
          const totalDownloads = details.files?.reduce((sum, f) => sum + (f.downloadCount || 0), 0) ?? 0;
          setDownloadCount(mod.id, totalDownloads);
        } catch {
          // Ignore errors silently
        }
        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 100));
      }
    };

    // Fetch up to first 10 mods immediately
    fetchBatch(missingMods.slice(0, 10));

    return () => {
      cancelled = true;
    };
  }, [mods, section, getDownloadCount, setDownloadCount]);
  */

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      // Sync current section from GameBanana API to local DB
      await window.electronAPI.syncSection(section);
      // Reset state and force re-fetch
      setMods([]);
      setHasMore(true);
      setPage(1);
      setError(null);
      setLoadMoreError(null);
      setAutoLoadPaused(false);
      browseResultsCacheRef.current.delete(fetchFilterStamp);
      browseScrollCacheRef.current.delete(fetchFilterStamp);
      requestGenerationRef.current += 1;
      lastFetchedStampRef.current = null;
      pendingPageResetStampRef.current = null;
      setRefreshKey(k => k + 1);
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
    }
  };

  // Retry a failed browse fetch (full-page or load-more). Clears the failure
  // flags, lifts the auto-pagination pause, and forces a re-fetch of the
  // current page. The stamp guard would otherwise treat the retry as a
  // duplicate and skip it, so the stamp is cleared too. loadingMore is set
  // up front so the observer can't also advance the page in the same commit.
  const handleRetryFetch = useCallback(() => {
    setError(null);
    setLoadMoreError(null);
    setAutoLoadPaused(false);
    setLoadingMore(true);
    lastFetchedStampRef.current = null;
    setRefreshKey((k) => k + 1);
  }, []);

  const applyLoadedModDetails = async (mod: GameBananaMod, details: GameBananaModDetails) => {
    setSelectedMod(details);
    setSelectedModDates({ dateAdded: mod.dateAdded, dateModified: mod.dateModified });

    // Update the mods array with the correct nsfw flag from details
    // This ensures grid cards show blur after clicking once
    if (details.nsfw !== mod.nsfw) {
      setMods(prev => prev.map(m =>
        m.id === mod.id ? { ...m, nsfw: details.nsfw } : m
      ));

      // Also update the local cache so future browses show correct status
      try {
        await window.electronAPI.updateModNsfw(mod.id, details.nsfw);
      } catch (cacheErr) {
        console.warn('Failed to update NSFW cache:', cacheErr);
      }
    }

    // Cache the download count from mod details (sum across all files)
    if (details.files && details.files.length > 0) {
      const totalDownloads = details.files.reduce((sum, f) => sum + (f.downloadCount || 0), 0);
      try {
        await window.electronAPI.updateModDownloadCount(mod.id, totalDownloads);
        // Update local state so the card shows the count immediately
        setMods(prev => prev.map(m =>
          m.id === mod.id ? { ...m, downloadCount: totalDownloads } : m
        ));
      } catch (cacheErr) {
        console.warn('Failed to cache download count:', cacheErr);
      }
    }
  };

  const handleModClick = async (mod: GameBananaMod) => {
    try {
      const details = await getModDetails(mod.id, section, { includeSubmitter: true });
      await applyLoadedModDetails(mod, details);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleNavigateMod = async (mod: GameBananaMod, direction: ModDetailsNavigationDirection) => {
    if (modalNavigation) return;

    const requestId = modalNavigationRequestRef.current + 1;
    modalNavigationRequestRef.current = requestId;
    setModalNavigation({ direction, label: mod.name });

    try {
      const details = await getModDetails(mod.id, section, { includeSubmitter: true });
      if (modalNavigationRequestRef.current !== requestId) return;
      await applyLoadedModDetails(mod, details);
    } catch (err) {
      if (modalNavigationRequestRef.current === requestId) {
        setError(String(err));
      }
    } finally {
      if (modalNavigationRequestRef.current === requestId) {
        setModalNavigation(null);
      }
    }
  };

  const handleDownload = async (fileId: number, fileName: string) => {
    if (!selectedMod || !activeDeadlockPath) return;

    // The first file claims the active slot (shows progress); additional clicks
    // queue behind it. The backend's download-queue-updated event is the source
    // of truth for what's queued, so don't clobber the active progress UI here.
    if (!downloading) {
      setDownloading({ modId: selectedMod.id, fileId });
      setDownloadProgress({ downloaded: 0, total: 0 });
      setExtracting(false);
    }

    try {
      await downloadMod(selectedMod.id, fileId, fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      // Reset the active UI only if the file that failed is the active one.
      // Functional update reads fresh state, not this closure's snapshot.
      setDownloading((cur) =>
        cur && cur.modId === selectedMod.id && cur.fileId === fileId ? null : cur
      );
    }
  };

  const handleQuickDownload = async (mod: GameBananaMod) => {
    if (!activeDeadlockPath) return;

    // Check if already downloading or in queue
    if (downloading?.modId === mod.id) return;
    if (downloadQueue.some(q => q.modId === mod.id)) return;

    try {
      // Fetch mod details to get the first file. Include the submitter up front
      // so the multi-file branch below can open the details panel (which shows
      // the artist card) without a second round-trip against the rate limiter.
      const details = await getModDetails(mod.id, section, { includeSubmitter: true });
      if (!details.files || details.files.length === 0) {
        setError('No downloadable files found');
        return;
      }

      // When a mod has more than one downloadable file (different versions,
      // variant builds, etc.) we used to silently pick whichever had the
      // highest download count. Forum feedback flagged that, so surface the
      // details modal and let the user choose which file to install.
      if (details.files.length > 1) {
        setSelectedMod(details);
        setSelectedModDates({ dateAdded: mod.dateAdded, dateModified: mod.dateModified });
        return;
      }

      const file = getPrimaryFile(details.files);

      // If nothing is currently downloading, set this as the active download
      if (!downloading) {
        setDownloading({ modId: mod.id, fileId: file.id });
        setDownloadProgress({ downloaded: 0, total: 0 });
        setExtracting(false);
      }

      await downloadMod(mod.id, file.id, file.fileName, section, effectiveCategoryId);
    } catch (err) {
      setError(String(err));
      // Only clear downloading state if this was the active download
      if (downloading?.modId === mod.id) {
        setDownloading(null);
        setDownloadProgress(null);
        setExtracting(false);
      }
    }
  };

  const heroOptions = useMemo(() => {
    const skins = findCategoryByName(modCategories, 'Skins');
    if (!skins?.children) return [];
    return skins.children
      .filter((child) => child.itemCount > 0)
      .map((child) => ({
        id: child.id,
        label: child.name,
      }));
  }, [modCategories]);

  const categoryOptions = useMemo(() => {
    // Per-hero entries under Skins are handled by the dedicated Hero filter, so
    // exclude them here. Everything else (Skins, Model Replacement, HUD,
    // Gameplay Modifications, Maps, Music, Killsounds, ...) becomes a mod-type
    // filter. This surfaces GameBanana's real categories instead of the old
    // hardcoded hud/other-misc/maps allowlist (issue #91).
    const heroIds = new Set(heroOptions.map((hero) => hero.id));
    const flat = flattenCategories(categories, '', { excludeIds: heroIds, includeEmpty: false });

    // GameBanana keeps several legacy duplicate categories that share a name
    // (e.g. multiple "Skins" / "Other/Misc" buckets). Collapse by label and keep
    // the most populated one so the dropdown stays short and points at the
    // canonical category.
    const byLabel = new Map<string, CategoryOption>();
    for (const opt of flat) {
      const key = opt.label.toLowerCase();
      const existing = byLabel.get(key);
      if (!existing || opt.itemCount > existing.itemCount) {
        byLabel.set(key, opt);
      }
    }

    return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [categories, heroOptions]);

  const installedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaId === 'number') {
        ids.add(mod.gameBananaId);
      }
    }
    return ids;
  }, [installedMods]);

  // Per-card lookup so each ModCard knows the local mod's id + enabled state.
  // Drives the inline "Enable" affordance: once a download finishes, the
  // top-right of the card flips from a downloading spinner into either a
  // green ✓ (already enabled) or a yellow Enable pill (still disabled).
  const installedByGbId = useMemo(() => {
    const map = new Map<number, { id: string; enabled: boolean }>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaId !== 'number') continue;
      // If a user has multiple variants of the same GB mod installed, prefer
      // the enabled one — that's the relevant state to show.
      const existing = map.get(mod.gameBananaId);
      if (!existing || (mod.enabled && !existing.enabled)) {
        map.set(mod.gameBananaId, { id: mod.id, enabled: mod.enabled });
      }
    }
    return map;
  }, [installedMods]);

  const toggleMod = useAppStore((state) => state.toggleMod);

  // Track installed file IDs for per-file "Reinstall" button state
  const installedFileIds = useMemo(() => {
    const ids = new Set<number>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaFileId === 'number') {
        ids.add(mod.gameBananaFileId);
      }
    }
    return ids;
  }, [installedMods]);

  // Per-file install map for the details modal. Lets a row that's installed
  // but currently disabled surface an inline "Enable" pill — matches the
  // affordance already on the tile card. If multiple local mods share a
  // file id (rare, e.g. dupe installs), prefer the enabled one as the
  // representative since that's the actionable state.
  const installedFileStates = useMemo(() => {
    const map = new Map<number, { modId: string; enabled: boolean }>();
    for (const mod of installedMods) {
      if (typeof mod.gameBananaFileId !== 'number') continue;
      const existing = map.get(mod.gameBananaFileId);
      if (!existing || (mod.enabled && !existing.enabled)) {
        map.set(mod.gameBananaFileId, { modId: mod.id, enabled: mod.enabled });
      }
    }
    return map;
  }, [installedMods]);

  const queuedByModId = useMemo(() => {
    const map = new Map<number, QueuedDownloadState>();
    downloadQueue.forEach((queued, index) => {
      map.set(queued.modId, { position: index + 1 });
    });
    return map;
  }, [downloadQueue]);

  const selectedQueuedFileIds = useMemo(() => {
    if (!selectedMod) return new Set<number>();
    const ids = new Set<number>();
    for (const queued of downloadQueue) {
      if (queued.modId === selectedMod.id) ids.add(queued.fileId);
    }
    return ids;
  }, [downloadQueue, selectedMod]);

  const queuedModIds = useMemo(
    () => new Set(downloadQueue.map((queued) => queued.modId)),
    [downloadQueue]
  );

  // Heal legacy 1-click installs that pre-date the forward fix. Those variants
  // have the right gameBananaId but no gameBananaFileId, so ModDetailsModal
  // can't recognise the matching file row as installed and the user ends up
  // clicking Install again, creating a duplicate. When the modal opens, try
  // to recover the file id by matching the local sourceFileName against the
  // GB file list; if only one variant lacks an id and only one file row
  // exists on the page, match unambiguously by position. Healed variants
  // become visible to installedFileIds on the next loadMods.
  useEffect(() => {
    if (!selectedMod) return;
    const candidates = installedMods.filter(
      (m) => m.gameBananaId === selectedMod.id && typeof m.gameBananaFileId !== 'number'
    );
    if (candidates.length === 0) return;
    const files = selectedMod.files ?? [];
    if (files.length === 0) return;

    const usedFileIds = new Set<number>();
    for (const m of installedMods) {
      if (m.gameBananaId === selectedMod.id && typeof m.gameBananaFileId === 'number') {
        usedFileIds.add(m.gameBananaFileId);
      }
    }
    const availableFiles = files.filter((f) => !usedFileIds.has(f.id));

    type Match = {
      modId: string;
      payload: { gameBananaFileId: number; fileDescription?: string; sourceFileName?: string };
    };
    const matches: Match[] = [];
    for (const mod of candidates) {
      const source = mod.sourceFileName?.toLowerCase();
      // Skip the placeholder our old 1-click flow used so we don't try to
      // match "gamebanana-mod-1778634670877" against real GB file rows.
      const usableSource = source && !/^gamebanana-mod-\d+$/.test(source) ? source : undefined;
      let matched = usableSource
        ? availableFiles.find(
            (f) => f.fileName.replace(/\.(zip|7z|rar|vpk)$/i, '').toLowerCase() === usableSource
          )
        : undefined;
      if (!matched && candidates.length === 1 && availableFiles.length === 1) {
        matched = availableFiles[0];
      }
      if (matched) {
        const stem = matched.fileName.replace(/\.(zip|7z|rar|vpk)$/i, '').trim();
        matches.push({
          modId: mod.id,
          payload: {
            gameBananaFileId: matched.id,
            fileDescription: matched.description?.trim() || undefined,
            sourceFileName: stem.length > 0 ? stem : undefined,
          },
        });
        usedFileIds.add(matched.id);
      }
    }
    if (matches.length === 0) return;

    let cancelled = false;
    (async () => {
      try {
        for (const m of matches) {
          await backfillGameBananaFileId(m.modId, m.payload);
        }
        if (!cancelled) await loadMods();
      } catch (err) {
        console.warn('[Browse] backfill gameBananaFileId failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMod, installedMods, loadMods]);

  // Just use all loaded mods - infinite scroll handles pagination.
  // Hide outdated mods if the user has opted in.
  const displayMods = useMemo(() => {
    let nextMods = settings?.hideOutdatedMods
      ? mods.filter((m) => !m.dateModified || !isModOutdated(m.dateModified))
      : mods;
    // "(No hero)" Sound filter: GameBanana Sound categories don't carry hero
    // metadata, so hero association is inferred from the title.
    if (section === 'Sound' && heroCategoryId === 'none') {
      nextMods = nextMods.filter((m) => inferHeroFromTitle(m.name) === null);
    }
    // The NSFW filter is only enforced server-side by the local-search path.
    // The remote paths (artist mode, and the no-local-cache fallback) return
    // unfiltered records, so enforce it here too. Local results already match,
    // so re-filtering them is a no-op.
    if (nsfw === 'sfw') {
      nextMods = nextMods.filter((m) => !m.nsfw);
    } else if (nsfw === 'nsfw') {
      nextMods = nextMods.filter((m) => m.nsfw);
    }

    return nextMods;
  }, [mods, settings?.hideOutdatedMods, section, heroCategoryId, nsfw]);
  const selectedModIndex = selectedMod
    ? displayMods.findIndex((mod) => mod.id === selectedMod.id)
    : -1;
  const previousSelectedMod = selectedModIndex > 0 ? displayMods[selectedModIndex - 1] : undefined;
  const nextSelectedMod =
    selectedModIndex >= 0 && selectedModIndex < displayMods.length - 1
      ? displayMods[selectedModIndex + 1]
      : undefined;
  const closeSelectedMod = () => {
    modalNavigationRequestRef.current += 1;
    setModalNavigation(null);
    setSelectedMod(null);
    setSelectedModDates(null);
  };

  // Enter artist mode: scope the grid to one submitter. We leave the user's
  // search/hero/category filters untouched (artist mode ignores them in the
  // fetch) so clearing artist mode restores their prior browse exactly.
  const viewArtist = (artist: BrowseArtistRef) => {
    if (!artist?.id) return;
    closeSelectedMod();
    setBrowseUi({ submitter: artist });
    scrollContainerRef.current?.scrollTo({ top: 0 });
  };
  const clearArtist = () => setBrowseUi({ submitter: undefined });

  const readableCardTargetWidth = getReadableCardTargetWidth(browseCardSize);
  const gridGap =
    layout === 'list'
      ? 12
      : browseCardDesign === 'readable'
        ? getReadableCardGridGap(readableCardTargetWidth)
        : 12;
  const columnMinWidth =
    layout === 'list'
      ? Math.max(1, browseViewportMetrics.containerWidth - 32)
      : browseCardDesign === 'readable'
        ? readableCardTargetWidth
        : browseCardSize;
  const contentWidth = Math.max(columnMinWidth, browseViewportMetrics.containerWidth - 32);
  const virtualColumnCount =
    layout === 'list'
      ? 1
      : Math.max(1, Math.floor((contentWidth + gridGap) / (columnMinWidth + gridGap)));
  const virtualColumnWidth =
    layout === 'list'
      ? contentWidth
      : Math.floor((contentWidth - gridGap * (virtualColumnCount - 1)) / virtualColumnCount);
  const virtualCardHeight = estimateBrowseRowHeight(
    virtualColumnWidth,
    layout,
    browseCardDesign,
    viewMode,
    section
  );
  const virtualRowHeight = virtualCardHeight + gridGap;
  const virtualRowCount = Math.ceil(displayMods.length / virtualColumnCount);
  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => virtualRowHeight,
    overscan: BROWSE_GRID_OVERSCAN_ROWS,
  });

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [rowVirtualizer, virtualRowHeight, virtualColumnCount, gridGap, browseCardDesign]);

  if (!activeDeadlockPath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Search className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Configure Game Path</h2>
        <p className="text-center max-w-md">
          Set your Deadlock installation path in Settings (or enable dev mode) before downloading mods.
        </p>
      </div>
    );
  }

  // One details element, two homes: the centered modal portals to <body>, the
  // sidebar renders inline inside the <aside> below. Same props either way, so
  // build it once and let `variant` decide the presentation.
  const renderModDetails = (variant: BrowseDetailsView) =>
    selectedMod ? (
      <ModDetailsModal
        variant={variant}
        onChangeView={setBrowseDetailsView}
        mod={selectedMod}
        section={section}
        installed={installedIds.has(selectedMod.id)}
        installedFileIds={installedFileIds}
        installedFileStates={installedFileStates}
        onEnableFile={(modId) => toggleMod(modId)}
        downloadingFileId={downloading?.modId === selectedMod.id ? downloading.fileId : null}
        queuedFileIds={selectedQueuedFileIds}
        extracting={extracting}
        progress={downloadProgress}
        hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
        dateAdded={selectedModDates?.dateAdded}
        dateModified={selectedModDates?.dateModified}
        isNavigating={!!modalNavigation}
        navigationDirection={modalNavigation?.direction}
        navigationLabel={modalNavigation?.label}
        onClose={closeSelectedMod}
        onDownload={handleDownload}
        onNavigatePrevious={
          previousSelectedMod ? () => void handleNavigateMod(previousSelectedMod, 'previous') : undefined
        }
        onNavigateNext={nextSelectedMod ? () => void handleNavigateMod(nextSelectedMod, 'next') : undefined}
        previousLabel={previousSelectedMod?.name}
        nextLabel={nextSelectedMod?.name}
        onDeleteFile={deleteMod}
        onViewArtist={viewArtist}
      />
    ) : null;

  return (
    <div className="flex h-full min-h-0">
      <div className={`flex-1 min-w-0 h-full overflow-y-auto ${isBrowseScrolling ? 'browse-is-scrolling' : ''}`} ref={scrollContainerRef}>
      {/* Header: artist banner in artist mode, otherwise the search/filter row. */}
      <div className="sticky top-0 z-40 p-4 border-b border-border bg-bg-primary">
        {artistMode && submitter ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={clearArtist}
              aria-label="Back to browse"
              title="Back to browse"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-bg-secondary text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            {submitter.avatarUrl && !artistAvatarFailed ? (
              <img
                src={submitter.avatarUrl}
                alt={submitter.name}
                className="h-11 w-11 flex-shrink-0 rounded-full border border-border object-cover"
                onError={() => setArtistAvatarFailed(true)}
              />
            ) : (
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 text-lg font-bold uppercase text-accent">
                {submitter.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {submitter.profileUrl ? (
                  <a
                    href={submitter.profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View ${submitter.name} on GameBanana`}
                    className="group inline-flex min-w-0 items-center gap-1.5 text-lg font-bold text-text-primary transition-colors hover:text-accent"
                  >
                    <span className="min-w-0 truncate">{submitter.name}</span>
                    <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-text-tertiary transition-colors group-hover:text-accent" />
                  </a>
                ) : (
                  <span className="min-w-0 truncate text-lg font-bold text-text-primary">{submitter.name}</span>
                )}
                {_totalCount > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-bg-tertiary px-2 py-0.5 text-[11px] font-semibold text-text-secondary border border-border">
                    {_totalCount.toLocaleString()} {_totalCount === 1 ? 'mod' : 'mods'}
                  </span>
                )}
              </div>
            </div>
            {/* Social symbols + Ko-fi grouped on the right. Ko-fi is filtered out
                of the symbol row since it gets its own labelled brand button. */}
            <div className="flex flex-shrink-0 items-center gap-1.5">
              {artistSocials
                .filter((link) => !(submitter.kofiUrl && link.platform === 'kofi'))
                .map((link) => {
                  const Icon = browseSocialIcon(link.platform);
                  const color = browseSocialColor(link.platform);
                  return (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={link.label}
                      aria-label={link.label}
                      style={{ backgroundColor: color }}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/10 transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    >
                      <Icon className="h-4 w-4" />
                    </a>
                  );
                })}
              {submitter.kofiUrl && (
                <a
                  href={submitter.kofiUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Support ${submitter.name} on Ko-fi`}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#FF5E5B] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#ff4542]"
                >
                  <KofiIcon className="h-4 w-4" />
                  Ko-fi
                </a>
              )}
            </div>
            <div className="hidden flex-shrink-0 items-center gap-1 rounded-lg border border-border bg-bg-secondary p-0.5 sm:flex">
              {(['Mod', 'Sound'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSection(s)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    section === s ? 'bg-accent/15 text-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {s === 'Mod' ? 'Mods' : 'Sounds'}
                </button>
              ))}
            </div>
          </div>
        ) : (
        <form onSubmit={handleSearch}>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input with integrated submit */}
            <div className="relative flex-1 min-w-[200px]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search mods..."
                className="w-full h-10 bg-bg-secondary border border-border rounded-lg pl-3 pr-16 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                {/* Inline spinner while debouncing or refetching with stale results.
                    Replaces the prior whole-grid skeleton flash on every keystroke. */}
                {(search !== debouncedSearch || (loadingMore && page === 1)) && (
                  <Loader2
                    className="w-4 h-4 mx-1 animate-spin text-text-secondary"
                    aria-label="Searching"
                  />
                )}
                {search && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); handleSearch(new Event('submit') as unknown as React.FormEvent); }}
                    className="p-1.5 text-text-secondary hover:text-text-primary transition-colors rounded-md hover:bg-bg-tertiary cursor-pointer"
                    title="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="submit"
                  className="p-1.5 text-text-secondary hover:text-accent transition-colors rounded-md hover:bg-bg-tertiary cursor-pointer"
                  title="Search"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Import menu: GameBanana collection or portable profile. */}
            <div className="relative" ref={importMenuRef}>
              <button
                type="button"
                onClick={() => setImportMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={importMenuOpen}
                className="h-10 flex items-center justify-center gap-1 pl-2.5 pr-1.5 bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="Import"
              >
                <Library className="w-5 h-5" />
                <ChevronDown className="w-3.5 h-3.5 opacity-70" />
              </button>

              {importMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 z-20 w-64 bg-bg-secondary border border-border rounded-lg shadow-xl p-1 animate-fade-in"
                  role="menu"
                  aria-label="Import"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setCollectionModalOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer"
                  >
                    <Library className="w-4 h-4 text-text-secondary shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span>GameBanana Collection</span>
                      <span className="text-[11px] text-text-secondary truncate">Import items from a collection URL</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setImportMenuOpen(false);
                      setImportProfileOpen(true);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4 text-text-secondary shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span>Grimoire Profile</span>
                      <span className="text-[11px] text-text-secondary truncate">Share code or .modprofile.json from the Profiles tab</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Refresh Icon Button */}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={syncing}
              className="h-10 w-10 flex items-center justify-center bg-bg-secondary hover:bg-bg-tertiary border border-border text-text-secondary hover:text-text-primary rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              title="Refresh from GameBanana"
            >
              {syncing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <RefreshCw className="w-5 h-5" />
              )}
            </button>

            <div className="relative" ref={viewMenuRef}>
              <button
                type="button"
                onClick={() => setViewMenuOpen((v) => !v)}
                aria-haspopup="dialog"
                aria-expanded={viewMenuOpen}
                className="flex h-10 items-center gap-2 rounded-lg border border-border bg-bg-secondary px-3 text-sm text-text-primary transition-colors hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                title="View options"
              >
                <LayoutGrid className="h-4 w-4 text-text-secondary" />
                <span>View</span>
                <ChevronDown className="h-3.5 w-3.5 text-text-secondary" />
              </button>

              {viewMenuOpen && (
                <div
                  className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-border bg-bg-secondary p-3 shadow-xl animate-fade-in"
                  role="dialog"
                  aria-label="View options"
                >
                  <div className="space-y-4">
                    <div>
                      <div className="mb-2 text-xs font-medium text-text-secondary">Layout</div>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setLayout('grid')}
                          className={`flex h-9 items-center justify-center gap-2 rounded-md border text-sm transition-colors ${
                            layout === 'grid'
                              ? 'border-accent/50 bg-accent/10 text-accent'
                              : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <LayoutGrid className="h-4 w-4" />
                          Grid
                        </button>
                        <button
                          type="button"
                          onClick={() => setLayout('list')}
                          className={`flex h-9 items-center justify-center gap-2 rounded-md border text-sm transition-colors ${
                            layout === 'list'
                              ? 'border-accent/50 bg-accent/10 text-accent'
                              : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          <List className="h-4 w-4" />
                          List
                        </button>
                      </div>
                    </div>

                    <div className={layout === 'list' ? 'opacity-45' : ''}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="text-xs font-medium text-text-secondary">Card size</span>
                        <span className="inline-flex items-center gap-1 text-[11px] text-text-tertiary">
                          <Grid3x3 className="h-3.5 w-3.5" />
                          Grid only
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Grid3x3 className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                        <input
                          type="range"
                          min={BROWSE_CARD_SIZE_MULTIPLIER_MIN}
                          max={BROWSE_CARD_SIZE_MULTIPLIER_MAX}
                          step={BROWSE_CARD_SIZE_MULTIPLIER_STEP}
                          value={browseCardSizeMultiplier}
                          disabled={layout === 'list'}
                          onChange={(e) => setBrowseCardSizeMultiplier(Number(e.currentTarget.value))}
                          aria-label="Card size"
                          aria-valuetext={`${browseCardSizeMultiplier.toFixed(2)}x card size`}
                          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default"
                        />
                        <LayoutGrid className="h-5 w-5 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                      </div>
                    </div>

                    <div className={layout === 'list' ? 'opacity-45' : ''}>
                      <div className="mb-2 text-xs font-medium text-text-secondary">Card style</div>
                      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Browse card design">
                        {(['readable', 'classic'] as const).map((design) => {
                          const active = browseCardDesign === design;
                          return (
                            <button
                              key={design}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              disabled={layout === 'list'}
                              onClick={() => setBrowseCardDesign(design)}
                              className={`h-9 rounded-md border text-xs font-semibold transition-colors disabled:cursor-default ${
                                active
                                  ? 'border-accent/50 bg-accent/10 text-accent'
                                  : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary'
                              }`}
                            >
                              {design === 'readable' ? 'Default' : 'Classic'}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-medium text-text-secondary">Details view</div>
                      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Mod details view">
                        {(['modal', 'sidebar'] as const).map((view) => {
                          const active = browseDetailsView === view;
                          return (
                            <button
                              key={view}
                              type="button"
                              role="tab"
                              aria-selected={active}
                              onClick={() => setBrowseDetailsView(view)}
                              className={`flex h-9 items-center justify-center gap-1.5 rounded-md border text-xs font-semibold transition-colors ${
                                active
                                  ? 'border-accent/50 bg-accent/10 text-accent'
                                  : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary'
                              }`}
                            >
                              {view === 'modal' ? <Maximize2 className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />}
                              {view === 'modal' ? 'Window' : 'Sidebar'}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </div>
              )}
            </div>

            {/* Section toggle — Mods vs Sounds as icon buttons */}
            {sections.length > 1 && (
              <div className="flex items-center h-10 rounded-lg border border-border bg-bg-secondary p-1" role="tablist" aria-label="Section">
                {sections.map((entry) => {
                  const Icon = entry.modelName === 'Sound' ? Music : Package;
                  const active = section === entry.modelName;
                  return (
                    <button
                      key={entry.modelName}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setSection(entry.modelName)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                        active
                          ? 'bg-bg-tertiary text-text-primary'
                          : 'text-text-secondary hover:text-text-primary'
                      }`}
                      title={entry.pluralTitle}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm">{entry.pluralTitle}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <DynamicSelect
              value={sort}
              onChange={(val) => setSort(val as SortOption)}
              options={[
                { value: 'default', label: 'Default' },
                { value: 'popular', label: 'Popularity' },
                { value: 'recent', label: 'Recently Added' },
                { value: 'updated', label: 'Recently Updated' },
                { value: 'views', label: 'Most Viewed' },
                { value: 'name', label: 'Name (A–Z)' },
              ]}
            />

            {/* Filters popover — houses hero + category selectors. Collapses two
                always-visible dropdowns into one control with an active-count badge. */}
            {(heroOptions.length > 0 || categoryOptions.length > 0 || hasLocalCache) && (() => {
              const filterCount =
                (heroCategoryId !== 'all' ? 1 : 0) +
                (categoryId !== 'all' ? 1 : 0) +
                (nsfw !== 'all' ? 1 : 0) +
                (addedWithin !== 'all' ? 1 : 0);
              return (
                <div className="relative" ref={filtersRef}>
                  <button
                    type="button"
                    onClick={() => setFiltersOpen((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={filtersOpen}
                    className={`flex items-center h-10 gap-2 px-3 rounded-lg border text-sm transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      filterCount > 0
                        ? 'bg-accent/10 border-accent/40 text-accent hover:bg-accent/20'
                        : 'bg-bg-secondary border-border text-text-primary hover:bg-bg-tertiary'
                    }`}
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>Filters</span>
                    {filterCount > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-black text-[11px] font-semibold flex items-center justify-center">
                        {filterCount}
                      </span>
                    )}
                  </button>

                  {filtersOpen && (
                    <div
                      className="absolute right-0 top-full mt-2 z-50 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl p-4 animate-fade-in"
                      role="dialog"
                      aria-label="Filters"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-semibold text-text-primary">Filters</h4>
                        {filterCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setHeroCategoryId('all');
                              setCategoryId('all');
                              setNsfw('all');
                              setAddedWithin('all');
                              setAddedFrom('');
                              setAddedTo('');
                            }}
                            className="text-xs text-text-secondary hover:text-accent cursor-pointer"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      <div className="space-y-3">
                        {heroOptions.length > 0 && (
                          <div className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Hero</span>
                            <HeroSelect
                              ariaLabel="Filter by hero"
                              value={String(heroCategoryId)}
                              onChange={(v) => {
                                if (v === 'all') setHeroCategoryId('all');
                                else if (v === 'none') setHeroCategoryId('none');
                                else setHeroCategoryId(Number(v));
                              }}
                              options={[
                                { value: 'all', label: 'All Heroes', muted: true },
                                ...(section === 'Sound'
                                  ? [{ value: 'none', label: 'No hero (item / UI / music)', muted: true }]
                                  : []),
                                ...heroOptions.map((hero) => ({
                                  value: String(hero.id),
                                  label: hero.label,
                                  heroName: hero.label,
                                })),
                              ]}
                            />
                          </div>
                        )}

                        {categoryOptions.length > 0 && (
                          <div className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Category</span>
                            <select
                              aria-label="Filter by category"
                              value={String(categoryId)}
                              onChange={(e) => setCategoryId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                              disabled={heroCategoryId !== 'all'}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <option value="all">All Categories</option>
                              {categoryOptions.map((cat) => (
                                <option key={cat.id} value={String(cat.id)}>{cat.label}</option>
                              ))}
                            </select>
                            {heroCategoryId !== 'all' && (
                              <span className="block text-[11px] text-text-tertiary mt-1">Hero filter overrides categories.</span>
                            )}
                          </div>
                        )}

                        {/* Content rating + recency are served by the local catalog
                            mirror, so they only show once it's available. */}
                        {hasLocalCache && (
                          <div className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Content</span>
                            <select
                              aria-label="Filter by content rating"
                              value={nsfw}
                              onChange={(e) => setNsfw(e.target.value as BrowseNsfwFilter)}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                            >
                              <option value="all">All</option>
                              <option value="sfw">SFW only</option>
                              <option value="nsfw">NSFW only</option>
                            </select>
                          </div>
                        )}

                        {hasLocalCache && (
                          <div className="block">
                            <span className="block text-xs font-medium text-text-secondary mb-1.5">Added</span>
                            <select
                              aria-label="Filter by date added"
                              value={addedWithin}
                              onChange={(e) => setAddedWithin(e.target.value as BrowseTimeRange)}
                              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                            >
                              <option value="all">Any time</option>
                              <option value="today">Today</option>
                              <option value="week">This week</option>
                              <option value="month">This month</option>
                              <option value="custom">Custom range</option>
                            </select>
                            {addedWithin === 'custom' && (
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <label className="block">
                                  <span className="block text-[11px] text-text-tertiary mb-1">From</span>
                                  <input
                                    type="date"
                                    value={addedFrom}
                                    max={addedTo || undefined}
                                    onChange={(e) => setAddedFrom(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                                  />
                                </label>
                                <label className="block">
                                  <span className="block text-[11px] text-text-tertiary mb-1">To</span>
                                  <input
                                    type="date"
                                    value={addedTo}
                                    min={addedFrom || undefined}
                                    onChange={(e) => setAddedTo(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-bg-tertiary border border-border rounded-md text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
                                  />
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {section === 'Sound' && (
            <div className="mt-3 inline-flex max-w-full items-center gap-3 rounded-lg border border-border bg-bg-secondary/70 px-3 py-2">
              <div className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-text-primary">
                <Volume2 className="h-4 w-4 flex-shrink-0 text-text-secondary" />
                <span>Preview volume</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(soundVolume * 100)}
                onChange={(e) => setSoundVolume(parseInt(e.target.value, 10) / 100)}
                className="h-1.5 w-40 cursor-pointer accent-accent sm:w-48"
                title={`Volume: ${Math.round(soundVolume * 100)}%`}
                aria-label="Preview volume"
              />
              <span className="w-9 text-right text-xs tabular-nums text-text-secondary">
                {Math.round(soundVolume * 100)}%
              </span>
            </div>
          )}
        </form>
        )}
      </div>

      {/* Main Content */}
      <div className="relative z-0 flex-1 p-4">
        {(() => {
          const gridClass =
            layout === 'list'
              ? 'flex flex-col gap-3'
              : browseCardDesign === 'readable'
                ? 'grid'
                : 'grid gap-3';
          const gridStyle =
            layout === 'list'
              ? undefined
              : browseCardDesign === 'readable'
                ? {
                    gridTemplateColumns: `repeat(auto-fit, minmax(${readableCardTargetWidth}px, 1fr))`,
                    gap: `${gridGap}px`,
                  }
                : browseCardSizeGridStyle;
          const hasActiveFilters =
            search.trim().length > 0 ||
            heroCategoryId !== 'all' ||
            categoryId !== 'all' ||
            sort !== 'default' ||
            nsfw !== 'all' ||
            addedWithin !== 'all' ||
            addedFrom.length > 0 ||
            addedTo.length > 0;

          if (loading) {
            // Match perPage so the skeleton grid fills roughly the same footprint
            // as the real results once they arrive.
            return (
              <div className={gridClass} style={gridStyle} aria-busy="true" aria-live="polite">
                {Array.from({ length: DEFAULT_PER_PAGE }).map((_, i) => (
                  <ModCardSkeleton key={i} viewMode={viewMode} />
                ))}
              </div>
            );
          }
          // Only blank the page for the error/empty states when there are no
          // results to show. When the grid already has mods, a fetch failure
          // is surfaced inline at the load-more row instead (see below), so the
          // grid never flashes out from under the user.
          if (displayMods.length === 0) {
            if (error) {
              return (
                <EmptyState
                  icon={AlertTriangle}
                  title="Couldn't load mods"
                  description={renderErrorWithLinks(error)}
                  variant="error"
                  action={<Button onClick={handleRetryFetch}>Retry</Button>}
                />
              );
            }
            return (
              <EmptyState
                icon={Search}
                title={hasActiveFilters ? 'No mods match your filters' : 'No mods found'}
                description={hasActiveFilters ? 'Try widening your search or clearing filters.' : undefined}
                action={
                  hasActiveFilters ? (
                    <Button
                      onClick={() => {
                        setSearch('');
                        setHeroCategoryId('all');
                        setCategoryId('all');
                        setSort('default');
                        setNsfw('all');
                        setAddedWithin('all');
                        setAddedFrom('');
                        setAddedTo('');
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            );
          }
          const virtualRows = rowVirtualizer.getVirtualItems();
          return (
            <div
              className="relative w-full"
              style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
            >
              {virtualRows.map((virtualRow) => {
                const rowStart = virtualRow.index * virtualColumnCount;
                const rowMods = displayMods.slice(rowStart, rowStart + virtualColumnCount);
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    className={layout === 'list' ? 'absolute left-0 top-0 w-full' : 'absolute left-0 top-0 grid w-full'}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      height: `${virtualCardHeight}px`,
                      gridTemplateColumns:
                        layout === 'list'
                          ? undefined
                          : `repeat(${virtualColumnCount}, minmax(0, 1fr))`,
                      gap: layout === 'list' ? undefined : `${gridGap}px`,
                    }}
                  >
                    {rowMods.map((mod, index) => {
                      const queuedState = queuedByModId.get(mod.id);
                      const installedLocal = installedByGbId.get(mod.id);
                      return (
                        <div
                          key={mod.id}
                          className="browse-result-card min-w-0 [contain:layout_style]"
                          style={{ animationDelay: `${Math.min(index * 18, 72)}ms` }}
                        >
                          <MemoizedModCard
                            key={mod.id}
                            mod={mod}
                            installed={installedIds.has(mod.id)}
                            installedDisabled={!!installedLocal && !installedLocal.enabled}
                            downloading={downloading?.modId === mod.id}
                            queuePosition={queuedState?.position}
                            viewMode={viewMode}
                            cardDesign={browseCardDesign}
                            cardSize={browseCardSize}
                            cardWidth={virtualColumnWidth}
                            cardHeight={virtualCardHeight}
                            section={section}
                            volume={soundVolume}
                            onVolumeChange={setSoundVolume}
                            hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
                            isPlaying={playingModId === mod.id}
                            suppressHoverIntent={isBrowseScrolling}
                            enableModId={installedLocal && !installedLocal.enabled ? installedLocal.id : undefined}
                            actionContextKey={`${activeDeadlockPath ?? ''}|${section}|${effectiveCategoryId ?? ''}`}
                            onPlayingChange={(playing) => {
                              setPlayingModId((prev) => {
                                if (playing) return mod.id;
                                return prev === mod.id ? null : prev;
                              });
                            }}
                            onClick={() => handleModClick(mod)}
                            onQuickDownload={() => handleQuickDownload(mod)}
                            onEnable={installedLocal && !installedLocal.enabled
                              ? () => toggleMod(installedLocal.id)
                              : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })()}
        {/* Infinite Scroll Trigger */}
        <div ref={loadMoreRef} className="flex items-center justify-center p-4">
          {loadingMore && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading more...</span>
            </div>
          )}
          {loadMoreError && !loadingMore && (
            <div className="flex flex-col items-center gap-2 text-center max-w-md">
              <div className="flex items-center gap-2 text-text-secondary">
                <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
                <span className="text-sm">Couldn't load more. {renderErrorWithLinks(loadMoreError)}</span>
              </div>
              <Button onClick={handleRetryFetch} variant="secondary" size="sm">Retry</Button>
            </div>
          )}
          {!hasMore && !loadMoreError && mods.length > 0 && !loadingMore && (
            <span className="text-sm text-text-secondary">No more mods to load</span>
          )}
        </div>
      </div>

      {/* Mod details: centered modal (portals to body). The sidebar variant is
          mounted in the <aside> outside this scroll container instead. */}
      {!detailsSidebarActive && renderModDetails('modal')}

      {collectionModalOpen && (
        <ImportCollectionModal
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          installedIds={installedIds}
          queuedIds={queuedModIds}
          activeDeadlockPath={activeDeadlockPath}
          onClose={() => setCollectionModalOpen(false)}
        />
      )}

      {importProfileOpen && (
        <ImportProfileDialog
          activeDeadlockPath={activeDeadlockPath}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          onClose={() => setImportProfileOpen(false)}
          onImported={() => { void loadMods(); }}
        />
      )}
      </div>

      {/* Docked details sidebar. Shrinking the flex-1 grid above triggers the
          scroll container's ResizeObserver, which recomputes the virtualized
          column count, so the grid reflows to fewer columns on its own. */}
      {selectedMod && detailsSidebarActive && (
        <aside
          className="relative flex-shrink-0 h-full border-l border-border bg-bg-secondary overflow-hidden animate-fade-in"
          style={{ width: effectiveSidebarWidth }}
        >
          {/* Drag the left edge to resize; the width is remembered. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details sidebar"
            onPointerDown={startSidebarResize}
            className="group absolute inset-y-0 left-0 z-30 w-2 -ml-1 cursor-col-resize"
          >
            <div className="absolute inset-y-0 left-1 w-0.5 bg-transparent transition-colors group-hover:bg-accent/60" />
          </div>
          {renderModDetails('sidebar')}
        </aside>
      )}
    </div>
  );
}

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
  suppressHoverIntent,
  onPlayingChange,
  onClick,
  onQuickDownload,
  onEnable,
}: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);
  const inferredHero = inferHeroFromTitle(mod.name);
  const heroRenderUrl = isSoundSection && inferredHero ? getHeroRenderPath(inferredHero) : undefined;
  const heroFacePos = inferredHero ? getHeroFacePosition(inferredHero) : 55;
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
  const titleMarginClass = showChips
    ? isCompactReadable
      ? 'mt-[clamp(4px,2.5cqw,7px)]'
      : 'mt-[clamp(5px,2.8571cqw,9px)]'
    : 'mt-0';
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
            style={{ objectPosition: `${heroFacePos}% 20%` }}
          />
        ) : (
          <ImageContextMenu src={heroRenderUrl} alt={inferredHero ?? mod.name}>
            <img
              src={heroRenderUrl}
              alt={inferredHero ?? mod.name}
              loading="lazy"
              decoding="async"
              className="browse-card-media-zoom h-full w-full object-cover"
              style={{ objectPosition: `${heroFacePos}% 20%` }}
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
          <span className="mt-1 text-[11px] font-semibold">NSFW hidden</span>
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

  useEffect(() => {
    if (!suppressHoverIntent) return;
    if (isPlaying) return;
    const timeout = window.setTimeout(() => setAudioControlsActive(false), 0);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, suppressHoverIntent]);

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => handleCardKeyDown(e, onClick)}
      onMouseEnter={() => {
        if (!suppressHoverIntent) setAudioControlsActive(true);
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
      className={`browse-card-hover-surface browse-readable-card group flex w-full flex-col overflow-hidden rounded-md border bg-[#141414]/90 text-left shadow-[0_1px_0_rgba(255,255,255,0.03)] transition-[border-color,transform,box-shadow] duration-150 cursor-pointer focus-visible:border-accent focus-visible:outline-none [container-type:inline-size] ${
        isPlaying
          ? 'border-state-danger/70 ring-2 ring-state-danger/35 shadow-lg shadow-state-danger/15'
          : downloading
            ? 'border-accent/40'
            : 'border-white/[0.07]'
      }`}
    >
      <div className={`browse-readable-card-media relative ${mediaHeightClass} overflow-hidden rounded-t-md bg-bg-tertiary`}>
        {media}
      </div>

      <div
        className={`browse-readable-card-body relative flex flex-none flex-col ${bodyPaddingClass}`}
      >
        {showChips && (
          <BrowseReadableChipRow
            chips={chips}
            availableWidth={chipRowWidth}
            maxVisible={readableDensity === 'compact' ? 2 : BROWSE_READABLE_MAX_VISIBLE_CHIPS}
          />
        )}

        <div className={`${titleMarginClass} min-w-0`}>
          <h3
            className={`block truncate font-mod-title font-bold text-[#eee8df] ${
              isMicro
                ? 'text-[13px] leading-4'
                : 'text-[clamp(11px,5.3571cqw,17px)] leading-[1.28] pb-px'
            }`}
            title={mod.name}
          >
            {mod.name}
          </h3>
          {showAuthor && (
            <p className="mt-0 truncate text-[clamp(10px,4.2857cqw,13px)] font-normal leading-[1.12] text-text-secondary/64">
              by {mod.submitter?.name ?? 'Unknown author'}
            </p>
          )}
          {updatedOwnLine && <BrowseReadableUpdatedLine timestamp={mod.dateModified} variant="block" />}
        </div>

        {showInlineAudioPreview && (
          <div
            className={`mt-[clamp(8px,3.5714cqw,10px)] flex items-center rounded-[clamp(9px,3.5714cqw,12px)] border border-white/10 bg-bg-primary/55 px-[clamp(7px,2.8571cqw,9px)] text-text-secondary shadow-[0_1px_0_rgba(255,255,255,0.03)] ${
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
                    className="flex h-[clamp(24px,8.5714cqw,28px)] w-[clamp(24px,8.5714cqw,28px)] items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
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
                    <div className="absolute bottom-[calc(100%+8px)] right-0 flex items-center rounded-full border border-white/10 bg-[#0a0c10]/92 px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(volume * 100)}
                        onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                        className="w-24 h-1 accent-accent cursor-pointer"
                        title={`Volume: ${Math.round(volume * 100)}%`}
                        aria-label="Volume"
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
                    <span className="flex h-[clamp(24px,8.5714cqw,28px)] w-[clamp(24px,8.5714cqw,28px)] flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80">
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
  suppressHoverIntent?: boolean;
  enableModId?: string;
  actionContextKey?: string;
  onPlayingChange: (playing: boolean) => void;
  onClick: () => void;
  onQuickDownload: () => void;
  /** Toggle the local mod's enabled state. Provided only when there's an
   *  installed-but-disabled mod to enable. */
  onEnable?: () => void;
}

function ModCardSkeleton({ viewMode }: { viewMode: ViewMode }) {
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
  const aspect = viewMode === 'compact' ? 'aspect-[4/3]' : 'aspect-[3/2]';
  return (
    <div className={`relative bg-bg-tertiary border border-border rounded-lg overflow-hidden ${aspect}`}>
      <div className="absolute inset-0 skeleton-shimmer bg-bg-secondary" />
      <div className="absolute bottom-0 left-0 right-0 p-3 space-y-2">
        <div className="h-3.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-3/4" />
        <div className="h-2.5 bg-bg-tertiary/80 skeleton-shimmer rounded w-1/2" />
      </div>
    </div>
  );
}

function ModCard({ mod, installed, installedDisabled, downloading, queuePosition, viewMode, cardDesign, cardSize, cardWidth, cardHeight, section, volume, onVolumeChange, hideNsfwPreviews, isPlaying, suppressHoverIntent, onPlayingChange, onClick, onQuickDownload, onEnable }: ModCardProps) {
  const thumbnail = getModThumbnail(mod);
  const audioPreview = section === 'Sound' ? getSoundPreviewUrl(mod) : undefined;
  // Compact chrome (4:3 aspect, smaller text/padding) kicks in for small cards;
  // see the size-threshold derivation of viewMode in the Browse component.
  const isCompact = viewMode === 'compact';
  // At the smallest grid sizes the bottom overlay (title + stats + author) eats
  // most of a classic card, burying the art it's drawn over. Below this width
  // we collapse to just the title at rest and reveal the rest on hover/focus.
  // Keyed off the real card width (not viewMode, which never resolves to
  // 'compact' for classic cards) so it tracks the card-size slider.
  const minimalChrome =
    cardDesign === 'classic' && typeof cardWidth === 'number' && cardWidth > 0 && cardWidth < 205;
  const isList = viewMode === 'list';
  const isSoundSection = section === 'Sound';
  const hasAudioPreview = Boolean(audioPreview);
  // Sound mods don't carry hero info in the API, so guess from the title.
  // Used to swap in the locker hero portrait as the card backdrop.
  const inferredHero = isSoundSection ? inferHeroFromTitle(mod.name) : null;
  const heroRenderUrl = inferredHero ? getHeroRenderPath(inferredHero) : undefined;
  const heroFacePos = inferredHero ? getHeroFacePosition(inferredHero) : 55;
  const [audioControlsActive, setAudioControlsActive] = useState(false);

  useEffect(() => {
    if (!suppressHoverIntent) return;
    if (isPlaying) return;
    const timeout = window.setTimeout(() => setAudioControlsActive(false), 0);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, suppressHoverIntent]);

  // List view keeps original layout
  if (isList) {
    return (
      <div
        onClick={onClick}
        onKeyDown={(e) => handleCardKeyDown(e, onClick)}
        onMouseEnter={() => {
          if (!suppressHoverIntent) setAudioControlsActive(true);
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
        className={`browse-card-hover-surface relative bg-bg-secondary border rounded-lg overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer flex items-center gap-4 p-3 ${
          isPlaying
            ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
            : 'border-border hover:border-accent/50'
        }`}
      >
        <div className="relative bg-bg-tertiary w-32 h-20 flex-shrink-0 rounded-md overflow-hidden">
          {isSoundSection ? (
            heroRenderUrl ? (
              <ImageContextMenu src={heroRenderUrl} alt={inferredHero ?? mod.name}>
                <img
                  src={heroRenderUrl}
                  alt={inferredHero ?? mod.name}
                  loading="lazy"
                  decoding="async"
                  className="browse-card-media-zoom w-full h-full object-cover"
                  style={{ objectPosition: `${heroFacePos}% 25%` }}
                />
              </ImageContextMenu>
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary flex items-center justify-center">
                <div className="flex items-center gap-1 px-2 py-1 rounded-full border border-accent/40 bg-accent/10 text-text-primary text-[10px] font-semibold">
                  <Volume2 className="w-3 h-3" />
                  SOUND
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
                title="Enable this mod (currently in your disabled folder)"
              >
                <Power className="w-3 h-3" />
                Enable
              </button>
            ) : installed ? (
              <Tag tone="success" variant="overlay" title="Installed" className="flex-shrink-0">
                <span aria-hidden>✓</span>
                Installed
              </Tag>
            ) : downloading ? (
              <span className="flex-shrink-0 flex items-center justify-center w-7 h-7 bg-bg-primary/80 rounded-full">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
              </span>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onQuickDownload(); }}
                className="flex-shrink-0 flex items-center justify-center w-7 h-7 border border-accent/40 bg-accent/10 hover:bg-accent/20 hover:border-accent/60 text-text-primary rounded-full shadow-lg transition-colors cursor-pointer"
                title="Install"
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
              <span className="truncate">{isModOutdated(mod.dateModified) ? 'Outdated · ' : ''}{formatDate(mod.dateModified)}</span>
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
                aria-label="Volume"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Grid/Compact: overlay card — image fills card, info overlaid at bottom
  if (cardDesign === 'readable') {
    return (
      <BrowseArtParallaxCard disabled={suppressHoverIntent}>
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
          suppressHoverIntent={suppressHoverIntent}
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
    <BrowseArtParallaxCard disabled={suppressHoverIntent}>
      <div
        onClick={onClick}
        onKeyDown={(e) => handleCardKeyDown(e, onClick)}
        onMouseEnter={() => {
          if (!suppressHoverIntent) setAudioControlsActive(true);
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
        className={`browse-card-hover-surface relative isolate bg-bg-tertiary border rounded-lg overflow-hidden focus-visible:border-accent focus-visible:outline-none transition-colors text-left cursor-pointer group ${isCompact ? 'aspect-[4/3]' : 'aspect-[3/2]'} ${
          isPlaying
            ? 'border-state-danger ring-2 ring-state-danger/60 shadow-lg shadow-state-danger/20'
            : downloading
              ? 'border-accent ring-2 ring-accent/40 ring-offset-0'
              : installed
                ? 'border-state-success/40 hover:border-state-success/70'
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
                  style={{ objectPosition: `${heroFacePos}% 20%` }}
                />
              </ImageContextMenu>
            ) : thumbnail ? (
              <ModThumbnail src={thumbnail} alt={mod.name} nsfw={mod.nsfw} hideNsfw={hideNsfwPreviews} className="w-full h-full" imageFit="cover" imagePosition="center top" imageClassName="browse-card-media-zoom" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary" />
            )}
            {!hasAudioPreview && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/40 bg-accent/10 text-text-primary font-medium shadow-lg backdrop-blur-sm ${isCompact ? 'text-xs px-2 py-1' : 'text-sm'}`}>
                  <Volume2 className={isCompact ? 'w-3 h-3' : 'w-4 h-4'} />
                  <span>SOUND</span>
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
        <div className={`absolute top-0 left-0 right-0 pointer-events-none ${isCompact ? 'p-2.5 pr-10' : 'p-3 pr-12'}`}>
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
                  Outdated
                </Tag>
              )}
            </div>
          )}
          <h3 className={`font-mod-title font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${isCompact ? 'text-sm' : 'text-base'}`}>{mod.name}</h3>
          <div className={`mt-1 flex flex-wrap items-center gap-3 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
            <BrowseStatItem type="likes" icon={ThumbsUp} value={formatCount(mod.likeCount)} title={`${mod.likeCount ?? 0} likes`} />
            <BrowseStatItem type="views" icon={Eye} value={formatCount(mod.viewCount)} title={`${mod.viewCount ?? 0} views`} />
            {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
          </div>
        </div>
      ) : (
        <div className={`absolute bottom-0 left-0 right-0 ${minimalChrome ? 'p-2' : isCompact ? 'p-2.5' : 'p-3'}`}>
          <h3 className={`font-mod-title font-semibold truncate text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] ${minimalChrome || isCompact ? 'text-sm' : 'text-base'}`}>{mod.name}</h3>
          {/* Stats / author / outdated. On minimal cards this group is collapsed
              to zero height at rest and slides up on hover or keyboard focus. */}
          <div
            className={
              minimalChrome
                ? 'overflow-hidden transition-all duration-200 ease-out max-h-0 opacity-0 group-hover:max-h-20 group-hover:opacity-100 group-focus-within:max-h-20 group-focus-within:opacity-100'
                : ''
            }
          >
            <div className={`mt-1 flex flex-wrap items-center gap-3 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] ${isCompact ? 'text-xs' : 'text-sm'}`}>
              <BrowseStatItem type="likes" icon={ThumbsUp} value={formatCount(mod.likeCount)} title={`${mod.likeCount ?? 0} likes`} />
              <BrowseStatItem type="views" icon={Eye} value={formatCount(mod.viewCount)} title={`${mod.viewCount ?? 0} views`} />
              {mod.submitter && <span className="truncate">by {mod.submitter.name}</span>}
            </div>
            {mod.dateModified > 0 && isModOutdated(mod.dateModified) && (
              <IconText
                icon={AlertTriangle}
                className={`mt-1 max-w-full text-state-warning ${isCompact ? 'text-xs' : 'text-sm'}`}
                iconClassName="browse-meta-icon"
              >
                <span className="truncate">Outdated · {formatDate(mod.dateModified)}</span>
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
              Outdated
            </Tag>
          )}
        </div>
      )}

      {/* Audio preview + volume, pinned to bottom with its own pointer-events layer.
          z-20 keeps it above the gradient + any overlays so clicks always land.
          Single spacious pill: [play + progress + time] | divider | [volume icon + slider] */}
      {isSoundSection && hasAudioPreview && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 ${isCompact ? 'p-2' : 'p-2.5'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 backdrop-blur-md bg-bg-primary/85 rounded-full border border-white/10 px-3 py-2 shadow-lg">
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
            <div className="w-px h-5 bg-white/20 flex-shrink-0" />
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onVolumeChange(volume > 0 ? 0 : 1);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
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
                aria-label="Volume"
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
            className={`flex items-center gap-1.5 rounded-full bg-state-warning/90 hover:bg-state-warning text-bg-primary backdrop-blur-sm ring-1 ring-border shadow-md font-semibold transition-colors cursor-pointer ${isCompact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs'}`}
            title="Enable this mod (currently in your disabled folder)"
          >
            <Power className={isCompact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
            Enable
          </button>
        ) : installed ? (
          <span
            className={`flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md text-state-success ${isCompact ? 'w-7 h-7 text-sm' : 'w-8 h-8 text-base'}`}
            title="Installed and enabled"
          >
            ✓
          </span>
        ) : downloading ? (
          <div className={`flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md ${isCompact ? 'w-7 h-7' : 'w-8 h-8'}`} title="Downloading...">
            <Loader2 className={`animate-spin text-accent ${isCompact ? 'w-4 h-4' : 'w-5 h-5'}`} />
          </div>
        ) : queuePosition ? (
          <div
            className={`flex items-center justify-center bg-accent text-bg-primary rounded-full font-bold ring-1 ring-border shadow-md ${isCompact ? 'w-7 h-7 text-[11px]' : 'w-8 h-8 text-xs'}`}
            title={`Queued #${queuePosition}`}
          >
            {queuePosition}
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onQuickDownload(); }}
            className={`flex items-center justify-center rounded-full bg-bg-primary/85 backdrop-blur-sm ring-1 ring-border shadow-md text-accent hover:bg-accent/20 hover:text-text-primary hover:ring-accent/60 transition-all cursor-pointer ${isCompact ? 'w-7 h-7' : 'w-8 h-8'}`}
            title="Install"
          >
            <Download className={isCompact ? 'w-4 h-4' : 'w-5 h-5'} />
          </button>
        )}
      </div>
      </div>
    </BrowseArtParallaxCard>
  );
}

const MemoizedModCard = React.memo(ModCard, (prev, next) => (
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
  prev.suppressHoverIntent === next.suppressHoverIntent &&
  prev.enableModId === next.enableModId &&
  prev.actionContextKey === next.actionContextKey
));
