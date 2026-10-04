import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2, AlertTriangle, FolderOpen, FilePlus, Files, ImagePlus, Download, Info, Check, Wrench, Layers, Scissors, Share2, Beaker, PowerOff, Tag as TagIcon, Pencil, MoreHorizontal, Link2, Banana, Fingerprint, ExternalLink, Star, ArrowUpToLine, ImageDown, Link, Unlink } from 'lucide-react';
import { MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from '../common/menu';
import { showToast } from '../../stores/toastStore';
import { revealModInFolder } from '../../lib/api';
import type { ModConflict } from '../../lib/api';
import type { Mod, GlobalModType } from '../../types/mod';
import ModThumbnail from '../ModThumbnail';
import AudioPreviewPlayer from '../AudioPreviewPlayer';
import PriorityEditor from '../PriorityEditor';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition, HERO_NAMES_SORTED, canonicalHeroName, GLOBAL_MOD_TYPE_ORDER, GLOBAL_MOD_TYPE_LABELS } from '../../lib/lockerUtils';
import { getInstalledCardTaxonomy, type InstalledCardTaxonomy } from '../../lib/installedCardTaxonomy';
import { formatRelativeDate, formatAbsoluteDate } from '../../lib/dates';
import { formatBytes } from '../../lib/formatBytes';
import { canOpenImageSource, copyImageToClipboard, resolveImageSource } from '../../lib/imageActions';
import type { ModList } from '../../lib/modLists';
import { ModListSubmenu } from './ModListMenu';
import { Tag } from '../common/ui';
import type { ViewMode } from '../common/PageComponents';
import { GlobalLoadBadge, ChipText, HeroTagLabel } from './chips';
import { heroNameForLabel } from '../../lib/heroNames';
import { EMPTY_LIST_IDS } from './emptyIds';
import { ModSafetyBadge } from '../ModSafety';

interface ModCardProps {
  mod: {
    safety?: Mod['safety'];
    safetyTarget?: Pick<Mod, 'id' | 'name' | 'safety'>;
    id: string;
    name: string;
    fileName: string;
    enabled: boolean;
    priority: number;
    size: number;
    installedAt: string;
    thumbnailUrl?: string;
    audioUrl?: string;
    sourceSection?: string;
    categoryName?: string;
    nsfw?: boolean;
    gameBananaId?: number;
    isUnknown?: boolean;
    lockerHero?: string;
    lockerHeroSource?: Mod['lockerHeroSource'];
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
  /** Absorbed merge sources whose GameBanana file is gone. Informational only:
   *  a merged VPK has no file of its own to re-download. */
  staleSourceCount?: number;
  onOpenDetails?: () => void;
  /** Open the mod author's GameBanana profile in the browser. Undefined for
   *  local mods with no GameBanana source. */
  onViewAuthor?: () => void;
  onToggle: () => void;
  /** Disable every other mod, enable only this one, and launch the game. Used
   *  for A/B testing a single skin. */
  onSoloLaunch?: () => void;
  soloBusy?: boolean;
  onDelete: () => void;
  onEditLocal?: () => void;
  /** Inline rename of a local mod's name (double-click the title). Undefined
   *  for GameBanana-sourced mods, which can't be renamed. */
  onRenameLocal?: (newName: string) => Promise<void>;
  /** Import more local VPKs as variants of this mod. Local cards only: a
   *  GameBanana mod's files come from its submission. */
  onAddVariant?: () => void;
  /** Dissolve this local variant group. Passed only on local GROUP cards. */
  onUngroupVariants?: () => void;
  /** Open the imprint details modal. Passed only when the mod's wire
   *  `imprinted` flag is true (the parent gates on it); shown in the card's
   *  right-click menu. */
  onViewImprint?: () => void;
  onTagLocker?: (heroName: string | null) => void | Promise<void>;
  onTagGlobal?: (globalType: GlobalModType | null) => void | Promise<void>;
  /** Toggle this mod's Global (priority root) placement. */
  onSetPriority?: (priority: boolean) => void | Promise<void>;
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
  selected?: boolean;
  onSelectToggle?: React.MouseEventHandler<HTMLButtonElement>;
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
   *  Swaps the filename meta for an enabled/total count and routes the
   *  card-body click to the picker modal. */
  group?: {
    variantCount: number;
    /** Enabled file labels for this group. Empty when fully disabled. */
    enabledCount: number;
    enabledLabels: string[];
    onOpenPicker: () => void;
  };
}

interface ModMediaPreviewProps {
  mod: ModCardProps['mod'];
  hideNsfwPreviews: boolean;
  soundVolume: number;
  overlayBadges: ReactNode;
  mediaSpacingClasses: string;
  mediaFrameClasses: string;
  audioOverlayClasses: string;
  audioPlayerClassName: string;
  onOpenDetails?: () => void;
  isGroupCard: boolean;
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
  hideNsfwPreviews,
  soundVolume,
  overlayBadges,
  mediaSpacingClasses,
  mediaFrameClasses,
  audioOverlayClasses,
  audioPlayerClassName,
  onOpenDetails,
  isGroupCard,
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
  const detailsLabel = canOpen ? (isGroupCard ? t('installed.card.chooseFilesFor', { name: mod.name }) : t('installed.card.viewDetailsFor', { name: mod.name })) : undefined;
  // Prefer an explicit mod thumbnail. For sound-only mods without one, fall
  // back to the inferred hero render before using the waveform placeholder.
  // `lockerHero` is persisted from VPK path inference and catches titles that
  // don't name the hero; title matching covers not-yet-enriched mods.
  const soundHeroName = isSound && !mod.thumbnailUrl
    ? mod.lockerHero ?? inferHeroFromTitle(mod.name)
    : null;
  const soundHeroRenderUrl = soundHeroName ? getHeroRenderPath(soundHeroName) : null;
  const soundHeroFacePosX = soundHeroName ? getHeroFacePosition(soundHeroName).x : 50;
  const image = (
    <ModThumbnail
      src={mod.thumbnailUrl}
      alt={mod.name}
      nsfw={mod.nsfw}
      hideNsfw={hideNsfwPreviews}
      className="w-full h-full"
      enableImageContextMenu={false}
      imageClassName="origin-center transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
      mergedSources={mod.merged?.sources}
      forgeInstalled={!!mod.forgeInstall}
    />
  );
  const soundMedia = mod.thumbnailUrl ? image : soundHeroRenderUrl ? (
    <img
      src={soundHeroRenderUrl}
      alt={soundHeroName ?? mod.name}
      draggable={false}
      className="block h-full w-full object-cover origin-center transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
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
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{image}</div>
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/20" />
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
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        <div className={`h-full w-full ${mediaDisabledClass}`}>{soundMedia}</div>
        {(mod.thumbnailUrl || soundHeroRenderUrl) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-bg-primary/80 via-bg-primary/25 to-transparent" />
        )}
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/15" />
        )}
      </button>
      {overlayBadges}
      <div
        className={audioOverlayClasses}
        data-card-action="true"
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

