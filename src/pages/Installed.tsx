import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { isModLoadedInGame, isReorderBlocked } from '../lib/modLocks';
import { Trans, useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import InstalledSkinPreview from '../components/installed/InstalledSkinPreview';
import { installedDoorStuckTarget } from '../lib/installedSkinTarget';
import { restoreMovementFxDraft } from '../lib/foundryDrafts';
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
  FileWarning,
  Camera,
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { showToast } from '../stores/toastStore';
import { useAppStore, type BrowseArtistRef } from '../stores/appStore';
import { useModUpdatesStore } from '../stores/modUpdatesStore';
import { useModUpdateCheckStore } from '../stores/modUpdateCheckStore';
import { useHeroCategoryStore } from '../stores/heroCategoryStore';
import { getActiveDeadlockPath, shouldBlurNsfw } from '../lib/appSettings';
import { isImprintPending } from '../lib/imprintPending';
import { getConflicts, openModsFolder, getModDetails, downloadMod, createSnapshot, detectUnknownModFilters, detectUnknownModCacheBulk, cancelUnknownModDetection, onUnknownModDetectionProgress, applyUnknownModMatch, applyUnknownCustomMod, associateUnknownMod, mergeMods, unmergeMod, extractMergeSource, addMergeSources, replaceMergeSources, reorderMods as apiReorderMods, setModIgnoreUpdates, getLockerOverview, imprintAllInstalled, onImprintAllInstalledProgress, imprintPreflight, launchModded } from '../lib/api';
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
import { useInstalledRequirements } from '../components/requirements/useInstalledRequirements';
import { RequirementsControl } from '../components/requirements/RequirementsControl';
import { useRequirementOrderStore } from '../stores/requirementOrderStore';
import { requirementOrderIssues } from '../lib/requirementLoadOrder';
import { useRequirementsStore } from '../stores/requirementsStore';
import { hasInstalledRequirementIssues, modRequirementRefs, requirementKey, skinRequirementSource } from '../lib/modRequirements';
import ImportSourceMenu from '../components/interchange/ImportSourceMenu';
import ExportModal from '../components/interchange/ExportModal';
import VariantPickerModal from '../components/VariantPickerModal';
import ModUpdatesModal from '../components/installed/ModUpdatesModal';
import ImportCustomModsModal from '../components/ImportCustomModsModal';
import MergeModsModal from '../components/MergeModsModal';
import MergedContentsModal from '../components/MergedContentsModal';
import { deriveModNameFromPath } from '../lib/customModImport';
import { useBackdropDismiss } from '../components/common/useBackdropDismiss';
import { HERO_NAMES_SORTED, GLOBAL_MOD_TYPE_ORDER, globalModTypeLabel, modLoadOrder } from '../lib/lockerUtils';
import {
  canJoinLocalVariantGroup,
  localVariantSelectionEligibility,
} from '../lib/localVariantEligibility';
import { useStableCallback } from '../lib/useStableCallback';
import {
  STABLE_KEY_PREFERENCES_MIGRATED_EVENT,
  type StableKeyPreferencesMigratedDetail,
} from '../lib/stableKeyMigration';
import { isDownloadRequestPending, releaseDownloadRequest, requestDownload, usePendingDownloadCompletions } from '../lib/downloadActivity';
import { classifyModFiles } from '../lib/updateFileMatch';
import { decideFileDownload, groupModUpdates, modUpdateGroup, replaceableFilesFor, summarizeUpdateScope } from '../lib/updateActions';
import { installsOutsideMerge, mergeSourceInstalls } from '../lib/updateCheck';
import { updateCheckCache } from '../lib/updateCheckCache';
import { visibleInstalledMods } from '../lib/visibleMods';
import { sameEntryCardProps } from '../components/installed/sameEntryCardProps';
import { entryCardShell } from '../components/installed/entryCardShell';
import { isModCardDragTarget } from '../components/installed/cardDragSurface';
import { useInstalledScrollActivity } from '../components/installed/useInstalledScrollActivity';
import { InstalledVirtualGrid } from '../components/installed/InstalledVirtualGrid';
import { useInstalledScrollRestoration } from '../components/installed/useInstalledScrollRestoration';
import { useInstalledEntryReveal } from '../components/installed/useInstalledEntryReveal';
import { modRestoreKey } from '../lib/soloRestore';
import { buildCachedModDetails, canUseCachedModDetails } from '../lib/cachedModDetails';
import {
  createDisabledEntryComparator,
  modPreferenceKey,
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
  reorderList,
  setListIcon,
  setListMembership,
  moveListMembership,
  positionListKey,
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
import { ViewModeToggle, EmptyState, ConfirmModal, type ViewMode } from '../components/common/PageComponents';
import { InstalledSection } from '../components/installed/InstalledSection';
import { InstalledListGroups } from '../components/installed/InstalledListGroups';
import { InstalledListControls, InstalledListSelectionMenu } from '../components/installed/InstalledListControls';
import { buildInstalledListGroups, listSelectionEntries, visibleListOccurrences, readInstalledListPreferences, writeInstalledListPreferences, UNLISTED_GROUP_ID, type InstalledListView } from '../lib/installedListGroups';
import { useInstalledSelection } from '../components/installed/useInstalledSelection';
import { entrySelectionIds, visibleSelectionEntries } from '../components/installed/selection';
import { useShiftKey } from '../components/installed/useShiftKey';
import { HeroTagLabel } from '../components/installed/chips';
import { ModCard } from '../components/installed/ModCard';
import { EMPTY_LIST_IDS } from '../components/installed/emptyIds';
import { EditLocalModModal } from '../components/installed/EditLocalModModal';
import { CompatibilityRepairsModal } from '../components/installed/CompatibilityRepairsModal';
import { OutdatedVdataModal } from '../components/installed/OutdatedVdataModal';
import { StaleModelsModal } from '../components/installed/StaleModelsModal';
import { StatusIssues, type StatusIssue } from '../components/installed/StatusIssues';
import { DeleteModsModal, type DeleteModsTarget } from '../components/installed/DeleteModsModal';
import { ModBackupDeletePrompt } from '../components/installed/ModBackupsSubmenu';
import { MakeCustomModModal } from '../components/installed/MakeCustomModModal';
import type { FoundUnknownMatch } from '../components/installed/unknown/foundMatch';
import { UnknownFilterGuessModal, BulkUnknownFixModal } from '../components/installed/unknown/UnknownFixModals';
import { type ImprintModalState, ImprintModal } from '../components/installed/imprint/ImprintModal';
import { ImprintDetailsModal } from '../components/installed/imprint/ImprintDetailsModal';
import { InstalledSkeleton } from '../components/installed/InstalledSkeleton';
import { type ModEntry, buildModEntries, isEntryEnabled, entrySortPriority, entryName, entrySearchText, entryPrimaryMod, entryDetailsAnchor, entryInstalledAt, entryIsLocal, OTHER_TAG_KEY, entryHeroNames, tagKeyLabel, entryTagKeys, flattenEntries, entryRepresentativeId, entryDisabledPreferenceKey, buildCompactPriorityOrder } from '../lib/modEntries';

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
  renderContent = true,
  ...cardProps
}: { sortableDisabled: boolean; renderContent?: boolean } & InstalledEntryCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardProps.entry.key, disabled: sortableDisabled });

  const shell = entryCardShell(cardProps.viewMode === 'list');
  const style: CSSProperties = {
    ...shell.style,
    ...(!renderContent ? { height: '100%' } : {}),
    transform: sortableDisabled ? undefined : CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.32 : undefined,
    zIndex: isDragging ? 1 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      data-installed-entry-key={cardProps.entry.key}
      aria-hidden={!renderContent || undefined}
      className={`${shell.className} ${sortableDisabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
      style={style}
      {...(sortableDisabled ? {} : attributes)}
      {...(sortableDisabled ? {} : listeners)}
      onPointerDown={sortableDisabled ? undefined : (event) => {
        if (isModCardDragTarget(event.target, event.currentTarget)) listeners?.onPointerDown?.(event);
      }}
    >
      {renderContent && <InstalledEntryCard {...cardProps} />}
    </div>
  );
}, sameEntryCardProps);

/** Lists-view grid item: the same shell as SortableEntryCard, without dnd-kit. */
const StaticEntryCard = memo(function StaticEntryCard(cardProps: InstalledEntryCardProps) {
  return (
    <div data-installed-entry-key={cardProps.entry.key} {...entryCardShell(cardProps.viewMode === 'list')}>
      <InstalledEntryCard {...cardProps} />
    </div>
  );
}, sameEntryCardProps);

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
  updatableSourceCount: number;
  fixingUnknown: boolean;
  loadPosition: number | undefined;
  loadCount: number;
  selectMode: boolean;
  shiftHeld: boolean;
  selected: boolean;
  soloBusy: boolean;
  favorite: boolean;
  onOpenDetails: (mod: Mod) => void;
  onViewAuthor: (mod: Mod) => void;
  /** Opens the variant picker for a group, by its shared grouping key. */
  onOpenPicker: (groupKey: string) => void;
  onToggle: (entry: ModEntry) => Promise<boolean>;
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
  onCommitPriority?: (modId: string, newPosition: number) => Promise<void>;
  onUnmerge: (mod: Mod) => void;
  onCopyShareCode: (mod: Mod) => void;
  /** Selection key when the same entry renders more than once (Lists view);
   *  undefined means entry.key. Passed as data, not baked into a per-card
   *  onSelectToggle closure, so the memo holds. */
  occurrenceKey: string | undefined;
  onSelectToggle: (entry: ModEntry, shiftKey: boolean, occurrenceKey: string | undefined) => void;
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
  updatableSourceCount,
  fixingUnknown,
  loadPosition,
  loadCount,
  selectMode,
  shiftHeld,
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
  occurrenceKey,
  onSelectToggle,
  onToggleFavorite,
  lists,
  listIds,
  onToggleList,
  onCreateList,
}: InstalledEntryCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const doorStuckEnabled = useAppStore(state => state.settings?.experimentalFoundry);
  const heroByCategoryId = useHeroCategoryStore(state => state.heroByCategoryId);
  const previewMod = entry.kind === 'single' ? entry.mod : entry.enabledVariants[0] ?? entry.primary;
  const target = installedDoorStuckTarget(previewMod, heroByCategoryId);
  const openDoorStuck = doorStuckEnabled && target ? () => {
    if ('kind' in target && target.kind === 'movement') {
      const settings = useAppStore.getState().settings;
      const scope = settings?.devMode && settings.devDeadlockPath ? settings.devDeadlockPath : settings?.deadlockPath ?? '';
      if (!restoreMovementFxDraft(localStorage, scope, target.choice)) {
        showToast(t('foundry.draft.failed'), { tone: 'error' });
        return;
      }
    }
    navigate('/foundry', { state: target });
  } : undefined;
  if (entry.kind === 'single') {
    const mod = entry.mod;
    return (
      <ModCard
        mod={mod}
        onOpenDoorStuck={openDoorStuck}
        viewMode={viewMode}
        hideNsfwPreviews={hideNsfwPreviews}
        conflicts={conflicts}
        soundVolume={soundVolume}
        updateAvailable={updateAvailable}
        staleSourceCount={staleSourceCount}
        updatableSourceCount={updatableSourceCount}
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
        onCommitPriority={onCommitPriority ? (p) => onCommitPriority(mod.id, p) : undefined}
        onUnmerge={mod.merged ? () => onUnmerge(mod) : undefined}
        onCopyShareCode={mod.merged ? () => onCopyShareCode(mod) : undefined}
        selectMode={selectMode}
        shiftHeld={shiftHeld}
        selected={selected}
        onSelectToggle={(event) => onSelectToggle(entry, event.shiftKey, occurrenceKey)}
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
  const safetyTarget = entry.variants.find(v => v.safety?.report.verdict === 'blocked' || v.safety?.report.verdict === 'incomplete')
    ?? entry.variants.find(v => v.safety?.report.verdict === 'requires-trust' && !v.safety.trusted)
    ?? entry.variants.find(v => v.safety?.report.verdict === 'requires-trust');
  const outdatedVariant = entry.enabledVariants.find(v => v.outdatedVdata) ?? entry.variants.find(v => v.outdatedVdata);
  return (
    <ModCard
      onOpenDoorStuck={openDoorStuck}
      previewMetaKey={previewMod.metaKey}
      mod={{
        ...entry.primary,
        safetyTarget,
        crashModIds: entry.variants.map(variant => variant.id),
        outdatedVdata: outdatedVariant?.outdatedVdata,
        outdatedVdataEnabled: !!outdatedVariant?.enabled,
        staleModels: entry.variants.flatMap(v => v.staleModels ?? []),
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
      onCommitPriority={onCommitPriority ? (p) => onCommitPriority(entry.primary.id, p) : undefined}
      selectMode={selectMode}
      shiftHeld={shiftHeld}
      selected={selected}
      onSelectToggle={(event) => onSelectToggle(entry, event.shiftKey, occurrenceKey)}
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
}, sameEntryCardProps);

function previewEntriesForDrag(
  entries: ModEntry[],
  section: DragSection,
  draft: { section: DragSection; keys: string[] } | null
): ModEntry[] {
  if (draft?.section !== section) return entries;
  return orderEntriesByKeys(entries, draft.keys);
}

function orderEntriesByKeys(entries: ModEntry[], keys: string[]): ModEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]));
  const ordered = keys
    .map((key) => byKey.get(key))
    .filter((entry): entry is ModEntry => !!entry);
  const seen = new Set(ordered.map((entry) => entry.key));
  const missing = entries.filter((entry) => !seen.has(entry.key));
  return [...ordered, ...missing];
}

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
  const location = useLocation();
  const loadedGameModIds = useAppStore((state) => state.loadedGameModIds);
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
  } = useAppStore(useShallow((state) => ({
    settings: state.settings,
    mods: state.mods,
    modsLoading: state.modsLoading,
    modsError: state.modsError,
    modsNotice: state.modsNotice,
    clearModsNotice: state.clearModsNotice,
    soloRestore: state.soloRestore,
    soloMod: state.soloMod,
    restoreSoloMods: state.restoreSoloMods,
    clearSoloRestore: state.clearSoloRestore,
    loadSettings: state.loadSettings,
    loadMods: state.loadMods,
    toggleMod: state.toggleMod,
    deleteMod: state.deleteMod,
    reorderMods: state.reorderMods,
    editLocalMod: state.editLocalMod,
    setLocalVariantGroup: state.setLocalVariantGroup,
    setModLockerHero: state.setModLockerHero,
    setModGlobalType: state.setModGlobalType,
    setModPriorityFolder: state.setModPriorityFolder,
    setVariantLabel: state.setVariantLabel,
    importCustomMods: state.importCustomMods,
    soundVolume: state.soundVolume,
    setInstalledScrollTop: state.setInstalledScrollTop,
    setBrowseUi: state.setBrowseUi,
  })));
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
  const [creatingList, setCreatingList] = useState<{ keys: string[]; modName?: string } | null>(null);
  const [managingLists, setManagingLists] = useState<boolean | string>(false);
  const [listPreferences, setListPreferences] = useState(readInstalledListPreferences);
  const [searchListState, setSearchListState] = useState<{ query: string; collapsed: string[] }>({ query: '', collapsed: [] });
  const listsView = listPreferences.view === 'lists';
  const collapsedLists = useMemo(() => new Set(listPreferences.collapsed), [listPreferences.collapsed]);
  const updateListPreferences = (next: typeof listPreferences) => {
    setListPreferences(next);
    writeInstalledListPreferences(next);
  };
  const setListView = (view: InstalledListView) => updateListPreferences({ ...listPreferences, view });

  // Applying (or saving) a profile from the header control changes what is
  // enabled behind the page's back: there is no event or subscription to hear
  // it on. The force flag is required because loadMods no-ops on a generation
  // guard otherwise, and settings carry the active-profile marker.
  const handleProfileApplied = useCallback(() => {
    void loadMods({ force: true });
    void loadSettings();
  }, [loadMods, loadSettings]);

  // Source mods absorbed into a merged VPK still live on disk (disabled) so
  // unmerge can restore them, but the merged mod is now the source of truth,
  // and Locker artifacts are managed from the Locker (see visibleInstalledMods).
  // Downstream rendering, reorder, and update checks all run off `visibleMods`.
  // Memoized so the array identity (and the entry identities derived from it)
  // only changes when `mods` does; the memoized card grid depends on that.
  const visibleMods = useMemo(() => visibleInstalledMods(mods), [mods]);
  useInstalledRequirements(visibleMods);
  const requirementSnapshots = useRequirementsStore(state => state.snapshots);
  const requirementFiles = useRequirementOrderStore(state => state.files);
  const [requirementsOnly, setRequirementsOnly] = useState(false);
  const requirementIssueIds = useMemo(() => new Set(visibleMods.filter(mod => {
    const local = skinRequirementSource(mod, mods);
    return (local && (hasInstalledRequirementIssues(mod, local.requirements, mods) || requirementOrderIssues(local, local.requirements, mods, requirementFiles).length > 0)) || modRequirementRefs(mod)
      .some(target => hasInstalledRequirementIssues(mod, requirementSnapshots[requirementKey(target)], mods) || requirementOrderIssues(target, requirementSnapshots[requirementKey(target)], mods, requirementFiles).some(issue => issue.overlay.id === mod.id));
  }).map(mod => mod.id)),
  [visibleMods, mods, requirementSnapshots, requirementFiles]);
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
  useEffect(() => {
    const id = (location.state as { crashSuspectId?: string } | null)?.crashSuspectId;
    const suspect = id && mods.find(mod => mod.id === id);
    if (!suspect) return;
    setSearch(suspect.name);
    setSourceSel(['gamebanana', 'local']);
    setStatusSel(['enabled', 'disabled']);
    setHeroFilter('all');
    setTagFilter([]);
    setRequirementsOnly(false);
    setListFilter([]);
    navigate(location.pathname, { replace: true, state: null });
  }, [location, mods, navigate]);
  const installedHideNsfwPreviews = shouldBlurNsfw(settings);
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
  const [modToDelete, setModToDelete] = useState<DeleteModsTarget | null>(null);
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
  const shiftHeld = useShiftKey();
  const [enabledCollapsed, setEnabledCollapsed] = useState(false);
  const [disabledCollapsed, setDisabledCollapsed] = useState(false);
  const getVisibleSelection = useStableCallback(() => visibleSelection);
  const { selectedIds, setSelectedIds, toggleSelection } = useInstalledSelection(mods, getVisibleSelection);
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
  const [exportOpen, setExportOpen] = useState(false);
  const soloBusyRef = useRef(false);
  const [soloBusy, setSoloBusy] = useState(false);
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
  const [detailsIgnoreUpdatesPending, setDetailsIgnoreUpdatesPending] = useState(false);
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
  const updatesAvailable = useModUpdateCheckStore(state => state.updatesAvailable);
  const mergedSourceUpdates = useModUpdateCheckStore(state => state.staleMergeSources);
  const updatableMergeSources = useModUpdateCheckStore(state => state.updatableMergeSources);
  const updatingModIds = useModUpdatesStore(state => state.state.updatingModIds);
  const submittingModIds = useModUpdatesStore(state => state.submittingModIds);
  const heroByCategoryId = useHeroCategoryStore((state) => state.heroByCategoryId);
  const loadHeroCategories = useHeroCategoryStore((state) => state.load);
  useEffect(() => {
    void loadHeroCategories();
  }, [loadHeroCategories]);
  const finishing = usePendingDownloadCompletions();
  const unavailableUpdateIds = useMemo(() => new Set([
    ...updatingModIds, ...submittingModIds,
    ...finishing.flatMap(item => item.replacementModIds ?? []),
  ]), [updatingModIds, submittingModIds, finishing]);
  const menuUpdateIds = useMemo(
    () => new Set([...updatesAvailable].filter(id => !unavailableUpdateIds.has(id))),
    [updatesAvailable, unavailableUpdateIds],
  );
  const updateModCount = useMemo(
    () => groupModUpdates(visibleMods, menuUpdateIds).length,
    [visibleMods, menuUpdateIds],
  );

  const detailsInstalledMods = useMemo(
    () => modUpdateGroup(visibleMods, detailsGameBananaId, detailsSection),
    [visibleMods, detailsGameBananaId, detailsSection],
  );
  // A mixed state can remain after an interrupted save or a previous per-file
  // toggle. Resume detection for the whole submission when any variant is ignored.
  const detailsIgnoreUpdates = detailsInstalledMods.some(mod => mod.ignoreUpdates);

  // Installed/enabled GameBanana fileIds for the mod the details overlay is
  // showing, aggregated across every sibling in the same submission and section
  // so multi-variant groups flag every owned row. Derived
  // from the visible mods so an install, delete or toggle performed while the
  // overlay is open updates it on the spot, the way Browse feeds the same
  // modal, and a file held only inside a merge does not read as installed.
  const { detailsInstalledFileIds, detailsActiveFileIds } = useMemo(() => {
    const installedFileIds = new Set<number>();
    const activeFileIds = new Set<number>();
    for (const candidate of detailsInstalledMods) {
      if (typeof candidate.gameBananaFileId !== 'number') continue;
      installedFileIds.add(candidate.gameBananaFileId);
      if (candidate.enabled) activeFileIds.add(candidate.gameBananaFileId);
    }
    return { detailsInstalledFileIds: installedFileIds, detailsActiveFileIds: activeFileIds };
  }, [detailsInstalledMods]);
  // Files the user has inside a merge are never proposed as successors.
  const mergedInstalls = useMemo(() => mergeSourceInstalls(visibleMods), [visibleMods]);
  const autoMatchRemainingFiles = settings?.autoMatchRemainingFiles ?? true;

  // The mod page shows every installed file's update or manual replacement.
  // Each download still replaces only its matched or explicitly chosen file.
  const detailsUpdate = useMemo(() => {
    const files = detailsMod?.files ?? [];
    const classification = classifyModFiles(detailsMod?.id ?? -1, files, detailsInstalledMods, mergedInstalls, autoMatchRemainingFiles);
    const source = detailsSourceModId ? mods.find((mod) => mod.id === detailsSourceModId) : undefined;
    const summary = summarizeUpdateScope(classification);
    // The offline fallback has no file rows; keep the card's verdict for the badge.
    const offlineFlag = files.length === 0 && !!source && updatesAvailable.has(source.id);
    return {
      classification,
      flagged: summary.flagged || offlineFlag,
      archived: summary.archived,
      updateFileIds: new Set(summary.targets.keys()),
      replaceableFiles: replaceableFilesFor(summary.needsPick, detailsInstalledMods),
    };
  }, [detailsMod, detailsSourceModId, mods, detailsInstalledMods, mergedInstalls, updatesAvailable, autoMatchRemainingFiles]);

  const [updateAllConfirmOpen, setUpdateAllConfirmOpen] = useState(false);
  const [updateMenuTargetId, setUpdateMenuTargetId] = useState<string | null>(null);
  const requirementRevealId = location.state && typeof location.state === 'object' &&
    'requirementModId' in location.state && typeof location.state.requirementModId === 'string'
    ? location.state.requirementModId : null;
  useEffect(() => {
    if (!requirementRevealId) return;
    setSearch('');
    setSourceSel(['gamebanana', 'local']);
    setStatusSel(['enabled', 'disabled']);
    setHeroFilter('all');
    setTagFilter([]);
    setListFilter([]);
    setRequirementsOnly(false);
    setSortMode('priority');
    setEnabledCollapsed(false);
    setDisabledCollapsed(false);
  }, [requirementRevealId]);
  const [compatibilityOpen, setCompatibilityOpen] = useState(false);
  const [outdatedVdataOpen, setOutdatedVdataOpen] = useState(false);
  const [staleModelsOpen, setStaleModelsOpen] = useState(false);
  const startUpdates = useModUpdatesStore((state) => state.start);
  const installedScrollRef = useRef<HTMLDivElement | null>(null);
  useInstalledScrollActivity(installedScrollRef);
  useInstalledScrollRestoration(
    installedScrollRef,
    installedPageScrollTop || useAppStore.getState().installedScrollTop,
    (offset) => { installedPageScrollTop = offset; },
    setInstalledScrollTop,
  );

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
    const linkedCandidates = modUpdateGroup(visibleMods, item.id, item.section);
    // Prefer the sibling that actually carries the update pulse. Choosing the
    // first installed sibling could anchor on a current variant and suppress
    // both the badge and the stale variant's replacement plan.
    const source = linkedCandidates.find((candidate) => updatesAvailable.has(candidate.id))
      ?? linkedCandidates[0]
      ?? null;
    setDetailsGameBananaId(item.id);
    setDetailsSourceModId(source?.id ?? null);
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

  // Match the update menu: ignore/resume every installed variant, then rescan
  // after the writes so an older in-flight scan cannot retain stale flags.
  const handleToggleIgnoreUpdates = useStableCallback(async () => {
    if (detailsIgnoreUpdatesPending || detailsInstalledMods.length === 0) return;
    const next = !detailsIgnoreUpdates;
    setDetailsIgnoreUpdatesPending(true);
    try {
      for (const mod of detailsInstalledMods) {
        if (!!mod.ignoreUpdates !== next) await setModIgnoreUpdates(mod.id, next);
      }
    } catch (err) {
      console.error('[Installed] toggle ignoreUpdates failed:', err);
      showToast(toastErrorMessage(err), { tone: 'error' });
    } finally {
      await loadMods({ silent: true, force: true });
      setDetailsIgnoreUpdatesPending(false);
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

  const openBulkUnknownFix = (unknowns: Mod[]) => {
    const first = unknowns[0];
    if (!first) return;
    openUnknownModFix(first, 'bulk');
    // The heavy auto-detect sweep is not kicked on open. The bulk modal lists
    // the unknowns so the user can search/link each one manually; the
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

  const handleDetailsDownload = useStableCallback(async (fileId: number, fileName: string, replaceFileId?: number) => {
    if (!detailsMod) return;
    // Synchronous app-wide guard: covers double clicks and the same target
    // being requested from Browse before React or the backend queue can render.
    if (!requestDownload({ modId: detailsMod.id, fileId, fileName, modName: detailsMod.name })) return;
    setDetailsError(null);
    try {
      // A pick replaces only the stale file it is the confident successor of,
      // a stale file the user confirmed replacing, or the same file on a
      // reinstall. Anything else is an ordinary install beside what is there.
      const decision = decideFileDownload(
        fileId,
        detailsUpdate.classification,
        detailsInstalledMods,
        { replaceFileId },
      );
      if (!isDownloadRequestPending(detailsMod.id, fileId)) return;
      await downloadMod(
        detailsMod.id,
        fileId,
        fileName,
        detailsSection,
        detailsCategoryId,
        detailsMod.name,
        decision.replacedModIds.length > 0,
        decision.replacedModIds,
      );
      await loadMods({ force: true });
      updateCheckCache.invalidate([detailsMod.id]);

      // Keep the overlay open on the freshly installed file so the row flips to
      // Installed/Active and the button to "Reinstall" in place. Re-anchor the
      // source entry first: an update or reinstall deletes the old local id,
      // which navigation and the offline update badge still use.
      const installed = modUpdateGroup(useAppStore.getState().mods, detailsMod.id, detailsSection)
        .find(mod => mod.gameBananaFileId === fileId);
      if (installed) {
        setDetailsSourceModId(installed.id);
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

  const handleUpdateGroup = async (variantIds: readonly string[]) => {
    try {
      await startUpdates(variantIds.filter(id => menuUpdateIds.has(id)));
    } catch (error) {
      showToast(toastErrorMessage(error), { tone: 'error' });
    }
  };

  const handleIgnoreUpdateGroup = async (modIds: string[]) => {
    const ignored = new Set<string>();
    try {
      for (const id of modIds) {
        await setModIgnoreUpdates(id, true);
        ignored.add(id);
      }
    } finally {
      if (ignored.size > 0) {
        useModUpdateCheckStore.setState(state => ({
          updatesAvailable: new Set([...state.updatesAvailable].filter(id => !ignored.has(id))),
        }));
        await loadMods({ silent: true, force: true });
      }
    }
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
  }, [selectMode, bulkProgress, modToDelete, setSelectedIds]);

  const handleDeleted = (target: DeleteModsTarget) => {
    setModToDelete(null);
    if (target.isBulk) exitSelectMode();
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
      mods: selectedMods,
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
    const sources = mergedContentsMod?.merged?.sources ?? [];
    const stale = sources.filter((source) => staleFileNames?.has(source.fileName));
    if (!targetId || !staleFileNames || stale.length === 0) return { updated: 0, skipped: [] };

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

    // Files installed standalone or inside another merge are never re-downloaded,
    // and those installs compete with this merge's sources for the same uploads.
    const plan = planMergeSourceUpdates(
      sources, staleFileNames, filesByModId, installsOutsideMerge(visibleMods, targetId), autoMatchRemainingFiles,
    );
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
      const modName = entry.sources[0].modName;
      try {
        // The fresh file only feeds the merge rebuild, so it must not switch
        // off the user's standalone files from the same mod.
        await downloadMod(
          entry.gameBananaId,
          entry.fileId,
          entry.fileName,
          entry.section,
          categoryByModId.get(entry.gameBananaId) ?? 0,
          modName,
          true,
        );
      } catch (err) {
        console.warn(`[MergeUpdate] download failed for ${modName}:`, err);
        for (const source of entry.sources) skipped.push({ modName: source.modName, reason: 'download-failed' });
        continue;
      }
      await loadMods({ silent: true });
      const installed = useAppStore
        .getState()
        .mods.filter((mod) => !before.has(mod.id) && mod.gameBananaFileId === entry.fileId);
      if (installed.length !== 1 || entry.sources.length !== 1) {
        // Zero means the archive yielded nothing usable. Several new VPKs, or
        // several sources cut from one archive, leave nothing that says which
        // VPK replaces which source. Either way whatever landed stays
        // installed as normal mods.
        const reason = installed.length === 0 ? 'download-failed' : 'multi-vpk';
        for (const source of entry.sources) skipped.push({ modName: source.modName, reason });
        continue;
      }
      replacements.push({ oldFileName: entry.sources[0].fileName, newModId: installed[0].id });
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
    return toggleMod(target.id);
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
      return setGroupEnabled(group, false);
    } else {
      setPickerGroupId(group.groupKey);
      return true;
    }
  };

  const isEntryOrderLocked = (entry: ModEntry) =>
    flattenEntries([entry]).some((mod) => isModLoadedInGame(mod, loadedGameModIds));

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
      byKey.set(entry.key, { heroNames: entryHeroNames(entry, heroByCategoryId), tagKeys: entryTagKeys(entry, heroByCategoryId) });
    }
    return byKey;
  }, [allEntries, heroByCategoryId]);

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
    return entry.kind === 'group' ? handleGroupToggle(entry) : toggleMod(entry.mod.id);
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
  const openCreateListFor = useStableCallback((entry: ModEntry) => setCreatingList({ keys: [entryDisabledPreferenceKey(entry)], modName: entryName(entry) }));
  // Create, and file the entry the dialog was opened from into the new list.
  // createList reuses an existing list when the name matches, so typing the
  // name of a list you already have files it there instead of duplicating.
  // Filing is add-only for exactly that reason: a toggle here would un-file a
  // mod that is already in the list whose name was typed.
  // With nothing to file (Manage's create box), a taken name changes nothing,
  // so it reports null and the dialog says the name is in use.
  const createModList = useStableCallback((name: string, keys: readonly string[]): string | null => {
    const { lists, id } = createList(modLists, name, keys);
    const existing = modLists.find((list) => list.id === id);
    if (!id || (existing && keys.length === 0)) return null;
    commitModLists(lists);
    updateListPreferences({ ...listPreferences, collapsed: listPreferences.collapsed.filter((key) => key !== id) });
    setSearchListState((current) => ({ ...current, collapsed: current.collapsed.filter((key) => key !== id) }));
    showToast(keys.length > 0 ? t('installed.lists.addedTo', { name: existing?.name ?? name }) : t('installed.lists.created', { name }), { tone: 'success' });
    return id;
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
    updateListPreferences({ ...listPreferences, collapsed: listPreferences.collapsed.filter((key) =>
      key !== id) });
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
      if (reason === 'safety') {
        showToast(t('installed.solo.safety', { name: label }), { tone: 'warning' });
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
        mods: entry.variants,
        name: entry.primary.name,
        isGroup: true,
      });
    } else {
      setModToDelete({ mods: [entry.mod], name: entry.mod.name, isGroup: false });
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
  // commitLoadPosition is declared later (it reads the compact order built
  // below); bridge it through the same synchronous-ref
  // pattern as selectAllVisibleRef so a stable callback can live up here.
  const commitLoadPositionRef = useRef<(modId: string, newPosition: number) => Promise<void>>(
    () => Promise.resolve()
  );
  const commitEntryPriority = useStableCallback((modId: string, newPosition: number) =>
    commitLoadPositionRef.current(modId, newPosition)
  );
  const unmergeEntry = useStableCallback((mod: Mod) => setUnmergeTarget(mod));
  const copyEntryShareCode = useStableCallback((mod: Mod) => void handleCopyShareCode(mod));
  const selectToggleEntry = useStableCallback((entry: ModEntry, shiftKey: boolean, occurrenceKey: string = entry.key) => {
    setSelectMode(true);
    toggleSelection({ key: occurrenceKey, ids: entrySelectionIds(entry) }, shiftKey);
  });

  const compactOrder = buildCompactPriorityOrder(allEntries);
  const conflictCount = conflictPairCount;
  const unknownMods = mods
    .filter((mod) => mod.isUnknown)
    .sort((a, b) => a.priority - b.priority);
  const outdatedVdataMods = mods.filter((mod) => mod.enabled && mod.outdatedVdata?.length);
  // Disabled ones too: fixing is safe, and they break the camera once enabled.
  const staleModelMods = visibleMods.filter((mod) => mod.staleModels?.length);
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
    entryFacetMeta.get(entry.key)?.heroNames ?? entryHeroNames(entry, heroByCategoryId);
  const tagKeysOf = (entry: ModEntry): string[] =>
    entryFacetMeta.get(entry.key)?.tagKeys ?? entryTagKeys(entry, heroByCategoryId);

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
  const toggleList = (key: string) => {
    if (searchNeedle) {
      const next = new Set(searchListState.query === searchNeedle ? searchListState.collapsed : []);
      if (!next.delete(key)) next.add(key);
      setSearchListState({ query: searchNeedle, collapsed: [...next] });
      return;
    }
    const next = new Set(collapsedLists);
    if (!next.delete(key)) next.add(key);
    updateListPreferences({ ...listPreferences, collapsed: [...next] });
  };
  // Both toggles on (length 2) = no filtering on that axis.
  const sourceActive = sourceSel.length !== 2;
  const statusActive = statusSel.length !== 2;
  const heroActive = heroFilter !== 'all';
  const filtersActive =
    sourceActive || statusActive || heroActive || tagFilter.length > 0 || listFilter.length > 0 || requirementsOnly;
  const sortActive = sortMode !== 'priority';
  const viewIsReorderable = !listsView && !searchNeedle && !filtersActive && !sortActive;
  const activeAdjustmentCount =
    (sourceActive ? 1 : 0) +
    (requirementsOnly ? 1 : 0) +
    (statusActive ? 1 : 0) +
    (heroActive ? 1 : 0) +
    tagFilter.length +
    listFilter.length +
    (sortActive ? 1 : 0);
  const disabledAlphabetical = disabledSortMode === 'name';
  const { visibleEnabled, visibleDisabled } = useMemo(() => {
    const matchesSearchEntry = (entry: ModEntry) =>
      !searchNeedle || entrySearchText(entry).toLowerCase().includes(searchNeedle);
    const matchesSourceEntry = (entry: ModEntry) =>
      entryIsLocal(entry) ? sourceSel.includes('local') : sourceSel.includes('gamebanana');
    const matchesHeroEntry = (entry: ModEntry) =>
      heroFilter === 'all' || (entryFacetMeta.get(entry.key)?.heroNames ?? entryHeroNames(entry, heroByCategoryId)).includes(heroFilter);
    const matchesTagEntry = (entry: ModEntry) =>
      tagFilter.length === 0 || (entryFacetMeta.get(entry.key)?.tagKeys ?? entryTagKeys(entry, heroByCategoryId)).some((key) => tagFilter.includes(key));
    // Selecting several lists unions them (same as tags), but the list axis as a
    // whole ANDs with the others.
    const matchesListEntry = (entry: ModEntry) =>
      listFilter.length === 0 ||
      (entryListIds.get(entry.key) ?? EMPTY_LIST_IDS).some((id) => listFilter.includes(id));
    const matchesAllFilters = (entry: ModEntry) =>
      (!requirementsOnly || (entry.kind === 'single' ? requirementIssueIds.has(entry.mod.id) : entry.variants.some(mod => requirementIssueIds.has(mod.id)))) &&
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
    return { visibleEnabled, visibleDisabled };
  }, [searchNeedle, sourceSel, heroFilter, tagFilter, listFilter, entryFacetMeta, heroByCategoryId, entryListIds, sortMode, statusSel, enabledEntries, disabledEntries, disabledAlphabetical, disabledOrder, disabledFavorites, requirementsOnly, requirementIssueIds]);
  const totalMatches = visibleEnabled.length + visibleDisabled.length;
  const listGroups = useMemo(() => buildInstalledListGroups([...visibleEnabled, ...visibleDisabled], modLists, listPreferences.unlistedOrder), [visibleEnabled, visibleDisabled, modLists, listPreferences.unlistedOrder]);
  const activeCollapsedLists = searchNeedle
    ? new Set(searchListState.query === searchNeedle ? searchListState.collapsed : []) : collapsedLists;
  const visibleSelection = listsView
    ? listSelectionEntries(listGroups, activeCollapsedLists)
    : visibleSelectionEntries(visibleEnabled, visibleDisabled, enabledCollapsed, disabledCollapsed);
  const selectedListKeys = [...new Set(selectedMods.map(modPreferenceKey))];
  const fileSelection = (id: string, add: boolean) => {
    const selectedKeys = new Set(selectedListKeys);
    commitModLists(add
      ? selectedListKeys.reduce((next, key) => addListMembership(next, id, key), modLists)
      : modLists.map((list) => list.id === id ? { ...list, keys: list.keys.filter((key) => !selectedKeys.has(key)) } : list));
  };
  const navigationEntries = listsView
    ? [...new Map(visibleListOccurrences(listGroups, activeCollapsedLists).map(({ entry }) => [entry.key, entry])).values()]
    : [...visibleEnabled, ...visibleDisabled];
  const detailsNavigationEntries = navigationEntries.filter(
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
    void openModDetails(entryDetailsAnchor(entry, (id) => updatesAvailable.has(id)));
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(
      visibleSelection.flatMap((entry) => entry.ids)
    ));
  };

  // Keep the Ctrl/Cmd+A handler (installed above) pointed at the latest
  // closures. Synchronous assignment keeps them current for keyboard events.
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
  const findEntryForModId = useCallback((entries: ModEntry[], id: string): ModEntry | undefined => {
    return entries.find((e) =>
      e.kind === 'single' ? e.mod.id === id : e.variants.some((v) => v.id === id)
    );
  }, []);

  const expandEntryLists = useStableCallback((entry: ModEntry) => {
    if (!listsView) return;
    const reveal = new Set(buildInstalledListGroups([entry], modLists)
      .filter((list) => list.entries.length > 0).map((list) => list.id));
    const collapsed = listPreferences.collapsed.filter((key) => !reveal.has(key));
    if (collapsed.length !== listPreferences.collapsed.length) {
      updateListPreferences({ ...listPreferences, collapsed });
    }
    setSearchListState((current) => {
      const collapsed = current.collapsed.filter((key) => !reveal.has(key));
      return collapsed.length === current.collapsed.length ? current : { ...current, collapsed };
    });
  });

  const openUpdateMenuMod = (modId: string) => {
    const entry = findEntryForModId(allEntries, modId);
    if (!entry) return;
    if (![...visibleEnabled, ...visibleDisabled].some(candidate => candidate.key === entry.key)) {
      setSearch('');
      setSourceSel(['gamebanana', 'local']);
      setStatusSel(['enabled', 'disabled']);
      setHeroFilter('all');
      setTagFilter([]);
      setRequirementsOnly(false);
      setListFilter([]);
    }
    if (isEntryEnabled(entry)) setEnabledCollapsed(false);
    else setDisabledCollapsed(false);
    expandEntryLists(entry);
    setUpdateMenuTargetId(modId);
  };

  const requirementRevealEntry = requirementRevealId
    ? findEntryForModId(allEntries, requirementRevealId) : undefined;
  const updateRevealEntry = updateMenuTargetId
    ? findEntryForModId(allEntries, updateMenuTargetId) : undefined;
  const revealEntryKey = updateRevealEntry?.key ?? requirementRevealEntry?.key ?? null;
  useEffect(() => {
    if (requirementRevealEntry) expandEntryLists(requirementRevealEntry);
  }, [requirementRevealEntry, expandEntryLists]);
  useEffect(() => {
    if (updateMenuTargetId && !updateRevealEntry) setUpdateMenuTargetId(null);
  }, [updateMenuTargetId, updateRevealEntry]);

  useInstalledEntryReveal(installedScrollRef, requirementRevealEntry?.key ?? null, (card) => {
    const remove = () => card.classList.remove('ring-2', 'ring-accent');
    card.classList.add('ring-2', 'ring-accent');
    window.setTimeout(remove, 2500);
    navigate(location.pathname, { replace: true, state: null });
  });

  useInstalledEntryReveal(installedScrollRef, updateRevealEntry?.key ?? null, () => {
    if (!updateRevealEntry) return;
    if (updateRevealEntry.kind === 'group') openEntryPicker(updateRevealEntry.groupKey);
    else openEntryDetails(updateRevealEntry.mod);
    setUpdateMenuTargetId(null);
  });

  const previewEnabled = useMemo(
    () => previewEntriesForDrag(visibleEnabled, 'enabled', dragDraftOrder),
    [visibleEnabled, dragDraftOrder]
  );
  const previewDisabled = useMemo(
    () => previewEntriesForDrag(visibleDisabled, 'disabled', dragDraftOrder),
    [visibleDisabled, dragDraftOrder]
  );
  // dnd-kit broadcasts context changes whenever this array identity changes,
  // even if every key is identical. Keep unrelated page state out of it.
  const enabledSortableKeys = useMemo(() => previewEnabled.map((entry) => entry.key), [previewEnabled]);
  const disabledSortableKeys = useMemo(() => previewDisabled.map((entry) => entry.key), [previewDisabled]);

  const sortableEnabled = viewIsReorderable && !selectMode && !shiftHeld;

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
    if (isReorderBlocked(entries, oldIndex, newIndex, isEntryOrderLocked)) {
      resetDragState();
      return;
    }
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
  const cardPropsFor = (entry: ModEntry, occurrenceKey?: string): InstalledEntryCardProps => ({
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
    updatableSourceCount:
      entry.kind === 'single' ? (updatableMergeSources.get(entry.mod.id)?.size ?? 0) : 0,
    fixingUnknown: entry.kind === 'single' && unknownFilterPendingIds.has(entry.mod.id),
    loadPosition: loadPositionById.get(entryRepresentativeId(entry)),
    loadCount: isEntryEnabled(entry) ? enabledModCount : 0,
    selectMode,
    shiftHeld,
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
    onCommitPriority: listsView || isEntryOrderLocked(entry) ? undefined : commitEntryPriority,
    onUnmerge: unmergeEntry,
    onCopyShareCode: copyEntryShareCode,
    occurrenceKey,
    onSelectToggle: selectToggleEntry,
    onToggleFavorite: toggleEntryFavorite,
    lists: modLists,
    listIds: entryListIds.get(entry.key) ?? EMPTY_LIST_IDS,
    onToggleList: toggleEntryList,
    onCreateList: openCreateListFor,
  });

  const renderEntryCard = (entry: ModEntry) => <InstalledEntryCard {...cardPropsFor(entry)} />;

  const gridClasses =
    layout === 'list' ? 'space-y-1.5' : viewMode === 'compact' ? 'grid gap-3' : 'grid gap-4';
  const gridStyle =
    layout === 'list'
      ? undefined
      : cardSizeGridStyle;

  const renderSortableSection = (section: DragSection) => {
    const entries = previewEntriesForSection(section);
    // A-Z is a display order, so a drop in the disabled section would have
    // nowhere to be saved. The enabled section keeps its handles either way.
    const sectionSortable =
      sortableEnabled && !(section === 'disabled' && disabledAlphabetical);
    const activeEntry = draggingSection === section
      ? entries.find((entry) => entry.key === draggingKey && !isEntryOrderLocked(entry))
      : undefined;
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
          items={section === 'enabled' ? enabledSortableKeys : disabledSortableKeys}
          strategy={layout === 'list' ? verticalListSortingStrategy : rectSortingStrategy}
        >
          <InstalledVirtualGrid
            entries={entries}
            scrollRef={installedScrollRef}
            gridClassName={gridClasses}
            gridStyle={gridStyle}
            viewMode={viewMode}
            revealEntryKey={revealEntryKey}
            dragging={draggingSection === section && draggingKey !== null}
            draggingKey={draggingSection === section ? draggingKey : null}
            renderEntry={(entry, renderContent) => (
              <SortableEntryCard
                key={entry.key}
                sortableDisabled={!sectionSortable || isEntryOrderLocked(entry)}
                renderContent={renderContent}
                {...cardPropsFor(entry)}
              />
            )}
          />
        </SortableContext>
        {createPortal(
          <DragOverlay zIndex={40} className="pointer-events-none">
            {activeEntry ? (
              <div className="opacity-95 shadow-2xl">
                {renderEntryCard(activeEntry)}
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    );
  };

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
              <ImportSourceMenu onImported={() => void loadMods()} />
            </div>
          }
        />
      </>
    );
  }

  // Issue buttons (outdated data, camera fix, conflicts, fix unknown) plus
  // update-all. Rendered once, in the top action bar's right cluster (next to
  // Fix Order). Two or more issues collapse into one dropdown.
  const statusIssues: StatusIssue[] = [];
  if (outdatedVdataMods.length > 0) {
    statusIssues.push({
      key: 'outdatedVdata',
      variant: 'danger',
      icon: FileWarning,
      label: t('installed.outdatedData.button', { count: outdatedVdataMods.length }),
      title: t('installed.outdatedData.buttonHint'),
      count: outdatedVdataMods.length,
      onOpen: () => setOutdatedVdataOpen(true),
    });
  }
  if (staleModelMods.length > 0) {
    statusIssues.push({
      key: 'staleModels',
      variant: 'warning',
      icon: Camera,
      label: t('installed.staleModels.button', { count: staleModelMods.length }),
      title: t('installed.staleModels.buttonHint'),
      count: staleModelMods.length,
      onOpen: () => setStaleModelsOpen(true),
    });
  }
  if (conflictCount > 0) {
    statusIssues.push({
      key: 'conflicts',
      variant: 'warning',
      icon: AlertTriangle,
      label: t('installed.status.conflictCount', { count: conflictPairCount }),
      count: conflictPairCount,
      onOpen: () => navigate('/conflicts'),
    });
  }
  if (unknownMods.length > 0 && !fixUnknownHidden) {
    statusIssues.push({
      key: 'unknown',
      variant: 'primary',
      icon: HelpCircle,
      label: t('installed.unknown.fixButton', { count: unknownMods.length }),
      title: t('installed.unknown.fixButtonHint'),
      count: unknownMods.length,
      onOpen: () => openBulkUnknownFix(unknownMods),
      onContextMenu: (e) => {
        e.preventDefault();
        setFixUnknownHidden(true);
      },
    });
  }
  const showUpdateButton = updateModCount > 0;
  const hasStatusButtons = statusIssues.length > 0 || showUpdateButton || unknownMods.length > 0;
  const statusButtons = hasStatusButtons ? (
    <div className="flex flex-wrap items-center gap-2">
      <StatusIssues issues={statusIssues} />
      {showUpdateButton && (
        <Button
          variant="primary"
          onClick={() => setUpdateAllConfirmOpen(true)}
          icon={Download}
          aria-live="polite"
          title={t('installed.updateAll.hint')}
        >
          {t('installed.updateAll.updateCount', { count: updateModCount })}
        </Button>
      )}
      {unknownMods.length > 0 && fixUnknownHidden && (
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
      )}
    </div>
  ) : null;
  const topStatusActions = (
      <div className="flex flex-wrap items-center gap-2">
        {statusButtons}
        {enabledModCount > 0 && (
          <Button variant="secondary" onClick={() => setCompatibilityOpen(true)}>
            {t('installed.repairs.button')}
          </Button>
        )}
        {/* After the status buttons: copy enabled names in load order. */}
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
          <Button
            variant="secondary"
            disabled={!viewIsReorderable}
            onClick={fixOrder}
            icon={Wrench}
            className="!px-2.5"
            aria-label={t('installed.actions.fixOrder')}
            title={t('installed.actions.fixOrderHint')}
          />
      </div>
    );

  return (
    <div ref={installedScrollRef} className="h-full overflow-y-auto px-4 pb-5 sm:px-6 [scrollbar-gutter:stable]">
      <InstalledSkinPreview hideNsfw={installedHideNsfwPreviews} />
      <div
        className={`sticky top-0 z-30 -mx-4 mb-4 border-b border-hl/5 px-4 py-3 sm:-mx-6 sm:px-6 ${
          settings?.sidebarTransparent
            ? 'app-background-fixed'
            : 'bg-bg-primary/95 backdrop-blur supports-[backdrop-filter]:bg-bg-primary/80'
        }`}
      >
        {/* Narrow windows give search its own row so controls wrap together. */}
        <div className="flex flex-col items-stretch gap-2 xl:flex-row xl:items-center xl:gap-3">
          <div className="relative min-w-[11rem] flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchListState({ query: '', collapsed: [] }); }}
              placeholder={t('installed.filters.searchPlaceholder')}
              className={`bg-bg-secondary border border-border rounded-lg pl-8 ${search ? 'pr-8' : 'pr-3'} py-2 text-sm text-text-primary placeholder:text-text-primary/55 focus:outline-none focus:ring-2 focus:ring-accent w-full`}
            />
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); setSearchListState({ query: '', collapsed: [] }); }}
                title={t('installed.filters.clearSearch')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-tertiary cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-start gap-2 xl:ml-auto xl:justify-end">
            <InstalledListControls
              view={listPreferences.view}
              onView={setListView}
              onManage={() => setManagingLists(true)}
            />
            {/* Contextual status + reorder actions ride the same row as the
                view controls (wrapping together when cramped) instead of
                claiming a second strip below the search. Copy-enabled sits
                inside topStatusActions, immediately after Fix Unknown. */}
            <RequirementsControl count={requirementIssueIds.size} active={requirementsOnly} onClick={() => setRequirementsOnly(value => !value)} />
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
    setRequirementsOnly(false);
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
            <ImportSourceMenu compact onImported={() => void loadMods()} onExport={() => setExportOpen(true)} />
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

      {!listsView && (searchNeedle || filtersActive) && totalMatches === 0 && (
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
    setRequirementsOnly(false);
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
      {listsView && <InstalledListGroups
        groups={listGroups}
        collapsed={activeCollapsedLists}
        showEmpty={!searchNeedle && !filtersActive}
        onToggle={toggleList}
        onManage={(id) => setManagingLists(id ?? true)}
        dragDisabled={selectMode || shiftHeld || !!bulkProgress}
        pauseUpdates={!!managingLists}
        onMove={(key, sourceId, targetId, beforeKey) => {
          commitModLists(moveListMembership(modLists, {
            key, fromListId: sourceId === UNLISTED_GROUP_ID ? null : sourceId,
            toListId: targetId === UNLISTED_GROUP_ID ? null : targetId, beforeKey,
          }));
          if (targetId === UNLISTED_GROUP_ID) {
            const completeGroups = searchNeedle || filtersActive
              ? buildInstalledListGroups([...enabledEntries, ...disabledEntries], modLists, listPreferences.unlistedOrder) : listGroups;
            const keys = [...new Set([...(listPreferences.unlistedOrder ?? []), ...(completeGroups.find(group => group.id === UNLISTED_GROUP_ID)?.entries.map(entryDisabledPreferenceKey) ?? [])])];
            updateListPreferences({ ...listPreferences, unlistedOrder: positionListKey(keys, key, beforeKey) });
          }
        }}
        onReorder={(id, targetId) => commitModLists(reorderList(modLists, id, targetId))}
        gridClassName={gridClasses}
        gridStyle={gridStyle}
        scrollRef={installedScrollRef}
        viewMode={viewMode}
        revealEntryKey={revealEntryKey}
        renderEntry={(entry, occurrence) => <StaticEntryCard {...cardPropsFor(entry, occurrence)} />}
      />}
      {!listsView && (visibleEnabled.length > 0 || (!searchNeedle && !filtersActive)) && (
        <div className="mb-6">
          <InstalledSection
            title={t('installed.sections.enabled', { count: visibleEnabled.length })}
            count={visibleEnabled.length}
            collapsed={enabledCollapsed}
            onToggle={() => setEnabledCollapsed((collapsed) => !collapsed)}
            actions={<InstalledProfilesMenu onApplied={handleProfileApplied} />}
          >
            {() => visibleEnabled.length > 0 && renderSortableSection('enabled')}
          </InstalledSection>
        </div>
      )}

      {!listsView && visibleDisabled.length > 0 && (
        <InstalledSection
          title={t('installed.sections.disabled', { count: visibleDisabled.length })}
          count={visibleDisabled.length}
          collapsed={disabledCollapsed}
          onToggle={() => setDisabledCollapsed((collapsed) => !collapsed)}
          actions={
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
          }
        >
          {() => renderSortableSection('disabled')}
        </InstalledSection>
      )}

      {updateAllConfirmOpen && (
        <ModUpdatesModal
          mods={visibleMods}
          updateIds={menuUpdateIds}
          onUpdate={handleUpdateGroup}
          onIgnore={handleIgnoreUpdateGroup}
          onOpen={openUpdateMenuMod}
          onClose={() => setUpdateAllConfirmOpen(false)}
        />
      )}

      <CompatibilityRepairsModal open={compatibilityOpen} onClose={() => setCompatibilityOpen(false)} mods={mods} />
      <OutdatedVdataModal
        mods={outdatedVdataMods}
        open={outdatedVdataOpen}
        onClose={() => setOutdatedVdataOpen(false)}
      />

      <StaleModelsModal
        mods={staleModelMods}
        open={staleModelsOpen}
        onClose={() => setStaleModelsOpen(false)}
      />

      <DeleteModsModal
        target={modToDelete}
        onCancel={() => setModToDelete(null)}
        onDeleted={handleDeleted}
      />
      <ModBackupDeletePrompt />

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
      {creatingList && (
        <CreateModListModal
          modName={creatingList.modName}
          onClose={() => setCreatingList(null)}
          onCreate={(name) => createModList(name, creatingList.keys)}
        />
      )}
      {managingLists && (
        <ManageModListsModal
          lists={modLists}
          entries={allEntries}
          hideNsfw={installedHideNsfwPreviews}
          initialListId={typeof managingLists === 'string' ? managingLists : undefined}
          onMembership={(id, key, member) => commitModLists(setListMembership(modLists, id, key, member))}
          onCreate={(name) => createModList(name, [])}
          counts={listCounts}
          onClose={() => {
            if (!bulkProgress) setManagingLists(false);
          }}
          onRename={renameModList}
          onReorder={(id, overId) => commitModLists(reorderList(modLists, id, overId))}
          onIcon={(id, icon) => commitModLists(setListIcon(modLists, id, icon))}
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
            onDeleteVariant={deleteMod}
            onRenameVariant={(variant, label) => setVariantLabel(variant.id, label)}
            onOpenModDetails={
              liveEntry.primary.gameBananaId
                ? () => {
                    // Stash the picker so the user can return to it after
                    // closing the details modal.
                    setPickerGroupId(null);
                    openModDetails(entryDetailsAnchor(liveEntry, (id) => updatesAvailable.has(id)));
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
            isUpdating={liveEntry.variants.some(variant => unavailableUpdateIds.has(variant.id))}
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
          updateAvailable={detailsUpdate.flagged}
          updateFileIds={detailsUpdate.updateFileIds}
          archivedByAuthor={detailsUpdate.archived}
          replaceableFiles={detailsUpdate.replaceableFiles}
          onReplace={handleDetailsDownload}
          ignoreUpdates={detailsIgnoreUpdates}
          ignoreUpdatesPending={detailsIgnoreUpdatesPending}
          onToggleIgnoreUpdates={
            detailsInstalledMods.length > 0 ? handleToggleIgnoreUpdates : undefined
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

      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}

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
          updatableSourceFileNames={updatableMergeSources.get(mergedContentsMod.id)}
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

      {selectMode && createPortal(
        // Floats at top-center. Portaled to body because the page's outlet
        // wrapper is its own stacking context, which trapped this bar under the
        // sidebar when dragged over it. At root, z-40 keeps it above the whole
        // app shell but below modal overlays (z-50), so an open modal's
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
              <InstalledListSelectionMenu
                lists={modLists}
                disabled={selectedMods.length === 0}
                onAdd={(id) => fileSelection(id, true)}
                onRemove={(id) => fileSelection(id, false)}
                onCreate={() => setCreatingList({ keys: selectedListKeys })}
              />
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
                        {globalModTypeLabel(type, t)}
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
        </div>,
        document.body
      )}
    </div>
  );
}

