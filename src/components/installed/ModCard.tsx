import { canJoinLocalVariantGroup } from '../../lib/localVariantEligibility';
import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { gameBananaCategoryLabel } from '../../lib/gameBananaCategories';
import { RequirementWarning } from '../requirements/RequirementWarning';
import { Loader2, Trash2, AlertTriangle, FolderOpen, FilePlus, Files, ImagePlus, Download, Info, Wrench, Hammer, Layers, Scissors, Share2, Beaker, PowerOff, Tag as TagIcon, MoreHorizontal, Link2, Banana, Fingerprint, ExternalLink, Star, ImageDown, Link, ArrowLeftRight, Rotate3d } from 'lucide-react';
import type { EntrySwapTarget } from '../../lib/modEntries';
import { MenuContent, MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../common/menu';
import { showToast } from '../../stores/toastStore';
import { useAppStore } from '../../stores/appStore';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { modRequirementRefs, requirementKey } from '../../lib/modRequirements';
import { modRestoreKey } from '../../lib/soloRestore';
import { useModBackupsStore } from '../../stores/modBackupsStore';
import { useCategoryStore } from '../../stores/categoryStore';
import { EMPTY_CUSTOM_TAGS, EMPTY_TAG_ORDER, customTagsForMods, useInstalledTagsStore } from '../../stores/installedTagsStore';
import { getInstallationScope } from '../../lib/appSettings';
import { getModBackupIdentity } from '../../lib/modBackupIdentity';
import { restoreModBackup, revealModInFolder } from '../../lib/api';
import { ModBackupsSubmenu } from './ModBackupsSubmenu';
import type { ModConflict } from '../../lib/api';
import type { Mod, GlobalModType } from '../../types/mod';
import { isCardSelectClick } from './selection';
import ModThumbnail from '../ModThumbnail';
import { RevealImage } from '../common/RevealImage';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import PriorityEditor from '../PriorityEditor';
import { getHeroRenderPath, getHeroFacePosition } from '../../lib/lockerUtils';
import { getInstalledGroupTaxonomy, sortInstalledTags } from '../../lib/installedCardTaxonomy';
import { ModTagMenuItems } from './ModTagMenu';
import { formatAbsoluteDate } from '../../lib/dates';
import { formatBytes } from '../../lib/formatBytes';
import { shakeElement } from '../../lib/shakeElement';
import { canOpenImageSource, copyImageToClipboard, resolveImageSource } from '../../lib/imageActions';
import type { ModList } from '../../lib/modLists';
import { ModListSubmenu } from './ModListMenu';
import { Tag, CheckboxMark } from '../common/ui';
import type { InstalledWindowView as ViewMode } from './installedWindowing';
import { HeroIconStack, RepairIssueIcons, FittingTagList, MOD_TAG_CHIP_CLASS, MOD_TAG_SURFACE_CLASS } from './chips';
import { EMPTY_LIST_IDS } from './emptyIds';
import { ModSafetyBadge } from '../ModSafety';
import { CrashAdvisoryBadge } from '../CrashAdvisories';

// Radix only mounts content when its menu opens. A component boundary also
// defers constructing the item tree, including the full locker-tag roster.
function DeferredMenuItems({ children }: { children: () => ReactNode }) {
  return children();
}

interface ModCardProps {
  mod: {
    safety?: Mod['safety'];
    safetyTarget?: Pick<Mod, 'id' | 'name' | 'safety'>;
    crashModIds?: string[];
    outdatedVdata?: Mod['outdatedVdata'];
    /** Group cards: whether the flagged variant is the enabled one. Defaults to `enabled`. */
    outdatedVdataEnabled?: boolean;
    staleModels?: Mod['staleModels'];
    id: string;
    metaKey?: string;
    name: string;
    fileName: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    thumbnailUrl?: string;
    movementFx?: Mod['movementFx'];
    audioUrl?: string;
    sourceSection?: string;
    categoryId?: number;
    categoryName?: string;
    nsfw?: boolean;
    gameBananaId?: number;
    sha256?: string;
    skinEdit?: Mod['skinEdit'];
    localGroupId?: string;
    localImport?: boolean;
    isUnknown?: boolean;
    lockerHero?: string;
    lockerHeroSource?: Mod['lockerHeroSource'];
    lockerHeroes?: string[];
    tagOverrides?: Mod['tagOverrides'];
    detectedTags?: Mod['detectedTags'];
    globalType?: GlobalModType;
    /** Lives in the citadel/grimoire priority root: wins every file collision
     *  and is never disabled by the launch shuffle. */
    priorityMod?: boolean;
    merged?: import('../../types/mod').MergedModInfo;
    /** Came from deadlockforge.net over the local install bridge. Drives the
     *  DeadlockForge badge, since these mods have no remote thumbnail. */
    forgeInstall?: import('../../types/mod').ForgeInstallInfo;
  };
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  conflicts: ModConflict[];
  soundVolume: number;
  updateAvailable?: boolean;
  /** Absorbed merge sources whose GameBanana file was replaced or removed. */
  staleSourceCount?: number;
  /** The part of `staleSourceCount` the merged-contents dialog can update.
   *  The rest need a manual extract or unmerge. */
  updatableSourceCount?: number;
  onOpenDetails?: () => void;
  /** The card opens local files rather than a GameBanana page. */
  opensPicker?: boolean;
  /** A local import that carries a GameBanana id: its page stays reachable from the menu. */
  onViewModPage?: () => void;
  onOpenDoorStuck?: () => void;
  /** Pins this card in the 3D preview panel. */
  onPinPreview?: () => void;
  previewMetaKey?: string;
  /** Files the Alt preview can cycle through with the wheel, in picker order. */
  previewKeys?: string[];
  /** Open the mod author's GameBanana profile in the browser. Undefined for
   *  local mods with no GameBanana source. */
  onViewAuthor?: () => void;
  onToggle: () => Promise<boolean> | void;
  swapTargets?: readonly EntrySwapTarget[];
  onSwap?: (outgoingEntryKey: string) => Promise<void>;
  /** Disable every other mod, enable only this one, and launch the game. Used
   *  for A/B testing a single skin. */
  onSoloLaunch?: () => void;
  soloBusy?: boolean;
  onDelete: () => void;
  /** Import local VPKs as variants of this mod. */
  onAddVariant?: () => void;
  /** Open the imprint details modal. Passed only when the mod's wire
   *  `imprinted` flag is true (the parent gates on it); shown in the card's
   *  right-click menu. */
  onViewImprint?: () => void;
  onSetTags?: (tags: Mod['tagOverrides'] | null) => void | Promise<void>;
  onFixUnknown?: () => void;
  fixingUnknown?: boolean;
  /** Reposition commit. Passed through to PriorityEditor; the argument is a
   *  1-based global load-order position, applied via a dense reorder. */
  onCommitPriority?: (newPosition: number) => Promise<void>;
  /** This mod's 1-based global load-order position, shown on the badge. */
  loadPosition?: number;
  /** Count of enabled mods (the badge editor's max position). */
  loadCount?: number;
  /** Open the unmerge confirm flow. Only meaningful when `mod.merged` is set. */
  onUnmerge?: () => void;
  /** Copy the merged mod's share code to the clipboard. */
  onCopyShareCode?: () => void;
  /** When true, the card renders a selection checkbox overlay and clicks
   *  anywhere on the card route to `onSelectToggle` instead of opening
   *  details / firing toggle / delete. */
  selectMode?: boolean;
  shiftHeld?: boolean;
  selected?: boolean;
  onSelectToggle?: React.MouseEventHandler<HTMLElement>;
  /** Personal pin, settable from either section, but it only reorders the
   *  disabled section (favorites sort ahead of other disabled entries). The
   *  enabled section is real load order, so starring an enabled card is a pure
   *  marker: it takes effect once the entry is disabled. */
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** User lists, for the right-click "Add to list" submenu. Organization only:
   *  membership never enables, disables, or reorders anything. */
  lists?: readonly ModList[];
  listIds?: readonly string[];
  onToggleList?: (listId: string) => void;
  onCreateList?: () => void;
  entryKey?: string;
  /** Present when this card represents grouped files that are variants of one
   *  mod (a GameBanana submission, or a locally imported multi-VPK archive).
   *  Swaps the filename meta for an enabled/total count and adds a "Choose
   *  files" action that opens the picker modal. */
  group?: {
    variants?: readonly Mod[];
    variantCount: number;
    /** Enabled file labels for this group. Empty when fully disabled. */
    enabledCount: number;
    enabledLabels: string[];
    onOpenPicker: () => void;
    /** Opens the group's GameBanana page. Absent for a local group. */
    onViewDetails?: () => void;
    /** `onOpenDetails` (the card click) opens the picker, not a details page. */
    opensPicker?: boolean;
  };
}

interface ModMediaPreviewProps {
  mod: ModCardProps['mod'];
  heroName?: string;
  hideNsfwPreviews: boolean;
  soundVolume: number;
  overlayBadges: ReactNode;
  mediaSpacingClasses: string;
  mediaFrameClasses: string;
  audioOverlayClasses: string;
  audioPlayerClassName: string;
  onOpenDetails?: () => void;
  opensPicker: boolean;
}

function SoundPlaceholder() {
  const { t } = useTranslation();
  const bars = [6, 10, 15, 21, 27, 19, 13, 23, 29, 18, 11, 16, 24];
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary text-text-secondary">
      <div className="flex h-8 items-end gap-1 opacity-70">
        {bars.map((height, index) => (
          <span
            key={index}
            className="w-1 rounded-full bg-accent/70"
            style={{ height }}
          />
        ))}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-secondary/80">
        {t('installed.card.soundPreview')}
      </span>
    </div>
  );
}