interface ModListRowContentProps {
  mod: ModCardProps['mod'];
  taxonomy: InstalledCardTaxonomy;
  hideNsfwPreviews: boolean;
  soundVolume: number;
  onOpenDetails?: () => void;
  onRenameLocal?: (newName: string) => Promise<void>;
  onCommitPriority?: (newPosition: number) => Promise<void>;
  loadPosition?: number;
  loadCount?: number;
  isGroupCard: boolean;
  group?: ModCardProps['group'];
  variantStatusLabel: string | null;
  variantStatusTitle: string;
  metaChipClasses: string;
  manualTagChipClasses: string;
  inferredTagChipClasses: string;
  dangerInlineChipClasses: string;
  tagIconClassName: string;
  technicalMetaClasses: string;
  actions: ReactNode;
}

function lockerHeroSourceLabel(source: Mod['lockerHeroSource']): string {
  switch (source) {
    case 'manual':
      return 'Manual override';
    case 'download-title':
    case 'title':
      return 'Inferred from title';
    case 'download-vpk':
    case 'vpk':
      return 'Inferred from VPK files';
    default:
      return 'Inferred by Grimoire';
  }
}

function CategoryChip({
  label,
  className,
  iconClassName = 'h-4 w-4',
  iconOnly = false,
}: {
  label: string;
  className: string;
  iconClassName?: string;
  /** When the category is a hero, collapse to the bare face icon (no frame, no
   *  truncated name) to match the locker-hero chip in cards. */
  iconOnly?: boolean;
}) {
  const heroName = heroNameForLabel(label);
  if (heroName && iconOnly) {
    return (
      <span className="inline-flex flex-shrink-0 items-center" title={label}>
        <HeroTagLabel heroName={heroName} iconClassName={iconClassName} iconOnly />
      </span>
    );
  }
  return (
    <span className={className} title={label}>
      {heroName ? (
        <HeroTagLabel heroName={heroName} iconClassName={iconClassName} />
      ) : (
        <ChipText>{label}</ChipText>
      )}
    </span>
  );
}

function MetaTextChip({ label, className, title }: { label: string; className: string; title?: string }) {
  return (
    <span className={className} title={title ?? label}>
      <ChipText>{label}</ChipText>
    </span>
  );
}

function LockerHeroChip({
  mod,
  manualTagChipClasses,
  inferredTagChipClasses,
  iconClassName = 'h-4 w-4',
  iconOnly = false,
}: {
  mod: { lockerHero?: string; lockerHeroSource?: Mod['lockerHeroSource'] };
  manualTagChipClasses: string;
  inferredTagChipClasses: string;
  iconClassName?: string;
  /** Drop the hero name and show just the face icon. Used in the card grid,
   *  where a narrow chip otherwise truncates the name to a useless "L." */
  iconOnly?: boolean;
}) {
  if (!mod.lockerHero) return null;
  const isManual = mod.lockerHeroSource === 'manual';
  const title = `${lockerHeroSourceLabel(mod.lockerHeroSource)}: ${mod.lockerHero}`;
  // Icon-only (card grid): just the bare face icon, no accent chip frame — the
  // colored manual/inferred border reads as a highlight that fights the theme.
  if (iconOnly) {
    return (
      <span className="inline-flex flex-shrink-0 items-center" title={title}>
        <HeroTagLabel heroName={mod.lockerHero} iconClassName={iconClassName} iconOnly />
      </span>
    );
  }
  return (
    <span
      className={isManual ? manualTagChipClasses : inferredTagChipClasses}
      title={title}
    >
      <HeroTagLabel heroName={mod.lockerHero} iconClassName={iconClassName} />
    </span>
  );
}

/**
 * The card's mod title. For local mods (no GameBanana source) double-clicking
 * the name swaps it for an inline input so it can be renamed in place without
 * opening the full Edit modal. Non-local cards just render a plain heading.
 * `onRename` is expected to persist the new name; rename preserves the mod's
 * existing thumbnail/NSFW flag (the caller threads those through edit-local-mod).
 */
