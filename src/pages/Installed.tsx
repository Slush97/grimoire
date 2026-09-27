import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Package,
  Loader2,
  Settings,
  Trash2,
  AlertTriangle,
  FolderOpen,
  FilePlus,
  Files,
  X,
  Search,
  Download,
  List,
  LayoutGrid,
  Grid3x3,
  Check,
  CheckSquare,
  Wrench,
  Layers,
  Beaker,
  Tag as TagIcon,
  Wand2,
  SlidersHorizontal,
  ArrowDownAZ,
  ArrowDownUp,
  HelpCircle,
  GripVertical,
  ClipboardList,
  Fingerprint,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { showToast } from '../stores/toastStore';
import { useAppStore, type BrowseArtistRef } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { isImprintPending } from '../lib/imprintPending';
import { getConflicts, openModsFolder, getModDetails, getModFileList, downloadMod, createSnapshot, deleteMod as deleteModApi, detectUnknownModFilters, detectUnknownModCacheBulk, cancelUnknownModDetection, onUnknownModDetectionProgress, applyUnknownModMatch, applyUnknownCustomMod, associateUnknownMod, mergeMods, unmergeMod, extractMergeSource, addMergeSources, replaceMergeSources, reorderMods as apiReorderMods, restoreLocalVariantGroupReplacement, setModIgnoreUpdates, getLockerOverview, dmmMigrateScan, dmmMigrateExecute, imprintAllInstalled, onImprintAllInstalledProgress, imprintPreflight, launchModded } from '../lib/api';
import type { UnmergeModResult, ImportCustomModArgs, ImportCustomModResult } from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod, GlobalModType, UnknownModDetectionProgress, UnknownModFilterGuess, MergedModSource, MergeSourceReplacement, AssociateUnknownModArgs } from '../types/mod';
import type { GameBananaModDetails, GameBananaItemRef, GameBananaFile } from '../types/gamebanana';
import {
  mergeSourceModIds,
  planMergeSourceUpdates,
  type MergeSourceUpdateOutcome,
  type MergeSourceUpdateSkip,
} from '../lib/mergeSourceUpdate';
import ModDetailsModal from '../components/ModDetailsModal';
import VariantPickerModal from '../components/VariantPickerModal';
import ImportCustomModsModal from '../components/ImportCustomModsModal';
import MergeModsModal from '../components/MergeModsModal';
import MergedContentsModal from '../components/MergedContentsModal';
import { deriveModNameFromPath } from '../lib/customModImport';
import { useBackdropDismiss } from '../components/common/useBackdropDismiss';
import { HERO_NAMES_SORTED, GLOBAL_MOD_TYPE_ORDER, GLOBAL_MOD_TYPE_LABELS, modLoadOrder } from '../lib/lockerUtils';
import {
  canJoinLocalVariantGroup,
  localVariantSelectionEligibility,
} from '../lib/localVariantEligibility';
import { useStableCallback } from '../lib/useStableCallback';
import {
  STABLE_KEY_PREFERENCES_MIGRATED_EVENT,
  type StableKeyPreferencesMigratedDetail,
} from '../lib/stableKeyMigration';
import { isDownloadRequestPending, releaseDownloadRequest, requestDownload } from '../lib/downloadActivity';
import { planFileUpdates } from '../lib/updateFileMatch';
import {
  createEnabledVpkRestoreSnapshot,
  createGlobalVpkRestoreSnapshot,
  restoreReplacementVpkState,
  type EnabledVpkRestoreSnapshot,
  type GlobalVpkRestoreSnapshot,
} from '../lib/vpkRestore';
import { modRestoreKey } from '../lib/soloRestore';
import { findReplacementTargetIdsAfterInstall } from '../lib/replacementCleanup';
import { planLocalVariantUpdateRestore } from '../lib/localVariantUpdateRestore';
import { buildCachedModDetails, canUseCachedModDetails } from '../lib/cachedModDetails';
import {
  createDisabledEntryComparator,
  readStoredDisabledFavorites,
  readStoredDisabledOrder,
  toggleFavoriteKey,
  writeStoredDisabledFavorites,
  writeStoredDisabledOrder,
} from '../lib/disabledModPrefs';
import {
  type ModList,
  addListMembership,
  buildListMembershipIndex,
  countLiveMembers,
  createList,
  deleteList,
  readStoredModLists,
  renameList,
  toggleListMembership,
  writeStoredModLists,
} from '../lib/modLists';
import { CreateModListModal } from '../components/installed/ModListMenu';
import { ManageModListsModal } from '../components/installed/ManageModListsModal';
import { FilterCheckList } from '../components/installed/FilterCheckList';
import { InstalledProfilesMenu } from '../components/installed/InstalledProfilesMenu';
import { Button, IconButton } from '../components/common/ui';
import { HeroSelect } from '../components/common/HeroSelect';
import { LockerOverridesModal } from '../components/LockerOverridesModal';
import { ViewModeToggle, EmptyState, ConfirmModal, SectionHeader, type ViewMode } from '../components/common/PageComponents';
import { HeroTagLabel } from '../components/installed/chips';
import { ModCard } from '../components/installed/ModCard';
import { EMPTY_LIST_IDS } from '../components/installed/emptyIds';
import { EditLocalModModal } from '../components/installed/EditLocalModModal';
import { MakeCustomModModal } from '../components/installed/MakeCustomModModal';
import type { FoundUnknownMatch } from '../components/installed/unknown/foundMatch';
import { UnknownFilterGuessModal, BulkUnknownFixModal } from '../components/installed/unknown/UnknownFixModals';
import { type ImprintModalState, ImprintModal } from '../components/installed/imprint/ImprintModal';
import { ImprintDetailsModal } from '../components/installed/imprint/ImprintDetailsModal';
import { InstalledSkeleton } from '../components/installed/InstalledSkeleton';
import { type ModEntry, buildModEntries, isEntryEnabled, entrySortPriority, entryName, entrySearchText, entryPrimaryMod, entryInstalledAt, entryIsLocal, OTHER_TAG_KEY, entryHeroNames, tagKeyLabel, entryTagKeys, flattenEntries, entryRepresentativeId, entryDisabledPreferenceKey, buildCompactPriorityOrder } from '../lib/modEntries';

const UNKNOWN_FIND_QUEUE_CONCURRENCY = 1;
const UNKNOWN_FIND_QUEUE_PAUSE_MS = 35;

function pauseUnknownFindQueue(ms = 0): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function unknownModCacheKey(mod: Pick<Mod, 'id' | 'fileName' | 'size' | 'installedAt' | 'sha256'>): string {
  return [mod.id, mod.fileName, mod.size, mod.installedAt, mod.sha256 ?? ''].join('|');
}