function stopMediaDrag(e: React.DragEvent<HTMLElement>) {
  e.preventDefault();
  e.stopPropagation();
}

function ModMediaPreview({
  mod,
  heroName,
  hideNsfwPreviews,
  soundVolume,
  overlayBadges,
  mediaSpacingClasses,
  mediaFrameClasses,
  audioOverlayClasses,
  audioPlayerClassName,
  onOpenDetails,
  opensPicker,
}: ModMediaPreviewProps) {
  const { t } = useTranslation();
  const isSound = mod.sourceSection === 'Sound' && !!mod.audioUrl;
  const canOpen = !!onOpenDetails;
  // Desaturate + dim the cover art for disabled mods so an "off" card reads
  // differently at a glance. Applied to a wrapper around the media only, so
  // overlay badges (Disabled/Update/Conflict) keep their color.
  const mediaDisabledClass = mod.enabled
    ? ''
    : 'grayscale-[0.6] opacity-[0.7] transition-[filter,opacity] duration-200';
  const detailsLabel = canOpen ? (opensPicker ? t('installed.card.chooseFilesFor', { name: mod.name }) : t('installed.card.viewDetailsFor', { name: mod.name })) : undefined;
  // Prefer an explicit mod thumbnail. For sound-only mods without one, fall
  // back to the inferred hero render before using the waveform placeholder.
  const soundHeroName = isSound && !mod.thumbnailUrl
    ? heroName
    : null;
  const soundHeroRenderUrl = soundHeroName ? getHeroRenderPath(soundHeroName) : null;
  const soundHeroFacePosX = soundHeroName ? getHeroFacePosition(soundHeroName).x : 50;
  const image = (
    <ModThumbnail
      src={mod.thumbnailUrl}
      movementFx={mod.movementFx}
      alt={mod.name}
      nsfw={mod.nsfw}
      hideNsfw={hideNsfwPreviews}
      className="w-full h-full"
      enableImageContextMenu={false}
      imageClassName="installed-card-media-zoom origin-center transition-transform duration-200 group-enabled:group-installed-hover:scale-[1.03]"
      mergedSources={mod.merged?.sources}
      forgeInstalled={!!mod.forgeInstall}
    />
  );
  const soundMedia = mod.thumbnailUrl ? image : soundHeroRenderUrl ? (
    <RevealImage
      src={soundHeroRenderUrl}
      alt={soundHeroName ?? mod.name}
      draggable={false}
      className="installed-card-media-zoom block h-full w-full object-cover origin-center transition-transform duration-200 group-enabled:group-installed-hover:scale-[1.03]"
      style={{ objectPosition: `${soundHeroFacePosX}% 25%` }}
    />
  ) : (
    <SoundPlaceholder />
  );

  if (!isSound) {
    return (
      <div className={`group relative w-full ${mediaFrameClasses} ${mediaSpacingClasses}`}>
      {/* The frame is the button, not the wrapper: its focus ring must not be
          clipped, and the image zoom keys on the button's :enabled state. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className="group absolute inset-0 h-full w-full overflow-hidden rounded-lg border border-hl/[0.08] bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
        aria-label={detailsLabel}
        data-card-action="true"
        data-mod-drag-surface
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{image}</div>
        {canOpen && (
          <div className="installed-card-media-overlay pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-installed-hover:bg-bg-primary/20" />
        )}
      </button>
      {overlayBadges}
      </div>
    );
  }

  return (
    <div className={`group relative w-full ${mediaFrameClasses} overflow-hidden rounded-lg bg-bg-tertiary border border-hl/[0.08] ${mediaSpacingClasses}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className="absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
        aria-label={detailsLabel}
        data-card-action="true"
        data-mod-drag-surface
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{soundMedia}</div>
        {(mod.thumbnailUrl || soundHeroRenderUrl) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg-primary/80 via-bg-primary/25 to-transparent" />
        )}
        {canOpen && (
          <div className="installed-card-media-overlay pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-installed-hover:bg-bg-primary/15" />
        )}
      </button>
      {overlayBadges}
      <div
        className={audioOverlayClasses}
        data-card-action="true"
        data-mod-drag-ignore
        draggable={false}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onDragStart={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <AudioPreviewPlayer
          src={mod.audioUrl!}
          compact
          variant="inline"
          volume={soundVolume}
          className={audioPlayerClassName}
        />
      </div>
    </div>
  );
}

function InstalledTaxonomyChips({
  taxonomy,
  className,
}: {
  taxonomy: ReturnType<typeof getInstalledGroupTaxonomy>;
  className: string;
}) {
  const { t } = useTranslation();
  const labels = useMemo(() => taxonomy.tags.map(label => gameBananaCategoryLabel(label, t)), [taxonomy.tags, t]);
  return (
    <>
      <HeroIconStack heroes={taxonomy.heroNames} />
      <FittingTagList labels={labels} chipClassName={className} />
    </>
  );
}

function MergeSourceUpdateTag({ staleCount, updatableCount, variant }: {
  staleCount: number;
  updatableCount: number;
  variant: 'overlay' | 'inline';
}) {
  const { t } = useTranslation();
  if (staleCount === 0 && updatableCount === 0) return null;
  const manualCount = Math.max(0, staleCount - updatableCount);
  const title = [
    updatableCount > 0 && t('mergedContents.staleSourcesUpdatable', { count: updatableCount }),
    manualCount > 0 && t('installed.card.staleSourcesTitle', { count: manualCount }),
  ].filter(Boolean).join('\n');
  return <Tag tone="update" variant={variant} icon={Download} className="uppercase tracking-wide"
    title={title}>
    {t('profiles.actions.update')}
  </Tag>;
}

export function ModCard({
  mod,
  viewMode,
  hideNsfwPreviews,
  conflicts,
  soundVolume,
  updateAvailable,
  staleSourceCount = 0,
  updatableSourceCount = 0,
  onOpenDetails,
  opensPicker = false,
  onViewModPage,
  onOpenDoorStuck,
  onPinPreview,
  previewMetaKey,
  previewKeys,
  onViewAuthor,
  onToggle,
  swapTargets = [],
  onSwap,
  onSoloLaunch,
  soloBusy = false,
  onDelete,
  onAddVariant,
  onViewImprint,
  onSetTags,
  onFixUnknown,
  fixingUnknown,
  onCommitPriority,
  loadPosition,
  loadCount,
  onUnmerge,
  onCopyShareCode,
  selectMode,
  shiftHeld = false,
  selected,
  onSelectToggle,
  favorite = false,
  onToggleFavorite,
  lists,
  listIds = EMPTY_LIST_IDS,
  onToggleList,
  onCreateList,
  entryKey,
  group,
}: ModCardProps) {
  const { t } = useTranslation();
  const pointerInside = useRef(false);
  const menuKeyboard = useRef(false);
  const menuFocusProps = {
    onKeyDownCapture: () => { menuKeyboard.current = true; },
    onPointerDownCapture: () => { menuKeyboard.current = false; },
    // Mouse actions need no focus restore; keyboard dismissal returns to the trigger.
    onCloseAutoFocus: (event: Event) => { if (!menuKeyboard.current) event.preventDefault(); },
  };
  const hasRequirements = useRequirementsStore(state => (group?.variants ?? [mod]).some(variant =>
    !!variant.skinEdit?.sources.length || modRequirementRefs(variant).some(ref => {
      const snapshot = state.snapshots[requirementKey(ref)];
      return snapshot?.status === 'loaded' && snapshot.items.length > 0;
    })));
  const cardRef = useRef<HTMLDivElement>(null);
  const backups = useModBackupsStore((state) => state.backups);
  const backupIdentity = getModBackupIdentity(mod, mod.fileName, mod.name);
  const modBackups = backups.filter((backup) => backup.identityKey === backupIdentity);
  const [backupBusy, setBackupBusy] = useState(false);
  const setBackupToDelete = useModBackupsStore((state) => state.setDeleteTarget);
  const heroByCategoryId = useCategoryStore((state) => state.heroByCategoryId);
  const heroNames = useCategoryStore((state) => state.heroNames);
  const pathsByModel = useCategoryStore((state) => state.pathsByModel);
  const taxonomyContext = useMemo(() => ({ heroByCategoryId, heroNames, pathsByModel }), [heroByCategoryId, heroNames, pathsByModel]);
  const tagScope = useAppStore(state => getInstallationScope(state.settings));
  const revealNsfwOnHover = useAppStore(state => state.settings?.revealNsfwOnHover ?? false);
  const customTags = useInstalledTagsStore(state => tagScope ? state.byScope[tagScope] ?? EMPTY_CUSTOM_TAGS : EMPTY_CUSTOM_TAGS);
  const tagOrder = useInstalledTagsStore(state => tagScope ? state.orderByScope[tagScope] ?? EMPTY_TAG_ORDER : EMPTY_TAG_ORDER);
  const assignedCustomTags = customTagsForMods(customTags, group?.variants ?? [mod]);
  const baseTaxonomy = getInstalledGroupTaxonomy(mod, group?.variants ?? [mod], taxonomyContext);
  const cardTags = sortInstalledTags([
    ...assignedCustomTags.sort((a, b) => a.name.localeCompare(b.name)).map(tag => ({ key: `custom:${tag.id}`, label: tag.name })),
    ...baseTaxonomy.tags.map(label => ({ key: `tag:${label.toLowerCase()}`, label })),
  ], tagOrder);
  const cardTaxonomy = { ...baseTaxonomy, tags: [...new Set(cardTags.map(tag => tag.label))] };
  const restoreBackup = async (backupId: string) => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      await restoreModBackup(backupId);
      await useAppStore.getState().loadMods({ silent: true, force: true });
      showToast(t('installed.backups.restored'), { tone: 'success' });
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), { tone: 'error' });
    } finally {
      setBackupBusy(false);
    }
  };
  const [hovered, setHovered] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const swapInFlight = useRef(false);
  // Ordinary hover is styled by CSS. Only Shift-selection needs React state.
  // Remember the pointer separately so pressing Shift over a stationary card
  // still shows the preview before paint.
  useLayoutEffect(() => {
    setHovered(shiftHeld && !selectMode && pointerInside.current);
  }, [shiftHeld, selectMode]);
  const selectionPreview = shiftHeld && hovered && !selectMode;
  const hasConflicts = conflicts.length > 0;
  const handleRevealInFolder = () => {
    revealModInFolder(mod.id).catch((err) => {
      console.error('[Installed] Failed to reveal mod in folder:', err);
    });
  };
  const hasListActions = !selectMode && !!lists && !!onToggleList && !!onCreateList;
  const menuHeroName = mod.sourceSection === 'Sound' && !mod.thumbnailUrl
    ? cardTaxonomy.previewHeroName
    : null;
  // Right-clicking one tile of a merged mod's collage should act on that tile,
  // not on the merged mod's first source. Captured from the pointer target
  // before Radix opens the context menu, and cleared both when that menu closes
  // and when the three-dot button opens the same actions instead.
  const [pointerImageSrc, setPointerImageSrc] = useState<string | null>(null);
  const rawCardImageSource = pointerImageSrc
    ?? mod.thumbnailUrl
    ?? (menuHeroName ? getHeroRenderPath(menuHeroName) : undefined)
    ?? mod.merged?.sources.find((source) => !!source.thumbnailUrl)?.thumbnailUrl;
  const cardImageSource = rawCardImageSource && !(mod.nsfw && hideNsfwPreviews)
    ? resolveImageSource(rawCardImageSource)
    : null;
  const canOpenCardImage = cardImageSource ? canOpenImageSource(cardImageSource) : false;
  const captureContextImage = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const cell = target?.closest?.('[data-collage-src]');
    setPointerImageSrc(cell?.getAttribute('data-collage-src') ?? null);
  };
  const variantStatusLabel = group ? `${group.enabledCount}/${group.variantCount}` : null;
  const enabledTitle = group?.enabledLabels.join(', ') ?? '';
  const variantStatusTitle = !group
    ? ''
    : group.opensPicker
      ? t('installed.card.variantStatusTitle', { labels: enabledTitle || t('installed.card.noFilesEnabled') })
      : t('installed.card.variantFilesTitle', { labels: enabledTitle || t('installed.card.noFilesEnabled') });
  const [menuBusy, setMenuBusy] = useState(false);

  // The menu closes on select (Radix default), so outcomes are reported by
  // toast rather than by a banner inside a panel the user can no longer see.
  const reportMenuError = (context: string, err: unknown) => {
    console.error(`[Installed] ${context}:`, err);
    showToast(err instanceof Error ? err.message : String(err), { tone: 'error', duration: 4000 });
  };

  const copyCardImage = async () => {
    if (!cardImageSource) return;
    try {
      await copyImageToClipboard(cardImageSource);
      showToast(t('imageContextMenu.imageCopied'), { tone: 'success', duration: 2200 });
    } catch (err) {
      console.error('[Installed] Failed to copy card image:', err);
      showToast(t('imageContextMenu.copyImageFailed'), { tone: 'error', duration: 4000 });
    }
  };

  const copyCardImageAddress = async () => {
    if (!cardImageSource) return;
    try {
      await navigator.clipboard.writeText(cardImageSource);
      showToast(t('imageContextMenu.addressCopied'), { tone: 'success', duration: 2200 });
    } catch (err) {
      console.error('[Installed] Failed to copy card image address:', err);
      showToast(t('imageContextMenu.copyAddressFailed'), { tone: 'error', duration: 4000 });
    }
  };

  const openCardImage = () => {
    if (!cardImageSource) return;
    window.open(cardImageSource, '_blank', 'noopener,noreferrer');
  };

  const applyTags = async (tags: Mod['tagOverrides'] | null, clearCustom = false) => {
    if (!onSetTags || menuBusy) return;
    setMenuBusy(true);
    try {
      await onSetTags(tags);
      if (clearCustom && tagScope) useInstalledTagsStore.getState().clearForMods(tagScope, group?.variants ?? [mod]);
    } catch (err) {
      reportMenuError('Failed to set mod tags', err);
    } finally {
      setMenuBusy(false);
    }
  };

  // Glass surface for grid/compact cards: a translucent base over which a
  // blurred copy of the cover art (see glassBackdropUrl) bleeds, so the card
  // is tinted by its own thumbnail.
  const glassStateClasses = hasConflicts
    ? 'border-state-warning/45 bg-state-warning/[0.07] premium-card-glow premium-card-glow-warning'
    : mod.enabled
      ? 'premium-glass-card premium-card-glow-active'
      : 'premium-glass-card opacity-85';

  // Merged mods get a "stacked card" silhouette via two offset box-shadows
  // that read as cards-behind-the-card. Uses only neutral surface/border
  // tokens so it stays correct under any accent color the user picks.
  // Suppressed in compact view (cards are too small for the offset to look
  // intentional).
  const mergedStackShadow =
    mod.merged && viewMode === 'grid'
      ? 'shadow-[3px_3px_0_0_var(--color-bg-secondary),3px_3px_0_1px_var(--color-border),6px_6px_0_0_var(--color-bg-secondary),6px_6px_0_1px_var(--color-border)] mr-1.5 mb-1.5'
      : '';
  const chipMaxClass =
    viewMode === 'compact' ? 'max-w-[132px]' : 'max-w-[170px]';
  const baseChipClasses = `${MOD_TAG_CHIP_CLASS} ${chipMaxClass}`;
  const metaChipClasses = `${baseChipClasses} ${MOD_TAG_SURFACE_CLASS}`;
  const utilityActionClasses = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-all duration-200 hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 cursor-pointer disabled:opacity-60';
  // Keyboard focus reveals actions without leaving mouse-clicked buttons visible.
  // Invisible buttons cannot receive pointer clicks, but remain reachable with Tab.
  const hoverRevealClasses = 'installed-card-hover-action opacity-0 pointer-events-none group-installed-hover/card:opacity-90 group-installed-hover/card:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto';
  const hoverActionVisibilityClasses = hoverRevealClasses;
  const toggleHitboxClasses = 'inline-flex h-7 w-12 items-center justify-center rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary';
  const toggleTrackClasses = `relative h-6 w-11 rounded-full transition-colors duration-200 ${
    mod.enabled ? 'bg-accent shadow-[0_0_0_1px_rgba(255,122,47,0.25)]' : 'bg-bg-tertiary border border-border group-hover/toggle:border-hl/20'
  }`;
  const isCompact = viewMode === 'compact';
  const quickActionSizeClasses = '@max-[240px]/installed-card:hidden';
  // Cover-art source for the glass backdrop. Skipped when NSFW previews are
  // hidden so we never bleed hidden imagery, even blurred.
  const glassBackdropUrl =
    mod.thumbnailUrl && !(mod.nsfw && hideNsfwPreviews)
      ? mod.thumbnailUrl
      : null;
  const shellClasses = 'flex h-full flex-col gap-0 p-2';
  const mediaSpacingClasses = isCompact ? 'mb-2' : 'mb-1.5';
  const mediaFrameClasses = isCompact ? 'h-[116px]' : 'aspect-video';
  const audioOverlayClasses = isCompact
    ? 'absolute bottom-2 left-2 right-2 z-20 flex h-[30px] cursor-pointer items-center rounded-md border border-hl/[0.10] bg-bg-secondary/85 px-2 shadow-sm [&_*]:cursor-pointer'
    : 'absolute bottom-2.5 left-3 right-3 z-20 flex h-[34px] cursor-pointer items-center rounded-md border border-hl/[0.10] bg-bg-secondary/85 px-2.5 shadow-sm [&_*]:cursor-pointer';
  const audioPlayerClassName = isCompact
    ? 'w-full gap-2 [&>button:first-of-type]:h-6 [&>button:first-of-type]:w-6 [&>div]:h-1 [&>span]:text-[10px]'
    : 'w-full gap-2.5 [&>button:first-of-type]:h-7 [&>button:first-of-type]:w-7 [&>div]:h-1 [&>span]:text-[10px]';
  const titleClasses = isCompact
    ? 'text-[14px] font-semibold leading-[18px] truncate'
    : 'text-[15px] font-medium leading-[18px] truncate';
  const favoriteMenuLabel = favorite
    ? t('installed.card.unfavorite')
    : t('installed.card.favorite');

  // One canonical list of card actions, shared by the right-click (context)
  // root wrapping the card and dropdown root on the three-dot button.
  // Construct it only when Radix mounts the open menu, rather than on every
  // closed card's render.
  // A group card's click may open the picker, so its "View details" has its own handler.
  const localMod = canJoinLocalVariantGroup(mod);
  const localGroup = !!group && localMod;
  const viewDetails = localMod ? group?.onOpenPicker ?? onOpenDetails : group ? group.onViewDetails : onOpenDetails;
  const hasTopActions =
    !!(onAddVariant && localMod) || !!onOpenDetails || !!onViewAuthor || !!(onViewModPage && localMod)
    || !!cardImageSource || !!group;
  const hasSecondaryActions =
    !!onSoloLaunch || !!onFixUnknown
    || !!(mod.merged && (onCopyShareCode || onUnmerge));
  const renderCardMenuItems = () => (
    <>
      {onAddVariant && localMod && (
        <MenuItem icon={FilePlus} onSelect={onAddVariant}>
          {t('installed.card.addVariant')}
        </MenuItem>
      )}
      {viewDetails && (
        <MenuItem icon={Info} onSelect={viewDetails}>
          {localMod ? t('installed.card.chooseFiles') : t('installed.card.viewDetails')}
        </MenuItem>
      )}
      {localMod && onViewModPage && (
        <MenuItem icon={ExternalLink} onSelect={onViewModPage}>
          {t('installed.card.viewDetails')}
        </MenuItem>
      )}
      {group && !localGroup && (
        <MenuItem icon={Files} onSelect={group.onOpenPicker}>
          {t('installed.card.chooseFiles')}
        </MenuItem>
      )}
      {hasRequirements && (
        <MenuItem icon={Link2} onSelect={() => {
          const mods = useAppStore.getState().mods;
          const owner = mods.find(candidate => candidate.id === mod.id);
          if (!owner) return;
          const key = modRestoreKey(owner);
          void useRequirementsStore.getState().load(mods.flatMap(modRequirementRefs)).then(() => {
            const current = useAppStore.getState().mods;
            const owner = current.find(candidate => modRestoreKey(candidate) === key);
            if (owner) useRequirementsStore.getState().manage(owner, current);
          });
        }}>{t('requirements.manageTitle')}</MenuItem>
      )}
      {mod.merged && updatableSourceCount > 0 && onOpenDetails && (
        <MenuItem icon={Download} onSelect={onOpenDetails}>
          {t('mergedContents.updateSources', { count: updatableSourceCount })}
        </MenuItem>
      )}
      {onViewAuthor && (
        <MenuItem icon={Banana} onSelect={onViewAuthor}>
          {t('installed.card.viewAuthorPage')}
        </MenuItem>
      )}
      {cardImageSource && (
        <MenuSub>
          <MenuSubTrigger icon={ImagePlus}>{t('imageContextMenu.image')}</MenuSubTrigger>
          <MenuSubContent>
            <MenuItem icon={ImageDown} onSelect={() => void copyCardImage()}>
              {t('imageContextMenu.copyImage')}
            </MenuItem>
            <MenuItem icon={Link} onSelect={() => void copyCardImageAddress()}>
              {t('imageContextMenu.copyImageAddress')}
            </MenuItem>
            {canOpenCardImage && (
              <MenuItem icon={ExternalLink} onSelect={openCardImage}>
                {t('imageContextMenu.openImage')}
              </MenuItem>
            )}
          </MenuSubContent>
        </MenuSub>
      )}
      <ModBackupsSubmenu
        backups={modBackups}
        busy={backupBusy}
        onRestore={(backupId) => void restoreBackup(backupId)}
        onDelete={setBackupToDelete}
      />
      {(hasTopActions || modBackups.length > 0) && <MenuSeparator />}
      {onToggleFavorite && (
        <MenuItem icon={Star} onSelect={onToggleFavorite}>
          {favoriteMenuLabel}
        </MenuItem>
      )}
      {onSetTags && <MenuSub>
        <MenuSubTrigger icon={TagIcon}>{t('installed.tag.setTags')}</MenuSubTrigger>
        <MenuSubContent className="max-h-72 max-w-72 overflow-y-auto">
          <DeferredMenuItems>{() => {
            return <ModTagMenuItems mod={mod} variants={group?.variants ?? [mod]} disabled={menuBusy} onApply={applyTags} />;
          }}</DeferredMenuItems>
        </MenuSubContent>
      </MenuSub>}
      {hasListActions && lists && onToggleList && onCreateList && (
        <ModListSubmenu
          lists={lists}
          memberIds={listIds}
          onToggle={onToggleList}
          onCreateNew={onCreateList}
        />
      )}
      {hasListActions && <MenuSeparator />}
      <MenuItem icon={FolderOpen} onSelect={handleRevealInFolder}>
        {t('installed.card.revealInFolder')}
      </MenuItem>
      {onAddVariant && !localMod && (
        <MenuItem icon={FilePlus} onSelect={onAddVariant}>
          {t('installed.card.addVariant')}
        </MenuItem>
      )}
      {onViewImprint && (
        <MenuItem icon={Fingerprint} onSelect={onViewImprint}>
          {t('installed.imprintDetails.menuEntry')}
        </MenuItem>
      )}
      {onPinPreview && <MenuItem icon={Rotate3d} onSelect={onPinPreview}>{t('installed.card.pinPreview')}</MenuItem>}
      {onOpenDoorStuck && <MenuItem icon={Hammer} onSelect={onOpenDoorStuck}>{t('installed.card.openDoorStuck')}</MenuItem>}
      {hasSecondaryActions && <MenuSeparator />}
      {onSoloLaunch && (
        <MenuItem icon={Beaker} disabled={soloBusy} onSelect={onSoloLaunch}>
          {t('installed.card.soloLaunch')}
        </MenuItem>
      )}
      {onFixUnknown && (
        <MenuItem
          icon={fixingUnknown ? Loader2 : mod.isUnknown ? Wrench : Link2}
          spinning={fixingUnknown}
          onSelect={onFixUnknown}
        >
          {mod.isUnknown ? t('installed.card.fixUnknownMatch') : t('installed.unknown.linkToGamebanana')}
        </MenuItem>
      )}
      {mod.merged && onCopyShareCode && (
        <MenuItem icon={Share2} onSelect={onCopyShareCode}>
          {t('installed.merge.copyShareCode')}
        </MenuItem>
      )}
      {mod.merged && onUnmerge && (
        <MenuItem icon={Scissors} onSelect={onUnmerge}>
          {t('installed.merge.unmerge')}
        </MenuItem>
      )}
      {/* A merged mod is removed via Unmerge (which deletes the merged VPK
          and restores its sources), so a raw Delete alongside it would be
          redundant and confusing. Non-merged mods keep Delete. */}
      {!mod.merged && (
        <>
          <MenuSeparator />
          <MenuItem icon={Trash2} tone="danger" onSelect={onDelete}>
            {t('common.actions.delete')}
          </MenuItem>
        </>
      )}
    </>
  );

  const runSwap = async (key: string) => {
    if (!onSwap || swapInFlight.current) return;
    swapInFlight.current = true;
    setSwapping(true);
    try { await onSwap(key); }
    catch (error) { showToast(String(error), { tone: 'error' }); }
    finally { swapInFlight.current = false; setSwapping(false); }
  };
  const chooseSwapTarget = swapTargets.length > 1 || cardTaxonomy.heroNames.length > 1;
  const swapButton = <button type="button" disabled={swapping} aria-busy={swapping || undefined}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation();
      if (!chooseSwapTarget && swapTargets[0]) void runSwap(swapTargets[0].key);
    }}
    className={`${utilityActionClasses} ${hoverActionVisibilityClasses} aria-expanded:opacity-100 aria-expanded:pointer-events-auto disabled:cursor-default`}
    title={t('installed.swap.action', { name: mod.name })} aria-label={t('installed.swap.action', { name: mod.name })}
    data-card-action="true" data-mod-swap>
    {swapping ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
  </button>;

  const actions = (selectMode || selectionPreview) ? (
    <div className={`${toggleHitboxClasses} justify-end!`}><CheckboxMark checked={!!selected} className="h-6! w-6! [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-accent-foreground" /></div>
  ) : (
    <div className="ml-auto flex items-center gap-1">
      {/* Small cards keep Delete in the menu so taxonomy chips have room. */}
      {!mod.merged && !isCompact && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={`${utilityActionClasses} ${quickActionSizeClasses} ${hoverActionVisibilityClasses} text-state-danger hover:bg-state-danger/10 hover:text-state-danger focus-visible:ring-state-danger/60`}
          title={t('installed.card.deleteNamed', { name: mod.name })}
          aria-label={t('installed.card.deleteNamed', { name: mod.name })}
          data-card-action="true"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      <div className="relative flex" data-card-action="true">
        <MenuRoot kind="dropdown" onOpenChange={(open) => { if (open) setPointerImageSrc(null); }}>
          <MenuTrigger asChild disabled={selectMode}>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`${utilityActionClasses} ${selectMode ? 'hidden' : `${hoverRevealClasses} aria-expanded:opacity-100 aria-expanded:pointer-events-auto`}`}
              title={t('installed.card.moreActions')}
              aria-label={t('installed.card.moreActionsFor', { name: mod.name })}
              data-card-action="true"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </MenuTrigger>
          <MenuContent {...menuFocusProps} className="max-h-[70vh] overflow-y-auto" data-card-menu-open>
            <DeferredMenuItems>{renderCardMenuItems}</DeferredMenuItems>
          </MenuContent>
        </MenuRoot>
      </div>
      {!mod.enabled && !selectMode && cardTaxonomy.heroNames.length > 0 && swapTargets.length > 0 && onSwap && (
        chooseSwapTarget ? <MenuRoot kind="dropdown" open={swapOpen} onOpenChange={setSwapOpen}>
          <MenuTrigger asChild>{swapButton}</MenuTrigger>
          <MenuContent {...menuFocusProps} side="bottom" align="end" className="max-h-[50vh] max-w-80 overflow-y-auto" data-swap-menu>
            <MenuLabel>{t('installed.swap.choose')}</MenuLabel>
            <DeferredMenuItems>{() => swapTargets.map(target => <MenuItem key={target.key}
              leading={<span className="flex h-[22px] w-[66px] shrink-0 items-center" aria-hidden><HeroIconStack heroes={target.heroNames} /></span>}
              disabled={swapping} title={target.name} onSelect={() => { void runSwap(target.key); }}>{target.name}</MenuItem>)}</DeferredMenuItems>
          </MenuContent>
        </MenuRoot> : swapButton
      )}
        <button
          onClick={async () => {
            const toggled = await onToggle();
            if (mod.enabled && toggled === false) shakeElement(cardRef.current);
          }}
          aria-pressed={mod.enabled}
          aria-label={mod.enabled ? t('installed.card.disableMod') : t('installed.card.enableMod')}
          title={mod.enabled ? t('installed.card.disableMod') : t('installed.card.enableMod')}
          className={`${toggleHitboxClasses} group/toggle`}
          data-card-action="true"
        >
          <span className={toggleTrackClasses} aria-hidden>
            <span
              className={`absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                mod.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
    </div>
  );
  // Isolate the negative-z backdrop without forcing a GPU surface per card.
  return (
    <MenuRoot onOpenChange={(open) => { if (!open) setPointerImageSrc(null); }}>
      {/* Disabled in select mode so right-click doesn't fight the full-card
          select overlay. The thumbnail's own image menu is switched off on
          cards (enableImageContextMenu={false}), so artwork right-clicks reach
          this one rather than a second, image-only menu. */}
      <MenuTrigger asChild disabled={selectMode}>
    <div
      ref={cardRef}
      data-mod-entry-key={entryKey}
      data-selected={selected || undefined}
      data-mod-preview-key={previewMetaKey ?? mod.metaKey}
      data-mod-preview-variants={previewKeys && previewKeys.length > 1 ? JSON.stringify(previewKeys) : undefined}
      data-nsfw-hover-reveal={revealNsfwOnHover || undefined}
      onKeyDownCapture={menuFocusProps.onKeyDownCapture}
      onPointerDownCapture={menuFocusProps.onPointerDownCapture}
      onPointerEnter={() => {
        pointerInside.current = true;
        if (shiftHeld && !selectMode) setHovered(true);
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        if (shiftHeld && !selectMode) setHovered(false);
      }}
      onClickCapture={(event) => {
        if (!selectMode && event.shiftKey && onSelectToggle && isCardSelectClick(event.currentTarget, event.target)) {
          event.preventDefault();
          event.stopPropagation();
          onSelectToggle(event);
        }
      }}
      onContextMenu={captureContextImage}
      className={`installed-card @container/installed-card group/card relative isolate rounded-xl border ${glassStateClasses} ${mergedStackShadow} ${updateAvailable ? 'update-stripes' : ''} ${shellClasses}`}
    >
      <div>
        {(selectMode || selectionPreview) && (
        <>
          {/* Full-card click target. Sits above thumbnail button, toggle, and
              delete (their non-positioned containers stack below this absolute
              z-30 element) so every click in select mode lands here. */}
          <button
            type="button"
            onClick={onSelectToggle}
            className="absolute inset-0 z-30 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
            aria-label={selected ? t('installed.card.deselectNamed', { name: mod.name }) : t('installed.card.selectNamed', { name: mod.name })}
            aria-pressed={!!selected}
          />

        </>
        )}

        {glassBackdropUrl && (
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl">
            <RevealImage
              src={glassBackdropUrl}
              alt=""
              aria-hidden
              draggable={false}
              skeleton={false}
              className={`h-full w-full scale-[1.35] object-cover blur-2xl saturate-[1.4] transition-opacity duration-200 ${
                mod.enabled ? 'opacity-55' : 'opacity-30 grayscale-[0.4]'
              }`}
            />
            <div className="absolute inset-0 scrim-bottom" />
          </div>
        )}
        {(() => {
        const overlayBadges = (
          <div className="always-dark pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
            {mod.enabled && !mod.priorityMod && (
              <div className="pointer-events-auto flex h-5 shrink-0 items-start" data-card-action="true">
                <PriorityEditor
                  modName={mod.name}
                  value={loadPosition ?? mod.priority}
                  max={loadCount ?? 99}
                  variant="overlay"
                  onCommit={selectMode || selectionPreview ? undefined : onCommitPriority}
                />
              </div>
            )}
            {!mod.enabled && (
              <div className="pointer-events-auto flex shrink-0 flex-col items-start gap-1">
                <Tag tone="neutral" variant="overlay" icon={PowerOff} title={t('locker.global.disabledBadgeTitle')}>
                  {t('locker.global.disabledBadge')}
                </Tag>
              </div>
            )}
              <div className="pointer-events-auto ml-auto flex min-w-0 flex-wrap items-start justify-end gap-1">
              {!selectMode && <ModSafetyBadge variant="overlay" id={(mod.safetyTarget ?? mod).id}
                name={(mod.safetyTarget ?? mod).name} snapshot={(mod.safetyTarget ?? mod).safety} />}
              {!selectMode && <CrashAdvisoryBadge variant="overlay" modIds={mod.crashModIds ?? [mod.id]} />}
              {mod.nsfw && (
                <Tag
                  tone="danger"
                  variant="overlay"
                  title={t('modThumbnail.nsfw')}
                  className="uppercase tracking-wide"
                >
                  18+
                </Tag>
              )}
              {hasConflicts && (
                <Tag
                  tone="warning"
                  variant="overlay"
                  icon={AlertTriangle}
                  title={conflicts.map((c) => c.details).join(', ')}
                  className="uppercase tracking-wide"
                >
                  {t('installed.card.overlap')}
                </Tag>
              )}
              {mod.isUnknown && (
                <Tag
                  variant="overlay"
                  icon={Wrench}
                  title={t('installed.card.unknownTitle')}
                  className="border-cyan-300/70 text-cyan-200"
                >
                  {t('installed.card.unknown')}
                </Tag>
              )}
              {updateAvailable && (
                <Tag
                  tone="update"
                  variant="overlay"
                  icon={Download}
                  title={t('installed.card.updateAvailableTitle')}
                  className="uppercase tracking-wide"
                >
                  {t('profiles.actions.update')}
                </Tag>
              )}
              {mod.merged && (
                <Tag
                  variant="overlay"
                  icon={Layers}
                  title={t('installed.card.mergedTitle', { count: mod.merged.sources.length })}
                  className="border-hl/20 text-white/90"
                >
                  {t('installed.card.mergedBadge', { count: mod.merged.sources.length })}
                </Tag>
              )}
              <MergeSourceUpdateTag staleCount={staleSourceCount} updatableCount={updatableSourceCount}
                variant="overlay" />
              {group && group.variantCount > 1 && (
                <Tag
                  variant="overlay"
                  icon={Files}
                  title={variantStatusTitle}
                  className="border-hl/20 text-white/90 tabular-nums"
                >
                  {variantStatusLabel}
                </Tag>
              )}
            </div>
          </div>
        );

        return (
          <ModMediaPreview
            mod={mod}
            heroName={cardTaxonomy.previewHeroName}
            hideNsfwPreviews={hideNsfwPreviews}
            soundVolume={soundVolume}
            overlayBadges={overlayBadges}
            mediaSpacingClasses={mediaSpacingClasses}
            mediaFrameClasses={mediaFrameClasses}
            audioOverlayClasses={audioOverlayClasses}
            audioPlayerClassName={audioPlayerClassName}
            onOpenDetails={onOpenDetails}
            opensPicker={group?.opensPicker ?? opensPicker}
          />
        );
        })()}

        <div className="mt-auto min-w-0 px-0.5">
          <h3 className={`min-w-0 text-text-primary ${titleClasses}`} title={mod.name}>
            {mod.name}
          </h3>
          <div
            className={`${isCompact ? 'mt-1.5' : 'mt-1'} grid min-h-7 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-1.5`}
            title={t('installed.card.gridMetaTitle', { file: mod.fileName, size: formatBytes(mod.size), date: formatAbsoluteDate(mod.installedAt) })}
          >
            <div className="flex h-7 min-w-0 items-center gap-1 text-xs text-text-secondary">
              {favorite && <Star role="img" aria-label={t('installed.card.favorite')} className="h-4 w-4 shrink-0 fill-current text-accent" />}
              <RequirementWarning mod={mod}>{(icon, title) => <RepairIssueIcons
                outdated={mod.outdatedVdata} enabled={mod.outdatedVdataEnabled ?? mod.enabled} models={mod.staleModels}
                requirement={selectMode ? undefined : { icon, title }} />}</RequirementWarning>
              <InstalledTaxonomyChips taxonomy={cardTaxonomy} className={metaChipClasses} />
            </div>

            <div className={`flex flex-shrink-0 items-center justify-end gap-2 ${isCompact ? '' : 'pr-1'}`}>
              {actions}
            </div>
          </div>
        </div>
      </div>

    </div>
      </MenuTrigger>
      <MenuContent {...menuFocusProps} className="max-h-[70vh] overflow-y-auto" data-card-menu-open>
        <DeferredMenuItems>{renderCardMenuItems}</DeferredMenuItems>
      </MenuContent>
    </MenuRoot>
  );
}