function EditableModTitle({
  name,
  className,
  onRename,
}: {
  name: string;
  className: string;
  /** Undefined when the title isn't renamable (GameBanana-sourced mods). */
  onRename?: (newName: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reflect an upstream name change (rename elsewhere, reload) while at rest.
  useEffect(() => {
    if (!editing) setValue(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editing || !onRename) {
    return (
      <h3
        className={`${className}${onRename ? ' cursor-text' : ''}`}
        title={onRename ? `${name} (double-click to rename)` : name}
        onDoubleClick={
          onRename
            ? (e) => {
                e.stopPropagation();
                setValue(name);
                setEditing(true);
              }
            : undefined
        }
      >
        {name}
      </h3>
    );
  }

  const commit = async () => {
    // Enter commits, which sets `saving` and disables the input below. Disabling
    // a focused input makes the browser fire focusout, so onBlur re-entered
    // commit and renamed twice (the parent has not reloaded yet, so the
    // trimmed !== name check still passed on the second pass).
    if (saving) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    setSaving(true);
    try {
      await onRename(trimmed);
      setEditing(false);
    } catch (err) {
      console.error('[Installed] Failed to rename local mod:', err);
      // Stay in edit mode so the user can retry or cancel.
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      disabled={saving}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          void commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setValue(name);
        }
      }}
      onBlur={() => void commit()}
      data-card-action="true"
      className={`${className} premium-inline-rename-input disabled:opacity-60`}
    />
  );
}

function ModListRowContent({
  mod,
  taxonomy,
  hideNsfwPreviews,
  soundVolume,
  onOpenDetails,
  onRenameLocal,
  onCommitPriority,
  loadPosition,
  loadCount,
  isGroupCard,
  group,
  variantStatusLabel,
  variantStatusTitle,
  metaChipClasses,
  manualTagChipClasses,
  inferredTagChipClasses,
  dangerInlineChipClasses,
  tagIconClassName,
  technicalMetaClasses,
  actions,
}: ModListRowContentProps) {
  const { t } = useTranslation();
  const isSound = mod.sourceSection === 'Sound' && !!mod.audioUrl;
  const canOpen = !!onOpenDetails;
  const listHeroName = isSound && !mod.thumbnailUrl
    ? mod.lockerHero ?? inferHeroFromTitle(mod.name)
    : null;
  const listHeroRenderUrl = listHeroName ? getHeroRenderPath(listHeroName) : null;
  const listHeroFacePosX = listHeroName ? getHeroFacePosition(listHeroName).x : 50;
  const taxonomyLabel = taxonomy.globalType
    ? (GLOBAL_MOD_TYPE_LABELS[taxonomy.globalType] ?? taxonomy.globalType)
    : taxonomy.categoryLabel;

  return (
    <>
      <div className="flex min-w-0 items-center justify-start">
        {mod.enabled && mod.priorityMod ? (
          <GlobalLoadBadge variant="inline" />
        ) : mod.enabled ? (
          <span data-card-action="true">
            <PriorityEditor
              modName={mod.name}
              value={loadPosition ?? mod.priority}
              max={loadCount ?? 99}
              variant="inline"
              onCommit={onCommitPriority}
            />
          </span>
        ) : (
          <span className="inline-flex h-5 items-center rounded border border-hl/[0.06] bg-bg-tertiary/60 px-1.5 text-2xs font-semibold text-text-secondary/70">
            {t('installed.card.off')}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenDetails?.();
        }}
        disabled={!canOpen}
        className={`group relative h-10 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-bg-tertiary border border-hl/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer transition-[filter,opacity] duration-200 ${
          mod.enabled ? '' : 'grayscale-[0.6] opacity-[0.7]'
        }`}
        aria-label={canOpen ? (isGroupCard ? t('installed.card.chooseFilesFor', { name: mod.name }) : t('installed.card.viewDetailsFor', { name: mod.name })) : undefined}
        data-card-action="true"
        draggable={false}
        onDragStart={stopMediaDrag}
      >
        {listHeroRenderUrl ? (
          <img
            src={listHeroRenderUrl}
            alt={listHeroName ?? mod.name}
            draggable={false}
            className="block h-full w-full object-cover origin-center transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            style={{ objectPosition: `${listHeroFacePosX}% 25%` }}
          />
        ) : isSound && !mod.thumbnailUrl ? (
          <SoundPlaceholder />
        ) : (
          <ModThumbnail
            src={mod.thumbnailUrl}
            alt={mod.name}
            nsfw={mod.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-full h-full"
            enableImageContextMenu={false}
            imageClassName="origin-center transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            mergedSources={mod.merged?.sources}
            forgeInstalled={!!mod.forgeInstall}
          />
        )}
        {canOpen && (
          <div className="pointer-events-none absolute inset-0 bg-bg-primary/0 transition-colors duration-200 group-hover:bg-bg-primary/20" />
        )}
      </button>

      <div className="grid min-w-0">
        <EditableModTitle
          name={mod.name}
          className="min-w-0 truncate text-[13px] font-semibold leading-[22px] text-text-primary"
          onRename={onRenameLocal}
        />
        <div className="min-w-0">
          <ModSafetyBadge id={(mod.safetyTarget ?? mod).id} name={(mod.safetyTarget ?? mod).name} snapshot={(mod.safetyTarget ?? mod).safety} />
        </div>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-2xs leading-[24px] text-text-secondary">
          {!mod.enabled && mod.priorityMod && (
            <MetaTextChip
              label={t('installed.priority.chip')}
              className={manualTagChipClasses}
              title={t('installed.priority.hint')}
            />
          )}
          {taxonomy.heroName && (
            mod.lockerHero ? (
              <LockerHeroChip
                mod={mod}
                manualTagChipClasses={manualTagChipClasses}
                inferredTagChipClasses={inferredTagChipClasses}
                iconClassName={tagIconClassName}
              />
            ) : (
              <CategoryChip
                label={taxonomy.heroName}
                className={metaChipClasses}
                iconClassName={tagIconClassName}
              />
            )
          )}
          {taxonomyLabel && (
            <MetaTextChip
              label={taxonomyLabel}
              className={metaChipClasses}
            />
          )}
          {mod.nsfw && (
            <MetaTextChip label="18+" className={dangerInlineChipClasses} />
          )}
          <span className="flex-shrink-0">{formatBytes(mod.size)}</span>
          <span className="flex-shrink-0 tabular-nums" title={`Installed ${formatAbsoluteDate(mod.installedAt)}`}>
            {formatRelativeDate(mod.installedAt)}
          </span>
          {group && (
            <span
              className="inline-flex flex-shrink-0 items-center gap-1 tabular-nums text-text-secondary"
              title={variantStatusTitle}
            >
              <Files className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {variantStatusLabel}
            </span>
          )}
          {!group && (
            <span className={technicalMetaClasses} title={mod.fileName}>
              {mod.fileName}
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex min-w-0 items-center justify-end gap-3">
        {isSound && (
          <div
            className="hidden w-48 min-w-0 flex-shrink items-center rounded-md border border-hl/[0.06] bg-bg-secondary/45 px-2 py-1 opacity-85 transition-opacity duration-200 group-hover/card:opacity-100 lg:flex"
            data-card-action="true"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AudioPreviewPlayer
              src={mod.audioUrl!}
              compact
              variant="inline"
              volume={soundVolume}
              className="w-full gap-2 [&>button:first-of-type]:h-6 [&>button:first-of-type]:w-6 [&>div]:h-1 [&>span]:text-[10px]"
            />
          </div>
        )}
        {actions}
      </div>
    </>
  );
}

export function ModCard({
  mod,
  viewMode,
  hideNsfwPreviews,
  conflicts,
  soundVolume,
  updateAvailable,
  staleSourceCount = 0,
  onOpenDetails,
  onViewAuthor,
  onToggle,
  onSoloLaunch,
  soloBusy = false,
  onDelete,
  onEditLocal,
  onRenameLocal,
  onAddVariant,
  onUngroupVariants,
  onViewImprint,
  onTagLocker,
  onTagGlobal,
  onSetPriority,
  onFixUnknown,
  fixingUnknown,
  onCommitPriority,
  loadPosition,
  loadCount,
  onUnmerge,
  onCopyShareCode,
  selectMode,
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
  const hasConflicts = conflicts.length > 0;
  const isGroupCard = !!group;
  const handleRevealInFolder = () => {
    revealModInFolder(mod.id).catch((err) => {
      console.error('[Installed] Failed to reveal mod in folder:', err);
    });
  };
  const hasListActions = !selectMode && !!lists && !!onToggleList && !!onCreateList;
  const menuHeroName = mod.sourceSection === 'Sound' && !mod.thumbnailUrl
    ? mod.lockerHero ?? inferHeroFromTitle(mod.name)
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
  const variantStatusTitle = group
    ? t('installed.card.variantStatusTitle', { labels: enabledTitle || t('installed.card.noFilesEnabled') })
    : '';
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

  const applyLockerTag = async (heroName: string | null) => {
    if (!onTagLocker || menuBusy) return;
    setMenuBusy(true);
    try {
      await onTagLocker(heroName);
    } catch (err) {
      reportMenuError('Failed to set locker hero', err);
    } finally {
      setMenuBusy(false);
    }
  };

  const applyGlobalTag = async (globalType: GlobalModType) => {
    if (!onTagGlobal || menuBusy) return;
    setMenuBusy(true);
    try {
      await onTagGlobal(globalType);
    } catch (err) {
      reportMenuError('Failed to set global locker tag', err);
    } finally {
      setMenuBusy(false);
    }
  };

  // Toggle the Global (priority root) placement. The move renames the VPK, so
  // the resulting mod carries a new id; the store refreshes the list, and this
  // card is re-rendered from the new entry rather than trying to patch itself.
  const togglePriority = async () => {
    if (!onSetPriority || menuBusy) return;
    setMenuBusy(true);
    try {
      await onSetPriority(!mod.priorityMod);
    } catch (err) {
      reportMenuError('Failed to change Global placement', err);
    } finally {
      setMenuBusy(false);
    }
  };

  const clearLockerTag = async () => {
    if (menuBusy) return;
    setMenuBusy(true);
    try {
      await onTagLocker?.(null);
      await onTagGlobal?.(null);
    } catch (err) {
      reportMenuError('Failed to clear locker tag', err);
    } finally {
      setMenuBusy(false);
    }
  };

  const stateClasses = hasConflicts
    ? 'bg-state-warning/5 border-state-warning/45'
    : mod.enabled
      ? 'bg-bg-tertiary border-hl/[0.08] hover:border-hl/[0.14] hover:bg-bg-secondary'
      : 'bg-bg-tertiary/85 border-hl/[0.08] text-text-primary/80 hover:border-hl/[0.14] hover:bg-bg-secondary hover:text-text-primary';

  // Glass surface for grid/compact cards: a translucent base over which a
  // blurred copy of the cover art (see glassBackdropUrl) bleeds, so the card
  // is tinted by its own thumbnail. List view keeps the solid stateClasses.
  const glassStateClasses = hasConflicts
    ? 'border-state-warning/45 bg-state-warning/[0.07] premium-card-glow premium-card-glow-warning'
    : mod.enabled
      ? 'premium-glass-card premium-card-glow-active'
      : 'premium-glass-card opacity-85';

  // Merged mods get a "stacked card" silhouette via two offset box-shadows
  // that read as cards-behind-the-card. Uses only neutral surface/border
  // tokens so it stays correct under any accent color the user picks.
  // Suppressed in compact view (cards are too small for the offset to look
  // intentional) and in list view (the card is a horizontal strip).
  const mergedStackShadow =
    mod.merged && viewMode === 'grid'
      ? 'shadow-[3px_3px_0_0_var(--color-bg-secondary),3px_3px_0_1px_var(--color-border),6px_6px_0_0_var(--color-bg-secondary),6px_6px_0_1px_var(--color-border)] mr-1.5 mb-1.5'
      : '';
  const chipMaxClass =
    viewMode === 'compact' ? 'max-w-[132px]' : viewMode === 'list' ? 'max-w-[148px]' : 'max-w-[170px]';
  const chipSizeClasses =
    viewMode === 'list'
      ? 'h-6 rounded-[7px] px-2 text-2xs'
      : viewMode === 'compact'
        ? 'h-[26px] rounded-lg px-2 text-[12px]'
        : 'h-7 rounded-lg px-2.5 text-[12px]';
  const tagIconClassName =
    viewMode === 'list' ? 'h-[18px] w-[18px]' : viewMode === 'compact' ? 'h-5 w-5' : 'h-[22px] w-[22px]';
  // A compact text chip must retain enough width to show actual content; zero
  // was technically valid to flexbox and produced the orphaned border seen on
  // the smallest cards.
  const chipMinClass = viewMode === 'compact' ? 'min-w-9' : 'min-w-0';
  const baseChipClasses = `inline-flex ${chipMinClass} ${chipMaxClass} ${chipSizeClasses} items-center overflow-hidden font-semibold leading-none`;
  const metaChipClasses = `${baseChipClasses} border border-hl/[0.06] bg-bg-tertiary/65 text-text-secondary/80`;
  const manualTagChipClasses = `${baseChipClasses} border border-accent/30 bg-accent/10 text-accent`;
  const inferredTagChipClasses = `${baseChipClasses} border border-sky-400/35 bg-sky-500/15 text-sky-100`;
  const dangerInlineChipClasses = `${baseChipClasses} flex-shrink-0 border border-state-danger/40 bg-state-danger/10 text-state-danger`;
  const technicalMetaClasses = 'min-w-0 truncate font-mono text-2xs text-text-secondary/55 hover:text-text-secondary cursor-help';
  const utilityActionClasses = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-all duration-200 hover:bg-bg-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 cursor-pointer disabled:opacity-60';
  // Hover-revealed card action. `pointer-events-none` while transparent is
  // load-bearing: opacity-0 alone still accepts clicks, so an unrevealed button
  // is a mis-click straight into a real action (delete, or a persisted
  // favorite). pointer-events does not gate keyboard focus, so tab-then-Enter
  // still reaches the button, and the focus: pair keeps it visible once there.
  const hoverRevealClasses = 'opacity-0 pointer-events-none group-hover/card:opacity-90 group-hover/card:pointer-events-auto focus:opacity-100 focus:pointer-events-auto';
  const hoverActionVisibilityClasses = selectMode ? 'hidden' : hoverRevealClasses;
  // A set star stays permanently visible in both sections, so there is always an
  // affordance to unpin. An unset star is hover-only like its delete / overflow
  // siblings, in both sections: an always-on outline star on every card is visual
  // noise. Reveal via opacity, never `hidden` plus another display utility:
  // utilityActionClasses already sets inline-flex and two display utilities
  // resolve by stylesheet order, not by attribute order.
  const favoriteVisibilityClasses = favorite
    ? (selectMode ? 'hidden' : '')
    : hoverActionVisibilityClasses;
  const toggleHitboxClasses = 'inline-flex h-7 w-12 items-center justify-center rounded-md cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary';
  const toggleTrackClasses = `relative h-6 w-11 rounded-full transition-colors duration-200 ${
    mod.enabled ? 'bg-accent shadow-[0_0_0_1px_rgba(255,122,47,0.25)]' : 'bg-bg-tertiary border border-border group-hover/toggle:border-hl/20'
  }`;
  const isList = viewMode === 'list';
  const isCompact = viewMode === 'compact';
  // Cover-art source for the glass backdrop. Skipped when NSFW previews are
  // hidden so we never bleed hidden imagery, even blurred.
  const glassBackdropUrl =
    !isList && mod.thumbnailUrl && !(mod.nsfw && hideNsfwPreviews)
      ? mod.thumbnailUrl
      : null;
  const shellClasses = isList
    ? 'grid min-h-[58px] grid-cols-[32px_56px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-0'
    : isCompact
      ? 'flex h-full flex-col gap-0 p-2'
      : 'flex h-full flex-col gap-0 p-2';
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
  // Grid footers stay single-line. Classification is deliberately limited to
  // one hero identity plus one text label below, so resizing a card never
  // changes *which* tags it shows.
  const gridTagsClasses = viewMode === 'compact' ? 'h-[26px] flex-nowrap' : 'h-7 flex-nowrap';
  // Locker global axis (HUD, Soul Containers, ...). Surfaced as a card chip so a
  // manual or auto global tag is visible here, not just in the Locker. A global
  // mod has no hero, so the two chips never both show.
  const cardTaxonomy = getInstalledCardTaxonomy(mod);
  const cardGlobalLabel = cardTaxonomy.globalType
    ? (GLOBAL_MOD_TYPE_LABELS[cardTaxonomy.globalType] ?? cardTaxonomy.globalType)
    : undefined;
  // One stable taxonomy model for every grid size:
  //   1. the hero identity, when present (bare portrait);
  //   2. either the Locker global type or the GameBanana category (one label).
  // Global classification supersedes category because those labels are often
  // identical (HUD/HUD). A hero category is represented by the portrait and
  // therefore does not also need a text chip. Previously compact cards counted
  // available slots and silently dropped later tags, which made the same mod
  // appear to have different metadata as the size slider crossed a breakpoint.
  const cardTaxonomyLabel = cardGlobalLabel ?? cardTaxonomy.categoryLabel;
  // Enabled cards get their own copy: pinning only takes effect once the mod is
  // disabled, and the disabled section's "top of disabled mods" wording would be
  // a lie there.
  const favoriteLabel = mod.enabled
    ? favorite
      ? t('installed.card.removeFavoriteWhenDisabled', { name: mod.name })
      : t('installed.card.addFavoriteWhenDisabled', { name: mod.name })
    : favorite
      ? t('installed.card.removeDisabledFavorite', { name: mod.name })
      : t('installed.card.addDisabledFavorite', { name: mod.name });
  // Context-menu actions should scan like actions, not tooltips. Keep the
  // longer placement explanation on the card button's title/aria label, while
  // the right-click and kebab menus use the same concise wording as Locker.
  const favoriteMenuLabel = favorite
    ? t('installed.card.unfavorite')
    : t('installed.card.favorite');

  // One canonical list of card actions, mounted twice: once under the
  // right-click (context) root wrapping the whole card, once under the
  // dropdown root on the three-dot button. Only one of the two is open at a
  // time, so this renders once in practice.
  const hasTopActions =
    !!onEditLocal || !!onAddVariant || !!onUngroupVariants || !!onOpenDetails || !!onViewAuthor
    || !!cardImageSource;
  const hasSecondaryActions =
    !!onSoloLaunch || !!onSetPriority || !!onTagLocker || !!onTagGlobal || !!onFixUnknown
    || !!(mod.merged && (onCopyShareCode || onUnmerge));
  const cardMenuItems = (
    <>
      {onEditLocal && (
        <MenuItem icon={Pencil} onSelect={onEditLocal}>
          {t('installed.card.edit')}
        </MenuItem>
      )}
      {onAddVariant && (
        <MenuItem icon={FilePlus} onSelect={onAddVariant}>
          {t('installed.card.addVariant')}
        </MenuItem>
      )}
      {onUngroupVariants && (
        <MenuItem icon={Unlink} onSelect={onUngroupVariants}>
          {t('installed.card.ungroupVariants')}
        </MenuItem>
      )}
      {onOpenDetails && (
        <MenuItem icon={Info} onSelect={onOpenDetails}>
          {t('installed.card.viewDetails')}
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
      {hasTopActions && <MenuSeparator />}
      {hasListActions && lists && onToggleList && onCreateList && (
        <ModListSubmenu
          lists={lists}
          memberIds={listIds}
          onToggle={onToggleList}
          onCreateNew={onCreateList}
        />
      )}
      {onToggleFavorite && (
        <MenuItem icon={Star} onSelect={onToggleFavorite}>
          {favoriteMenuLabel}
        </MenuItem>
      )}
      <MenuItem icon={FolderOpen} onSelect={handleRevealInFolder}>
        {t('installed.card.revealInFolder')}
      </MenuItem>
      {onViewImprint && (
        <MenuItem icon={Fingerprint} onSelect={onViewImprint}>
          {t('installed.imprintDetails.menuEntry')}
        </MenuItem>
      )}
      {hasSecondaryActions && <MenuSeparator />}
      {onSoloLaunch && (
        <MenuItem icon={Beaker} disabled={soloBusy} onSelect={onSoloLaunch}>
          {t('installed.card.soloLaunch')}
        </MenuItem>
      )}
      {onSetPriority && (
        <MenuItem
          icon={ArrowUpToLine}
          disabled={menuBusy}
          tone={mod.priorityMod ? 'success' : 'default'}
          onSelect={() => void togglePriority()}
        >
          {menuBusy
            ? t('installed.priority.busy')
            : mod.priorityMod
              ? t('installed.priority.clear')
              : t('installed.priority.make')}
        </MenuItem>
      )}
      {(onTagLocker || onTagGlobal) && (
        <MenuSub>
          <MenuSubTrigger icon={TagIcon}>{t('installed.tag.setLockerTag')}</MenuSubTrigger>
          {/* Cap the height: the hero list is the full roster and would
              otherwise run taller than the window. */}
          <MenuSubContent className="max-h-72 overflow-y-auto">
            <MenuItem
              disabled={menuBusy || (!mod.lockerHero && !mod.globalType)}
              onSelect={() => void clearLockerTag()}
            >
              {t('installed.tag.clearLockerTag')}
            </MenuItem>
            <MenuSeparator />
            {/* Global type and hero are independent axes (setModGlobalType does
                not clear lockerHero), so they are two radio groups rather than
                one. "Clear locker tag" above resets both. */}
            {onTagGlobal && (
              <>
                <MenuLabel>{t('installed.tag.global')}</MenuLabel>
                <MenuRadioGroup
                  value={mod.globalType ?? ''}
                  onValueChange={(value) => void applyGlobalTag(value as GlobalModType)}
                >
                  {GLOBAL_MOD_TYPE_ORDER.map((type) => (
                    <MenuRadioItem key={type} value={type} disabled={menuBusy}>
                      {GLOBAL_MOD_TYPE_LABELS[type]}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
                <MenuSeparator />
              </>
            )}
            <MenuLabel>{t('installed.tag.hero')}</MenuLabel>
            <MenuRadioGroup
              value={canonicalHeroName(mod.lockerHero) ?? ''}
              onValueChange={(value) => void applyLockerTag(value)}
            >
              {HERO_NAMES_SORTED.map((heroName) => (
                <MenuRadioItem
                  key={heroName}
                  value={heroName}
                  disabled={menuBusy}
                  // Inferred tags read as informational, manual ones as chosen.
                  tone={mod.lockerHeroSource === 'manual' ? 'accent' : 'info'}
                >
                  <HeroTagLabel heroName={heroName} />
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuSubContent>
        </MenuSub>
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

  const actions = (
    <div className="ml-auto flex items-center gap-1">
      {/* At compact size the direct favorite/delete buttons consumed 56px even
          while transparent, squeezing the adjacent taxonomy chip down to a
          one-pixel border. Both actions remain available from the kebab and
          right-click menus; larger cards keep their faster hover affordances. */}
      {onToggleFavorite && !isCompact && (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          className={`${utilityActionClasses} ${favoriteVisibilityClasses} ${favorite ? 'text-accent hover:text-accent/80' : 'text-text-tertiary hover:text-accent'}`}
          title={favoriteLabel}
          aria-label={favoriteLabel}
          aria-pressed={favorite}
          data-card-action="true"
        >
          <Star className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
        </button>
      )}
      {!mod.merged && !isCompact && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className={`${utilityActionClasses} ${hoverActionVisibilityClasses} text-state-danger hover:bg-state-danger/10 hover:text-state-danger focus-visible:ring-state-danger/60`}
          title={t('installed.card.deleteNamed', { name: mod.name })}
          aria-label={t('installed.card.deleteNamed', { name: mod.name })}
          data-card-action="true"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
      <div className="relative" data-card-action="true">
        <MenuRoot kind="dropdown" onOpenChange={(open) => { if (open) setPointerImageSrc(null); }}>
          <MenuTrigger asChild disabled={selectMode}>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className={`${utilityActionClasses} ${selectMode ? 'hidden' : `${isList ? '' : hoverRevealClasses} aria-expanded:opacity-100 aria-expanded:pointer-events-auto`}`}
              title={t('installed.card.moreActions')}
              aria-label={t('installed.card.moreActionsFor', { name: mod.name })}
              data-card-action="true"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </MenuTrigger>
          <MenuContent className="max-h-[70vh] overflow-y-auto" data-card-menu-open>
            {cardMenuItems}
          </MenuContent>
        </MenuRoot>
      </div>
        <button
          onClick={onToggle}
          aria-pressed={mod.enabled}
          aria-label={mod.enabled ? t('installed.card.disableMod') : t('installed.card.enableMod')}
          title={mod.enabled ? t('installed.card.disableMod') : t('installed.card.enableMod')}
          className={`${toggleHitboxClasses} group/toggle`}
          data-card-action="true"
        >
          <span className={toggleTrackClasses} aria-hidden>
            <span
              className={`absolute top-[2px] left-[2px] h-5 w-5 rounded-full bg-text-primary shadow-sm transition-transform duration-200 ${
                mod.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </span>
        </button>
    </div>
  );
  return (
    <MenuRoot onOpenChange={(open) => { if (!open) setPointerImageSrc(null); }}>
      {/* Disabled in select mode so right-click doesn't fight the full-card
          select overlay. The thumbnail's own image menu is switched off on
          cards (enableImageContextMenu={false}), so artwork right-clicks reach
          this one rather than a second, image-only menu. */}
      <MenuTrigger asChild disabled={selectMode}>
    <div
      data-mod-entry-key={entryKey}
      onContextMenu={captureContextImage}
      className={`group/card relative rounded-xl border transform-gpu ${isList ? 'transition-[transform,box-shadow,border-color,background-color,opacity] duration-200 ease-out ' + stateClasses : glassStateClasses} ${mergedStackShadow} ${updateAvailable ? 'update-stripes' : ''} ${shellClasses} ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-primary' : mod.priorityMod ? 'ring-1 ring-accent/40' : ''}`}
    >
      <div className={isList ? 'contents' : ''}>
        {selectMode && (
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
          {/* Visible checkbox indicator. pointer-events-none so the overlay
              button below it still receives the click. */}
          <div
            className={`absolute top-2 left-2 z-40 w-6 h-6 rounded-md border-2 transition-colors pointer-events-none flex items-center justify-center shadow-md ${
              selected ? 'bg-accent border-accent' : 'bg-bg-primary/85 border-hl/40'
            }`}
          >
            {selected && <Check className="w-4 h-4 text-accent-foreground" strokeWidth={3} />}
          </div>
        </>
        )}

        {isList ? (
          <ModListRowContent
            mod={mod}
            taxonomy={cardTaxonomy}
            hideNsfwPreviews={hideNsfwPreviews}
            soundVolume={soundVolume}
            onOpenDetails={onOpenDetails}
            onRenameLocal={onRenameLocal}
            onCommitPriority={onCommitPriority}
            loadPosition={loadPosition}
            loadCount={loadCount}
            isGroupCard={isGroupCard}
            group={group}
            variantStatusLabel={variantStatusLabel}
            variantStatusTitle={variantStatusTitle}
            metaChipClasses={metaChipClasses}
            manualTagChipClasses={manualTagChipClasses}
            inferredTagChipClasses={inferredTagChipClasses}
            dangerInlineChipClasses={dangerInlineChipClasses}
            tagIconClassName={tagIconClassName}
            technicalMetaClasses={technicalMetaClasses}
            actions={actions}
          />
        ) : (
        <>
        {glassBackdropUrl && (
          <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-xl">
            <img
              src={glassBackdropUrl}
              alt=""
              aria-hidden
              draggable={false}
              className={`h-full w-full scale-[1.35] object-cover blur-2xl saturate-[1.4] transition-opacity duration-200 ${
                mod.enabled ? 'opacity-55' : 'opacity-30 grayscale-[0.4]'
              }`}
            />
            <div className="absolute inset-0 scrim-bottom" />
          </div>
        )}
        {(() => {
        const overlayBadges = (
          <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
            {mod.enabled && !selectMode && (
              mod.priorityMod ? (
                <div className="pointer-events-auto flex h-5 shrink-0 items-start">
                  <GlobalLoadBadge variant="overlay" />
                </div>
              ) : (
              <div className="pointer-events-auto flex h-5 shrink-0 items-start" data-card-action="true">
                <PriorityEditor
                  modName={mod.name}
                  value={loadPosition ?? mod.priority}
                  max={loadCount ?? 99}
                  variant="overlay"
                  onCommit={onCommitPriority}
                />
              </div>
              )
            )}
            {!mod.enabled && !selectMode && (
              <div className="pointer-events-auto flex shrink-0 flex-col items-start gap-1">
                <Tag tone="neutral" variant="overlay" icon={PowerOff} title={t('locker.global.disabledBadgeTitle')}>
                  {t('locker.global.disabledBadge')}
                </Tag>
                {mod.priorityMod && (
                  <Tag
                    tone="accent"
                    variant="overlay"
                    icon={ArrowUpToLine}
                    title={t('installed.priority.hint')}
                  >
                    {t('installed.priority.chip')}
                  </Tag>
                )}
              </div>
            )}
              <div className="pointer-events-auto ml-auto flex min-w-0 flex-wrap items-start justify-end gap-1">
              {!selectMode && <ModSafetyBadge variant="overlay" id={(mod.safetyTarget ?? mod).id}
                name={(mod.safetyTarget ?? mod).name} snapshot={(mod.safetyTarget ?? mod).safety} />}
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
                >
                  {t('installed.card.conflict')}
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
                  tone="accent"
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
              {staleSourceCount > 0 && (
                <Tag
                  variant="overlay"
                  icon={Download}
                  title={t('installed.card.staleSourcesTitle', { count: staleSourceCount })}
                  className="border-amber-300/70 text-amber-200"
                >
                  {t('installed.card.staleSourcesBadge', { count: staleSourceCount })}
                </Tag>
              )}
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
            hideNsfwPreviews={hideNsfwPreviews}
            soundVolume={soundVolume}
            overlayBadges={overlayBadges}
            mediaSpacingClasses={mediaSpacingClasses}
            mediaFrameClasses={mediaFrameClasses}
            audioOverlayClasses={audioOverlayClasses}
            audioPlayerClassName={audioPlayerClassName}
            onOpenDetails={onOpenDetails}
            isGroupCard={isGroupCard}
          />
        );
        })()}

        <div className="mt-auto min-w-0 px-0.5">
          <EditableModTitle
            name={mod.name}
            className={`min-w-0 text-text-primary ${titleClasses}`}
            onRename={onRenameLocal}
          />
          <div
            className={`${isCompact ? 'mt-1.5 h-7 gap-1.5' : 'mt-1 gap-3'} grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end`}
            title={`${mod.fileName} | ${formatBytes(mod.size)} | installed ${formatAbsoluteDate(mod.installedAt)}`}
          >
            <div className={`flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-text-secondary ${gridTagsClasses}`}>
              {cardTaxonomy.heroName && (
                <span
                  className="inline-flex flex-shrink-0 items-center"
                  title={cardTaxonomy.heroName}
                >
                  <HeroTagLabel
                    heroName={cardTaxonomy.heroName}
                    iconClassName={tagIconClassName}
                    iconOnly
                  />
                </span>
              )}
              {cardTaxonomyLabel && (
                <MetaTextChip
                  label={cardTaxonomyLabel}
                  className={metaChipClasses}
                />
              )}
            </div>

            <div className={`flex flex-shrink-0 items-center justify-end gap-2 ${isCompact ? '' : 'pr-1'}`}>
              {actions}
            </div>
          </div>
        </div>
      </>
        )}
      </div>

    </div>
      </MenuTrigger>
      <MenuContent className="max-h-[70vh] overflow-y-auto" data-card-menu-open>
        {cardMenuItems}
      </MenuContent>
    </MenuRoot>
  );
}