function sameUnknownCache(
  left: Record<string, UnknownModFilterGuess>,
  right: Record<string, UnknownModFilterGuess>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

function clearUnknownCacheForMod(
  cache: Record<string, UnknownModFilterGuess>,
  mod: Mod
): Record<string, UnknownModFilterGuess> {
  const next = { ...cache };
  delete next[unknownModCacheKey(mod)];
  delete next[mod.id];
  return next;
}

type ReorderPosition = 'before' | 'after';
type DragSection = 'enabled' | 'disabled';
type DragDraftOrder = {
  section: DragSection;
  keys: string[];
} | null;

const DROP_STATE_RESET_DELAY_MS = 160;

// Cards mounted synchronously during the navigation commit; covers a tall
// viewport's worth in the densest grid. The rest of the library mounts in a
// deferred render one frame later (see gridWarm).
const INITIAL_MOUNT_COUNT = 40;

/** Electron prefixes ipcRenderer.invoke rejections with the channel name;
 *  strip it so toasts show only the main-process message. */
function toastErrorMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return detail.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/**
 * Sortable grid item: useSortable wrapper + the memoized card, merged into a
 * single memo boundary. Keeping useSortable inside the memo matters: with the
 * hook in an unmemoized wrapper, every page-level re-render re-ran it for
 * every entry (~70-80ms across a full library) even when all the cards
 * skipped. Drag updates still get through because dnd-kit delivers them via
 * context, which bypasses memo.
 */
const SortableEntryCard = memo(function SortableEntryCard({
  sortableDisabled,
  ...cardProps
}: { sortableDisabled: boolean } & InstalledEntryCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardProps.entry.key, disabled: sortableDisabled });

  const isList = cardProps.viewMode === 'list';
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.32 : undefined,
    position: 'relative',
    zIndex: isDragging ? 1 : undefined,
    // Sizing estimate for the content-visibility skip. The property itself lives
    // in className (not here) so a :hover variant can lift it, see below. The
    // `auto` keyword keeps the real size once a card has been rendered; the
    // estimate only stands in before first view. dnd-kit drag measurement is
    // unaffected: offscreen items still have placeholder boxes.
    containIntrinsicSize: isList ? 'auto 72px' : 'auto 280px',
  };

  return (
    <div
      ref={setNodeRef}
      // content-visibility:auto skips layout + paint for offscreen cards (most of
      // the cost of mounting a large library) but implies contain:paint, which
      // clips whatever the card paints outside its box AND traps it in its own
      // stacking context. On grid/compact the enabled-card :hover lifts + scales
      // the card: that expansion would be cropped and stuck behind neighbors. So
      // on hover we lift containment (-> visible) and raise z so the expanded card
      // renders whole and on top. The has-menu-open lift does the same for an open
      // action menu that would otherwise paint behind the next card.
      // overflow-anchor:none opts every card out of the browser's scroll
      // anchoring. Without it, pinning a card near the bottom of a long library
      // dragged the viewport along with it: Chrome had picked that card as the
      // scroll anchor, so when the star moved it to the top of the disabled
      // section the scroller "helpfully" followed it thousands of pixels up.
      // Excluding cards leaves the grid container as the anchor, which never
      // moves on a reorder, so the view stays put through pin / unpin / delete.
      className={`flex flex-col has-[[data-card-menu-open]]:z-20 [overflow-anchor:none] [content-visibility:auto] ${isList ? '' : 'hover:[content-visibility:visible] hover:z-10'} ${sortableDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      style={style}
      {...attributes}
      {...listeners}
    >
      <InstalledEntryCard {...cardProps} />
    </div>
  );
});

// Stable fallback for cards with no conflicts; a fresh [] per render would
// defeat InstalledEntryCard's memo on every page-level state change.
const EMPTY_CONFLICTS: ModConflict[] = [];
/** Floor for the measured sort/filter popover height, so a very short window
 *  leaves it scrollable rather than collapsing it to nothing. */
const MIN_FILTER_PANEL_HEIGHT = 160;

interface InstalledEntryCardProps {
  entry: ModEntry;
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  soundVolume: number;
  conflicts: ModConflict[];
  updateAvailable: boolean;
  staleSourceCount: number;
  fixingUnknown: boolean;
  loadPosition: number | undefined;
  loadCount: number;
  selectMode: boolean;
  selected: boolean;
  soloBusy: boolean;
  favorite: boolean;
  onOpenDetails: (mod: Mod) => void;
  onViewAuthor: (mod: Mod) => void;
  /** Opens the variant picker for a group, by its shared grouping key. */
  onOpenPicker: (groupKey: string) => void;
  onToggle: (entry: ModEntry) => void;
  onSoloLaunch: (entry: ModEntry) => void;
  onDelete: (entry: ModEntry) => void;
  onEditLocal: (mod: Mod) => void;
  onRenameLocal: (mod: Mod, newName: string) => Promise<void>;
  /** Open the add-variants import dialog for a local entry. */
  onAddVariant: (entry: ModEntry) => void;
  /** Dissolve a local variant group (every member becomes its own card). */
  onUngroupVariants: (entry: ModEntry) => Promise<void>;
  /** Open the imprint details modal for a mod whose wire `imprinted` flag is
   *  true. Externally-imprinted files without the local flag simply do not get
   *  the menu entry: the flag is the cheap client hint, and the modal's empty
   *  state covers a stale flag. */
  onViewImprint: (mod: Mod) => void;
  onTagLocker: (entry: ModEntry, heroName: string | null) => Promise<void>;
  onTagGlobal: (entry: ModEntry, globalType: GlobalModType | null) => Promise<void>;
  /** Move an entry into or out of the citadel/grimoire priority root. */
  onSetPriority: (entry: ModEntry, priority: boolean) => Promise<void>;
  onFixUnknown: (mod: Mod) => void;
  onCommitPriority: (modId: string, newPosition: number) => Promise<void>;
  onUnmerge: (mod: Mod) => void;
  onCopyShareCode: (mod: Mod) => void;
  onSelectToggle: (entry: ModEntry) => void;
  onToggleFavorite: (entry: ModEntry) => void;
  /** All user lists, for the card's "Add to list" submenu. */
  lists: readonly ModList[];
  /** Ids of the lists this entry belongs to (EMPTY_LIST_IDS when none). */
  listIds: readonly string[];
  onToggleList: (entry: ModEntry, listId: string) => void;
  onCreateList: (entry: ModEntry) => void;
}

/**
 * Memoized per-entry bridge between the page and ModCard. The page passes
 * entry-level handlers with stable identities (useStableCallback) plus
 * primitive or stable-reference data props, so page-level state changes
 * (conflict refresh, update flags, select mode, locker override count) only
 * re-render the cards whose props actually changed instead of all of them.
 * The thin per-card closures ModCard wants are rebuilt here, inside the memo
 * boundary, where they are cheap.
 */
const InstalledEntryCard = memo(function InstalledEntryCard({
  entry,
  viewMode,
  hideNsfwPreviews,
  soundVolume,
  conflicts,
  updateAvailable,
  staleSourceCount,
  fixingUnknown,
  loadPosition,
  loadCount,
  selectMode,
  selected,
  soloBusy,
  favorite,
  onOpenDetails,
  onViewAuthor,
  onOpenPicker,
  onToggle,
  onSoloLaunch,
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
  onCommitPriority,
  onUnmerge,
  onCopyShareCode,
  onSelectToggle,
  onToggleFavorite,
  lists,
  listIds,
  onToggleList,
  onCreateList,
}: InstalledEntryCardProps) {
  if (entry.kind === 'single') {
    const mod = entry.mod;
    return (
      <ModCard
        mod={mod}
        viewMode={viewMode}
        hideNsfwPreviews={hideNsfwPreviews}
        conflicts={conflicts}
        soundVolume={soundVolume}
        updateAvailable={updateAvailable}
        staleSourceCount={staleSourceCount}
        entryKey={entry.key}
        onOpenDetails={
          mod.merged || mod.gameBananaId ? () => onOpenDetails(mod) : undefined
        }
        onViewAuthor={mod.gameBananaId ? () => onViewAuthor(mod) : undefined}
        onToggle={() => onToggle(entry)}
        onSoloLaunch={() => onSoloLaunch(entry)}
        soloBusy={soloBusy}
        onDelete={() => onDelete(entry)}
        onEditLocal={entryIsLocal(entry) ? () => onEditLocal(mod) : undefined}
        onRenameLocal={
          entryIsLocal(entry) ? (newName) => onRenameLocal(mod, newName) : undefined
        }
        // A local mod can adopt variants: the first add mints the group. A
        // merged VPK is excluded, like it is from the GameBanana link flow.
        onAddVariant={canJoinLocalVariantGroup(mod) ? () => onAddVariant(entry) : undefined}
        onViewImprint={mod.imprinted ? () => onViewImprint(mod) : undefined}
        onTagLocker={(heroName) => onTagLocker(entry, heroName)}
        onTagGlobal={(globalType) => onTagGlobal(entry, globalType)}
        onSetPriority={(priority) => onSetPriority(entry, priority)}
        onFixUnknown={
          // Any local (unlinked, non-merged) mod can search GameBanana and
          // link, not just ones flagged "unknown": naming a local mod via
          // Edit Local clears isUnknown but it still has no GameBanana source.
          entryIsLocal(entry) &&
          !mod.merged &&
          !(typeof mod.gameBananaId === 'number' && mod.gameBananaId > 0)
            ? () => onFixUnknown(mod)
            : undefined
        }
        fixingUnknown={fixingUnknown}
        loadPosition={loadPosition}
        loadCount={loadCount}
        onCommitPriority={(p) => onCommitPriority(mod.id, p)}
        onUnmerge={mod.merged ? () => onUnmerge(mod) : undefined}
        onCopyShareCode={mod.merged ? () => onCopyShareCode(mod) : undefined}
        selectMode={selectMode}
        selected={selected}
        onSelectToggle={() => onSelectToggle(entry)}
        favorite={favorite}
        // Settable in both sections: starring while enabled pre-pins the entry
        // for the moment it later gets disabled. On an enabled card the star is
        // a marker only, it never reorders the (load-order) enabled section.
        onToggleFavorite={() => onToggleFavorite(entry)}
        lists={lists}
        listIds={listIds}
        onToggleList={(listId) => onToggleList(entry, listId)}
        onCreateList={() => onCreateList(entry)}
      />
    );
  }
  // Group entry. Stand-in `mod` is the primary so the card visuals look
  // right; the `group` prop tells ModCard to swap filename for file
  // selection metadata and route clicks to the picker.
  return (
    <ModCard
      mod={{
        ...entry.primary,
        // Group's overall enable state is "one or more files enabled", not
        // the primary's individual flag (matches sort + section choice).
        enabled: entry.enabledVariants.length > 0,
        // Card meta shows total size across the grouped files.
        size: entry.totalSize,
        installedAt: entry.variants.reduce(
          (latest, v) => (v.installedAt > latest ? v.installedAt : latest),
          entry.primary.installedAt
        ),
      }}
      viewMode={viewMode}
      hideNsfwPreviews={hideNsfwPreviews}
      conflicts={conflicts}
      soundVolume={soundVolume}
      updateAvailable={updateAvailable}
      entryKey={entry.key}
      onOpenDetails={() => onOpenPicker(entry.groupKey)}
      onViewAuthor={entry.gameBananaId ? () => onViewAuthor(entry.primary) : undefined}
      // Imprints are per file; a group card shows the primary's imprint.
      onViewImprint={entry.primary.imprinted ? () => onViewImprint(entry.primary) : undefined}
      onToggle={() => onToggle(entry)}
      onSoloLaunch={() => onSoloLaunch(entry)}
      soloBusy={soloBusy}
      onDelete={() => onDelete(entry)}
      // A local group is the user's own construction, so it can be renamed,
      // extended and dissolved from the card. A GameBanana group can do none of
      // those: its files and its name come from the submission. Renaming the
      // primary renames every member (main fans the name out).
      onEditLocal={entryIsLocal(entry) ? () => onEditLocal(entry.primary) : undefined}
      onRenameLocal={
        entryIsLocal(entry) ? (newName) => onRenameLocal(entry.primary, newName) : undefined
      }
      onAddVariant={
        entryIsLocal(entry) && entry.variants.every(canJoinLocalVariantGroup)
          ? () => onAddVariant(entry)
          : undefined
      }
      onUngroupVariants={entryIsLocal(entry) ? () => void onUngroupVariants(entry) : undefined}
      onTagLocker={(heroName) => onTagLocker(entry, heroName)}
      onTagGlobal={(globalType) => onTagGlobal(entry, globalType)}
      onSetPriority={(priority) => onSetPriority(entry, priority)}
      loadPosition={loadPosition}
      loadCount={loadCount}
      onCommitPriority={(p) => onCommitPriority(entry.primary.id, p)}
      selectMode={selectMode}
      selected={selected}
      onSelectToggle={() => onSelectToggle(entry)}
      favorite={favorite}
      onToggleFavorite={() => onToggleFavorite(entry)}
      // A group shares one preference key with its variants, so filing the card
      // files the whole submission. That matches how the star already behaves.
      lists={lists}
      listIds={listIds}
      onToggleList={(listId) => onToggleList(entry, listId)}
      onCreateList={() => onCreateList(entry)}
      group={{
        variantCount: entry.variants.length,
        // Display friendly names for enabled files when possible.
        enabledCount: entry.enabledVariants.length,
        enabledLabels: entry.enabledVariants.map((variant) =>
          variant.variantLabel ??
          variant.fileDescription ??
          variant.sourceFileName ??
          variant.fileName
        ),
        onOpenPicker: () => onOpenPicker(entry.groupKey),
      }}
    />
  );
});

/**
 * Cache of the set of non-archived live file ids per GameBanana mod id,
 * populated by the update-detection effect. Module-scope so it survives page
 * navigation within a session and lets variants of the same mod share one
 * fetch. A value of null means the mod page returned no usable file list.
 */
const updateCheckCache = new Map<number, Set<number> | null>();
let installedPageScrollTop = 0;

const CARD_SIZE_MIN = 220;
const CARD_SIZE_BASE = 118;
const CARD_SIZE_VW = 7;
const CARD_SIZE_VH = 3;
const CARD_SIZE_MAX = 300;
const CARD_SIZE_MULTIPLIER_MIN = 0.8;
const CARD_SIZE_MULTIPLIER_MAX = 2;
const CARD_SIZE_MULTIPLIER_DEFAULT = 1;
const CARD_SIZE_MULTIPLIER_STEP = 0.1;
// Below this multiplier the grid drops to the dense "compact" card (shorter
// media frame, fewer chips, single-line tags). The size slider doesn't expose a
// separate compact toggle: dragging toward the small end past this cutoff flips
// the treatment, same as the old px threshold did before the slider became a
// responsive multiplier.
const CARD_SIZE_COMPACT_MULTIPLIER = 0.95;
const INSTALLED_CARD_SIZE_MULTIPLIER_KEY = 'installedCardSizeMultiplier';
// localStorage key for the user-dragged position of the floating select bar.
const SELECT_BAR_POS_KEY = 'installedSelectBarPos';

function clampCardSizeMultiplier(value: number): number {
  return Math.min(CARD_SIZE_MULTIPLIER_MAX, Math.max(CARD_SIZE_MULTIPLIER_MIN, value));
}

function readInstalledCardSizeMultiplier(): number {
  const raw = localStorage.getItem(INSTALLED_CARD_SIZE_MULTIPLIER_KEY);
  if (raw == null || raw === '') return CARD_SIZE_MULTIPLIER_DEFAULT;
  const stored = Number(raw);
  return Number.isFinite(stored) ? clampCardSizeMultiplier(stored) : CARD_SIZE_MULTIPLIER_DEFAULT;
}

function getCardSizeCss(multiplier: number): string {
  const nextMultiplier = clampCardSizeMultiplier(multiplier);
  return `clamp(${CARD_SIZE_MIN * nextMultiplier}px, calc(${CARD_SIZE_BASE * nextMultiplier}px + ${CARD_SIZE_VW * nextMultiplier}vw + ${CARD_SIZE_VH * nextMultiplier}vh), ${CARD_SIZE_MAX * nextMultiplier}px)`;
}

function getCardSizeGridStyle(multiplier: number): CSSProperties {
  return {
    '--card-size': getCardSizeCss(multiplier),
    gridTemplateColumns: 'repeat(auto-fill, minmax(var(--card-size), 1fr))',
  } as CSSProperties;
}

export default function Installed() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    settings,
    mods,
    modsLoading,
    modsError,
    modsNotice,
    clearModsNotice,
    soloRestore,
    soloMod,
    restoreSoloMods,
    clearSoloRestore,
    loadSettings,
    loadMods,
    toggleMod,
    deleteMod,
    reorderMods,
    editLocalMod,
    setLocalVariantGroup,
    setModLockerHero,
    setModGlobalType,
    setModPriorityFolder,
    setVariantLabel,
    importCustomMods,
    soundVolume,
    setInstalledScrollTop,
    setBrowseUi,
  } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [disabledFavorites, setDisabledFavorites] = useState(readStoredDisabledFavorites);
  const [disabledOrder, setDisabledOrder] = useState(readStoredDisabledOrder);
  // User-authored lists (see lib/modLists.ts). Membership never changes what
  // is enabled; only the explicit "Enable all" / "Disable all" actions do.
  const [modLists, setModLists] = useState(readStoredModLists);
  // Grouping changes a standalone mod's stable key (sha256 -> localgroup) and
  // splitting does the reverse. The store migrates localStorage atomically,
  // then signals this mounted page so its component-local mirrors update in
  // the same interaction instead of waiting for a remount.
  useEffect(() => {
    const handleMigration = (
      event: CustomEvent<StableKeyPreferencesMigratedDetail>
    ) => {
      setDisabledFavorites(new Set(event.detail.disabledFavorites));
      setDisabledOrder([...event.detail.disabledOrder]);
      setModLists(event.detail.modLists.map((list) => ({ ...list, keys: [...list.keys] })));
    };
    window.addEventListener(STABLE_KEY_PREFERENCES_MIGRATED_EVENT, handleMigration);
    return () => window.removeEventListener(STABLE_KEY_PREFERENCES_MIGRATED_EVENT, handleMigration);
  }, []);
  // Entry the "New list" dialog was opened from, so creating also files it.
  const [creatingListFor, setCreatingListFor] = useState<ModEntry | null>(null);
  const [managingLists, setManagingLists] = useState(false);

  // Applying (or saving) a profile from the header control changes what is
  // enabled behind the page's back: there is no event or subscription to hear
  // it on. The force flag is required because loadMods no-ops on a generation
  // guard otherwise, and settings carry the active-profile marker.
  const handleProfileApplied = useCallback(() => {
    void loadMods({ force: true });
    void loadSettings();
  }, [loadMods, loadSettings]);

  // Source mods absorbed into a merged VPK still live on disk (disabled) so
  // unmerge can restore them, but the user shouldn't see them as separate
  // cards: the merged mod is now the source of truth. Match by identity instead
  // of filename alone because recyclable pakNN slots can later hold unrelated
  // enabled mods; downstream rendering, reorder, and update checks all run off
  // `visibleMods`.
  // The Locker cosmetics VPK (applied hero cards) and the Locker sound VPK
  // (applied per-ability sounds) are Locker-managed artifacts, not user-
  // installed mods, so they never show as cards here. They're managed entirely
  // from the Locker's Hero Card / Sounds pickers.
  // Memoized so the array identity (and the entry identities derived from it)
  // only changes when `mods` does; the memoized card grid depends on that.
  const visibleMods = useMemo(() => {
    const absorbedSources: MergedModSource[] = [];
    for (const m of mods) absorbedSources.push(...(m.merged?.sources ?? []));

    const matchesAbsorbedSource = (mod: Mod, source: MergedModSource): boolean => {
      if (mod.enabled || mod.fileName !== source.fileName) return false;

      const sourceSha = source.sha256AtMergeTime?.toLowerCase();
      const modSha = mod.sha256?.toLowerCase();
      if (sourceSha && modSha) return sourceSha === modSha;

      if (typeof source.gameBananaId === 'number' && typeof mod.gameBananaId === 'number') {
        if (source.gameBananaId !== mod.gameBananaId) return false;
        if (
          typeof source.gameBananaFileId === 'number' &&
          typeof mod.gameBananaFileId === 'number'
        ) {
          return source.gameBananaFileId === mod.gameBananaFileId;
        }
      }

      // A disabled VPK at the exact recorded source filename is physically the
      // absorbed source (filenames are unique within a folder), and enabled
      // mods were already excluded above, so a recycled pakNN slot can't reach
      // here. Fold it in unless sha or gbId positively proved a different mod;
      // a hand-placed VPK with no recorded identity must not leave a stray card.
      return true;
    };

    return mods.filter(
      (m) =>
        !m.lockerCosmetics &&
        !m.lockerSounds &&
        !absorbedSources.some((source) => matchesAbsorbedSource(m, source))
    );
  }, [mods]);
  // Mods the bulk imprint could plausibly act on: visible (locker artifacts and
  // absorbed sources already excluded above) that are not yet imprinted OR
  // carry a stale embed (legacy format / sidecar drift, pending re-imprint).
  // Merged mods count under the same uniform rule (see isImprintPending: a
  // pre-feature merge has no embed and no flags, and IS pending work). Drives
  // the toolbar button's hide-when-done visibility. Deliberately optimistic:
  // files the backend would classify as loaded or anomalous still count (they
  // need attention, so the entry point stays up); the preflight modal is the
  // source of truth for what actually happens.
  const pendingImprintCount = useMemo(
    () => visibleMods.filter(isImprintPending).length,
    [visibleMods]
  );
  // Layout = the user's structural choice (cards grid vs horizontal list).
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    const stored = localStorage.getItem('installedLayout');
    if (stored === 'grid' || stored === 'list') return stored;
    // Migrate from the old three-mode key: only 'list' carried structure.
    return localStorage.getItem('installedViewMode') === 'list' ? 'list' : 'grid';
  });
  const [cardSizeMultiplier, setCardSizeMultiplierState] = useState(readInstalledCardSizeMultiplier);
  useEffect(() => {
    localStorage.setItem('installedLayout', layout);
  }, [layout]);
  const setCardSizeMultiplier = useCallback((nextMultiplier: number) => {
    const clampedMultiplier = clampCardSizeMultiplier(nextMultiplier);
    setCardSizeMultiplierState(clampedMultiplier);
    localStorage.setItem(INSTALLED_CARD_SIZE_MULTIPLIER_KEY, String(clampedMultiplier));
  }, []);
  // Style + card-size live behind a single dropdown so they don't eat a row of
  // toolbar width. Same relative/click-outside pattern as the filter popover.
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!viewMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(event.target as Node)) {
        setViewMenuOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [viewMenuOpen]);
  // Fix unknown can be dismissed by right-clicking it; right-clicking the small
  // stub it leaves behind brings it back. Persisted so the choice sticks.
  const [fixUnknownHidden, setFixUnknownHidden] = useState(
    () => localStorage.getItem('installedFixUnknownHidden') === '1',
  );
  useEffect(() => {
    localStorage.setItem('installedFixUnknownHidden', fixUnknownHidden ? '1' : '0');
  }, [fixUnknownHidden]);
  const cardSizeGridStyle = useMemo(
    () => getCardSizeGridStyle(cardSizeMultiplier),
    [cardSizeMultiplier]
  );
  const viewMode: ViewMode =
    layout === 'list'
      ? 'list'
      : cardSizeMultiplier < CARD_SIZE_COMPACT_MULTIPLIER
        ? 'compact'
        : 'grid';
  // Locker overrides (hero cards + ability sounds) live off the mod list in
  // citadel/grimoire. The toolbar icon opens the manage popup; the badge shows
  // how many are applied. Count is fetched on mount (covers changes made over
  // in the Locker) and refreshed from the popup's onChanged.
  const [lockerOverridesOpen, setLockerOverridesOpen] = useState(false);
  const [lockerOverrideCount, setLockerOverrideCount] = useState(0);
  const refreshLockerOverrideCount = useCallback(async () => {
    try {
      const ov = await getLockerOverview();
      setLockerOverrideCount(
        ov.cards.length + ov.sounds.length + ov.colors.length + ov.trippySkins.length,
      );
    } catch {
      setLockerOverrideCount(0);
    }
  }, []);
  useEffect(() => {
    void refreshLockerOverrideCount();
  }, [refreshLockerOverrideCount]);
  const [search, setSearch] = useState('');
  // Sort + filter popover (the SlidersHorizontal button in the top bar). Sort
  // and source persist across launches; hero/tag selections are library-specific
  // so they reset per session. A non-default sort or any active filter turns the
  // list into a read-only view (see viewIsReorderable) because the displayed
  // order no longer maps to load-order priority.
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  // Retroactive "Imprint installed mods" (path B). A single state machine drives
  // the shared modal through four phases: an up-front preflight dry-run that
  // classifies every candidate into buckets before the user commits, a live
  // progress phase streaming done/total + current file, and a final report of
  // what was imprinted / skipped / failed. `null` means the modal is closed.
  const [imprintState, setImprintState] = useState<ImprintModalState>(null);
  // "View imprint" details modal target (right-click menu on an imprinted mod's
  // card). The modal fetches the embedded imprint itself; null means closed.
  const [imprintDetailsMod, setImprintDetailsMod] = useState<Mod | null>(null);
  // Guards the bulk-imprint post-await state updates (and its streamed progress
  // callback) against a setState-after-unmount leak if the user navigates away
  // mid-run. Set false on unmount; every post-resolve setImprintState / showToast
  // / loadMods checks it first. UX is unchanged, just leak-proof.
  const imprintMountedRef = useRef(true);
  useEffect(() => {
    imprintMountedRef.current = true;
    return () => {
      imprintMountedRef.current = false;
    };
  }, []);
  const [sortMode, setSortMode] = useState<'priority' | 'recent' | 'name'>(() => {
    const stored = localStorage.getItem('installedSortMode');
    return stored === 'recent' || stored === 'name' ? stored : 'priority';
  });
  // Source + status are independent toggles (both on = no filter). Source
  // persists; status resets per session like the type selection.
  const [sourceSel, setSourceSel] = useState<('gamebanana' | 'local')[]>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('installedSourceSel') ?? 'null');
      if (Array.isArray(stored)) {
        const valid = Array.from(
          new Set(stored.filter((v): v is 'gamebanana' | 'local' => v === 'gamebanana' || v === 'local'))
        );
        if (valid.length > 0) return valid;
      }
    } catch {
      /* fall through to default */
    }
    return ['gamebanana', 'local'];
  });
  const [statusSel, setStatusSel] = useState<('enabled' | 'disabled')[]>(['enabled', 'disabled']);
  const [heroFilter, setHeroFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  // Selected list ids. A separate axis from tagFilter (which holds derived
  // category keys) so the two AND together: "in my Ivy list AND tagged Skins"
  // is the useful reading, where folding lists into tagFilter would OR them.
  const [listFilter, setListFilter] = useState<string[]>([]);
  const installedHideNsfwPreviews =
    settings?.installedHideNsfwPreviews ?? settings?.hideNsfwPreviews ?? true;
  // Disabled-section sort, deliberately separate from the top-bar sort above.
  // That one spans both sections and turns the whole page read-only (a sorted
  // enabled list no longer maps to load order). The disabled library is a
  // shelf, not load order, so it can be alphabetized on its own without
  // costing the enabled section its drag handles. 'custom' is the shipped
  // behavior (pinned first, then the manual drag order); 'name' sorts A to Z
  // inside those same pin bands.
  const [disabledSortMode, setDisabledSortMode] = useState<'custom' | 'name'>(() =>
    localStorage.getItem('installedDisabledSort') === 'name' ? 'name' : 'custom'
  );
  useEffect(() => {
    localStorage.setItem('installedSortMode', sortMode);
  }, [sortMode]);
  useEffect(() => {
    localStorage.setItem('installedDisabledSort', disabledSortMode);
  }, [disabledSortMode]);
  useEffect(() => {
    localStorage.setItem('installedSourceSel', JSON.stringify(sourceSel));
  }, [sourceSel]);
  useEffect(() => {
    if (!filterOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setFilterOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFilterOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [filterOpen]);
  // Cap the sort/filter popover to whatever room is left below the toolbar:
  // uncapped, at short window heights everything below TAGS was cut off with no
  // way to reach it (the inner lists scroll, the popover itself did not).
  //
  // Measured rather than a `calc(100vh - <constant>)`, because the toolbar's
  // distance from the top of the viewport is not a constant: it moves with the
  // header, the batch-import bar, browser zoom, and the native window frame on
  // Windows. A stale constant either wastes space or lets the panel run off the
  // bottom, which is the bug this is fixing.
  useLayoutEffect(() => {
    if (!filterOpen) return;
    const panel = filterPanelRef.current;
    if (!panel) return;
    const applyMaxHeight = () => {
      // Top-anchored, so this stays correct across repeated applications.
      const { top } = panel.getBoundingClientRect();
      panel.style.maxHeight = `${Math.max(MIN_FILTER_PANEL_HEIGHT, window.innerHeight - top - 12)}px`;
    };
    applyMaxHeight();
    window.addEventListener('resize', applyMaxHeight);
    return () => window.removeEventListener('resize', applyMaxHeight);
  }, [filterOpen]);
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  // Raw pair count from detectConflicts. conflictMap.size / 2 only works when
  // every mod is in exactly one pair — when one mod conflicts with multiple
  // peers, that math produces fractional or wrong totals.
  const [conflictPairCount, setConflictPairCount] = useState(0);
  // Delete confirmation. `ids` is a list so the same prompt can drive
  // single-mod, group, and bulk-selection deletions.
  const [modToDelete, setModToDelete] = useState<{
    ids: string[];
    name: string;
    isGroup: boolean;
    isBulk?: boolean;
  } | null>(null);
  const [localEditMod, setLocalEditMod] = useState<Mod | null>(null);
  const [customUnknownMod, setCustomUnknownMod] = useState<Mod | null>(null);
  // Sources for the in-progress merge. Non-null means the modal is open.
  const [mergeSources, setMergeSources] = useState<Mod[] | null>(null);
  // Merged mod whose contents are currently being inspected. Non-null means
  // the contents modal is open.
  const [mergedContentsMod, setMergedContentsMod] = useState<Mod | null>(null);
  const eligibleMergeAdditions = useMemo(() => {
    const sources = mergedContentsMod?.merged?.sources;
    if (!sources) return [];
    return visibleMods.filter((candidate) => {
      if (candidate.id === mergedContentsMod.id || candidate.merged) return false;
      return !sources.some((source) => {
        const sourceSha = source.sha256AtMergeTime?.toLowerCase();
        const candidateSha = candidate.sha256?.toLowerCase();
        if (sourceSha && candidateSha && sourceSha === candidateSha) return true;
        return typeof source.gameBananaFileId === 'number'
          && typeof candidate.gameBananaFileId === 'number'
          && source.gameBananaFileId === candidate.gameBananaFileId;
      });
    });
  }, [mergedContentsMod, visibleMods]);
  // Pending unmerge confirmation. Non-null means the confirm dialog is open.
  const [unmergeTarget, setUnmergeTarget] = useState<Mod | null>(null);
  // Result of the most recent unmerge — surfaced when sources were missing on
  // disk so the user can recover via the share code.
  const [unmergeResult, setUnmergeResult] = useState<{ mod: Mod; result: UnmergeModResult; copied: boolean } | null>(null);
  // Brief inline confirmation when the share code is copied. Cleared on a
  // timer; null when no recent copy.

  // Multi-select state. `selectedIds` always stores mod ids (variants of a
  // selected group expand to every variant id) so bulk handlers can iterate
  // directly without re-deriving from entries.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Per-item progress for the in-flight bulk enable/disable. While set, the
  // action bar swaps its buttons for a "Enabling 2/5…" line so users see
  // incremental progress on large selections.
  const [bulkProgress, setBulkProgress] = useState<{
    verb: 'Enabling' | 'Disabling' | 'Tagging';
    done: number;
    total: number;
  } | null>(null);
  // Persisted screen position of the floating select bar. `null` means
  // "use the default top-center anchor"; once the user drags it we store the
  // top-left corner in px and reuse it next time the bar appears.
  const [selectBarPos, setSelectBarPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(SELECT_BAR_POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p?.x === 'number' && typeof p?.y === 'number') return p;
    } catch {
      // ignore malformed/unavailable storage
    }
    return null;
  });
  const selectBarRef = useRef<HTMLDivElement>(null);
  // Pointer offset from the bar's top-left captured on drag start, plus the
  // live move/end listeners so they can detach themselves.
  const selectBarDragRef = useRef<{ dx: number; dy: number } | null>(null);

  const clampSelectBarPos = useCallback((x: number, y: number) => {
    const el = selectBarRef.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const maxX = Math.max(0, window.innerWidth - w);
    const maxY = Math.max(0, window.innerHeight - h);
    return {
      x: Math.min(Math.max(0, x), maxX),
      y: Math.min(Math.max(0, y), maxY),
    };
  }, []);

  const handleSelectBarDragMove = useCallback(
    (e: PointerEvent) => {
      const drag = selectBarDragRef.current;
      if (!drag) return;
      setSelectBarPos(clampSelectBarPos(e.clientX - drag.dx, e.clientY - drag.dy));
    },
    [clampSelectBarPos],
  );

  const handleSelectBarDragEnd = useCallback(() => {
    selectBarDragRef.current = null;
    window.removeEventListener('pointermove', handleSelectBarDragMove);
    window.removeEventListener('pointerup', handleSelectBarDragEnd);
    setSelectBarPos((p) => {
      if (p) {
        try {
          localStorage.setItem(SELECT_BAR_POS_KEY, JSON.stringify(p));
        } catch {
          // ignore unavailable storage
        }
      }
      return p;
    });
  }, [handleSelectBarDragMove]);

  const handleSelectBarDragStart = useCallback(
    (e: React.PointerEvent) => {
      const el = selectBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      selectBarDragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      // Pin the current pixel position so it doesn't jump from the centered
      // anchor to absolute coords on the first move.
      setSelectBarPos(clampSelectBarPos(rect.left, rect.top));
      window.addEventListener('pointermove', handleSelectBarDragMove);
      window.addEventListener('pointerup', handleSelectBarDragEnd);
      e.preventDefault();
    },
    [clampSelectBarPos, handleSelectBarDragMove, handleSelectBarDragEnd],
  );

  // Detach drag listeners if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleSelectBarDragMove);
      window.removeEventListener('pointerup', handleSelectBarDragEnd);
    };
  }, [handleSelectBarDragMove, handleSelectBarDragEnd]);

  // Keep a saved (dragged) bar position on-screen when the bar appears and on
  // window resize, so a position saved at a larger window size doesn't strand
  // the bar off the viewport.
  useEffect(() => {
    if (!selectMode || !selectBarPos) return;
    const reclamp = () => setSelectBarPos((p) => (p ? clampSelectBarPos(p.x, p.y) : p));
    reclamp();
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
    // selectBarPos intentionally omitted: this only re-pins on appear/resize,
    // not on every drag tick (which would fight the active drag).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode, clampSelectBarPos]);

  // GB id of the group whose picker is open, or null. The actual entry is
  // derived from live `mods` each render so per-file deletes inside the
  // picker reflect immediately without juggling a separate snapshot.
  // Open variant picker, held by the group's shared grouping key (see
  // variantGroupKey): "gb:<id>" for GameBanana groups, "local:<uuid>" for
  // locally imported multi-VPK archives.
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null);
  // The batch local-import dialog is mounted by Layout, not here: this page
  // early-returns an empty state when it has no mods, so hosting the dialog
  // would unmount it mid-batch on a first-ever import. Only the open flag lives
  // on the page's buttons.
  const openBatchImport = useAppStore((s) => s.openBatchImport);
  // Target of the "Add variant" dialog, which IS hosted here (unlike the plain
  // batch import): it can only be opened from a card, so the page always has
  // mods and can never early-return out from under it. `groupId` is null for a
  // standalone local mod, whose group is minted on the first successful add.
  const [addVariantTarget, setAddVariantTarget] = useState<{
    modIds: string[];
    groupId: string | null;
    modName: string;
    /** Set once this dialog minted the group, so a retry after a partial
     *  failure joins the same group instead of minting another, and closing
     *  without a single file landing can undo the mint. */
    mintedGroupId?: string;
  } | null>(null);
  const [unknownFilterGuess, setUnknownFilterGuess] = useState<{
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
  } | null>(null);
  const [unknownFixMode, setUnknownFixMode] = useState<'single' | 'bulk' | null>(null);
  // Synchronous re-entry guard for the DMM auto-import step (one click only,
  // even if the button is mashed before the first run resolves). A ref, not
  // state, so two clicks in the same tick can't both read a stale `false`.
  const dmmAutoImportInFlightRef = useRef(false);
  const [dmmAutoImporting, setDmmAutoImporting] = useState(false);
  const soloBusyRef = useRef(false);
  const [soloBusy, setSoloBusy] = useState(false);
  // Pending DMM-import consent dialog. Holds the promise resolver so
  // autoImportDmmMods can await the user's answer; null = no dialog.
  const [dmmConfirm, setDmmConfirm] = useState<{
    count: number;
    profileName: string;
    resolve: (ok: boolean) => void;
  } | null>(null);
  const [unknownFilterCache, setUnknownFilterCache] = useState<Record<string, UnknownModFilterGuess>>({});
  const [unknownFilterPendingIds, setUnknownFilterPendingIds] = useState<Set<string>>(new Set());
  const [unknownFilterErrors, setUnknownFilterErrors] = useState<Record<string, string>>({});
  const [unknownDetectionProgress, setUnknownDetectionProgress] = useState<Record<string, UnknownModDetectionProgress>>({});
  const unknownRequestSeqRef = useRef(0);
  const unknownRequestIdsRef = useRef<Record<string, string>>({});
  const unknownModKeyByIdRef = useRef<Record<string, string>>({});
  const unknownProgressQueueRef = useRef<Record<string, UnknownModDetectionProgress>>({});
  const unknownProgressFlushRef = useRef<number | null>(null);

  useEffect(() => {
    const nextKeys: Record<string, string> = {};
    for (const mod of mods) {
      if (mod.isUnknown) {
        nextKeys[mod.id] = unknownModCacheKey(mod);
      }
    }
    unknownModKeyByIdRef.current = nextKeys;

    setUnknownFilterCache((prev) => {
      const next: Record<string, UnknownModFilterGuess> = {};
      for (const mod of mods) {
        if (!mod.isUnknown) continue;
        const key = nextKeys[mod.id];
        const cached = prev[key] ?? prev[mod.id];
        if (cached) next[key] = cached;
      }
      return sameUnknownCache(prev, next) ? prev : next;
    });
  }, [mods]);

  useEffect(() => {
    const flush = () => {
      unknownProgressFlushRef.current = null;
      const queued = Object.values(unknownProgressQueueRef.current);
      unknownProgressQueueRef.current = {};
      if (queued.length === 0) return;

      setUnknownDetectionProgress((prev) => {
        const next = { ...prev };
        for (const progress of queued) {
          next[progress.modId] = progress;
        }
        return next;
      });

      const withResults = queued.filter((progress) => progress.result);
      if (withResults.length > 0) {
        setUnknownFilterCache((prev) => {
          const next = { ...prev };
          for (const progress of withResults) {
            const cacheKey = unknownModKeyByIdRef.current[progress.modId] ?? progress.modId;
            next[cacheKey] = progress.result!;
          }
          return next;
        });
        setUnknownFilterGuess((current) => {
          if (!current) return current;
          const progress = withResults.find((item) => item.modId === current.mod.id);
          return progress?.result
            ? { ...current, result: progress.result, error: undefined, cancelled: false }
            : current;
        });
      }
    };

    const unsubscribe = onUnknownModDetectionProgress((progress) => {
      const activeRequestId = unknownRequestIdsRef.current[progress.modId];
      if (progress.requestId && activeRequestId !== progress.requestId) {
        return;
      }
      unknownProgressQueueRef.current[progress.modId] = progress;
      const immediate = !!progress.result || ['cache-hit', 'found', 'complete', 'cancelled', 'error'].includes(progress.phase);
      if (immediate) {
        if (unknownProgressFlushRef.current !== null) {
          window.clearTimeout(unknownProgressFlushRef.current);
        }
        flush();
      } else if (unknownProgressFlushRef.current === null) {
        unknownProgressFlushRef.current = window.setTimeout(flush, 100);
      }
    });

    return () => {
      unsubscribe();
      if (unknownProgressFlushRef.current !== null) {
        window.clearTimeout(unknownProgressFlushRef.current);
      }
    };
  }, []);

  // Drag-and-drop reorder state. `draggingSection` scopes overlays so dragging
  // an enabled card can't render against a disabled section and vice versa.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<DragSection | null>(null);
  const [dragDraftOrder, setDragDraftOrder] = useState<DragDraftOrder>(null);
  const dropCommitPendingRef = useRef(false);
  const sortableSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Details overlay state
  const [detailsMod, setDetailsMod] = useState<GameBananaModDetails | null>(null);
  const [detailsSection, setDetailsSection] = useState<string>('Mod');
  const [detailsCategoryId, setDetailsCategoryId] = useState<number>(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  // True when the overlay is showing cached-catalog data because the live
  // GameBanana fetch failed; drives the offline banner in the modal.
  const [detailsOffline, setDetailsOffline] = useState(false);
  const [detailsIgnoreUpdates, setDetailsIgnoreUpdates] = useState(false);
  // GameBanana id the overlay is showing. Every installed-state value below is
  // derived live from the store off this id rather than snapshotted when the
  // overlay opens: a snapshot went stale the moment the user installed a
  // variant or an update from inside the overlay, so the button stayed on
  // "Install" and the row never picked up its Installed/Active styling.
  const [detailsGameBananaId, setDetailsGameBananaId] = useState<number | null>(null);
  const [detailsDates, setDetailsDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  // Local id of the installed mod that triggered the overlay. A successful
  // Update/Reinstall removes this predecessor after the replacement lands.
  const [detailsSourceModId, setDetailsSourceModId] = useState<string | null>(null);
  // Monotonic guard so a slower linked-item fetch can't clobber a newer one.
  const detailsRequestIdRef = useRef(0);
  // Map of mod id → true if a newer version exists on GameBanana.
  const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());
  // Merged mod id -> fileNames of its absorbed sources whose GameBanana file is
  // gone. Kept apart from `updatesAvailable` because runUpdate has nothing to
  // re-download for a merged VPK; this is surfaced as information only.
  const [mergedSourceUpdates, setMergedSourceUpdates] = useState<Map<string, Set<string>>>(
    new Map(),
  );

  // Installed/enabled GameBanana fileIds for the mod the details overlay is
  // showing, aggregated across every sibling that shares the GB id (not just
  // the clicked file) so multi-variant groups flag every owned row. Derived
  // from `mods` so an install, delete or toggle performed while the overlay is
  // open updates it on the spot, the way Browse feeds the same modal.
  const { detailsInstalledFileIds, detailsActiveFileIds } = useMemo(() => {
    const installedFileIds = new Set<number>();
    const activeFileIds = new Set<number>();
    if (detailsGameBananaId !== null) {
      for (const candidate of mods) {
        if (candidate.gameBananaId !== detailsGameBananaId) continue;
        if (typeof candidate.gameBananaFileId !== 'number') continue;
        installedFileIds.add(candidate.gameBananaFileId);
        if (candidate.enabled) activeFileIds.add(candidate.gameBananaFileId);
      }
    }
    return { detailsInstalledFileIds: installedFileIds, detailsActiveFileIds: activeFileIds };
  }, [mods, detailsGameBananaId]);

  // Update pulse for the overlay. Keyed off the entry that opened it, matching
  // the per-file update check: a sibling variant having an update must not
  // relabel this file's button as "Update", which would make the download
  // handler treat the pick as a version replacement and delete the source.
  const detailsUpdateAvailable = useMemo(
    () => (detailsSourceModId ? updatesAvailable.has(detailsSourceModId) : false),
    [detailsSourceModId, updatesAvailable],
  );

  const detailsUpdatePlan = useMemo(() => {
    if (!detailsMod || !detailsSourceModId || !detailsUpdateAvailable) {
      return { sourcesByTargetFileId: new Map<number, string[]>(), unresolvedSourceIds: [] };
    }
    const source = mods.find((mod) => mod.id === detailsSourceModId);
    if (!source || typeof source.gameBananaFileId !== 'number') {
      return { sourcesByTargetFileId: new Map<number, string[]>(), unresolvedSourceIds: [] };
    }
    const liveIds = new Set(
      (detailsMod.files ?? []).filter((file) => !file.isArchived).map((file) => file.id),
    );
    const candidates = mods.filter(
      (mod) =>
        mod.gameBananaId === detailsMod.id &&
        (mod.gameBananaFileId === source.gameBananaFileId ||
          (typeof mod.gameBananaFileId === 'number' && liveIds.has(mod.gameBananaFileId))),
    );
    return planFileUpdates(
      detailsMod.id,
      detailsMod.files ?? [],
      candidates.map((mod) => ({
        id: mod.id,
        gameBananaId: mod.gameBananaId,
        gameBananaFileId: mod.gameBananaFileId,
        ignoreUpdates: mod.ignoreUpdates,
        installedFileId: mod.gameBananaFileId!,
        fileDescription: mod.fileDescription,
        sourceFileName: mod.sourceFileName,
      })),
    );
  }, [detailsMod, detailsSourceModId, detailsUpdateAvailable, mods]);

  const detailsUpdateFileIds = useMemo(() => {
    const planned = new Set(detailsUpdatePlan.sourcesByTargetFileId.keys());
    if (planned.size > 0 || detailsUpdatePlan.unresolvedSourceIds.length === 0) return planned;
    // No automatic match: every current file is a user-selectable replacement.
    // They are intentionally labelled Update because the Installed handler
    // will replace the stale source, not add an ordinary sibling variant.
    for (const file of detailsMod?.files ?? []) {
      if (!file.isArchived) planned.add(file.id);
    }
    return planned;
  }, [detailsMod, detailsUpdatePlan]);

  // "Update all" confirm + progress. Progress is null when idle, otherwise
  // { done, total } so the button can render "Updating 2/5…" and stay disabled
  // for the duration of the run.
  const [updateAllConfirmOpen, setUpdateAllConfirmOpen] = useState(false);
  const [updateAllProgress, setUpdateAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [updateAllError, setUpdateAllError] = useState<string | null>(null);
  // Mods whose replacement file couldn't be auto-matched during an update run
  // (author replaced their files and several current files could be the
  // successor). The installs are kept untouched; a toast offers a manual pick
  // via the details modal, which already handles the delete + re-enable flow.
  const [updatePickQueue, setUpdatePickQueue] = useState<{ id: string; name: string }[]>([]);
  const installedScrollRef = useRef<HTMLDivElement | null>(null);
  const latestInstalledScrollTopRef = useRef(
    installedPageScrollTop || useAppStore.getState().installedScrollTop
  );

  // Two-phase grid mount. The route transition's commit used to create all
  // card subtrees at once: content-visibility skips their layout/paint, but
  // DOM creation alone for a 200+ mod library blocked ~100ms inside the
  // navigation commit, which also holds back the sidebar highlight and the
  // page swap. Mount one viewport's worth synchronously; the rest lands in a
  // low-priority render one frame after first paint.
  const [gridWarm, setGridWarm] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      startTransition(() => setGridWarm(true));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const restoreScroll = () => {
      const container = installedScrollRef.current;
      const target = installedPageScrollTop || useAppStore.getState().installedScrollTop;
      if (!container || target <= 0) return;
      container.scrollTop = target;
      latestInstalledScrollTopRef.current = target;
    };
    restoreScroll();
    const frame = window.requestAnimationFrame(restoreScroll);
    return () => window.cancelAnimationFrame(frame);
    // gridWarm: the saved offset may exceed phase 1's scrollHeight, so restore
    // again once the full list is mounted.
  }, [modsLoading, mods.length, gridWarm]);

  useEffect(() => {
    const container = installedScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      latestInstalledScrollTopRef.current = container.scrollTop;
      installedPageScrollTop = container.scrollTop;
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      setInstalledScrollTop(latestInstalledScrollTopRef.current);
    };
  }, [setInstalledScrollTop]);

  const openModDetails = async (m: typeof mods[number]) => {
    if (!m.gameBananaId) return;
    const section = m.sourceSection ?? 'Mod';
    const categoryId = m.categoryId ?? 0;
    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;
    setDetailsLoading(true);
    setDetailsMod(null);
    setDetailsError(null);
    setDetailsSection(section);
    setDetailsCategoryId(categoryId);
    setDetailsSourceModId(m.id);
    // Installed/active file sets and the update pulse are derived from this id
    // against the live mod list, so nothing to snapshot here.
    setDetailsGameBananaId(m.gameBananaId);
    setDetailsIgnoreUpdates(!!m.ignoreUpdates);
    setDetailsDates(null);
    setDetailsOffline(false);
    const cachedPromise = window.electronAPI.getCachedMod(m.gameBananaId).catch(() => null);
    try {
      const details = await getModDetails(m.gameBananaId, section, { includeSubmitter: true });
      const cached = await cachedPromise;
      if (detailsRequestIdRef.current !== requestId) return;
      setDetailsMod(details);
      if (cached) {
        setDetailsDates({ dateAdded: cached.dateAdded, dateModified: cached.dateModified });
      }
    } catch (err) {
      const cached = await cachedPromise;
      if (detailsRequestIdRef.current !== requestId) return;
      // For transient GameBanana failures, fall back to the local catalog
      // record plus the installed mod's own name so the overlay still opens.
      // Permanent and unexpected errors remain visible for diagnosis.
      const fallback = canUseCachedModDetails(err)
        ? buildCachedModDetails(m.gameBananaId, cached, m.name)
        : null;
      if (fallback) {
        setDetailsMod(fallback);
        setDetailsOffline(true);
        if (cached) {
          setDetailsDates({ dateAdded: cached.dateAdded, dateModified: cached.dateModified });
        }
      } else {
        setDetailsError(String(err));
      }
    } finally {
      if (detailsRequestIdRef.current === requestId) {
        setDetailsLoading(false);
      }
    }
  };

  // Stable identities for ModDetailsModal's prev/next props. Inline arrows there
  // broke the modal's memo AND, because it lists these two in its keydown effect
  // deps, re-registered four window listeners on every Installed render (which
  // happens on drag, hover-intent and selection). Declared up here with the
  // other detail-overlay hooks so they stay above this component's early
  // returns; the entries and navigateToDetailsEntry they close over are read at
  // click time, not render time. The props still flip to undefined when
  // navigation is unavailable, so the effect re-runs exactly when it should.
  const navigateToPreviousDetails = useStableCallback(() => {
    if (previousDetailsEntry) navigateToDetailsEntry(previousDetailsEntry);
  });
  const navigateToNextDetails = useStableCallback(() => {
    if (nextDetailsEntry) navigateToDetailsEntry(nextDetailsEntry);
  });

  const closeModDetails = useStableCallback(() => {
    setDetailsMod(null);
    setDetailsError(null);
    setDetailsOffline(false);
    setDetailsIgnoreUpdates(false);
    setDetailsSourceModId(null);
    setDetailsGameBananaId(null);
    setDetailsDates(null);
  });

  // Backdrops for the details loading/error overlays. Selecting the error text
  // to copy it and releasing outside the panel used to dismiss the error.
  const detailsLoadingBackdropRef = useBackdropDismiss<HTMLDivElement>(
    closeModDetails,
    detailsLoading
  );
  const detailsErrorBackdropRef = useBackdropDismiss<HTMLDivElement>(
    closeModDetails,
    !!detailsError && !detailsMod
  );

  // Open a GameBanana item linked from description/changelog/comments inside
  // the same details modal (in-app), rather than the OS browser. Works for
  // mods that are not installed too.
  const openLinkedGameBananaItem = useStableCallback(async (item: GameBananaItemRef) => {
    if (detailsMod && item.id === detailsMod.id && item.section === detailsSection) {
      return;
    }

    const requestId = detailsRequestIdRef.current + 1;
    detailsRequestIdRef.current = requestId;

    // Keep the current modal open while loading so we don't flash-close.
    setDetailsError(null);
    setDetailsSection(item.section);
    setDetailsCategoryId(0);

    // A linked item has no clicked entry, so choose an installed sibling as
    // its anchor. The file sets and update pulse follow from that anchor plus
    // the live mod list.
    const linkedCandidates = mods.filter((candidate) => candidate.gameBananaId === item.id);
    // Prefer the sibling that actually carries the update pulse. Choosing the
    // first installed sibling could anchor on a current variant and suppress
    // both the badge and the stale variant's replacement plan.
    const source = linkedCandidates.find((candidate) => updatesAvailable.has(candidate.id))
      ?? linkedCandidates[0]
      ?? null;
    setDetailsGameBananaId(item.id);
    setDetailsSourceModId(source?.id ?? null);
    setDetailsIgnoreUpdates(!!source?.ignoreUpdates);
    setDetailsDates(null);

    const cachedPromise = window.electronAPI.getCachedMod(item.id).catch(() => null);
    try {
      const details = await getModDetails(item.id, item.section, { includeSubmitter: true });
      const cached = await cachedPromise;
      if (detailsRequestIdRef.current !== requestId) return;
      setDetailsMod(details);
      setDetailsOffline(false);
      setDetailsSection(item.section);
      if (cached) {
        setDetailsDates({ dateAdded: cached.dateAdded, dateModified: cached.dateModified });
      }
    } catch (err) {
      const cached = await cachedPromise;
      if (detailsRequestIdRef.current !== requestId) return;
      // Linked items may not be installed, so the only offline fallback is the
      // catalog cache; without a row there we still have to show the error.
      const fallback = canUseCachedModDetails(err)
        ? buildCachedModDetails(item.id, cached)
        : null;
      if (fallback) {
        setDetailsMod(fallback);
        setDetailsOffline(true);
        setDetailsSection(item.section);
        setDetailsDates({ dateAdded: cached!.dateAdded, dateModified: cached!.dateModified });
      } else {
        // The previous item remains mounted while a linked item loads. Clear it
        // before setting the error so the error dialog is not suppressed by its
        // `!detailsMod` guard.
        setDetailsMod(null);
        setDetailsOffline(false);
        setDetailsError(String(err));
      }
    }
  });

  const getUnknownCache = (mod: Mod) => unknownFilterCache[unknownModCacheKey(mod)];

  // Flip the ignoreUpdates flag for the currently-open installed mod and
  // refresh the mods store so the next updatesAvailable recompute (driven by
  // the [mods] useEffect) picks the new flag up. Optimistically toggle the
  // local state first so the pill flips immediately even if the IPC + scan
  // round-trip is slow.
  const handleToggleIgnoreUpdates = useStableCallback(async () => {
    if (!detailsSourceModId) return;
    const next = !detailsIgnoreUpdates;
    setDetailsIgnoreUpdates(next);
    try {
      await setModIgnoreUpdates(detailsSourceModId, next);
      await loadMods({ silent: true });
    } catch (err) {
      console.error('[Installed] toggle ignoreUpdates failed:', err);
      setDetailsIgnoreUpdates(!next);
    }
  });

  const inspectUnknownModFilters = async (
    mod: Mod,
    force = false,
    mode: 'single' | 'bulk' = 'single',
    focus = true
  ) => {
    setUnknownFixMode(mode);
    if (unknownFilterPendingIds.has(mod.id) && !force) {
      if (focus) setUnknownFilterGuess({ mod, loading: true });
      return;
    }

    const cached = getUnknownCache(mod);
    if (cached && !force) {
      if (focus) setUnknownFilterGuess({ mod, loading: false, result: cached });
      return;
    }

    const requestId = String(++unknownRequestSeqRef.current);
    unknownRequestIdsRef.current[mod.id] = requestId;
    setUnknownFilterPendingIds((prev) => new Set(prev).add(mod.id));
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownDetectionProgress((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    if (focus) setUnknownFilterGuess({ mod, loading: true });
    try {
      const result = await detectUnknownModFilters(mod.id, requestId);
      if (unknownRequestIdsRef.current[mod.id] !== requestId) return;
      delete unknownRequestIdsRef.current[mod.id];
      setUnknownFilterPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
      if (result.crcMatch.status !== 'error') {
        setUnknownFilterCache((prev) => ({ ...prev, [unknownModCacheKey(mod)]: result }));
      }
      setUnknownFilterGuess((current) =>
        current?.mod.id === mod.id ? { mod: current.mod, loading: false, result } : current
      );
    } catch (err) {
      if (unknownRequestIdsRef.current[mod.id] !== requestId) return;
      delete unknownRequestIdsRef.current[mod.id];
      const message = err instanceof Error ? err.message : String(err);
      setUnknownFilterPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(mod.id);
        return next;
      });
      setUnknownFilterErrors((prev) => ({ ...prev, [mod.id]: message }));
      setUnknownFilterGuess((current) => {
        if (current?.mod.id !== mod.id) return current;
        return {
          mod: current.mod,
          loading: false,
          error: message,
        };
      });
    }
  };

  const openUnknownModFix = (mod: Mod, mode: 'single' | 'bulk' = 'single') => {
    setUnknownFixMode(mode);
    setUnknownFilterGuess({ mod, loading: unknownFilterPendingIds.has(mod.id) });
    // The modal opens to the manual search + view-files path. The heavy CRC
    // NETWORK auto-matcher still waits for an explicit "Auto-detect" click (it
    // fans out GameBanana requests that can hit rate limits). But the OFFLINE
    // pass runs on open: the mod's own imprint (embedded Grimoire metadata,
    // always on and ungated) plus the local CRC cache. It issues no network
    // requests, so a self-identifying VPK surfaces its imprint card the moment
    // the modal opens, even with the experimental network matcher off.
    void runUnknownCacheQueue([mod]);
  };

  const applyUnknownMatch = async (mod: Mod, match: FoundUnknownMatch) => {
    if (!match.modId || !match.modName) {
      throw new Error(t('installed.unknown.missingMetadata'));
    }
    delete unknownRequestIdsRef.current[mod.id];
    await cancelUnknownModDetection(mod.id).catch(() => undefined);
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
    await applyUnknownModMatch(mod.id, {
      gameBananaId: match.modId,
      modName: match.modName,
      gameBananaFileId: match.fileId,
      sourceFileName: match.fileName,
      sourceSection: match.section,
      categoryName: match.categoryName,
      thumbnailUrl: match.thumbnailUrl,
      nsfw: match.nsfw,
    });
    await finishUnknownFix(mod);
  };

  // Manual association: the user found the mod on GameBanana (via the in-modal
  // search) and is linking it to their existing local VPK. Tags the file in
  // place, so no download and no archive fetches: the lightweight path that
  // sidesteps the rate-limit pain of the CRC auto-matcher.
  const associateUnknownMatch = async (mod: Mod, args: AssociateUnknownModArgs) => {
    await associateUnknownMod(mod.id, args);
    showToast(`Linked to ${args.modName}`, { tone: 'success', duration: 2200 });
    await finishUnknownFix(mod);
  };

  // Shared cleanup after an unknown mod is resolved (matched or linked):
  // refresh the list, drop its cached search state, and advance the bulk modal
  // to the next unknown (or close).
  const finishUnknownFix = async (mod: Mod) => {
    await loadMods();
    setUnknownFilterCache((prev) => clearUnknownCacheForMod(prev, mod));
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownDetectionProgress((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    delete unknownRequestIdsRef.current[mod.id];
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
    if (unknownFixMode === 'bulk') {
      const nextUnknown = unknownMods.find((candidate) => candidate.id !== mod.id);
      if (nextUnknown) {
        openUnknownModFix(nextUnknown, 'bulk');
      } else {
        closeUnknownFix();
      }
    } else {
      closeUnknownFix();
    }
  };

  const closeUnknownFix = () => {
    setUnknownFilterGuess(null);
    setUnknownFixMode(null);
  };

  const cancelUnknownMatch = (mod: Mod) => {
    const cached = getUnknownCache(mod);
    delete unknownRequestIdsRef.current[mod.id];
    void cancelUnknownModDetection(mod.id).catch(() => undefined);
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownDetectionProgress((prev) => ({
      ...prev,
      [mod.id]: {
        modId: mod.id,
        phase: 'cancelled',
        message: cached ? 'Stopped caching remaining files.' : 'Search cancelled.',
        result: cached,
      },
    }));
    setUnknownFilterGuess((current) =>
      current?.mod.id === mod.id
        ? { mod: current.mod, loading: false, result: cached ?? current.result, cancelled: !cached && !current.result }
        : current
    );
  };

  // Adopt any Deadlock Mod Manager install as the first step of the unknown-fix
  // flow. DMM detection is purely local (reads DMM's on-disk data, no
  // GameBanana, no rate limit), so it runs regardless of the auto-match toggle.
  // Importing tags the matching unknown VPKs with GameBanana metadata, so they
  // drop out of the unknown set before the manual modal opens. Returns the
  // unknown mods that remain afterward (the input list unchanged when there's
  // no DMM install or nothing new to adopt).
  const autoImportDmmMods = async (currentUnknowns: Mod[]): Promise<Mod[]> => {
    if (currentUnknowns.length === 0) return currentUnknowns;

    // Probe for a DMM install. Scan throws when there's no DMM data on this
    // machine (the common case): handled silently so the manual flow proceeds.
    let scan;
    try {
      scan = await dmmMigrateScan({});
    } catch {
      return currentUnknowns;
    }

    // Only act on DMM mods Grimoire isn't already managing. Without this gate a
    // user with DMM installed would see "detected, importing" on every Fix
    // Unknown click, even after everything had already been adopted.
    const managedGbIds = new Set(
      useAppStore
        .getState()
        .mods.map((m) => m.gameBananaId)
        .filter((id): id is number => !!id)
    );
    const freshEntries = scan.preview.filter((p) => !managedGbIds.has(p.submissionId));
    if (freshEntries.length === 0) return currentUnknowns;

    // Consent gate: importing writes mod identities in batch, so it never
    // runs on a toast alone. The dialog says what was found; declining goes
    // straight to manual identification.
    const consent = await new Promise<boolean>((resolve) =>
      setDmmConfirm({ count: freshEntries.length, profileName: scan.profileName, resolve })
    );
    if (!consent) return currentUnknowns;

    showToast(t('installed.unknown.dmmDetected'), { tone: 'info', duration: 4000 });

    let report;
    try {
      report = await dmmMigrateExecute({});
    } catch (err) {
      showToast(
        t('installed.unknown.dmmImportFailed') + ': ' + (err instanceof Error ? err.message : String(err)),
        { tone: 'error', duration: 8000, dismissable: true }
      );
      return currentUnknowns;
    }

    await loadMods();
    const remaining = useAppStore
      .getState()
      .mods.filter((m) => m.isUnknown)
      .sort((a, b) => a.priority - b.priority);

    if (report.adopted.length > 0) {
      showToast(t('installed.unknown.dmmImported', { count: report.adopted.length }), {
        tone: 'success',
        duration: 5000,
      });
    }
    return remaining;
  };

  const openBulkUnknownFix = async (unknowns: Mod[]) => {
    // Ignore re-entrant clicks while a DMM auto-import is mid-flight: the import
    // mutates files + reloads mods, so a second concurrent run would race the
    // first (main-process serialization keeps it safe, but it's wasted work and
    // a double toast). The button also shows a loading state via dmmAutoImporting.
    if (dmmAutoImportInFlightRef.current) return;
    dmmAutoImportInFlightRef.current = true;
    setDmmAutoImporting(true);
    let remaining: Mod[];
    try {
      // First adopt any Deadlock Mod Manager mods automatically, then open the
      // manual modal on whatever unknowns are left.
      remaining = await autoImportDmmMods(unknowns);
    } finally {
      dmmAutoImportInFlightRef.current = false;
      setDmmAutoImporting(false);
    }
    const first = remaining[0];
    if (!first) return;
    openUnknownModFix(first, 'bulk');
    // The heavy auto-detect sweep is no longer kicked on open. The bulk modal
    // lists the unknowns so the user can search/link each one manually; the
    // "Auto-detect all" button (behind a rate-limit confirm) still runs the
    // CRC matcher across the batch when explicitly requested.
  };

  const findAllUnknownMods = (unknowns: Mod[]) => {
    const queued = unknowns.filter(
      (mod) => !unknownFilterPendingIds.has(mod.id) && !getUnknownCache(mod)
    );
    void runUnknownFindAllQueue(queued);
  };

  const retryAllNoMatchUnknownMods = (unknowns: Mod[]) => {
    const queued = unknowns.filter(
      (mod) => !unknownFilterPendingIds.has(mod.id) && getUnknownCache(mod)?.crcMatch.status === 'not-found'
    );
    void runUnknownFindQueue(queued, true);
  };

  const runUnknownFindQueue = async (queued: Mod[], force = false) => {
    if (queued.length === 0) return;
    await pauseUnknownFindQueue();
    let nextIndex = 0;
    const workerCount = Math.min(UNKNOWN_FIND_QUEUE_CONCURRENCY, queued.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < queued.length) {
        const mod = queued[nextIndex++];
        await inspectUnknownModFilters(mod, force, 'bulk', false);
        await pauseUnknownFindQueue(UNKNOWN_FIND_QUEUE_PAUSE_MS);
      }
    });
    await Promise.all(workers);
  };

  const runUnknownFindAllQueue = async (queued: Mod[]) => {
    if (queued.length === 0) return;
    const misses = await runUnknownCacheQueue(queued);
    const networkQueue = misses.filter(
      (mod) => !unknownRequestIdsRef.current[mod.id]
    );
    await runUnknownFindQueue(networkQueue);
  };

  const runUnknownCacheQueue = async (queued: Mod[]): Promise<Mod[]> => {
    const active = queued.filter((mod) => !unknownFilterPendingIds.has(mod.id) && !getUnknownCache(mod));
    if (active.length === 0) return [];

    const requestIds = Object.fromEntries(
      active.map((mod) => [mod.id, String(++unknownRequestSeqRef.current)])
    );
    for (const mod of active) {
      unknownRequestIdsRef.current[mod.id] = requestIds[mod.id];
    }
    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      active.forEach((mod) => next.add(mod.id));
      return next;
    });
    setUnknownFilterErrors((prev) => {
      const next = { ...prev };
      active.forEach((mod) => delete next[mod.id]);
      return next;
    });
    setUnknownDetectionProgress((prev) => {
      const next = { ...prev };
      for (const mod of active) {
        next[mod.id] = {
          modId: mod.id,
          requestId: requestIds[mod.id],
          phase: 'fingerprinting',
          message: t('installed.unknown.checkingCrcCache'),
        };
      }
      return next;
    });

    const byId = new Map(active.map((mod) => [mod.id, mod]));
    const misses: Mod[] = [];
    let results: UnknownModFilterGuess[];
    try {
      results = await detectUnknownModCacheBulk(
        active.map((mod) => ({ modId: mod.id, requestId: requestIds[mod.id] }))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUnknownFilterPendingIds((prev) => {
        const next = new Set(prev);
        active.forEach((mod) => next.delete(mod.id));
        return next;
      });
      setUnknownDetectionProgress((prev) => {
        const next = { ...prev };
        for (const mod of active) {
          next[mod.id] = {
            modId: mod.id,
            requestId: requestIds[mod.id],
            phase: 'complete',
            message: `Cache check failed. Queued for online search. ${message}`,
          };
        }
        return next;
      });
      active.forEach((mod) => {
        if (unknownRequestIdsRef.current[mod.id] === requestIds[mod.id]) {
          delete unknownRequestIdsRef.current[mod.id];
          misses.push(mod);
        }
      });
      return misses;
    }

    for (const result of results) {
      const mod = byId.get(result.modId);
      if (!mod || unknownRequestIdsRef.current[mod.id] !== requestIds[mod.id]) continue;

      delete unknownRequestIdsRef.current[mod.id];
      if (result.crcMatch.status === 'found') {
        setUnknownFilterCache((prev) => ({ ...prev, [unknownModCacheKey(mod)]: result }));
      } else {
        misses.push(mod);
        setUnknownDetectionProgress((prev) => ({
          ...prev,
          [mod.id]: {
            modId: mod.id,
            requestId: requestIds[mod.id],
            phase: 'complete',
            message: t('installed.unknown.noCachedMatch'),
          },
        }));
      }
      setUnknownFilterGuess((current) =>
        current?.mod.id === mod.id ? { mod: current.mod, loading: false, result } : current
      );
    }

    setUnknownFilterPendingIds((prev) => {
      const next = new Set(prev);
      active.forEach((mod) => next.delete(mod.id));
      return next;
    });
    return misses;
  };

  const viewUnknownMatch = (mod: Mod, match: FoundUnknownMatch) => {
    if (!match.modId) return;
    closeUnknownFix();
    void openModDetails({
      ...mod,
      name: match.modName ?? mod.name,
      gameBananaId: match.modId,
      gameBananaFileId: match.fileId,
      sourceSection: match.section,
      categoryName: match.categoryName,
      thumbnailUrl: match.thumbnailUrl,
      nsfw: match.nsfw,
    });
  };

  const makeUnknownCustomMod = (mod: Mod) => {
    closeUnknownFix();
    setCustomUnknownMod(mod);
  };

  const editLocalInstalledMod = async (mod: Mod, args: { name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => {
    await editLocalMod(mod.id, args);
    setUnknownFilterCache((prev) => {
      if (!prev[mod.id]) return prev;
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    setUnknownFilterErrors((prev) => {
      if (!prev[mod.id]) return prev;
      const next = { ...prev };
      delete next[mod.id];
      return next;
    });
    delete unknownRequestIdsRef.current[mod.id];
    setUnknownFilterPendingIds((prev) => {
      if (!prev.has(mod.id)) return prev;
      const next = new Set(prev);
      next.delete(mod.id);
      return next;
    });
  };

  const handleDetailsDownload = useStableCallback(async (fileId: number, fileName: string) => {
    if (!detailsMod) return;
    // Synchronous app-wide guard: covers double clicks and the same target
    // being requested from Browse before React or the backend queue can render.
    if (!requestDownload({ modId: detailsMod.id, fileId, fileName, modName: detailsMod.name })) return;
    setDetailsError(null);
    try {
      // Decide whether this pick replaces the source install or adds a sibling:
      //  - same-file pick = a true reinstall -> replace.
      //  - different-file pick when the source has an update available = a
      //    version update -> delete the old version like "Update all" does, so
      //    the superseded file isn't left lingering (disabled) on disk.
      //  - different-file pick with no update available = an intentional variant
      //    add -> leave the source in place (the download backend auto-disables
      //    the prior enabled sibling instead of deleting it).
      const sourceMod = detailsSourceModId ? mods.find((m) => m.id === detailsSourceModId) : null;
      const pickedIsArchived = !!detailsMod.files?.find((f) => f.id === fileId)?.isArchived;
      const isReinstall = !!sourceMod && sourceMod.gameBananaFileId === fileId;
      // A not-installed, non-archived file picked while the source has an update
      // available is the update target. Guard on !installed so clicking a
      // *different* file the user already owns (a second variant) reinstalls it
      // rather than deleting the source; guard on !archived so picking an old
      // file from the archived list never replaces a newer install.
      const plannedUpdateSourceIds = detailsUpdatePlan.sourcesByTargetFileId.get(fileId);
      const isPlannedUpdate = !!plannedUpdateSourceIds && plannedUpdateSourceIds.length > 0;
      const isManualUpdate =
        detailsUpdatePlan.unresolvedSourceIds.includes(sourceMod?.id ?? '') &&
        detailsUpdateFileIds.has(fileId);
      const isUpdate =
        !!sourceMod &&
        detailsUpdateAvailable &&
        !pickedIsArchived &&
        (isPlannedUpdate || isManualUpdate);
      const replacing = isReinstall || isUpdate;
      let replacementTargets: typeof mods = [];
      if (isPlannedUpdate) {
        const sourceIds = new Set(plannedUpdateSourceIds);
        replacementTargets = mods.filter((mod) => sourceIds.has(mod.id));
      } else if (replacing && sourceMod) {
        replacementTargets = mods.filter(
          (mod) =>
            mod.gameBananaId === sourceMod.gameBananaId &&
            mod.gameBananaFileId === sourceMod.gameBananaFileId,
        );
      } else if (detailsInstalledFileIds.has(fileId)) {
        replacementTargets = mods.filter(
          (mod) => mod.gameBananaId === detailsMod.id && mod.gameBananaFileId === fileId,
        );
      }
      const restoreEnabled = createEnabledVpkRestoreSnapshot(replacementTargets);
      const restoreGlobal = createGlobalVpkRestoreSnapshot(replacementTargets);
      if (restoreGlobal.ambiguous) {
        throw new Error(t('installed.updateAll.ambiguousGlobalState'));
      }

      if (replacing && sourceMod) {
        // Snapshot before the destructive delete so the user can roll back,
        // matching runUpdate's pre-update snapshot. Non-fatal on failure: a
        // missing snapshot must not block the update the user just asked for.
        try {
          await createSnapshot('pre-update');
        } catch (err) {
          console.warn('[Update] failed to capture pre-update snapshot:', err);
        }
      }

      const replacementAlreadyInstalled = mods.some(
        (mod) =>
          mod.gameBananaId === detailsMod.id &&
          mod.gameBananaFileId === fileId &&
          !replacementTargets.some((target) => target.id === mod.id),
      );
      if (!isDownloadRequestPending(detailsMod.id, fileId)) return;
      let installedBeforeCleanup: typeof mods;
      let targetIds: string[];
      if (!replacementAlreadyInstalled) {
        await downloadMod(detailsMod.id, fileId, fileName, detailsSection, detailsCategoryId);
        await loadMods();
        installedBeforeCleanup = useAppStore.getState().mods;
        targetIds = findReplacementTargetIdsAfterInstall(
          installedBeforeCleanup,
          replacementTargets,
          fileId,
        );
      } else {
        installedBeforeCleanup = useAppStore.getState().mods;
        targetIds = replacementTargets.map((mod) => mod.id);
      }

      // A GameBanana update is normally forbidden from entering a local
      // variant group. The narrow restore IPC proves this is a replacement for
      // a still-installed adopted member, then copies that group's established
      // identity before the source is deleted. If the mapping is ambiguous,
      // keep the old source rather than split the card and orphan preferences.
      const groupedReplacement = replacementTargets.some((target) => !!target.localGroupId);
      let localGroupRestore = planLocalVariantUpdateRestore(
        replacementTargets,
        installedBeforeCleanup,
        targetIds,
        detailsMod.id,
        fileId,
      );
      if (groupedReplacement && !localGroupRestore) {
        throw new Error(t('installed.variants.updateRestoreFailed'));
      }
      // A Global local group must stay wholly in the priority folder. Move the
      // fresh files first (the existing restore operation owns filesystem
      // placement), then recompute because that move changes local mod ids.
      // Main refuses to stamp group metadata until placement matches, so a
      // failed move leaves the still-installed source and its preferences safe.
      if (localGroupRestore && restoreGlobal.allGlobal) {
        const replacementIds = new Set(localGroupRestore.replacementModIds);
        for (const replacement of installedBeforeCleanup) {
          if (replacementIds.has(replacement.id) && !replacement.priorityMod) {
            await setModPriorityFolder(replacement.id, true);
          }
        }
        await loadMods({ force: true });
        installedBeforeCleanup = useAppStore.getState().mods;
        localGroupRestore = planLocalVariantUpdateRestore(
          replacementTargets,
          installedBeforeCleanup,
          targetIds,
          detailsMod.id,
          fileId,
        );
        if (!localGroupRestore) {
          throw new Error(t('installed.variants.updateRestoreGlobalFailed'));
        }
      }
      if (localGroupRestore) await restoreLocalVariantGroupReplacement(localGroupRestore);
      for (const targetId of targetIds) await deleteModApi(targetId);

      await loadMods({ force: true });

      // Replacement downloads land disabled with fresh metadata. Restore both
      // enabled state and the user's Global priority-root placement after
      // reloading. Match by GB ids because local ids change on reinstall.
      let restoreFailureMessage: string | null = null;
      if (restoreEnabled.hadEnabled || restoreGlobal.hadGlobal) {
        const newMods = useAppStore
          .getState()
          .mods.filter((m) => m.gameBananaId === detailsMod.id && m.gameBananaFileId === fileId);
        const restoreFailures = await restoreReplacementVpkState(
          newMods,
          restoreEnabled,
          restoreGlobal,
          {
            setGlobal: (modId) => setModPriorityFolder(modId, true),
            enable: async (modId) => {
              if (!await toggleMod(modId)) throw new Error('Failed to enable replacement mod');
            },
          },
        );
        if (restoreFailures.length > 0) {
          const summary = restoreFailures
            .map((failure) => `${failure.action}: ${String(failure.error)}`)
            .join('; ');
          restoreFailureMessage = t('installed.updateAll.restoreStateFailed', { details: summary });
        }
      }

      // Always reconcile the store with what actually landed on disk, even when
      // the state restore below failed.
      await loadMods({ force: true });

      // A restore failure is NOT an update failure: the new file is installed
      // and only its enabled/Global state is off. Throwing here would report a
      // succeeded update as a failed one, so surface it in the overlay instead.
      if (restoreFailureMessage) {
        showToast(restoreFailureMessage, { tone: 'warning', duration: 7000 });
      }

      // Keep the overlay open on the freshly installed file so the row flips to
      // Installed/Active and the button to "Reinstall" in place. Re-anchor the
      // source entry first: an update or reinstall deletes the old local id, and
      // leaving it dangling would break the ignore-updates toggle and make a
      // follow-up pick look like a variant add rather than a replacement.
      const installed = useAppStore
        .getState()
        .mods.find((m) => m.gameBananaId === detailsMod.id && m.gameBananaFileId === fileId);
      if (installed) {
        setDetailsSourceModId(installed.id);
        setDetailsIgnoreUpdates(!!installed.ignoreUpdates);
      }
    } catch (err) {
      // The error dialog below only renders when no mod is loaded, and the
      // overlay now stays open through the install, so a failure has to be
      // surfaced as a toast or it would be swallowed entirely.
      showToast(toastErrorMessage(err), { tone: 'error', duration: 6000 });
    } finally {
      releaseDownloadRequest(detailsMod.id, fileId);
    }
  });

  /**
   * Re-download each target mod and restore its pre-update enabled state.
   * Downloads always go to the disabled folder by default, so without the
   * restore step the user would have to manually re-enable every updated mod.
   * Failures are caught per-item so one bad mod doesn't halt the rest.
   * Drives the same `updateAllProgress` state regardless of caller, so the
   * Update-all button reflects per-group updates too.
   */
  const runUpdate = async (targets: typeof mods) => {
    setUpdatePickQueue([]);
    const snapshots = targets
      .filter((m) => m.gameBananaId && typeof m.gameBananaFileId === 'number')
      .map((m) => ({
        oldId: m.id,
        modName: m.name,
        gameBananaId: m.gameBananaId!,
        gameBananaFileId: m.gameBananaFileId!,
        fileName: m.fileName,
        vpkIndex: m.vpkIndex,
        sha256: m.sha256,
        section: m.sourceSection ?? 'Mod',
        categoryId: m.categoryId ?? 0,
        wasEnabled: m.enabled,
        wasGlobal: !!m.priorityMod,
        localGroupId: m.localGroupId,
        fileDescription: m.fileDescription,
        sourceFileName: m.sourceFileName,
      }));
    if (snapshots.length === 0) return;

    // Group by GameBanana mod id so we fetch fresh file metadata once per
    // mod. Reusing each row's stored fileId would 404 whenever an author
    // replaced their upload (new file id) — the most common cause of
    // "update failed" reports.
    const groups = new Map<number, typeof snapshots>();
    for (const s of snapshots) {
      const arr = groups.get(s.gameBananaId) ?? [];
      arr.push(s);
      groups.set(s.gameBananaId, arr);
    }

    setUpdateAllProgress({ done: 0, total: snapshots.length });
    const failures: string[] = [];
    // Rows needing a manual file pick. Their installs are left untouched, so
    // they stay flagged and the details modal's update path can finish the job.
    const needsPick: { id: string; name: string }[] = [];
    // Track the (gameBananaId, fileId) actually downloaded so re-enable can
    // still find the new install even when we redirected a stale snapshot.
    const completed: {
      gameBananaId: number;
      gameBananaFileId: number;
      restoreEnabled: EnabledVpkRestoreSnapshot;
      restoreGlobal: GlobalVpkRestoreSnapshot;
      fileName: string;
    }[] = [];
    let progress = 0;
    // Guard so a multi-group update writes exactly one recovery snapshot, not
    // one per group.
    let snapshotTaken = false;

    for (const [, group] of groups) {
      let details: GameBananaModDetails;
      try {
        details = await getModDetails(group[0].gameBananaId, group[0].section);
      } catch (err) {
        for (const s of group) {
          failures.push(`${s.fileName}: failed to fetch mod details (${String(err)})`);
          progress += 1;
          setUpdateAllProgress({ done: progress, total: snapshots.length });
        }
        continue;
      }

      // Consider only current (non-archived) files, mirroring the update-check
      // effect below. An author's most common "update" is to archive the old
      // version and upload a new current file; counting archived files as live
      // would let the installed-but-now-archived row match Pass 1 1:1, so we'd
      // re-download the same stale file (the mod stays flagged "update
      // available" forever and "Update all" silently no-ops).
      const liveFiles = (details.files ?? []).filter((f) => !f.isArchived);
      const liveFileIds = new Set(liveFiles.map((f) => f.id));

      // Use the same per-file planner as the Installed and Browse detail
      // popups, so Update-all cannot disagree with the row labelled Update.
      // Resolve everything before any delete/download runs; unresolved rows
      // keep their existing install and go to the manual-pick queue.
      type Resolution =
        | { ok: true; snapshot: (typeof snapshots)[number]; fileId: number; fileName: string }
        | { ok: false; snapshot: (typeof snapshots)[number]; reason: string };
      const groupOldIds = new Set(group.map((s) => s.oldId));
      const plan = planFileUpdates(
        group[0].gameBananaId,
        details.files ?? [],
        [
          ...group.map((snapshot) => ({
            id: snapshot.oldId,
            gameBananaId: snapshot.gameBananaId,
            gameBananaFileId: snapshot.gameBananaFileId,
            installedFileId: snapshot.gameBananaFileId,
            fileDescription: snapshot.fileDescription,
            sourceFileName: snapshot.sourceFileName,
          })),
          ...mods
            .filter(
              (mod) =>
                mod.gameBananaId === group[0].gameBananaId &&
                !groupOldIds.has(mod.id) &&
                typeof mod.gameBananaFileId === 'number' &&
                liveFileIds.has(mod.gameBananaFileId),
            )
            .map((mod) => ({
              id: mod.id,
              gameBananaId: mod.gameBananaId,
              gameBananaFileId: mod.gameBananaFileId,
              installedFileId: mod.gameBananaFileId!,
              fileDescription: mod.fileDescription,
              sourceFileName: mod.sourceFileName,
            })),
        ],
      );
      const targetBySourceId = new Map<string, number>();
      for (const [fileId, sourceIds] of plan.sourcesByTargetFileId) {
        for (const sourceId of sourceIds) targetBySourceId.set(sourceId, fileId);
      }
      const resolutions: Resolution[] = group.map((snapshot) => {
        const fileId = liveFileIds.has(snapshot.gameBananaFileId)
          ? snapshot.gameBananaFileId
          : targetBySourceId.get(snapshot.oldId);
        const file = fileId === undefined ? undefined : liveFiles.find((candidate) => candidate.id === fileId);
        return file
          ? { ok: true, snapshot, fileId: file.id, fileName: file.fileName }
          : {
              ok: false,
              snapshot,
              reason: 'stored file is no longer current on GameBanana and no clear replacement match exists',
            };
      });

      // Capture a recovery snapshot before any delete runs in this group.
      // We only snapshot once per runUpdate invocation (guarded by the
      // `snapshotTaken` flag below), so a 50-mod update writes one file, not
      // one per mod. Failure is non-fatal: a missing snapshot must not block
      // the update the user just clicked.
      if (!snapshotTaken && resolutions.some((r) => r.ok)) {
        snapshotTaken = true;
        try {
          await createSnapshot('pre-update');
        } catch (err) {
          console.warn('[Update] failed to capture pre-update snapshot:', err);
        }
      }

      const okBatches = new Map<
        string,
        {
          gameBananaId: number;
          fileId: number;
          fileName: string;
          section: string;
          categoryId: number;
          snapshots: Array<(typeof snapshots)[number]>;
        }
      >();

      for (const r of resolutions) {
        if (!r.ok) {
          needsPick.push({ id: r.snapshot.oldId, name: r.snapshot.modName });
          console.warn(`[Update] ${r.snapshot.fileName}: ${r.reason}`);
        } else {
          const batchKey = `${r.snapshot.gameBananaId}:${r.fileId}`;
          const batch =
            okBatches.get(batchKey) ??
            {
              gameBananaId: r.snapshot.gameBananaId,
              fileId: r.fileId,
              fileName: r.fileName,
              section: r.snapshot.section,
              categoryId: r.snapshot.categoryId,
              snapshots: [],
            };
          batch.snapshots.push(r.snapshot);
          okBatches.set(batchKey, batch);
          continue;
        }
        progress += 1;
        setUpdateAllProgress({ done: progress, total: snapshots.length });
      }

      for (const batch of okBatches.values()) {
        try {
          const restoreEnabled = createEnabledVpkRestoreSnapshot(
            batch.snapshots.map((snapshot) => ({
              enabled: snapshot.wasEnabled,
              vpkIndex: snapshot.vpkIndex,
            })),
          );
          const restoreGlobal = createGlobalVpkRestoreSnapshot(
            batch.snapshots.map((snapshot) => ({
              priorityMod: snapshot.wasGlobal,
              vpkIndex: snapshot.vpkIndex,
            })),
          );
          if (restoreGlobal.ambiguous) {
            throw new Error(t('installed.updateAll.ambiguousGlobalState'));
          }
          // The replacement may already be installed as a disabled sibling
          // (for example the user installed V5 from Browse while V4 remained
          // enabled). In that case the update is a promotion, not another
          // download: delete the stale install and restore its state onto the
          // existing current file.
          const replacementAlreadyInstalled = mods.some(
            (mod) =>
              mod.gameBananaId === batch.gameBananaId &&
              mod.gameBananaFileId === batch.fileId &&
              !batch.snapshots.some((snapshot) => snapshot.oldId === mod.id),
          );
          if (!replacementAlreadyInstalled) {
            await downloadMod(
              batch.gameBananaId,
              batch.fileId,
              batch.fileName,
              batch.section,
              batch.categoryId,
            );
          }
          await loadMods();
          const installedAfterDownload = useAppStore.getState().mods;
          const cleanupTargets = batch.snapshots.map((snapshot) => ({
            id: snapshot.oldId,
            gameBananaId: snapshot.gameBananaId,
            gameBananaFileId: snapshot.gameBananaFileId,
            vpkIndex: snapshot.vpkIndex,
            sha256: snapshot.sha256,
          }));
          const targetIds = findReplacementTargetIdsAfterInstall(
            installedAfterDownload,
            cleanupTargets,
            batch.fileId,
          );
          const groupedReplacement = batch.snapshots.some((snapshot) => !!snapshot.localGroupId);
          let localGroupRestore = planLocalVariantUpdateRestore(
            batch.snapshots,
            installedAfterDownload,
            targetIds,
            batch.gameBananaId,
            batch.fileId,
          );
          if (groupedReplacement && !localGroupRestore) {
            throw new Error(t('installed.variants.updateRestoreFailed'));
          }
          if (localGroupRestore && restoreGlobal.allGlobal) {
            const replacementIds = new Set(localGroupRestore.replacementModIds);
            for (const replacement of installedAfterDownload) {
              if (replacementIds.has(replacement.id) && !replacement.priorityMod) {
                await setModPriorityFolder(replacement.id, true);
              }
            }
            await loadMods({ force: true });
            const installedAfterPriorityRestore = useAppStore.getState().mods;
            localGroupRestore = planLocalVariantUpdateRestore(
              batch.snapshots,
              installedAfterPriorityRestore,
              targetIds,
              batch.gameBananaId,
              batch.fileId,
            );
            if (!localGroupRestore) {
              throw new Error(t('installed.variants.updateRestoreGlobalFailed'));
            }
          }
          if (localGroupRestore) await restoreLocalVariantGroupReplacement(localGroupRestore);
          for (const targetId of targetIds) await deleteModApi(targetId);
          completed.push({
            gameBananaId: batch.gameBananaId,
            gameBananaFileId: batch.fileId,
            restoreEnabled,
            restoreGlobal,
            fileName: batch.fileName,
          });
        } catch (err) {
          for (const snapshot of batch.snapshots) {
            failures.push(`${snapshot.fileName}: ${String(err)}`);
          }
        } finally {
          progress += batch.snapshots.length;
          setUpdateAllProgress({ done: progress, total: snapshots.length });
        }
      }
    }

    // Drop touched gbIds from the update-check cache before we re-derive
    // the updatesAvailable set. The cache is module-scoped and never expires
    // otherwise, so the post-update useEffect would otherwise reuse the same
    // liveIds snapshot that flagged the mod in the first place and the
    // "update available" pulse would stick around on the freshly installed
    // file.
    for (const gbId of groups.keys()) {
      updateCheckCache.delete(gbId);
    }

    // Refresh once so the new installs are in the store with their new ids,
    // then restore Global placement and enabled state. Match by GB ids; the
    // local mod id changes on reinstall.
    await loadMods({ force: true });
    const refreshed = useAppStore.getState().mods;
    for (const c of completed) {
      if (!c.restoreEnabled.hadEnabled && !c.restoreGlobal.hadGlobal) continue;
      const newMods = refreshed.filter(
        (m) => m.gameBananaId === c.gameBananaId && m.gameBananaFileId === c.gameBananaFileId,
      );
      const restoreFailures = await restoreReplacementVpkState(
        newMods,
        c.restoreEnabled,
        c.restoreGlobal,
        {
          setGlobal: (modId) => setModPriorityFolder(modId, true),
          enable: async (modId) => {
            if (!await toggleMod(modId)) throw new Error('Failed to enable replacement mod');
          },
        },
      );
      for (const failure of restoreFailures) {
        failures.push(`restore ${failure.action} ${c.fileName}: ${String(failure.error)}`);
      }
    }
    setUpdateAllProgress(null);
    if (needsPick.length > 0) {
      setUpdatePickQueue(needsPick);
    }
    if (failures.length > 0) {
      setUpdateAllError(`${failures.length} mod${failures.length === 1 ? '' : 's'} failed to update. See console for details.`);
      console.warn('[Update] failures:', failures);
    }
  };

  /**
   * Walk the manual-pick queue: open the details modal for the next mod that
   * still exists so the user can choose the replacement file. The modal's
   * update path (handleDetailsDownload) handles delete + re-enable.
   */
  const openNextUpdatePick = () => {
    const queue = [...updatePickQueue];
    while (queue.length > 0) {
      const next = queue.shift()!;
      const mod = mods.find((m) => m.id === next.id);
      if (mod) {
        setUpdatePickQueue(queue);
        void openModDetails(mod);
        return;
      }
    }
    setUpdatePickQueue([]);
  };

  const handleUpdateAll = async () => {
    setUpdateAllConfirmOpen(false);
    setUpdateAllError(null);
    await runUpdate(mods.filter((m) => updatesAvailable.has(m.id)));
  };

  /**
   * Update every flagged variant within one grouped mod. Invoked from the
   * variant picker so the user doesn't have to bounce out to the mod page.
   */
  const handleUpdateGroup = async (variantIds: readonly string[]) => {
    const groupIds = new Set(variantIds);
    setUpdateAllError(null);
    await runUpdate(
      mods.filter((m) => groupIds.has(m.id) && updatesAvailable.has(m.id)),
    );
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // ESC leaves bulk-select mode (same as the toolbar toggle / X). Guarded so it
  // doesn't fire mid bulk-operation or steal ESC from the delete-confirm modal.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !bulkProgress && !modToDelete) {
        setSelectMode(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectMode, bulkProgress, modToDelete]);

  const handleDeleteConfirm = async () => {
    if (!modToDelete) return;
    const wasBulk = !!modToDelete.isBulk;
    // Sequential to keep priority renames coherent — parallel deletes have
    // raced renameVpks before.
    for (const id of modToDelete.ids) {
      await deleteMod(id);
    }
    setModToDelete(null);
    if (wasBulk) exitSelectMode();
  };

  const toggleEntrySelection = (entry: ModEntry) => {
    const ids = entry.kind === 'single' ? [entry.mod.id] : entry.variants.map((v) => v.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const isEntrySelected = (entry: ModEntry): boolean => {
    if (entry.kind === 'single') return selectedIds.has(entry.mod.id);
    return entry.variants.length > 0 && entry.variants.every((v) => selectedIds.has(v.id));
  };

  // Recomputed each render — cheap, and ensures action-bar counts/labels
  // track the live `mods` state after each bulk toggle.
  const selectedMods = mods.filter((m) => selectedIds.has(m.id));
  const selectedEnabledCount = selectedMods.filter((m) => m.enabled).length;
  const selectedDisabledCount = selectedMods.length - selectedEnabledCount;
  // Grouping as variants is local-only. Merged outputs also stay standalone:
  // their card is the only route to contents, unmerge, and share-code recovery.
  const groupSelectionEligibility = localVariantSelectionEligibility(selectedMods);
  const canGroupSelectionAsVariants = groupSelectionEligibility.eligible;

  // Make the selection one mod with N variants. Every member adopts the first
  // one's name (main does that), so the group card has a coherent title.
  const handleBulkGroupVariants = async () => {
    if (!canGroupSelectionAsVariants) return;
    const targets = selectedMods.map((m) => m.id);
    try {
      await setLocalVariantGroup(targets, { mode: 'mint' });
      showToast(t('installed.variants.grouped', { count: targets.length }), { tone: 'success' });
      exitSelectMode();
    } catch (err) {
      showToast(
        t('installed.variants.groupFailed', { error: toastErrorMessage(err) }),
        { tone: 'error' }
      );
    }
  };

  // Callers snapshot `targets` before the loop so the progress total stays
  // stable even as `mods` updates after each toggle.
  const runBulkToggle = async (targets: Mod[], verb: 'Enabling' | 'Disabling') => {
    setBulkProgress({ verb, done: 0, total: targets.length });
    for (let i = 0; i < targets.length; i++) {
      const ok = await toggleMod(targets[i].id);
      setBulkProgress({ verb, done: i + 1, total: targets.length });
      // Stop the batch as soon as we hit the 99-enabled cap rather than firing
      // a failing enable for every remaining selection.
      if (!ok) break;
    }
    setBulkProgress(null);
  };

  const handleBulkEnable = async () => {
    const targets = selectedMods.filter((m) => !m.enabled);
    if (targets.length > 0) await runBulkToggle(targets, 'Enabling');
    exitSelectMode();
  };

  const handleBulkDisable = async () => {
    const targets = selectedMods.filter((m) => m.enabled);
    if (targets.length > 0) await runBulkToggle(targets, 'Disabling');
    exitSelectMode();
  };

  // Bulk lockerHero retag. Writes the manual tag for every selected mod and
  // refreshes — Locker grouping picks the change up on its next mods read.
  // Pass null to clear the manual tag and fall back to title/category inference.
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tagMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setTagMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTagMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tagMenuOpen]);

  const handleBulkTag = async (heroName: string | null) => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModLockerHero(targets[i].id, heroName);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
    } catch (err) {
      console.error('[Installed] Bulk tag failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  const handleBulkClearTag = async () => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModLockerHero(targets[i].id, null);
        await setModGlobalType(targets[i].id, null);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
      await loadMods();
    } catch (err) {
      console.error('[Installed] Bulk tag clear failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  // Bulk-assign a Global (non-hero) cosmetic type to the selection, used when
  // the VPK-path classifier missed a mod or filed it wrong. Mirrors handleBulkTag
  // but writes the globalType axis; the main-process handler clears any hero tag.
  const handleBulkTagGlobal = async (globalType: GlobalModType) => {
    if (selectedMods.length === 0) return;
    setTagMenuOpen(false);
    const targets = [...selectedMods];
    setBulkProgress({ verb: 'Tagging', done: 0, total: targets.length });
    try {
      for (let i = 0; i < targets.length; i++) {
        await setModGlobalType(targets[i].id, globalType);
        setBulkProgress({ verb: 'Tagging', done: i + 1, total: targets.length });
      }
      await loadMods();
    } catch (err) {
      console.error('[Installed] Bulk global tag failed:', err);
    } finally {
      setBulkProgress(null);
      exitSelectMode();
    }
  };

  // Open the imprint modal and run the no-network preflight dry-run. Classifies
  // every installed candidate into buckets (eligible / already imprinted /
  // loaded / auto-managed / anomalous) before the user commits, so the confirm
  // step shows exactly what a bulk run would do. A preflight failure closes the
  // modal and surfaces a toast rather than stranding an empty dialog.
  const openImprintModal = useCallback(async () => {
    setImprintState({ phase: 'preflight' });
    try {
      const preflight = await imprintPreflight();
      setImprintState({ phase: 'review', preflight });
    } catch (err) {
      setImprintState(null);
      showToast(
        t('installed.imprintAll.error', { error: err instanceof Error ? err.message : String(err) }),
        { tone: 'error' }
      );
    }
  }, [t]);

  // Commit the bulk imprint: embed a self-identifying addoninfo.txt into every
  // eligible installed VPK the running game hasn't loaded. Streams progress into
  // the modal, then shows the imprinted / skipped / failed report and refreshes
  // the list so freshly-imprinted sizes update. A run-level failure closes the
  // modal and surfaces a toast. The progress subscription is always torn down.
  const handleImprintAllInstalled = useCallback(async () => {
    setImprintState({ phase: 'running', progress: null });
    const unsubscribe = onImprintAllInstalledProgress((progress) => {
      if (!imprintMountedRef.current) return;
      setImprintState({ phase: 'running', progress });
    });
    try {
      const result = await imprintAllInstalled();
      if (!imprintMountedRef.current) return;
      setImprintState({ phase: 'done', result });
      showToast(t('installed.imprintAll.imprintedSummary', { count: result.imprinted }), {
        tone: 'success',
        duration: 2200,
      });
      await loadMods({ silent: true });
    } catch (err) {
      if (!imprintMountedRef.current) return;
      setImprintState(null);
      showToast(
        t('installed.imprintAll.error', { error: err instanceof Error ? err.message : String(err) }),
        { tone: 'error' }
      );
    } finally {
      unsubscribe();
    }
  }, [loadMods, t]);

  const openBulkDeleteConfirm = () => {
    if (selectedMods.length === 0) return;
    setModToDelete({
      ids: selectedMods.map((m) => m.id),
      name: `${selectedMods.length} mod${selectedMods.length === 1 ? '' : 's'}`,
      isGroup: false,
      isBulk: true,
    });
  };

  // Open the merge modal with the current selection. Existing merges are
  // accepted and flattened to their original source VPKs by the backend.
  const openBulkMerge = () => {
    if (selectedMods.length < 2) return;
    setMergeSources(selectedMods);
  };

  const handleMergeConfirm = async ({
    modIds,
    name,
    strict,
  }: {
    modIds: string[];
    name: string;
    strict: boolean;
  }) => {
    if (!mergeSources) return;
    await mergeMods({ modIds, name, strict });
    setMergeSources(null);
    await loadMods();
    exitSelectMode();
  };

  const handleUnmergeConfirm = async () => {
    if (!unmergeTarget) return;
    const target = unmergeTarget;
    setUnmergeTarget(null);
    try {
      const result = await unmergeMod(target.id);
      await loadMods();
      // Surface the missing-sources recovery dialog only when something
      // actually went missing; the common case is a clean unmerge with
      // every source restored. We write the share code to the clipboard
      // BEFORE opening the dialog so its "is on your clipboard now" copy
      // is true regardless of whether the user clicks OK or Close.
      if (result.missingSourceFileNames.length > 0) {
        let copied = false;
        try {
          await navigator.clipboard.writeText(result.shareCode);
          copied = true;
        } catch (err) {
          console.error('[Installed] clipboard write failed:', err);
        }
        setUnmergeResult({ mod: target, result, copied });
      }
    } catch (err) {
      console.error('[Installed] unmerge failed:', err);
      showToast(`Unmerge failed: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' });
    }
  };

  const handleCopyShareCode = async (mod: Mod) => {
    if (!mod.merged?.shareCode) return;
    try {
      await navigator.clipboard.writeText(mod.merged.shareCode);
      showToast(t('installed.merge.shareCodeCopiedToast'), { tone: 'success', duration: 2200 });
    } catch (err) {
      console.error('[Installed] clipboard write failed:', err);
      showToast(
        t('installed.actions.copyFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        { tone: 'error' },
      );
    }
  };

  // Extract one source out of the open merged mod back to a standalone mod.
  // Errors propagate to the modal, which surfaces them inline; on success we
  // refresh the mod list and either re-sync the modal with the rebuilt merge or
  // close it when the merge collapsed (fewer than two sources left).
  const handleExtractMergeSource = async (source: MergedModSource) => {
    if (!mergedContentsMod) return;
    const result = await extractMergeSource(mergedContentsMod.id, source.fileName);
    await loadMods({ silent: true });
    if (result.collapsed) {
      setMergedContentsMod(null);
      showToast(`Merge dissolved (extracted ${source.modName})`, { tone: 'success', duration: 2200 });
      return;
    }
    setMergedContentsMod(result.merged);
    showToast(`Extracted ${source.modName}`, { tone: 'success', duration: 2200 });
  };

  const handleAddMergeSources = async (modIds: string[], strict: boolean) => {
    if (!mergedContentsMod) return;
    const targetId = mergedContentsMod.id;
    const result = await addMergeSources(targetId, modIds, strict);
    await loadMods({ silent: true });
    const refreshed = useAppStore.getState().mods.find((mod) => mod.id === targetId) ?? null;
    setMergedContentsMod(refreshed);
    showToast(
      t('mergedContents.addComplete', { count: result.addedFileNames.length }),
      { tone: 'success', duration: 2800 },
    );
  };

  /**
   * Update every outdated source of the open merge in one pass: resolve each
   * stale source to its current GameBanana file, download the replacements as
   * normal installs, then hand them all to a single `replaceMergeSources`
   * rebuild. One rebuild, not one per source.
   *
   * Sources that can't be confidently resolved (no clear replacement, or a
   * download that produced several VPKs with nothing to say which is the
   * replacement) are reported back rather than guessed at. The merge is left
   * alone for those; the per-source extract button is the manual route.
   */
  const handleUpdateMergeSources = async (): Promise<MergeSourceUpdateOutcome> => {
    const targetId = mergedContentsMod?.id;
    const staleFileNames = targetId ? mergedSourceUpdates.get(targetId) : undefined;
    const stale = (mergedContentsMod?.merged?.sources ?? []).filter((source) =>
      staleFileNames?.has(source.fileName),
    );
    if (!targetId || stale.length === 0) return { updated: 0, skipped: [] };

    const filesByModId = new Map<number, GameBananaFile[]>();
    const categoryByModId = new Map<number, number>();
    for (const [gbId, section] of mergeSourceModIds(stale)) {
      try {
        const details = await getModDetails(gbId, section);
        filesByModId.set(gbId, details.files ?? []);
        if (typeof details.category?.id === 'number') categoryByModId.set(gbId, details.category.id);
      } catch (err) {
        console.warn(`[MergeUpdate] failed to fetch files for GB mod ${gbId}:`, err);
      }
    }

    // Don't re-download a file the user already has installed standalone.
    const claimed = new Set<number>();
    for (const mod of mods) {
      if (typeof mod.gameBananaFileId !== 'number') continue;
      if (!filesByModId.has(mod.gameBananaId ?? -1)) continue;
      claimed.add(mod.gameBananaFileId);
    }

    const plan = planMergeSourceUpdates(stale, filesByModId, claimed);
    const skipped: MergeSourceUpdateSkip[] = plan.unresolved.map((entry) => ({
      modName: entry.source.modName,
      reason: entry.reason,
    }));
    if (plan.resolved.length === 0) return { updated: 0, skipped };

    try {
      await createSnapshot('pre-update');
    } catch (err) {
      console.warn('[MergeUpdate] failed to capture pre-update snapshot:', err);
    }

    // Snapshot the install list so each download's output can be identified as
    // the mods that were not there before it ran.
    const replacements: MergeSourceReplacement[] = [];
    for (const entry of plan.resolved) {
      const before = new Set(useAppStore.getState().mods.map((mod) => mod.id));
      try {
        await downloadMod(
          entry.gameBananaId,
          entry.fileId,
          entry.fileName,
          entry.section,
          categoryByModId.get(entry.gameBananaId) ?? 0,
        );
      } catch (err) {
        console.warn(`[MergeUpdate] download failed for ${entry.source.modName}:`, err);
        skipped.push({ modName: entry.source.modName, reason: 'download-failed' });
        continue;
      }
      await loadMods({ silent: true });
      const installed = useAppStore
        .getState()
        .mods.filter((mod) => !before.has(mod.id) && mod.gameBananaFileId === entry.fileId);
      if (installed.length !== 1) {
        // Zero means the archive yielded nothing usable; more than one means a
        // multi-VPK download where nothing identifies the replacement. Both
        // leave whatever landed installed as normal mods.
        skipped.push({
          modName: entry.source.modName,
          reason: installed.length === 0 ? 'download-failed' : 'multi-vpk',
        });
        continue;
      }
      replacements.push({ oldFileName: entry.source.fileName, newModId: installed[0].id });
    }

    if (replacements.length === 0) return { updated: 0, skipped };

    await replaceMergeSources(targetId, replacements);
    await loadMods({ silent: true });
    setMergedContentsMod(useAppStore.getState().mods.find((mod) => mod.id === targetId) ?? null);
    return { updated: replacements.length, skipped };
  };

  // Surface a non-fatal store notice (e.g. the 99-enabled cap) through the same
  // transient toast, then clear it from the store so it doesn't re-fire.
  useEffect(() => {
    if (!modsNotice) return;
    showToast(modsNotice, { tone: 'warning' });
    clearModsNotice();
  }, [modsNotice, clearModsNotice]);

  /**
   * Flip a single variant's enabled state. Variants are independent — a
   * mod's model VPK and its voice-lines VPK (same archive) or its red and
   * blue uploads (different archives on the same mod page) can each be on
   * or off without affecting the others. Sequential just because the store
   * action is single-mod.
   */
  const toggleVariant = async (target: Mod) => {
    await toggleMod(target.id);
  };

  const setGroupEnabled = async (group: Extract<ModEntry, { kind: 'group' }>, enabled: boolean): Promise<boolean> => {
    const targets = group.variants.filter((v) => v.enabled !== enabled);
    for (const v of targets) {
      const ok = await toggleMod(v.id);
      if (!ok) {
        return false;
      }
    }
    return true;
  };

  /** Top-level toggle on a grouped card. If anything is enabled, disable the
   *  whole group; otherwise open the picker so the user can choose the files. */
  const handleGroupToggle = async (group: Extract<ModEntry, { kind: 'group' }>) => {
    if (group.enabledVariants.length > 0) {
      await setGroupEnabled(group, false);
    } else {
      setPickerGroupId(group.groupKey);
    }
  };

  /**
   * Reorder a variant relative to one of its picker-siblings. Used by both
   * the chevron up/down buttons and the picker's drag-and-drop. Returns
   * early when the neighbor lives in a different section — cross-section
   * moves would silently flip a variant's on/off status, which the picker
   * UI explicitly blocks.
   *
   * The picker shows a group's variants sorted by priority, so the
   * before/after semantics match what the user sees: drop "before" puts
   * the source at the neighbor's slot (loads earlier, wins overlapping
   * files); drop "after" puts it just past the neighbor (loads later).
   *
   * Implementation: splice the source out of its section list, re-find the
   * neighbor's index (it may have shifted when source was removed), splice
   * the source back in before/after the neighbor, then pass the full
   * filename list to reorderMods. The backend renumbers densely 1..N
   * inside each section, so the index changes manifest as pak##_ renames
   * on disk.
   */
  const reorderVariantTo = async (
    source: Mod,
    neighbor: Mod,
    position: ReorderPosition
  ) => {
    if (source.id === neighbor.id) return;
    if (source.enabled !== neighbor.enabled) return;

    // Use `visibleMods` so absorbed merge sources aren't passed to
    // reorderMods — their fileNames are recorded in the merged mod's
    // manifest, and a rename would silently break unmerge recovery.
    const enabledMods = visibleMods.filter((m) => m.enabled).sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
    const disabledMods = visibleMods.filter((m) => !m.enabled).sort((a, b) => a.priority - b.priority);
    const section = source.enabled ? enabledMods : disabledMods;
    const next = section.slice();
    const srcIdx = next.findIndex((m) => m.id === source.id);
    if (srcIdx === -1) return;
    next.splice(srcIdx, 1);
    const neighborIdx = next.findIndex((m) => m.id === neighbor.id);
    if (neighborIdx === -1) return;
    const insertAt = position === 'before' ? neighborIdx : neighborIdx + 1;
    next.splice(insertAt, 0, source);
    const unchanged = next.every((m, i) => m.id === section[i]?.id);
    if (unchanged) return;

    const full = source.enabled
      ? [...next, ...disabledMods]
      : [...enabledMods, ...next];
    await reorderMods(full.map((m) => m.id));
  };

  /**
   * Convenience wrapper for the chevron buttons in the variant picker.
   * "Up" / "down" map to swapping with the picker-neighbor in the obvious
   * direction; reorderVariantTo handles the section-safety check.
   */
  const moveVariant = async (
    group: Extract<ModEntry, { kind: 'group' }>,
    target: Mod,
    direction: 'up' | 'down'
  ) => {
    const reorderableSiblings = group.variants.filter((v) => v.enabled === target.enabled);
    const idxInPicker = reorderableSiblings.findIndex((v) => v.id === target.id);
    if (idxInPicker === -1) return;
    const neighborIdx = direction === 'up' ? idxInPicker - 1 : idxInPicker + 1;
    if (neighborIdx < 0 || neighborIdx >= reorderableSiblings.length) return;
    const neighbor = reorderableSiblings[neighborIdx];
    await reorderVariantTo(target, neighbor, direction === 'up' ? 'before' : 'after');
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods({ silent: useAppStore.getState().modsLoaded });
    }
  }, [activeDeadlockPath, loadMods]);

  // Ctrl/Cmd+A: enter select mode (if not already) and select every visible
  // mod after search filtering. Must live above the early returns below so
  // the hook order is stable across renders. The handler reads the latest
  // `selectAllVisible` and `selectMode` via refs that are assigned
  // synchronously further down, after `selectAllVisible` is declared.
  const selectAllVisibleRef = useRef<() => void>(() => {});
  const selectModeRef = useRef(selectMode);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'a' && e.key !== 'A') return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Don't hijack Ctrl+A while the user is in a text field: the search
      // bar and any inline editors should keep their native select-all.
      if (tag === 'input' || tag === 'textarea' || (target?.isContentEditable ?? false)) {
        return;
      }
      e.preventDefault();
      if (!selectModeRef.current) setSelectMode(true);
      selectAllVisibleRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Refresh the mod list whenever any download completes — covers 1-Click
  // protocol installs (no UI navigation triggers loadMods) and the regular
  // Browse → Download flow when the user is already on this page.
  useEffect(() => {
    if (!activeDeadlockPath) return;
    const unsubscribe = window.electronAPI.onDownloadComplete(() => {
      loadMods();
    });
    return unsubscribe;
  }, [activeDeadlockPath, loadMods]);

  useEffect(() => {
    const loadConflictData = async () => {
      try {
        const conflicts = await getConflicts();
        const map = new Map<string, ModConflict[]>();
        for (const conflict of conflicts) {
          const existingA = map.get(conflict.modA) || [];
          existingA.push(conflict);
          map.set(conflict.modA, existingA);
          const existingB = map.get(conflict.modB) || [];
          existingB.push(conflict);
          map.set(conflict.modB, existingB);
        }
        setConflictMap(map);
        setConflictPairCount(conflicts.length);
      } catch {
        setConflictMap(new Map());
        setConflictPairCount(0);
      }
    };
    if (mods.length > 0) {
      loadConflictData();
    }
  }, [mods]);

  // Flag a mod when its stored gameBananaFileId is no longer in the live
  // non-archived file list. That is the only case runUpdate can meaningfully
  // act on: Pass 1 reinstalls when the id is still live (no real change), and
  // Pass 2 only swaps when the id is gone and a single replacement exists.
  // Matching that definition avoids false positives from page-only edits and
  // from authors adding alternate variants alongside an installed file.
  useEffect(() => {
    let cancelled = false;
    const checkUpdates = async () => {
      // Absorbed merge sources never enter `targets`: runUpdate would rewrite
      // the source VPK on disk and leave the merged VPK stale, so they can't be
      // updated in place. They are still checked separately below and reported
      // as information on the merged mod (see `mergedTargets`).
      // Mods with `ignoreUpdates` set are excluded too: the user pinned the
      // installed version on purpose (e.g. the author replaced the file with
      // one they don't want) and shouldn't see the pulse.
      const targets = visibleMods.filter(
        (m) =>
          !!m.gameBananaId &&
          typeof m.gameBananaFileId === 'number' &&
          m.gameBananaFileId > 0 &&
          !m.ignoreUpdates,
      );
      // Merged mods carry their sources' provenance in the manifest, so the
      // same live-file-list check answers "did any ingredient go stale?".
      const mergedTargets = visibleMods.filter((m) => !!m.merged && !m.ignoreUpdates);
      if (targets.length === 0 && mergedTargets.length === 0) {
        setUpdatesAvailable(new Set());
        setMergedSourceUpdates(new Map());
        return;
      }

      // One fetch per GB mod id; variants and merge sources share the result.
      const uniqueIds = new Map<number, string>();
      for (const m of targets) {
        if (!uniqueIds.has(m.gameBananaId!)) {
          uniqueIds.set(m.gameBananaId!, m.sourceSection ?? 'Mod');
        }
      }
      for (const m of mergedTargets) {
        for (const source of m.merged!.sources) {
          if (typeof source.gameBananaId !== 'number') continue;
          if (!uniqueIds.has(source.gameBananaId)) {
            uniqueIds.set(source.gameBananaId, source.section ?? 'Mod');
          }
        }
      }

      // Cap concurrency. An unbounded Promise.all here bursts N parallel
      // requests through the rate limiter and pins ~N JSON payloads in
      // renderer memory; with 70+ installed mods that visibly stalls the
      // page on mount. The slim getModFileList only pulls _idRow + _aFiles.
      const queue = Array.from(uniqueIds.entries()).filter(
        ([gbId]) => !updateCheckCache.has(gbId),
      );
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const idx = cursor++;
          if (idx >= queue.length) return;
          const [gbId, section] = queue[idx];
          try {
            const list = await getModFileList(gbId, section);
            const liveIds = new Set(
              list.files.filter((f) => !f.isArchived).map((f) => f.id),
            );
            updateCheckCache.set(gbId, liveIds.size > 0 ? liveIds : null);
          } catch {
            // Network or API failure: leave uncached so a later mount retries.
          }
        }
      };
      const concurrency = Math.min(5, queue.length);
      await Promise.all(Array.from({ length: concurrency }, worker));

      if (cancelled) return;
      const available = new Set<string>();
      for (const mod of targets) {
        const liveIds = updateCheckCache.get(mod.gameBananaId!);
        if (!liveIds) continue;
        if (!liveIds.has(mod.gameBananaFileId!)) {
          available.add(mod.id);
        }
      }
      setUpdatesAvailable(available);

      const staleByMerge = new Map<string, Set<string>>();
      for (const mod of mergedTargets) {
        const stale = new Set<string>();
        for (const source of mod.merged!.sources) {
          if (typeof source.gameBananaId !== 'number') continue;
          if (typeof source.gameBananaFileId !== 'number' || source.gameBananaFileId <= 0) continue;
          const liveIds = updateCheckCache.get(source.gameBananaId);
          if (!liveIds) continue;
          if (!liveIds.has(source.gameBananaFileId)) stale.add(source.fileName);
        }
        if (stale.size > 0) staleByMerge.set(mod.id, stale);
      }
      setMergedSourceUpdates(staleByMerge);
    };
    checkUpdates();
    return () => {
      cancelled = true;
    };
    // `visibleMods` is derived from `mods` and changes only when `mods`
    // does; listing it directly would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mods]);

  // Group variants sharing a GB mod id under a single card. Singletons and
  // custom imports (no GB id) keep their old card behavior. Absorbed merge
  // sources are excluded: they're represented by the merged mod card.
  // Memoized (and placed above the early returns, where hooks must live) so
  // entry object identities survive unrelated state changes (conflict map,
  // update flags, select mode). The memoized card wrapper depends on this:
  // rebuilding entries every render would re-render every card on each
  // page-level setState.
  const allEntries = useMemo(() => buildModEntries(visibleMods), [visibleMods]);
  const enabledEntries = useMemo(
    () =>
      allEntries
        .filter(isEntryEnabled)
        .sort((a, b) => entrySortPriority(a) - entrySortPriority(b)),
    [allEntries]
  );
  const disabledEntries = useMemo(
    () =>
      allEntries
        .filter((e) => !isEntryEnabled(e))
        .sort((a, b) => entrySortPriority(a) - entrySortPriority(b)),
    [allEntries]
  );

  // Per-entry hero/tag metadata, keyed by entry.key. entryHeroNames/entryTagKeys
  // do real work per mod (canonicalHeroName, tag-label regex splits,
  // inferHeroFromTitle for sounds), and the option-bucket + filter passes below
  // hit them for every entry on every render - including drag-start renders that
  // only flip draggingKey. Caching them here (rebuilt only when allEntries
  // changes) keeps those passes to cheap Map lookups, so a drag pickup paints the
  // overlay without rescanning the whole library. Mirrors entryConflicts.
  const entryFacetMeta = useMemo(() => {
    const byKey = new Map<string, { heroNames: string[]; tagKeys: string[] }>();
    for (const entry of allEntries) {
      byKey.set(entry.key, { heroNames: entryHeroNames(entry), tagKeys: entryTagKeys(entry) });
    }
    return byKey;
  }, [allEntries]);

  // List membership, deliberately kept OUT of entryFacetMeta: that cache is
  // rebuilt only when allEntries changes, so folding list ids into it would
  // either show stale membership after an assignment or force the whole facet
  // cache to be thrown away on every click. A separate index keyed the same way
  // stays correct and costs one Map lookup.
  const listMembership = useMemo(() => buildListMembershipIndex(modLists), [modLists]);
  // Per-entry list ids with identities that persist across renders (plus the
  // module-level EMPTY_LIST_IDS fallback), same contract as entryConflicts.
  const entryListIds = useMemo(() => {
    const byKey = new Map<string, string[]>();
    for (const entry of allEntries) {
      const ids = listMembership.get(entryDisabledPreferenceKey(entry));
      if (ids?.length) byKey.set(entry.key, ids);
    }
    return byKey;
  }, [allEntries, listMembership]);
  // Counts shown in the filter popover and the manage dialog. Live entries only,
  // so an orphaned key (uninstalled mod) never inflates a list's count.
  const listCounts = useMemo(
    () => countLiveMembers(modLists, new Set(allEntries.map(entryDisabledPreferenceKey))),
    [modLists, allEntries]
  );
  // Shaped for FilterCheckList, which the TAGS block uses too.
  const listFilterOptions = useMemo(
    () => modLists.map((list) => ({ key: list.id, label: list.name, count: listCounts.get(list.id) ?? 0 })),
    [modLists, listCounts]
  );

  // Conflict arrays per entry key, with identities that persist across
  // renders (plus the module-level EMPTY_CONFLICTS fallback) so memoized
  // cards only re-render when their own conflicts change.
  const entryConflicts = useMemo(() => {
    const byKey = new Map<string, ModConflict[]>();
    for (const entry of allEntries) {
      if (entry.kind === 'single') {
        const conflicts = conflictMap.get(entry.mod.id);
        if (conflicts?.length) byKey.set(entry.key, conflicts);
      } else {
        const aggregate: ModConflict[] = [];
        for (const variant of entry.variants) {
          if (!variant.enabled) continue;
          const conflicts = conflictMap.get(variant.id);
          if (conflicts) aggregate.push(...conflicts);
        }
        if (aggregate.length) byKey.set(entry.key, aggregate);
      }
    }
    return byKey;
  }, [allEntries, conflictMap]);

  // Entry-level handlers for the memoized cards. useStableCallback keeps
  // their identities fixed while the bodies see fresh state; the per-card
  // closures over these live inside InstalledEntryCard, behind its memo
  // boundary, so none of this re-renders the grid.
  const openEntryDetails = useStableCallback((mod: Mod) => {
    if (mod.merged) setMergedContentsMod(mod);
    else if (mod.gameBananaId) void openModDetails(mod);
  });
  const openEntryPicker = useStableCallback((groupKey: string) => {
    setPickerGroupId(groupKey);
  });
  // Open an artist's page inside Grimoire by entering Browse's artist mode (the
  // grid scoped to that submitter), the same surface the artist card in a mod's
  // details opens.
  const openArtistPage = useStableCallback((artist: BrowseArtistRef) => {
    if (!artist?.id || artist.id <= 0) return;
    closeModDetails();
    setBrowseUi({ submitter: artist });
    navigate('/browse');
  });
  // Kebab-menu entry point: we don't store the submitter locally, so resolve it
  // from the catalog cache first (instant when the mod is mirrored) and fall
  // back to a live details fetch before opening the artist page.
  const viewEntryAuthor = useStableCallback(async (mod: Mod) => {
    if (!mod.gameBananaId) return;
    try {
      const cached = await window.electronAPI.getCachedMod(mod.gameBananaId).catch(() => null);
      let artist: BrowseArtistRef | undefined =
        cached?.submitterId && cached.submitterId > 0
          ? { id: cached.submitterId, name: cached.submitterName ?? 'Artist', profileUrl: cached.profileUrl }
          : undefined;
      if (!artist) {
        const details = await getModDetails(mod.gameBananaId, mod.sourceSection ?? 'Mod', {
          includeSubmitter: true,
        });
        const s = details.submitter;
        if (s && s.id > 0) {
          artist = { id: s.id, name: s.name, avatarUrl: s.avatarUrl, profileUrl: s.profileUrl, kofiUrl: s.kofiUrl };
        }
      }
      if (!artist) {
        showToast(t('installed.actions.authorPageNotFound'), { tone: 'error' });
        return;
      }
      openArtistPage(artist);
    } catch (err) {
      showToast(`Couldn't open author page: ${err instanceof Error ? err.message : String(err)}`, {
        tone: 'error',
      });
    }
  });
  const toggleEntry = useStableCallback((entry: ModEntry) => {
    if (entry.kind === 'group') void handleGroupToggle(entry);
    else void toggleMod(entry.mod.id);
  });
  // Persist outside the setState updater: StrictMode double-invokes an updater,
  // and a write is a side effect even when it happens to be idempotent.
  const toggleEntryFavorite = useStableCallback((entry: ModEntry) => {
    const next = toggleFavoriteKey(disabledFavorites, entryDisabledPreferenceKey(entry));
    writeStoredDisabledFavorites(next);
    setDisabledFavorites(next);
  });

  // List mutations follow the same persist-outside-the-updater rule as the
  // favorite toggle above: modLists.ts is pure, this commits the result.
  const commitModLists = useStableCallback((next: ModList[]) => {
    writeStoredModLists(next);
    setModLists(next);
  });
  const toggleEntryList = useStableCallback((entry: ModEntry, listId: string) => {
    commitModLists(toggleListMembership(modLists, listId, entryDisabledPreferenceKey(entry)));
  });
  const openCreateListFor = useStableCallback((entry: ModEntry) => setCreatingListFor(entry));
  // Create, and file the entry the dialog was opened from into the new list.
  // createList reuses an existing list when the name matches, so typing the
  // name of a list you already have files it there instead of duplicating.
  // Filing is add-only for exactly that reason: a toggle here would un-file a
  // mod that is already in the list whose name was typed.
  const createListForEntry = useStableCallback((name: string) => {
    const entry = creatingListFor;
    const { lists, id } = createList(modLists, name);
    if (!id) return;
    commitModLists(entry ? addListMembership(lists, id, entryDisabledPreferenceKey(entry)) : lists);
  });
  const renameModList = useStableCallback((id: string, name: string) => {
    // renameList no-ops on a rejected name (blank, or taken by another list)
    // and reports which happened; the dialog uses this to restore the field
    // and explain why.
    const { lists, applied } = renameList(modLists, id, name);
    if (applied) commitModLists(lists);
    return applied;
  });
  const deleteModList = useStableCallback((id: string) => {
    commitModLists(deleteList(modLists, id));
    // Drop the selection too, or the grid keeps filtering on a list that no
    // longer exists and shows an empty shelf with no visible cause.
    setListFilter((prev) => prev.filter((selected) => selected !== id));
  });
  // A fully disabled group enables only its primary, same as picking one file
  // in the variant picker: variants are usually alternatives that conflict.
  const setModListEnabled = useStableCallback(async (id: string, enabled: boolean) => {
    if (bulkProgress) return;
    const keys = new Set(modLists.find((list) => list.id === id)?.keys);
    const targets = allEntries
      .filter((entry) => keys.has(entryDisabledPreferenceKey(entry)))
      .flatMap((entry) => {
        if (entry.kind === 'single') return entry.mod.enabled === enabled ? [] : [entry.mod];
        if (!enabled) return entry.enabledVariants;
        return entry.enabledVariants.length > 0 ? [] : [entry.primary];
      });
    if (targets.length > 0) await runBulkToggle(targets, enabled ? 'Enabling' : 'Disabling');
  });
  // "Start with only this mod enabled": solo the entry (disable everything else)
  // then launch. For a group we keep its already-enabled variants, or enable
  // every variant when the whole group is currently off. The prior enabled set
  // is snapshotted by soloMod for the restore banner.
  const soloLaunchEntry = useStableCallback(async (entry: ModEntry) => {
    if (soloBusyRef.current) return;
    soloBusyRef.current = true;
    setSoloBusy(true);
    try {
      const targetMods =
        entry.kind === 'group'
          ? (entry.enabledVariants.length > 0 ? entry.enabledVariants : entry.variants)
          : [entry.mod];
      const targetKeys = targetMods.map(modRestoreKey);
      const label = entry.kind === 'group' ? entry.primary.name : entry.mod.name;
      const { applied, failures, reason } = await soloMod(targetKeys, label);
      if (!applied) {
        if (reason === 'missing') {
          showToast(t('installed.solo.targetMissing'), { tone: 'error' });
        } else if (reason === 'gameRunning') {
          showToast(t('common.gameRunningWarning'), { tone: 'warning' });
        }
        return;
      }
      if (failures > 0) {
        showToast(t('installed.solo.partial', { count: failures }), { tone: 'warning' });
      }
      try {
        await launchModded();
      } catch (err) {
        showToast(String(err).replace(/^Error:\s*/, ''), { tone: 'error' });
      }
    } finally {
      soloBusyRef.current = false;
      setSoloBusy(false);
    }
  });
  const restoreSolo = useStableCallback(async () => {
    if (soloBusyRef.current) return;
    soloBusyRef.current = true;
    setSoloBusy(true);
    try {
      const { failures } = await restoreSoloMods();
      if (failures > 0) {
        showToast(t('installed.solo.restorePartial', { count: failures }), { tone: 'warning' });
      }
    } finally {
      soloBusyRef.current = false;
      setSoloBusy(false);
    }
  });
  const deleteEntry = useStableCallback((entry: ModEntry) => {
    if (entry.kind === 'group') {
      setModToDelete({
        ids: entry.variants.map((v) => v.id),
        name: entry.primary.name,
        isGroup: true,
      });
    } else {
      setModToDelete({ ids: [entry.mod.id], name: entry.mod.name, isGroup: false });
    }
  });
  const editLocalEntry = useStableCallback((mod: Mod) => setLocalEditMod(mod));
  const viewEntryImprint = useStableCallback((mod: Mod) => setImprintDetailsMod(mod));
  // Inline title rename (double-click). Reuses edit-local-mod but carries the
  // current thumbnail/NSFW flag through so renaming the name alone never wipes
  // them (the handler overwrites the full local-mod metadata triplet).
  const renameLocalMod = useStableCallback(async (mod: Mod, newName: string) => {
    await editLocalInstalledMod(mod, {
      name: newName,
      thumbnailDataUrl: mod.thumbnailUrl,
      nsfw: mod.nsfw,
    });
  });

  // LOCAL VARIANT GROUPS
  //
  // Grouping is derived from `localGroupId` (see lib/variantGroups.ts), so the
  // grid regroups on its own once main has written the sidecars: none of these
  // handlers touch entry state.
  const openAddVariant = useStableCallback((entry: ModEntry) => {
    const members = entry.kind === 'group' ? entry.variants : [entry.mod];
    setAddVariantTarget({
      modIds: members.map((m) => m.id),
      // Null for a standalone mod: importVariantsIntoGroup mints the group at
      // import time, so a dialog the user cancels leaves no stray id behind.
      groupId: members[0]?.localGroupId ?? null,
      modName: entry.kind === 'group' ? entry.primary.name : entry.mod.name,
    });
  });
  const importVariantsIntoGroup = useStableCallback(async (items: ImportCustomModArgs[]) => {
    const target = addVariantTarget;
    if (!target) return [];
    let groupId = target.groupId;
    if (!groupId) {
      groupId = await setLocalVariantGroup(target.modIds, { mode: 'mint' });
      if (!groupId) throw new Error(t('installed.variants.createGroupFailed'));
      // Remember it: the dialog stays open on a partial failure, and the retry
      // must land in this group rather than mint a second one.
      const minted = groupId;
      setAddVariantTarget((prev) =>
        prev ? { ...prev, groupId: minted, mintedGroupId: minted } : prev
      );
    }
    // Every row joins the group under the group's name; the per-file label
    // comes from the archive folder or filename, stamped by the import itself.
    return importCustomMods(
      items.map((item) => ({ ...item, name: target.modName, localGroupId: groupId }))
    );
  });
  // Closing without a single file landing undoes a mint from this dialog: the
  // lone member would otherwise keep a group id nothing else shares (harmless
  // on screen, since a one-member group renders as a plain card, but it is
  // state the user never asked for).
  const closeAddVariant = useStableCallback(() => {
    const target = addVariantTarget;
    setAddVariantTarget(null);
    if (!target?.mintedGroupId) return;
    // Read the store, not this render's `mods`: a successful import closes the
    // dialog immediately after updating the store, before React has re-rendered
    // this page, and the stale list would look like nothing joined.
    const members = useAppStore
      .getState()
      .mods.filter((m) => m.localGroupId === target.mintedGroupId);
    if (members.length !== 1) return;
    void setLocalVariantGroup([members[0].id], { mode: 'clear' }).catch(() => {
      // Best effort: the id is invisible either way.
    });
  });
  const reportVariantImport = useStableCallback((results: ImportCustomModResult[]) => {
    const imported = results.reduce((total, r) => total + (r.ok ? r.imported : 0), 0);
    const failed = results.filter((r) => !r.ok);
    if (imported > 0) {
      showToast(t('installed.batchImport.addedVariantsToast', { count: imported }), {
        tone: 'success',
      });
    }
    if (failed.length > 0) {
      showToast(
        t('installed.batchImport.failedToast', { count: failed.length, error: failed[0].error ?? '' }),
        { tone: 'error', duration: 9000 }
      );
    }
  });
  const ungroupEntry = useStableCallback(async (entry: ModEntry) => {
    if (entry.kind !== 'group') return;
    const count = entry.variants.length;
    try {
      await setLocalVariantGroup(entry.variants.map((v) => v.id), { mode: 'clear' });
      showToast(t('installed.variants.ungrouped', { count }), { tone: 'success' });
    } catch (err) {
      showToast(
        t('installed.variants.groupFailed', { error: toastErrorMessage(err) }),
        { tone: 'error' }
      );
    }
  });
  // Detach ONE file from a group. Main dissolves the group when this would
  // leave a single member behind, so no orphan id lingers.
  const detachVariant = useStableCallback(async (variant: Mod) => {
    try {
      await setLocalVariantGroup([variant.id], { mode: 'clear' });
      showToast(t('installed.variants.detached'), { tone: 'success' });
    } catch (err) {
      showToast(
        t('installed.variants.groupFailed', { error: toastErrorMessage(err) }),
        { tone: 'error' }
      );
    }
  });
  const tagEntryLocker = useStableCallback(async (entry: ModEntry, heroName: string | null) => {
    if (entry.kind === 'group') {
      for (const variant of entry.variants) await setModLockerHero(variant.id, heroName);
    } else {
      await setModLockerHero(entry.mod.id, heroName);
    }
  });
  const tagEntryGlobal = useStableCallback(async (entry: ModEntry, globalType: GlobalModType | null) => {
    if (entry.kind === 'group') {
      for (const variant of entry.variants) await setModGlobalType(variant.id, globalType);
    } else {
      await setModGlobalType(entry.mod.id, globalType);
    }
  });
  // Marking a grouped entry Global moves every variant, so a submission whose
  // files co-require each other (model plus voice lines) doesn't end up half in
  // the priority root. Sequential, like the other per-variant loops here: each
  // move renames a VPK under the main-process mutation lock.
  const setEntryPriority = useStableCallback(async (entry: ModEntry, priority: boolean) => {
    if (entry.kind === 'group') {
      for (const variant of entry.variants) await setModPriorityFolder(variant.id, priority);
    } else {
      await setModPriorityFolder(entry.mod.id, priority);
    }
  });
  const fixUnknownEntry = useStableCallback((mod: Mod) => openUnknownModFix(mod, 'single'));
  // commitLoadPosition is declared after the early returns (it reads the
  // compact order built there); bridge it through the same synchronous-ref
  // pattern as selectAllVisibleRef so a stable callback can live up here.
  const commitLoadPositionRef = useRef<(modId: string, newPosition: number) => Promise<void>>(
    () => Promise.resolve()
  );
  const commitEntryPriority = useStableCallback((modId: string, newPosition: number) =>
    commitLoadPositionRef.current(modId, newPosition)
  );
  const unmergeEntry = useStableCallback((mod: Mod) => setUnmergeTarget(mod));
  const copyEntryShareCode = useStableCallback((mod: Mod) => void handleCopyShareCode(mod));
  const selectToggleEntry = useStableCallback((entry: ModEntry) => toggleEntrySelection(entry));

  if (!activeDeadlockPath) {
    return (
      <EmptyState
        icon={Package}
        title={t('installed.empty.noGamePathTitle')}
        description={t('installed.empty.noGamePath')}
        action={
          <Button onClick={() => navigate('/settings')} icon={Settings}>
            {t('sidebar.openSettings')}
          </Button>
        }
      />
    );
  }

  if (modsLoading) {
    return <InstalledSkeleton viewMode={viewMode} gridStyle={cardSizeGridStyle} />;
  }

  if (modsError) {
    return (
      <EmptyState
        icon={Package}
        title={t('installed.empty.errorTitle')}
        description={modsError ?? undefined}
        variant="error"
        action={<Button onClick={() => loadMods()}>{t('common.actions.retry')}</Button>}
      />
    );
  }

  const compactOrder = buildCompactPriorityOrder(allEntries);
  const conflictCount = conflictPairCount;
  const unknownMods = mods
    .filter((mod) => mod.isUnknown)
    .sort((a, b) => a.priority - b.priority);
  const unknownFilterCacheById: Record<string, UnknownModFilterGuess> = {};
  for (const mod of unknownMods) {
    const cached = getUnknownCache(mod);
    if (cached) {
      unknownFilterCacheById[mod.id] = cached;
    }
  }
  // Auto-matching against GameBanana (CRC + filter search) is the rate-
  // limited path. Gated behind an experimental toggle while it's being
  // reworked; when off, only the manual "Make Custom Mod" path is offered.
  const autoMatchEnabled = settings?.experimentalUnknownModMatching ?? false;
  const selectedUnknownState = unknownFilterGuess
    ? {
        mod: unknownFilterGuess.mod,
        loading: unknownFilterPendingIds.has(unknownFilterGuess.mod.id),
        result: getUnknownCache(unknownFilterGuess.mod) ?? unknownFilterGuess.result,
        error: unknownFilterPendingIds.has(unknownFilterGuess.mod.id)
          ? undefined
          : unknownFilterErrors[unknownFilterGuess.mod.id] ?? unknownFilterGuess.error,
        cancelled: unknownFilterPendingIds.has(unknownFilterGuess.mod.id) ? false : unknownFilterGuess.cancelled,
        progress: unknownDetectionProgress[unknownFilterGuess.mod.id],
      }
    : null;
  // Cached per-entry hero/tag lookups (see entryFacetMeta); fall back to a live
  // compute if an entry somehow isn't in the cache.
  const heroNamesOf = (entry: ModEntry): string[] =>
    entryFacetMeta.get(entry.key)?.heroNames ?? entryHeroNames(entry);
  const tagKeysOf = (entry: ModEntry): string[] =>
    entryFacetMeta.get(entry.key)?.tagKeys ?? entryTagKeys(entry);

  // Hero and tag buckets are built from allEntries (not the filtered view) so
  // the option lists stay stable as selections change.
  const heroOptionMap = new Map<string, number>();
  const tagOptionMap = new Map<string, number>();
  for (const entry of allEntries) {
    for (const heroName of heroNamesOf(entry)) {
      heroOptionMap.set(heroName, (heroOptionMap.get(heroName) ?? 0) + 1);
    }
    for (const key of tagKeysOf(entry)) {
      tagOptionMap.set(key, (tagOptionMap.get(key) ?? 0) + 1);
    }
  }
  const heroOptions = HERO_NAMES_SORTED
    .filter((name) => heroOptionMap.has(name))
    .map((name) => ({ name, count: heroOptionMap.get(name) ?? 0 }));
  const tagOptions = Array.from(tagOptionMap.entries())
    .map(([key, count]) => ({ key, label: tagKeyLabel(key), count }))
    .sort((a, b) => {
      if (a.key === OTHER_TAG_KEY) return 1;
      if (b.key === OTHER_TAG_KEY) return -1;
      return a.label.localeCompare(b.label);
    });
  const localCount = allEntries.filter(entryIsLocal).length;
  const gbCount = allEntries.length - localCount;
  const enabledCount = enabledEntries.length;
  const disabledCount = disabledEntries.length;

  // Global load-order position (1..N) of each enabled mod, in true load order
  // (modLoadOrder folds in the addon-folder index, so overflow-folder mods rank
  // after base ones instead of restarting their pakNN at 1). Drives the
  // load-order badge so the displayed number never repeats across folders, and
  // commitLoadPosition repositions within this same ordering.
  const enabledByLoadOrder = visibleMods
    .filter((m) => m.enabled)
    .sort((a, b) => modLoadOrder(a) - modLoadOrder(b));
  // Priority-root (Global) mods sit outside the pakNN ordering: they win by
  // search-path position and reorderMods filters them out. Numbering only the
  // rest keeps positions 1..N meaningful and editable, while Global cards get
  // their own badge.
  const numberedByLoadOrder = enabledByLoadOrder.filter((m) => !m.priorityMod);
  const enabledModCount = numberedByLoadOrder.length;
  const loadPositionById = new Map(numberedByLoadOrder.map((m, i) => [m.id, i + 1] as const));

  const handleCopyEnabledMods = async () => {
    // Use the same enabled list the UI shows (visibleMods / load order), not the
    // raw store: that includes Locker-managed VPKs the Installed grid hides.
    const names = enabledByLoadOrder.map((m) => m.name);
    if (names.length === 0) return;
    try {
      await navigator.clipboard.writeText(names.join('\n'));
      showToast(t('installed.actions.copyEnabledToast', { count: names.length }), {
        tone: 'success',
        duration: 2200,
      });
    } catch (err) {
      showToast(
        t('installed.actions.copyFailed', {
          error: err instanceof Error ? err.message : String(err),
        }),
        { tone: 'error' },
      );
    }
  };

  // Filter by search query (substring on name), source (GameBanana vs local
  // import), hero, tags, and user lists, then optionally re-sort. Status
  // (enabled/disabled) is applied per-section below. Drag-and-drop reorder is
  // disabled whenever any of these is active (see viewIsReorderable) because the
  // displayed order no longer maps to load-order priority; the canonical
  // priority order lives on enabledEntries/compactOrder and is untouched.
  const searchNeedle = search.trim().toLowerCase();
  const matchesSearchEntry = (entry: ModEntry) =>
    !searchNeedle || entrySearchText(entry).toLowerCase().includes(searchNeedle);
  const matchesSourceEntry = (entry: ModEntry) =>
    entryIsLocal(entry) ? sourceSel.includes('local') : sourceSel.includes('gamebanana');
  const matchesHeroEntry = (entry: ModEntry) =>
    heroFilter === 'all' || heroNamesOf(entry).includes(heroFilter);
  const matchesTagEntry = (entry: ModEntry) =>
    tagFilter.length === 0 || tagKeysOf(entry).some((key) => tagFilter.includes(key));
  // Selecting several lists unions them (same as tags), but the list axis as a
  // whole ANDs with the others.
  const matchesListEntry = (entry: ModEntry) =>
    listFilter.length === 0 ||
    (entryListIds.get(entry.key) ?? EMPTY_LIST_IDS).some((id) => listFilter.includes(id));
  const matchesAllFilters = (entry: ModEntry) =>
    matchesSearchEntry(entry) &&
    matchesSourceEntry(entry) &&
    matchesHeroEntry(entry) &&
    matchesTagEntry(entry) &&
    matchesListEntry(entry);
  const sortEntries = (entries: ModEntry[]): ModEntry[] => {
    if (sortMode === 'name') {
      return [...entries].sort((a, b) =>
        entryName(a).localeCompare(entryName(b), undefined, { sensitivity: 'base' })
      );
    }
    if (sortMode === 'recent') {
      return [...entries].sort((a, b) => entryInstalledAt(b).localeCompare(entryInstalledAt(a)));
    }
    return entries; // 'priority' (already in load order).
  };
  // Both toggles on (length 2) = no filtering on that axis.
  const sourceActive = sourceSel.length !== 2;
  const statusActive = statusSel.length !== 2;
  const heroActive = heroFilter !== 'all';
  const filtersActive =
    sourceActive || statusActive || heroActive || tagFilter.length > 0 || listFilter.length > 0;
  const sortActive = sortMode !== 'priority';
  const viewIsReorderable = !searchNeedle && !filtersActive && !sortActive;
  const activeAdjustmentCount =
    (sourceActive ? 1 : 0) +
    (statusActive ? 1 : 0) +
    (heroActive ? 1 : 0) +
    tagFilter.length +
    listFilter.length +
    (sortActive ? 1 : 0);
  const visibleEnabled = statusSel.includes('enabled')
    ? sortEntries(enabledEntries.filter(matchesAllFilters))
    : [];
  const defaultSortedDisabled = sortEntries(disabledEntries.filter(matchesAllFilters));
  const disabledDefaultIndex = new Map(
    defaultSortedDisabled.map((entry, index) => [entry.key, index])
  );
  // A-Z drops the saved drag order (that's the point of asking for it) but
  // keeps the pinned band: the star's promise is "pins it to the top", so
  // favorites sort A-Z among themselves, then everything else does.
  const disabledAlphabetical = disabledSortMode === 'name';
  const visibleDisabled = statusSel.includes('disabled')
    ? [...defaultSortedDisabled].sort(createDisabledEntryComparator({
        favorites: disabledFavorites,
        manualOrder: disabledAlphabetical ? [] : disabledOrder,
        keyOf: entryDisabledPreferenceKey,
        fallback: disabledAlphabetical
          ? (left, right) =>
              entryName(left).localeCompare(entryName(right), undefined, { sensitivity: 'base' })
          : (left, right) =>
              (disabledDefaultIndex.get(left.key) ?? 0) - (disabledDefaultIndex.get(right.key) ?? 0),
      }))
    : [];
  const totalMatches = visibleEnabled.length + visibleDisabled.length;
  const detailsNavigationEntries = [...visibleEnabled, ...visibleDisabled].filter(
    (entry) => typeof entryPrimaryMod(entry).gameBananaId === 'number'
  );
  const detailsNavigationIndex = detailsSourceModId
    ? detailsNavigationEntries.findIndex((entry) =>
        entry.kind === 'single'
          ? entry.mod.id === detailsSourceModId
          : entry.variants.some((variant) => variant.id === detailsSourceModId)
      )
    : -1;
  const previousDetailsEntry =
    detailsNavigationIndex > 0 ? detailsNavigationEntries[detailsNavigationIndex - 1] : undefined;
  const nextDetailsEntry =
    detailsNavigationIndex >= 0 && detailsNavigationIndex < detailsNavigationEntries.length - 1
      ? detailsNavigationEntries[detailsNavigationIndex + 1]
      : undefined;
  const navigateToDetailsEntry = (entry: ModEntry) => {
    void openModDetails(entryPrimaryMod(entry));
  };

  const selectAllVisible = () => {
    const ids = new Set<string>();
    for (const entry of [...visibleEnabled, ...visibleDisabled]) {
      if (entry.kind === 'single') ids.add(entry.mod.id);
      else entry.variants.forEach((v) => ids.add(v.id));
    }
    setSelectedIds(ids);
  };

  // Keep the Ctrl/Cmd+A handler (installed above) pointed at the latest
  // closures. Synchronous assignment (not useEffect) so the hook count stays
  // stable across the early returns higher up.
  selectAllVisibleRef.current = selectAllVisible;
  selectModeRef.current = selectMode;

  const resetDragState = () => {
    setDraggingKey(null);
    setDraggingSection(null);
    setDragDraftOrder(null);
  };

  const resetDragStateAfterDrop = () =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => {
        resetDragState();
        dropCommitPendingRef.current = false;
        resolve();
      }, DROP_STATE_RESET_DELAY_MS);
    });

  /** Locate the entry that holds a given mod id within a section's entries. */
  const findEntryForModId = (entries: ModEntry[], id: string): ModEntry | undefined => {
    return entries.find((e) =>
      e.kind === 'single' ? e.mod.id === id : e.variants.some((v) => v.id === id)
    );
  };

  const orderEntriesByKeys = (entries: ModEntry[], keys: string[]): ModEntry[] => {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const ordered = keys
      .map((key) => byKey.get(key))
      .filter((entry): entry is ModEntry => !!entry);
    const seen = new Set(ordered.map((entry) => entry.key));
    const missing = entries.filter((entry) => !seen.has(entry.key));
    return [...ordered, ...missing];
  };

  const previewEntriesForDrag = (
    entries: ModEntry[],
    section: DragSection
  ): ModEntry[] => {
    if (dragDraftOrder?.section !== section) {
      return entries;
    }
    return orderEntriesByKeys(entries, dragDraftOrder.keys);
  };

  const previewEnabled = previewEntriesForDrag(visibleEnabled, 'enabled');
  const previewDisabled = previewEntriesForDrag(visibleDisabled, 'disabled');

  const sortableEnabled = viewIsReorderable && !selectMode;

  const visibleEntriesForSection = (section: DragSection): ModEntry[] =>
    section === 'enabled' ? visibleEnabled : visibleDisabled;

  const previewEntriesForSection = (section: DragSection): ModEntry[] =>
    section === 'enabled' ? previewEnabled : previewDisabled;

  const handleSortableDragStart = ({ active }: DragStartEvent, section: DragSection) => {
    const activeKey = String(active.id);
    const entry = visibleEntriesForSection(section).find((candidate) => candidate.key === activeKey);
    if (!entry) return;
    setDraggingKey(entry.key);
    setDraggingSection(section);
  };

  const handleSortableDragEnd = async ({ active, over }: DragEndEvent, section: DragSection) => {
    const activeKey = String(active.id);
    const overKey = over ? String(over.id) : null;
    if (!overKey || activeKey === overKey) {
      resetDragState();
      return;
    }

    const entries = visibleEntriesForSection(section);
    const oldIndex = entries.findIndex((entry) => entry.key === activeKey);
    const newIndex = entries.findIndex((entry) => entry.key === overKey);
    if (oldIndex === -1 || newIndex === -1) {
      resetDragState();
      return;
    }

    const sourceEntry = entries[oldIndex];
    const targetEntry = entries[newIndex];
    const draftKeys = arrayMove(entries.map((entry) => entry.key), oldIndex, newIndex);
    setDragDraftOrder({ section, keys: draftKeys });
    dropCommitPendingRef.current = true;

    await applyReorder(
      entryRepresentativeId(sourceEntry),
      entryRepresentativeId(targetEntry),
      section,
      draftKeys
    ).then(resetDragStateAfterDrop, resetDragStateAfterDrop);
  };

  /**
   * Entry-aware drag reorder. Singles move one mod; groups move all their
   * files as a block, keeping internal priority order. After the reshuffle
   * we flatten back to a filename list and hand it to reorderMods, which
   * renames pak##_ prefixes to lock in new priorities.
   */
  const applyReorder = async (
    sourceId: string,
    targetId: string,
    section: DragSection,
    draftKeys: string[]
  ): Promise<boolean> => {
    if (sourceId === targetId) return false;
    const entries = section === 'enabled' ? enabledEntries : disabledEntries;
    const sourceEntry = findEntryForModId(entries, sourceId);
    const targetEntry = findEntryForModId(entries, targetId);
    if (!sourceEntry || !targetEntry || sourceEntry.key === targetEntry.key) return false;

    const orderedEntries = orderEntriesByKeys(entries, draftKeys);
    if (section === 'disabled') {
      const nextOrder = orderedEntries.map(entryDisabledPreferenceKey);
      writeStoredDisabledOrder(nextOrder);
      setDisabledOrder(nextOrder);
      return true;
    }

    const next = flattenEntries(orderedEntries);
    const prev = flattenEntries(entries);
    if (next.length !== prev.length) return false;
    const unchanged = next.every((m, i) => m.id === prev[i]?.id);
    if (unchanged) return false;

    await reorderMods(next.map((m) => m.id));
    return true;
  };

  const fixOrder = () => {
    if (compactOrder.length === 0) return;
    reorderMods(compactOrder.map((m) => m.id));
  };

  /**
   * Commit a typed load-order position from the Load editor. The number is a
   * 1-based global position over the enabled mods (1 = loads first), so we move
   * the mod to that index in the global enabled order and hand the full id list
   * to reorderMods, which lays the slots out densely across addon folders. This
   * replaces the old pakNN-rename path, which restarted its number per overflow
   * folder and could collide; repositioning can never "already be in use".
   *
   * Calls the API directly (not the store wrappers) so errors propagate back
   * to PriorityEditor for inline display instead of being swallowed into
   * modsError.
   */
  const commitLoadPosition = async (modId: string, newPosition: number): Promise<void> => {
    const ordered = numberedByLoadOrder.slice();
    const fromIdx = ordered.findIndex((m) => m.id === modId);
    if (fromIdx === -1) throw new Error('Mod not found');
    // The editor validates 1..N, but a stale render could submit out of range;
    // clamp to a real slot so we never index past the ends.
    const toIdx = Math.min(Math.max(newPosition - 1, 0), ordered.length - 1);
    if (toIdx === fromIdx) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    await apiReorderMods(ordered.map((m) => m.id));
    await loadMods();
  };
  // Keep the stable commitEntryPriority callback (declared above the early
  // returns) pointed at the latest closure. Synchronous assignment, same
  // pattern as selectAllVisibleRef.
  commitLoadPositionRef.current = commitLoadPosition;

  /**
   * Render a single entry as a memoized InstalledEntryCard (which builds the
   * actual ModCard). Centralizes both the "single mod" and "grouped variants"
   * paths so the enabled/disabled sections don't each carry a 40-line inline
   * JSX block. Group cards: see InstalledEntryCard's group branch.
   *
   * Everything passed here is a primitive, a stable reference (memoized
   * entries/conflicts, useStableCallback handlers), or derived per card, so
   * unrelated page state changes leave the card subtrees untouched.
   */
  const cardPropsFor = (entry: ModEntry): InstalledEntryCardProps => ({
    entry,
    viewMode,
    hideNsfwPreviews: installedHideNsfwPreviews,
    soundVolume,
    conflicts: entryConflicts.get(entry.key) ?? EMPTY_CONFLICTS,
    updateAvailable:
      entry.kind === 'single'
        ? updatesAvailable.has(entry.mod.id)
        : entry.variants.some((v) => updatesAvailable.has(v.id)),
    staleSourceCount:
      entry.kind === 'single' ? (mergedSourceUpdates.get(entry.mod.id)?.size ?? 0) : 0,
    fixingUnknown: entry.kind === 'single' && unknownFilterPendingIds.has(entry.mod.id),
    loadPosition: loadPositionById.get(entryRepresentativeId(entry)),
    loadCount: enabledModCount,
    selectMode,
    selected: isEntrySelected(entry),
    soloBusy,
    favorite: disabledFavorites.has(entryDisabledPreferenceKey(entry)),
    onOpenDetails: openEntryDetails,
    onViewAuthor: viewEntryAuthor,
    onOpenPicker: openEntryPicker,
    onToggle: toggleEntry,
    onSoloLaunch: soloLaunchEntry,
    onDelete: deleteEntry,
    onEditLocal: editLocalEntry,
    onRenameLocal: renameLocalMod,
    onAddVariant: openAddVariant,
    onUngroupVariants: ungroupEntry,
    onViewImprint: viewEntryImprint,
    onTagLocker: tagEntryLocker,
    onTagGlobal: tagEntryGlobal,
    onSetPriority: setEntryPriority,
    onFixUnknown: fixUnknownEntry,
    onCommitPriority: commitEntryPriority,
    onUnmerge: unmergeEntry,
    onCopyShareCode: copyEntryShareCode,
    onSelectToggle: selectToggleEntry,
    onToggleFavorite: toggleEntryFavorite,
    lists: modLists,
    listIds: entryListIds.get(entry.key) ?? EMPTY_LIST_IDS,
    onToggleList: toggleEntryList,
    onCreateList: openCreateListFor,
  });

  const renderEntryCard = (entry: ModEntry) => <InstalledEntryCard {...cardPropsFor(entry)} />;

  const renderSortableSection = (section: DragSection) => {
    const entries = previewEntriesForSection(section);
    // A-Z is a display order, so a drop in the disabled section would have
    // nowhere to be saved. The enabled section keeps its handles either way.
    const sectionSortable =
      sortableEnabled && !(section === 'disabled' && disabledAlphabetical);
    const activeEntry = draggingSection === section
      ? entries.find((entry) => entry.key === draggingKey)
      : undefined;
    const gridClasses =
      layout === 'list' ? 'space-y-1.5' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4';
    const gridStyle =
      layout === 'list'
        ? undefined
        : cardSizeGridStyle;

    return (
      <DndContext
        sensors={sortableSensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => handleSortableDragStart(event, section)}
        onDragEnd={(event) => {
          void handleSortableDragEnd(event, section);
        }}
        onDragCancel={resetDragState}
      >
        <SortableContext
          items={entries.map((entry) => entry.key)}
          strategy={layout === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
        >
          <div className={gridClasses} style={gridStyle}>
            {(gridWarm ? entries : entries.slice(0, INITIAL_MOUNT_COUNT)).map((entry) => (
              <SortableEntryCard
                key={entry.key}
                sortableDisabled={!sectionSortable}
                {...cardPropsFor(entry)}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeEntry ? (
            <div className="pointer-events-none opacity-95 shadow-2xl">
              {renderEntryCard(activeEntry)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  // No mods at all
  if (mods.length === 0) {
    return (
      <>
        <EmptyState
          icon={Package}
          title={t('installed.empty.noModsTitle')}
          description={t('installed.empty.noMods')}
          action={
            <div className="flex items-center gap-3">
              <Button onClick={() => navigate('/browse')} icon={Search}>
                {t('installed.actions.browseMods')}
              </Button>
              <Button variant="secondary" onClick={() => openBatchImport()} icon={FilePlus}>
                {t('installed.actions.importCustomMod')}
              </Button>
            </div>
          }
        />
      </>
    );
  }

  // Conflicts, update-all, and fix-unknown buttons. Rendered once, in the top
  // action bar's right cluster (next to Fix Order). The right cluster wraps when
  // cramped, so there's no need to relocate them to a section header.
  const hasStatusButtons =
    conflictCount > 0 || updatesAvailable.size > 0 || !!updateAllProgress || unknownMods.length > 0;
  const statusButtons = hasStatusButtons ? (
    <div className="flex flex-wrap items-center gap-2">
      {conflictCount > 0 && (
        <Button
          variant="warning"
          size="sm"
          onClick={() => navigate('/conflicts')}
          icon={AlertTriangle}
        >
          {t('installed.status.conflictCount', { count: conflictPairCount })}
        </Button>
      )}
      {(updatesAvailable.size > 0 || updateAllProgress) && (
        <Button
          variant="primary"
          size="sm"
          onClick={() => setUpdateAllConfirmOpen(true)}
          icon={Download}
          isLoading={!!updateAllProgress}
          aria-live="polite"
          title={
            updateAllProgress
              ? 'Update in progress. Please wait until all mods finish before starting another.'
              : "Re-download every mod with a newer version on GameBanana and restore each one's enabled state"
          }
        >
          {updateAllProgress
            ? `Updating ${updateAllProgress.done}/${updateAllProgress.total}…`
            : `Update all (${updatesAvailable.size})`}
        </Button>
      )}
      {unknownMods.length > 0 &&
        (fixUnknownHidden ? (
          <button
            type="button"
            onContextMenu={(e) => {
              e.preventDefault();
              setFixUnknownHidden(false);
            }}
            aria-label={`Restore the Fix unknown button (${unknownMods.length} unknown)`}
            title={t('installed.unknown.fixHiddenHint')}
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-secondary/40 transition-colors hover:text-text-secondary cursor-pointer"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => openBulkUnknownFix(unknownMods)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFixUnknownHidden(true);
            }}
            icon={HelpCircle}
            isLoading={dmmAutoImporting}
            disabled={dmmAutoImporting}
            title={t('installed.unknown.fixButtonHint')}
          >
            {t('installed.unknown.fixButton', { count: unknownMods.length })}
          </Button>
        ))}
    </div>
  ) : null;
  const topStatusActions =
    hasStatusButtons || viewIsReorderable || enabledModCount > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        {statusButtons}
        {/* After Fix Unknown (last status button): copy enabled names in load order. */}
        {enabledModCount > 0 && (
          <Button
            variant="secondary"
            onClick={handleCopyEnabledMods}
            icon={ClipboardList}
            className="!px-2.5"
            aria-label={t('installed.actions.copyEnabled')}
            title={t('installed.actions.copyEnabledHint')}
          />
        )}
        {viewIsReorderable && (
          <Button
            variant="secondary"
            onClick={fixOrder}
            icon={Wrench}
            className="!px-2.5"
            aria-label={t('installed.actions.fixOrder')}
            title={t('installed.actions.fixOrderHint')}
          />
        )}
      </div>
    ) : null;

  return (
    <div ref={installedScrollRef} className="h-full overflow-y-auto px-4 pb-5 sm:px-6">
      <div
        className={`sticky top-0 z-30 -mx-4 mb-4 border-b border-hl/5 px-4 py-3 sm:-mx-6 sm:px-6 ${
          settings?.sidebarTransparent
            ? 'app-background-fixed'
            : 'bg-bg-primary/95 backdrop-blur supports-[backdrop-filter]:bg-bg-primary/80'
        }`}
      >
        {/* Row 1: search + view controls. The search takes every pixel the
            controls don't need (uncapped flex-1) so there's no dead gap at wide
            window widths, and shrinks to min-w instead of pushing the controls
            onto a right-aligned orphan row when cramped. */}
        <div className="flex items-center gap-2 lg:gap-3">
          <div className="relative min-w-[11rem] flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('installed.filters.searchPlaceholder')}
              className={`bg-bg-secondary border border-border rounded-lg pl-8 ${search ? 'pr-8' : 'pr-3'} py-2 text-sm text-text-primary placeholder:text-text-primary/55 focus:outline-none focus:ring-2 focus:ring-accent w-full`}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                title={t('installed.filters.clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-tertiary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* Contextual status + reorder actions ride the same row as the
                view controls (wrapping together when cramped) instead of
                claiming a second strip below the search. Copy-enabled sits
                inside topStatusActions, immediately after Fix Unknown. */}
            {topStatusActions}
            {/* Retroactive bulk imprint launcher (experimental, opt-in).
                Icon-only, same shape/height as the other toolbar icon buttons
                (copy enabled, fix order, filter) so it rides the cluster
                without claiming its own strip. Name lives in the tooltip /
                aria-label. Opens the preflight modal. */}
            {/* Hide-when-done: the button only exists while something could
                still be imprinted. After a successful bulk run loadMods()
                refreshes the list, the count reaches zero, and the button
                unmounts; the result modal stays up (it renders on
                imprintState, not on this condition). */}
            {settings?.experimentalVpkImprinting && pendingImprintCount > 0 && (
              <Button
                variant="secondary"
                icon={Fingerprint}
                className="!px-2.5"
                onClick={() => { void openImprintModal(); }}
                aria-label={t('installed.actions.imprintInstalledMods')}
                title={t('installed.actions.imprintInstalledModsHint')}
              />
            )}
            {/* Sort + filter: load order / recent / name, GameBanana vs local
                import, hero, and metadata tags. The badge counts active
                adjustments; while any are on, the list is read-only (no drag
                reorder) so it can't be mistaken for load order. order-last keeps
                it grouped with card size and layout controls at the row end. */}
            <div className="relative order-last" ref={filterRef}>
              <Button
                variant={activeAdjustmentCount > 0 ? 'primary' : 'secondary'}
                onClick={() => setFilterOpen((v) => !v)}
                icon={SlidersHorizontal}
                className="!px-2.5"
                aria-label={t('installed.filters.sortAndFilter')}
                title={t('installed.filters.sortAndFilterHint')}
              />
              {activeAdjustmentCount > 0 && (
                <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground ring-2 ring-bg-primary">
                  {activeAdjustmentCount}
                </span>
              )}
              {filterOpen && (
                // max-height is measured, not declared: see the layout effect
                // above. HeroSelect portals its listbox, so the HERO dropdown
                // overlays the page instead of clipping at this scroll edge.
                <div
                  ref={filterPanelRef}
                  className="absolute right-0 top-full z-40 mt-2 w-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-bg-secondary p-3 text-sm font-sans shadow-xl shadow-black/40 [&_button]:font-sans"
                >
                  <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                    <ArrowDownUp className="h-3.5 w-3.5" /> {t('installed.filters.sort')}
                  </div>
                  <div className="space-y-1">
                    {([
                      ['priority', t('installed.filters.loadOrder')],
                      ['recent', t('installed.filters.recentlyAdded')],
                      ['name', t('browse.sort.nameAZ')],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSortMode(value)}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors cursor-pointer ${
                          sortMode === value
                            ? 'bg-accent/15 text-text-primary'
                            : 'text-text-secondary hover:bg-hl/5 hover:text-text-primary'
                        }`}
                      >
                        <span>{label}</span>
                        {sortMode === value && <Check className="h-3.5 w-3.5 text-accent" />}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                      {t('installed.filters.source')}
                    </div>
                    <div className="flex gap-1">
                      {([
                        ['gamebanana', t('installed.filters.gamebanana'), gbCount],
                        ['local', t('installed.filters.local'), localCount],
                      ] as const).map(([value, label, count]) => {
                        const on = sourceSel.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setSourceSel((prev) =>
                                prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
                              )
                            }
                            aria-pressed={on}
                            className={`flex-1 rounded-md border px-1.5 py-1 text-2xs transition-colors cursor-pointer ${
                              on
                                ? 'border-accent/50 bg-accent/15 text-text-primary'
                                : 'border-border text-text-secondary opacity-50 hover:border-hl/20 hover:text-text-primary'
                            }`}
                          >
                            {label}
                            <span className="ml-1 opacity-60">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                      {t('installed.filters.status')}
                    </div>
                    <div className="flex gap-1">
                      {([
                        ['enabled', t('installed.filters.enabled'), enabledCount],
                        ['disabled', t('locker.global.disabledBadge'), disabledCount],
                      ] as const).map(([value, label, count]) => {
                        const on = statusSel.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setStatusSel((prev) =>
                                prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
                              )
                            }
                            aria-pressed={on}
                            className={`flex-1 rounded-md border px-1.5 py-1 text-2xs transition-colors cursor-pointer ${
                              on
                                ? 'border-accent/50 bg-accent/15 text-text-primary'
                                : 'border-border text-text-secondary opacity-50 hover:border-hl/20 hover:text-text-primary'
                            }`}
                          >
                            {label}
                            <span className="ml-1 opacity-60">{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {heroOptions.length > 0 && (
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                          {t('installed.filters.hero')}
                        </span>
                        {heroFilter !== 'all' && (
                          <button
                            type="button"
                            onClick={() => setHeroFilter('all')}
                            className="text-2xs text-accent hover:underline cursor-pointer"
                          >
                            {t('common.actions.clear')}
                          </button>
                        )}
                      </div>
                      <HeroSelect
                        ariaLabel="Filter by hero"
                        value={heroFilter}
                        onChange={setHeroFilter}
                        size="sm"
                        options={[
                          { value: 'all', label: t('browse.filters.allHeroes'), muted: true },
                          ...heroOptions.map((hero) => ({
                            value: hero.name,
                            label: `${hero.name} (${hero.count})`,
                            heroName: hero.name,
                          })),
                        ]}
                      />
                    </div>
                  )}

                  {tagOptions.length > 1 && (
                    <FilterCheckList
                      label={t('installed.filters.tags')}
                      options={tagOptions}
                      selected={tagFilter}
                      onToggle={(key) =>
                        setTagFilter((prev) =>
                          prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                        )
                      }
                      onClear={() => setTagFilter([])}
                    />
                  )}

                  {/* Rendered from modLists, not from the entry tag buckets, so
                      a list you just created stays visible while it is empty. */}
                  {modLists.length > 0 && (
                    <FilterCheckList
                      label={t('installed.filters.lists')}
                      options={listFilterOptions}
                      selected={listFilter}
                      onToggle={(id) =>
                        setListFilter((prev) =>
                          prev.includes(id) ? prev.filter((selected) => selected !== id) : [...prev, id]
                        )
                      }
                      onClear={() => setListFilter([])}
                      action={
                        <button
                          type="button"
                          onClick={() => setManagingLists(true)}
                          className="text-2xs text-text-secondary hover:text-text-primary hover:underline cursor-pointer"
                        >
                          {t('installed.lists.manage')}
                        </button>
                      }
                    />
                  )}

                  {activeAdjustmentCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSortMode('priority');
                        setSourceSel(['gamebanana', 'local']);
                        setStatusSel(['enabled', 'disabled']);
                        setHeroFilter('all');
                        setTagFilter([]);
                        setListFilter([]);
                      }}
                      className="mt-3 w-full rounded-md border border-border px-2 py-1.5 text-2xs uppercase tracking-wider text-text-secondary transition-colors hover:border-hl/20 hover:text-text-primary cursor-pointer"
                    >
                      {t('common.actions.reset')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <Button
              variant="secondary"
              onClick={() => openBatchImport()}
              icon={FilePlus}
              className="!px-2.5"
              aria-label={t('installed.actions.addCustomMod')}
              title={t('installed.actions.addCustomModHint')}
            />
            <Button
              variant="secondary"
              onClick={() => openModsFolder().catch(() => {})}
              icon={FolderOpen}
              className="!px-2.5"
              aria-label={t('installed.actions.openModsFolder')}
              title={t('installed.actions.openModsFolder')}
            />
            <Button
              variant={selectMode ? 'primary' : 'secondary'}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              icon={CheckSquare}
              disabled={!!bulkProgress}
              className="!px-2.5"
              aria-label={selectMode ? t('installed.actions.exitSelectionMode') : t('installed.actions.selectMultiple')}
              title={selectMode ? t('installed.actions.exitSelectionMode') : t('installed.actions.selectMultipleHint')}
            />

            {/* Locker overrides: hero cards + ability sounds + ability colors
                applied off the mod list. The badge shows how many are active;
                the popup reviews, previews, and removes them. */}
            <div className="relative">
              <Button
                variant="secondary"
                onClick={() => setLockerOverridesOpen(true)}
                icon={Wand2}
                className="!px-2.5"
                aria-label={t('installed.actions.lockerOverrides')}
                title={t('installed.actions.lockerOverridesHint')}
              />
              {lockerOverrideCount > 0 && (
                <span className="pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground ring-2 ring-bg-primary">
                  {lockerOverrideCount}
                </span>
              )}
            </div>

            {/* Style (grid vs list) + card size collapsed into one dropdown so
                they don't claim a stretch of toolbar width. Card size is only
                meaningful in grid, so it's disabled (and dimmed) while List is
                active rather than hidden, keeping the popover from reflowing. */}
            <div className="relative order-last" ref={viewMenuRef}>
              <Button
                variant="secondary"
                onClick={() => setViewMenuOpen((v) => !v)}
                icon={layout === 'list' ? List : LayoutGrid}
                className="!px-2.5"
                aria-label={t('installed.view.viewOptions')}
                aria-expanded={viewMenuOpen}
                title={t('installed.view.styleAndCardSize')}
              />
              {viewMenuOpen && (
                <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-border bg-bg-secondary p-3 text-sm font-sans shadow-xl shadow-black/40 [&_button]:font-sans [&_input]:font-sans">
                  <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                    {t('installed.view.style')}
                  </div>
                  <ViewModeToggle
                    className="w-full"
                    value={layout}
                    options={[
                      { value: 'grid', label: t('conflicts.view.grid'), icon: LayoutGrid },
                      { value: 'list', label: t('conflicts.view.list'), icon: List },
                    ]}
                    onChange={(mode) => setLayout(mode === 'list' ? 'list' : 'grid')}
                  />

                  <div className="mt-3 border-t border-border pt-3">
                    <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-text-secondary">
                      {t('installed.view.cardSize')}
                    </div>
                    <div
                      className={`flex items-center gap-2 transition-opacity ${
                        layout === 'list' ? 'opacity-40' : ''
                      }`}
                      title={t('installed.view.cardSizeHint')}
                    >
                      <Grid3x3 className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                      <input
                        type="range"
                        min={CARD_SIZE_MULTIPLIER_MIN}
                        max={CARD_SIZE_MULTIPLIER_MAX}
                        step={CARD_SIZE_MULTIPLIER_STEP}
                        value={cardSizeMultiplier}
                        disabled={layout === 'list'}
                        onChange={(e) => setCardSizeMultiplier(Number(e.currentTarget.value))}
                        aria-label={t('installed.view.cardSize')}
                        aria-valuetext={`${cardSizeMultiplier.toFixed(2)}x card size`}
                        className="h-1.5 flex-1 cursor-pointer accent-accent disabled:cursor-default"
                      />
                      <LayoutGrid className="h-5 w-5 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                    </div>
                    {layout === 'list' && (
                      <p className="mt-1.5 text-2xs text-text-secondary">
                        {t('installed.view.cardSizeGridOnly')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {soloRestore && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5">
          <Beaker className="h-4 w-4 flex-shrink-0 text-accent" />
          <span className="flex-1 text-sm text-text-primary">
            {t('installed.solo.banner', { name: soloRestore.label })}
          </span>
          <Button variant="secondary" size="sm" disabled={soloBusy} onClick={() => void restoreSolo()}>
            {t('installed.solo.restore')}
          </Button>
          <button
            type="button"
            disabled={soloBusy}
            onClick={() => clearSoloRestore()}
            title={t('common.actions.dismiss')}
            aria-label={t('common.actions.dismiss')}
            className="rounded-md p-1 text-text-secondary hover:bg-hl/5 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {lockerOverridesOpen && (
        <LockerOverridesModal
          onClose={() => setLockerOverridesOpen(false)}
          onChanged={() => {
            void refreshLockerOverrideCount();
            loadMods({ silent: true });
          }}
        />
      )}

      {(searchNeedle || filtersActive) && totalMatches === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <Search className="w-12 h-12 mb-3 opacity-50" />
          <p className="mb-2">
            {searchNeedle
              ? t('installed.empty.noSearchMatch', { query: search })
              : t('installed.empty.noFilterMatch')}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="mt-1"
            onClick={() => {
              setSearch('');
              setSourceSel(['gamebanana', 'local']);
              setStatusSel(['enabled', 'disabled']);
              setHeroFilter('all');
              setTagFilter([]);
            }}
          >
            {searchNeedle ? t('installed.filters.clearSearch') : t('installed.filters.clearFilters')}
          </Button>
        </div>
      )}

      {/* The header row also carries the profiles control, so it renders even
          with nothing enabled: zero enabled mods is exactly the moment someone
          wants to load a profile. A live search or filter is the one case where
          it stays hidden, because an empty result there is about the query or
          filter, not about the install (and the no-matches empty state above
          should not get a stray button row under it). */}
      {(visibleEnabled.length > 0 || (!searchNeedle && !filtersActive)) && (
        <div className="mb-6">
          <div className="flex items-center justify-between gap-3 mb-[14px]">
            {visibleEnabled.length > 0 ? (
              <SectionHeader count={visibleEnabled.length} className="!mb-0 !text-xs !font-semibold !tracking-[0.06em]">{t('installed.sections.enabled', { count: visibleEnabled.length })}</SectionHeader>
            ) : (
              <span />
            )}
            <InstalledProfilesMenu onApplied={handleProfileApplied} />
          </div>
          {visibleEnabled.length > 0 && renderSortableSection('enabled')}
        </div>
      )}

      {visibleDisabled.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-3 mb-[14px]">
            <SectionHeader count={visibleDisabled.length} className="!mb-0 !text-xs !font-semibold !tracking-[0.06em]">{t('installed.sections.disabled', { count: visibleDisabled.length })}</SectionHeader>
            {/* Sort toggle for the disabled shelf only, parked on the header
                row so it reads as belonging to this section and not to the
                top bar's page-wide sort. */}
            <button
              type="button"
              onClick={() => setDisabledSortMode(disabledAlphabetical ? 'custom' : 'name')}
              aria-pressed={disabledAlphabetical}
              title={
                disabledAlphabetical
                  ? t('installed.sections.sortCustomHint')
                  : t('installed.sections.sortAlphabeticalHint')
              }
              className={`inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-semibold uppercase tracking-[0.06em] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
                disabledAlphabetical
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-hl/[0.08] bg-bg-tertiary/50 text-text-secondary hover:border-hl/20 hover:text-text-primary'
              }`}
            >
              <ArrowDownAZ className="h-3.5 w-3.5" />
              {t('installed.sections.sortAlphabetical')}
            </button>
          </div>
          {renderSortableSection('disabled')}
        </div>
      )}

      <ConfirmModal
        isOpen={updateAllConfirmOpen}
        title={`Update all (${updatesAvailable.size})?`}
        message={
          <>
            <p className="mb-3">
              {t('installed.updateAll.description')}
            </p>
            {(() => {
              const pending = mods.filter((m) => updatesAvailable.has(m.id));
              if (pending.length === 0) return null;
              return (
                <div className="update-stripes border border-accent/20 bg-bg-tertiary/40 rounded-md px-3 py-2 max-h-48 overflow-y-auto">
                  <div className="text-[10px] uppercase tracking-wider text-accent mb-1.5 font-semibold">
                    {t('installed.updateAll.receivingUpdates', { count: pending.length })}
                  </div>
                  <ul className="space-y-1 text-sm text-text-primary">
                    {pending.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 min-w-0">
                        <Download className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                        <span className="truncate" title={m.name}>{m.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </>
        }
        confirmLabel={`Update ${updatesAvailable.size}`}
        variant="primary"
        onConfirm={handleUpdateAll}
        onCancel={() => setUpdateAllConfirmOpen(false)}
      />

      {(updateAllError || updatePickQueue.length > 0) && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
          {updateAllError && (
            <div
              role="alert"
              aria-live="polite"
              className="max-w-md bg-state-danger/10 border border-state-danger/40 text-state-danger rounded-sm px-4 py-3 shadow-lg flex items-start gap-3 animate-fade-in"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div className="flex-1 text-sm text-text-primary">{updateAllError}</div>
              <button
                type="button"
                onClick={() => setUpdateAllError(null)}
                className="text-state-danger hover:text-text-primary p-1 -m-1 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-state-danger"
                aria-label={t('installed.updateAll.dismissError')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {updatePickQueue.length > 0 && (
            <div
              role="alert"
              aria-live="polite"
              className="max-w-md bg-bg-secondary border border-accent/40 rounded-sm px-4 py-3 shadow-lg flex items-start gap-3 animate-fade-in"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent" />
              <div className="flex-1 text-sm text-text-primary">
                <p>
                  {updatePickQueue.length === 1
                    ? `${updatePickQueue[0].name} needs a manual file pick: the author replaced their files and no clear match exists. The installed version was kept.`
                    : `${updatePickQueue.length} mods need a manual file pick: the authors replaced their files and no clear match exists. The installed versions were kept.`}
                </p>
                <Button size="sm" variant="primary" className="mt-2" onClick={openNextUpdatePick}>
                  {updatePickQueue.length === 1
                    ? t('installed.updateAll.pickReplacement', { count: 1 })
                    : t('installed.updateAll.pickReplacement', { count: updatePickQueue.length })}
                </Button>
              </div>
              <button
                type="button"
                onClick={() => setUpdatePickQueue([])}
                className="text-text-muted hover:text-text-primary p-1 -m-1 cursor-pointer rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={t('installed.updateAll.dismissPickNotice')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={!!modToDelete}
        title={
          modToDelete?.isBulk
            ? t('installed.delete.bulkTitle', { name: modToDelete.name })
            : modToDelete?.isGroup
              ? t('installed.delete.groupTitle', { count: modToDelete.ids.length })
              : t('installed.delete.title')
        }
        message={
          modToDelete?.isBulk ? (
            <Trans
              i18nKey="installed.delete.bulkMessage"
              values={{ name: modToDelete.name }}
              components={{ name: <span className="font-medium text-text-primary" /> }}
            />
          ) : modToDelete?.isGroup ? (
            <Trans
              i18nKey="installed.delete.groupMessage"
              values={{ count: modToDelete.ids.length, name: modToDelete.name }}
              components={{ name: <span className="font-medium text-text-primary" /> }}
            />
          ) : (
            <Trans
              i18nKey="installed.delete.confirmMessage"
              values={{ name: modToDelete?.name ?? '' }}
              components={{ name: <span className="font-medium text-text-primary" /> }}
            />
          )
        }
        confirmLabel={
          modToDelete?.isBulk
            ? t('installed.delete.bulkConfirm', { name: modToDelete.name })
            : modToDelete?.isGroup
              ? t('installed.delete.groupConfirm', { count: modToDelete.ids.length })
              : t('common.actions.delete')
        }
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setModToDelete(null)}
      />

      {localEditMod && (
        <EditLocalModModal
          mod={localEditMod}
          onClose={() => setLocalEditMod(null)}
          onSave={async (args) => {
            await editLocalInstalledMod(localEditMod, args);
            setLocalEditMod(null);
          }}
        />
      )}

      {/* Conditionally rendered so each opening is a fresh mount: draft names
          and armed delete confirmations reset without a sync effect. */}
      {creatingListFor && (
        <CreateModListModal
          modName={entryName(creatingListFor)}
          onClose={() => setCreatingListFor(null)}
          onCreate={createListForEntry}
        />
      )}
      {managingLists && (
        <ManageModListsModal
          lists={modLists}
          counts={listCounts}
          onClose={() => {
            if (!bulkProgress) setManagingLists(false);
          }}
          onRename={renameModList}
          onDelete={deleteModList}
          onSetEnabled={setModListEnabled}
          progress={bulkProgress}
        />
      )}

      {/* Add variants to an existing local mod. The same batch-import dialog
          as the toolbar's, minus the per-row name: the group owns the name. */}
      {addVariantTarget && (
        <ImportCustomModsModal
          addToGroup={{ modName: addVariantTarget.modName }}
          onClose={closeAddVariant}
          onImport={importVariantsIntoGroup}
          onFinished={reportVariantImport}
        />
      )}

      {(() => {
        if (pickerGroupId === null) return null;
        // Derive the live entry from current mods so deletes inside the
        // picker reflect immediately. If the group has disappeared (all
        // files deleted or moved), auto-close the picker.
        const liveEntry = allEntries.find(
          (e) => e.kind === 'group' && e.groupKey === pickerGroupId
        ) as Extract<ModEntry, { kind: 'group' }> | undefined;
        if (!liveEntry) {
          // Defer close to avoid setState during render warnings.
          queueMicrotask(() => setPickerGroupId(null));
          return null;
        }
        const liveVariantIds = new Set(liveEntry.variants.map((v) => v.id));
        const conflictsByVariantId = Object.fromEntries(
          liveEntry.variants.map((variant) => {
            const conflicts = (conflictMap.get(variant.id) ?? [])
              .filter((conflict) => {
                const peerId = conflict.modA === variant.id ? conflict.modB : conflict.modA;
                return liveVariantIds.has(peerId);
              })
              .map((conflict) => {
                const peerName = conflict.modA === variant.id ? conflict.modBName : conflict.modAName;
                return `${peerName}: ${conflict.details}`;
              });
            return [variant.id, conflicts];
          })
        );
        const localGroup = liveEntry.groupKey.startsWith('local:');
        const variantsWithUpdate = new Set(
          liveEntry.variants
            .filter(
              (variant) =>
                typeof variant.gameBananaId === 'number' &&
                variant.gameBananaId > 0 &&
                updatesAvailable.has(variant.id)
            )
            .map((variant) => variant.id),
        );
        return (
          <VariantPickerModal
            modName={liveEntry.primary.name}
            variants={liveEntry.variants}
            conflictsByVariantId={conflictsByVariantId}
            onToggle={(target) => toggleVariant(target)}
            onMoveVariant={(target, direction) => moveVariant(liveEntry, target, direction)}
            onReorderVariantTo={(source, neighbor, position) =>
              reorderVariantTo(source, neighbor, position)
            }
            onDeleteVariant={(variant) => deleteMod(variant.id)}
            onRenameVariant={(variant, label) => setVariantLabel(variant.id, label)}
            onOpenModDetails={
              liveEntry.primary.gameBananaId
                ? () => {
                    // Stash the picker so the user can return to it after
                    // closing the details modal.
                    setPickerGroupId(null);
                    openModDetails(liveEntry.primary);
                  }
                : undefined
            }
            // Membership is only editable for local groups: a GameBanana group
            // is defined by its submission, not by the user. Adding closes the
            // picker (one modal at a time); the card reopens it.
            onAddVariant={
              localGroup
                ? () => {
                    setPickerGroupId(null);
                    openAddVariant(liveEntry);
                  }
                : undefined
            }
            onDetachVariant={localGroup ? (variant) => detachVariant(variant) : undefined}
            variantsWithUpdate={variantsWithUpdate}
            onUpdateGroup={
              variantsWithUpdate.size > 0
                ? () => handleUpdateGroup(liveEntry.variants.map((variant) => variant.id))
                : undefined
            }
            isUpdating={!!updateAllProgress}
            updateProgress={updateAllProgress}
            onClose={() => setPickerGroupId(null)}
          />
        );
      })()}

      {detailsLoading && createPortal(
        <div
          ref={detailsLoadingBackdropRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-sm text-text-secondary">{t('installed.details.loading')}</span>
          </div>
        </div>,
        document.body
      )}

      {detailsError && !detailsMod && createPortal(
        <div
          ref={detailsErrorBackdropRef}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-state-danger mb-2">{t('installed.details.loadFailed')}</h3>
            <p className="text-sm text-text-secondary mb-4">{detailsError}</p>
            <div className="flex justify-end">
              <Button onClick={closeModDetails}>{t('common.actions.close')}</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {detailsMod && (
        <ModDetailsModal
          mod={detailsMod}
          section={detailsSection}
          installed={detailsInstalledFileIds.size > 0}
          installedFileIds={detailsInstalledFileIds}
          activeFileIds={detailsActiveFileIds}
          hideNsfwPreviews={installedHideNsfwPreviews}
          dateAdded={detailsDates?.dateAdded}
          dateModified={detailsDates?.dateModified}
          offline={detailsOffline}
          updateAvailable={detailsUpdateAvailable}
          updateFileIds={detailsUpdateFileIds}
          ignoreUpdates={detailsIgnoreUpdates}
          onToggleIgnoreUpdates={
            detailsSourceModId ? handleToggleIgnoreUpdates : undefined
          }
          onClose={closeModDetails}
          onViewArtist={openArtistPage}
          onDownload={handleDetailsDownload}
          onNavigatePrevious={previousDetailsEntry ? navigateToPreviousDetails : undefined}
          onNavigateNext={nextDetailsEntry ? navigateToNextDetails : undefined}
          previousLabel={previousDetailsEntry ? entryName(previousDetailsEntry) : undefined}
          nextLabel={nextDetailsEntry ? entryName(nextDetailsEntry) : undefined}
          onOpenGameBananaItem={openLinkedGameBananaItem}
        />
      )}

      {selectedUnknownState && unknownFixMode === 'single' && (
        <UnknownFilterGuessModal
          state={selectedUnknownState}
          hideNsfwPreviews={installedHideNsfwPreviews}
          autoMatchEnabled={autoMatchEnabled}
          onApplyMatch={applyUnknownMatch}
          onAssociate={associateUnknownMatch}
          onViewMatch={viewUnknownMatch}
          onMakeCustom={makeUnknownCustomMod}
          onFind={(mod) => void inspectUnknownModFilters(mod, false, 'single')}
          onRetry={(mod) => void inspectUnknownModFilters(mod, true, 'single')}
          onCancel={cancelUnknownMatch}
          onClose={closeUnknownFix}
        />
      )}

      {selectedUnknownState && unknownFixMode === 'bulk' && (
        <BulkUnknownFixModal
          unknownMods={unknownMods}
          state={selectedUnknownState}
          hideNsfwPreviews={installedHideNsfwPreviews}
          autoMatchEnabled={autoMatchEnabled}
          cache={unknownFilterCacheById}
          pendingIds={unknownFilterPendingIds}
          errors={unknownFilterErrors}
          onSelect={(mod) => openUnknownModFix(mod, 'bulk')}
          onApplyMatch={applyUnknownMatch}
          onAssociate={associateUnknownMatch}
          onViewMatch={viewUnknownMatch}
          onMakeCustom={makeUnknownCustomMod}
          onFindAll={findAllUnknownMods}
          onRetryAll={retryAllNoMatchUnknownMods}
          onFind={(mod) => void inspectUnknownModFilters(mod, false, 'bulk')}
          onRetry={(mod) => void inspectUnknownModFilters(mod, true, 'bulk')}
          onCancel={cancelUnknownMatch}
          onClose={closeUnknownFix}
        />
      )}

      {/* Consent gate for the DMM auto-import step of Fix Unknown Mods. */}
      <ConfirmModal
        isOpen={dmmConfirm !== null}
        title={t('installed.unknown.dmmConfirmTitle')}
        message={t('installed.unknown.dmmConfirmMessage', {
          count: dmmConfirm?.count ?? 0,
          profile: dmmConfirm?.profileName ?? '',
        })}
        confirmLabel={t('installed.unknown.dmmConfirmImport')}
        cancelLabel={t('installed.unknown.dmmConfirmSkip')}
        onConfirm={() => {
          dmmConfirm?.resolve(true);
          setDmmConfirm(null);
        }}
        onCancel={() => {
          dmmConfirm?.resolve(false);
          setDmmConfirm(null);
        }}
      />

      {customUnknownMod && (
        <MakeCustomModModal
          vpkPath={customUnknownMod.path}
          initialName={deriveModNameFromPath(customUnknownMod.fileName)}
          onClose={() => setCustomUnknownMod(null)}
          onSave={async ({ name, thumbnailDataUrl, nsfw }) => {
            await applyUnknownCustomMod(customUnknownMod.id, { name, thumbnailDataUrl, nsfw });
            await loadMods();
            setUnknownFilterCache((prev) => clearUnknownCacheForMod(prev, customUnknownMod));
            setUnknownFilterErrors((prev) => {
              const next = { ...prev };
              delete next[customUnknownMod.id];
              return next;
            });
            setUnknownDetectionProgress((prev) => {
              const next = { ...prev };
              delete next[customUnknownMod.id];
              return next;
            });
            delete unknownRequestIdsRef.current[customUnknownMod.id];
            setUnknownFilterPendingIds((prev) => {
              const next = new Set(prev);
              next.delete(customUnknownMod.id);
              return next;
            });
            setCustomUnknownMod(null);
          }}
        />
      )}

      {mergeSources && (
        <MergeModsModal
          sources={mergeSources}
          hideNsfw={installedHideNsfwPreviews}
          onCancel={() => setMergeSources(null)}
          onConfirm={handleMergeConfirm}
        />
      )}

      {mergedContentsMod && (
        <MergedContentsModal
          mod={mergedContentsMod}
          hideNsfw={installedHideNsfwPreviews}
          onClose={() => setMergedContentsMod(null)}
          onUnmerge={() => setUnmergeTarget(mergedContentsMod)}
          onExtractSource={handleExtractMergeSource}
          staleSourceFileNames={mergedSourceUpdates.get(mergedContentsMod.id)}
          onUpdateSources={handleUpdateMergeSources}
          eligibleMods={eligibleMergeAdditions}
          onAddSources={handleAddMergeSources}
        />
      )}

      {imprintState && (
        <ImprintModal
          state={imprintState}
          onConfirm={() => { void handleImprintAllInstalled(); }}
          onClose={() => setImprintState(null)}
        />
      )}

      {imprintDetailsMod && (
        <ImprintDetailsModal
          key={imprintDetailsMod.id}
          mod={imprintDetailsMod}
          onClose={() => setImprintDetailsMod(null)}
        />
      )}

      <ConfirmModal
        isOpen={!!unmergeTarget}
        title={t('installed.merge.unmergeTitle')}
        message={
          unmergeTarget ? (
            <div className="space-y-2">
              <p>
                <Trans
                  i18nKey="installed.merge.unmergeMessage"
                  count={unmergeTarget.merged?.sources.length ?? 0}
                  values={{ name: unmergeTarget.name, count: unmergeTarget.merged?.sources.length ?? 0 }}
                  components={{ name: <span className="text-text-primary font-medium" /> }}
                />
              </p>
              <ul className="text-xs text-text-secondary list-disc pl-5">
                {unmergeTarget.merged?.sources.map((s) => (
                  <li key={s.fileName} className="truncate">{s.modName}</li>
                ))}
              </ul>
            </div>
          ) : null
        }
        variant="danger"
        confirmLabel={t('installed.merge.unmerge')}
        onConfirm={() => void handleUnmergeConfirm()}
        onCancel={() => setUnmergeTarget(null)}
      />

      {unmergeResult && (
        <ConfirmModal
          isOpen
          title={t('installed.merge.missingSourcesTitle')}
          message={
            <div className="space-y-2 text-sm">
              <p>
                {t('installed.merge.missingSourcesBody', {
                  count: unmergeResult.result.recovered.length,
                  recovered: unmergeResult.result.recovered.length,
                  missing: unmergeResult.result.missingSourceFileNames.length,
                })}
              </p>
              <p className="text-text-secondary">
                {unmergeResult.copied
                  ? t('installed.merge.shareCodeCopied')
                  : t('installed.merge.shareCodeCopyFailed')}
              </p>
              <ul className="text-xs text-text-secondary list-disc pl-5 max-h-24 overflow-y-auto">
                {unmergeResult.result.missingSourceFileNames.map((fn) => (
                  <li key={fn} className="font-mono truncate">{fn}</li>
                ))}
              </ul>
            </div>
          }
          confirmLabel={unmergeResult.copied ? t('installed.merge.ok') : t('installed.merge.copyShareCode')}
          cancelLabel={t('common.actions.close')}
          onConfirm={() => {
            if (!unmergeResult.copied) {
              void navigator.clipboard.writeText(unmergeResult.result.shareCode);
            }
            setUnmergeResult(null);
          }}
          onCancel={() => setUnmergeResult(null)}
        />
      )}

      {selectMode && (
        // Floats at top-center. z-40 keeps this bar above the page + sticky
        // header (z-30) but below modal overlays (z-50), so an open modal's
        // backdrop dims it like the rest of the page instead of the bar
        // painting over the modal (e.g. the variant picker overlapping it in a
        // short window).
        <div
          ref={selectBarRef}
          className={`fixed z-40 w-max max-w-[calc(100vw-2rem)] bg-bg-secondary border border-accent/40 ring-1 ring-accent/15 rounded-xl shadow-lg shadow-black/40 px-3 py-2 flex flex-wrap items-center gap-2 ${selectBarPos ? '' : 'top-4 left-1/2 -translate-x-1/2'}`}
          style={selectBarPos ? { left: selectBarPos.x, top: selectBarPos.y } : undefined}
        >
          <span
            onPointerDown={handleSelectBarDragStart}
            className="flex items-center self-stretch -ml-1 px-0.5 text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing touch-none select-none"
            title={t('installed.select.dragHint')}
            aria-hidden="true"
          >
            <GripVertical className="w-4 h-4" />
          </span>
          {bulkProgress ? (
            <span className="text-sm text-text-primary tabular-nums px-2 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              {bulkProgress.verb} {bulkProgress.done}/{bulkProgress.total}…
            </span>
          ) : (
            <>
              <span className="text-sm text-text-primary tabular-nums px-2">
                {selectedMods.length === 0
                  ? t('installed.select.noneSelected')
                  : t('installed.select.countSelected', { count: selectedMods.length })}
              </span>
              <span className="h-5 w-px bg-border" />
              <Button variant="ghost" size="sm" onClick={selectAllVisible}>
                {t('installed.select.selectAll')}
              </Button>
              {selectedMods.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  {t('common.actions.clear')}
                </Button>
              )}
              <span className="h-5 w-px bg-border" />
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedDisabledCount === 0}
                onClick={handleBulkEnable}
                title={selectedDisabledCount === 0 ? t('installed.select.noDisabledSelected') : t('installed.select.enableCount', { count: selectedDisabledCount })}
              >
                {t('installed.select.enable')}{selectedDisabledCount > 0 ? ` (${selectedDisabledCount})` : ''}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedEnabledCount === 0}
                onClick={handleBulkDisable}
                title={selectedEnabledCount === 0 ? t('installed.select.noEnabledSelected') : t('installed.select.disableCount', { count: selectedEnabledCount })}
              >
                {t('conflicts.actions.disable')}{selectedEnabledCount > 0 ? ` (${selectedEnabledCount})` : ''}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={selectedMods.length < 2}
                icon={Layers}
                onClick={openBulkMerge}
                title={
                  selectedMods.length < 2
                    ? t('installed.select.mergeMinHint')
                    : t('installed.select.mergeCombineHint', { count: selectedMods.length })
                }
              >
                {t('installed.select.merge')}{selectedMods.length >= 2 ? ` (${selectedMods.length})` : ''}
              </Button>
              {/* Group as variants: one card, N interchangeable files. Unlike
                  Merge, nothing is rebuilt or combined; the files stay separate
                  and independently toggleable. */}
              <Button
                variant="secondary"
                size="sm"
                disabled={!canGroupSelectionAsVariants}
                icon={Files}
                onClick={handleBulkGroupVariants}
                title={
                  groupSelectionEligibility.eligible
                    ? t('installed.select.groupVariantsHint', { count: selectedMods.length })
                    : groupSelectionEligibility.reason === 'minimum'
                    ? t('installed.select.groupVariantsMinHint')
                    : groupSelectionEligibility.reason === 'merged'
                      ? t('installed.select.groupVariantsMergedHint')
                      : groupSelectionEligibility.reason === 'placement'
                        ? t('installed.select.groupVariantsPlacementHint')
                        : groupSelectionEligibility.reason === 'classification'
                          ? t('installed.select.groupVariantsClassificationHint')
                          : t('installed.select.groupVariantsLocalHint')
                }
              >
                {t('installed.select.groupVariants')}
                {canGroupSelectionAsVariants ? ` (${selectedMods.length})` : ''}
              </Button>
              <div className="relative" ref={tagMenuRef}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedMods.length === 0}
                  icon={TagIcon}
                  onClick={() => setTagMenuOpen((v) => !v)}
                  title={
                    selectedMods.length === 0
                      ? t('installed.select.tagEmptyHint')
                      : t('installed.select.tagCountHint', { count: selectedMods.length })
                  }
                >
                  {t('installed.select.tag')}{selectedMods.length > 0 ? ` (${selectedMods.length})` : ''}
                </Button>
                {tagMenuOpen && selectedMods.length > 0 && (
                  <div
                    role="dialog"
                    aria-label={t('installed.select.tagDialogLabel')}
                    className="absolute top-full mt-2 right-0 z-[60] w-56 max-h-80 overflow-y-auto bg-bg-secondary border border-border rounded-lg shadow-xl p-1 animate-fade-in"
                  >
                    <button
                      type="button"
                      onClick={() => handleBulkClearTag()}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-bg-tertiary text-text-secondary hover:text-text-primary cursor-pointer"
                    >
                      {t('installed.tag.clearLockerTag')}
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      {t('installed.tag.global')}
                    </div>
                    {GLOBAL_MOD_TYPE_ORDER.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => handleBulkTagGlobal(type)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-bg-tertiary text-text-primary cursor-pointer"
                      >
                        {GLOBAL_MOD_TYPE_LABELS[type]}
                      </button>
                    ))}
                    <div className="my-1 h-px bg-border" />
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                      {t('installed.tag.hero')}
                    </div>
                    {HERO_NAMES_SORTED.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => handleBulkTag(name)}
                        className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-bg-tertiary cursor-pointer"
                      >
                        <HeroTagLabel heroName={name} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={selectedMods.length === 0}
                icon={Trash2}
                onClick={openBulkDeleteConfirm}
              >
                {t('common.actions.delete')}{selectedMods.length > 0 ? ` (${selectedMods.length})` : ''}
              </Button>
              <span className="h-5 w-px bg-border" />
              <IconButton
                icon={X}
                label={t('installed.actions.exitSelectionMode')}
                size="sm"
                onClick={exitSelectMode}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

