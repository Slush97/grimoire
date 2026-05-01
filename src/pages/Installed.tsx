import { useEffect, useRef, useState } from 'react';
import {
  Package,
  Loader2,
  Settings,
  Trash2,
  AlertTriangle,
  FolderOpen,
  GripVertical,
  FilePlus,
  X,
  ImagePlus,
  Search,
  Volume2,
  Info,
  Download,
  UploadCloud,
  List,
  LayoutGrid,
  Grid3x3,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts, openModsFolder, readImageDataUrl, showOpenDialog, getModDetails, downloadMod } from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { GameBananaModDetails } from '../types/gamebanana';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import ModDetailsModal from '../components/ModDetailsModal';
import { inferHeroFromTitle, getHeroRenderPath, getHeroFacePosition } from '../lib/lockerUtils';
import { Button, Tag } from '../components/common/ui';
import { PageHeader, ViewModeToggle, EmptyState, ConfirmModal, SectionHeader, type ViewMode } from '../components/common/PageComponents';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

type DropPosition = 'before' | 'after';

export default function Installed() {
  const navigate = useNavigate();
  const {
    settings,
    mods,
    modsLoading,
    modsError,
    loadSettings,
    loadMods,
    toggleMod,
    deleteMod,
    reorderMods,
    importCustomMod,
    soundVolume,
  } = useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem('installedViewMode');
    return stored === 'grid' || stored === 'compact' || stored === 'list' ? stored : 'list';
  });
  useEffect(() => {
    localStorage.setItem('installedViewMode', viewMode);
  }, [viewMode]);
  const [search, setSearch] = useState('');
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  const [modToDelete, setModToDelete] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Drag-and-drop reorder state. `draggingSection` scopes drops so dragging
  // an enabled card can't drop onto a disabled card and vice-versa.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSection, setDraggingSection] = useState<'enabled' | 'disabled' | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);
  const autoScrollRafRef = useRef<number | null>(null);

  // Details overlay state
  const [detailsMod, setDetailsMod] = useState<GameBananaModDetails | null>(null);
  const [detailsSection, setDetailsSection] = useState<string>('Mod');
  const [detailsCategoryId, setDetailsCategoryId] = useState<number>(0);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsUpdateAvailable, setDetailsUpdateAvailable] = useState(false);
  const [detailsInstalledFileIds, setDetailsInstalledFileIds] = useState<Set<number>>(new Set());
  const [detailsDates, setDetailsDates] = useState<{ dateAdded: number; dateModified: number } | null>(null);
  // Local id of the installed mod that triggered the overlay. On download we
  // delete this entry first so Update/Reinstall replaces the old VPK instead
  // of installing a second copy alongside it.
  const [detailsSourceModId, setDetailsSourceModId] = useState<string | null>(null);

  // Map of mod id → true if a newer version exists on GameBanana.
  const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());

  const openModDetails = async (m: typeof mods[number]) => {
    if (!m.gameBananaId) return;
    const section = m.sourceSection ?? 'Mod';
    const categoryId = m.categoryId ?? 0;
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsSection(section);
    setDetailsCategoryId(categoryId);
    setDetailsSourceModId(m.id);
    setDetailsInstalledFileIds(m.gameBananaFileId ? new Set([m.gameBananaFileId]) : new Set());
    setDetailsUpdateAvailable(updatesAvailable.has(m.id));
    setDetailsDates(null);
    try {
      const [details, cached] = await Promise.all([
        getModDetails(m.gameBananaId, section),
        window.electronAPI.getCachedMod(m.gameBananaId).catch(() => null),
      ]);
      setDetailsMod(details);
      if (cached) {
        setDetailsDates({ dateAdded: cached.dateAdded, dateModified: cached.dateModified });
      }
    } catch (err) {
      setDetailsError(String(err));
    } finally {
      setDetailsLoading(false);
    }
  };

  const closeModDetails = () => {
    setDetailsMod(null);
    setDetailsError(null);
    setDetailsUpdateAvailable(false);
    setDetailsSourceModId(null);
    setDetailsDates(null);
  };

  const handleDetailsDownload = async (fileId: number, fileName: string) => {
    if (!detailsMod) return;
    try {
      // Same-file picks (true reinstall/update) replace the source install;
      // different-file picks add a new entry and the download backend will
      // auto-disable any prior enabled variants of the same GameBanana mod.
      const sourceMod = detailsSourceModId ? mods.find((m) => m.id === detailsSourceModId) : null;
      if (sourceMod && sourceMod.gameBananaFileId === fileId) {
        await deleteMod(sourceMod.id);
      }
      await downloadMod(detailsMod.id, fileId, fileName, detailsSection, detailsCategoryId);
      closeModDetails();
      loadMods();
    } catch (err) {
      setDetailsError(String(err));
    }
  };

  const handleDeleteConfirm = async () => {
    if (modToDelete) {
      await deleteMod(modToDelete.id);
      setModToDelete(null);
    }
  };

  // Auto-scroll the main content container while drag-reordering. Native HTML
  // drag-and-drop doesn't fire pointer events, so we hook `dragover` at the
  // window and start a rAF loop whenever the cursor is near the top/bottom
  // edge of the scroll container.
  useEffect(() => {
    if (!draggingId) return;
    const main = document.querySelector('main');
    if (!main) return;
    const EDGE = 80;
    const MAX_STEP = 18;
    let pointerY = -1;

    const tick = () => {
      const rect = main.getBoundingClientRect();
      const fromTop = pointerY - rect.top;
      const fromBottom = rect.bottom - pointerY;
      let dy = 0;
      if (fromTop >= 0 && fromTop < EDGE) dy = -Math.round(((EDGE - fromTop) / EDGE) * MAX_STEP);
      else if (fromBottom >= 0 && fromBottom < EDGE) dy = Math.round(((EDGE - fromBottom) / EDGE) * MAX_STEP);
      if (dy !== 0) main.scrollBy({ top: dy });
      autoScrollRafRef.current = requestAnimationFrame(tick);
    };

    const onDragOver = (e: DragEvent) => {
      pointerY = e.clientY;
      if (autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(tick);
      }
    };
    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
  }, [draggingId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

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
      } catch {
        setConflictMap(new Map());
      }
    };
    if (mods.length > 0) {
      loadConflictData();
    }
  }, [mods]);

  // Flag mods whose GameBanana dateModified is newer than when the user
  // installed their copy. Uses the local mod cache (synced in the background)
  // so this is cheap and works offline; staler cache just means fewer flags.
  useEffect(() => {
    let cancelled = false;
    const checkUpdates = async () => {
      const targets = mods.filter((m) => !!m.gameBananaId && !!m.installedAt);
      if (targets.length === 0) {
        setUpdatesAvailable(new Set());
        return;
      }
      const available = new Set<string>();
      for (const mod of targets) {
        if (cancelled) return;
        try {
          const cached = await window.electronAPI.getCachedMod(mod.gameBananaId!);
          if (!cached) continue;
          const installedTs = Math.floor(new Date(mod.installedAt).getTime() / 1000);
          if (Number.isFinite(installedTs) && cached.dateModified > installedTs) {
            available.add(mod.id);
          }
        } catch {
          // Cache miss or backend error — just skip this mod.
        }
      }
      if (!cancelled) setUpdatesAvailable(available);
    };
    checkUpdates();
    return () => {
      cancelled = true;
    };
  }, [mods]);

  if (!activeDeadlockPath) {
    return (
      <EmptyState
        icon={Package}
        title="No Game Path Set"
        description="Configure your Deadlock installation path or enable dev mode to start managing mods."
        action={
          <Button onClick={() => navigate('/settings')} icon={Settings}>
            Open Settings
          </Button>
        }
      />
    );
  }

  if (modsLoading) {
    return <InstalledSkeleton viewMode={viewMode} />;
  }

  if (modsError) {
    return (
      <EmptyState
        icon={Package}
        title="Error Loading Mods"
        description={modsError ?? undefined}
        variant="error"
        action={<Button onClick={() => loadMods()}>Retry</Button>}
      />
    );
  }

  const enabledMods = mods.filter((m) => m.enabled).sort((a, b) => a.priority - b.priority);
  const disabledMods = mods.filter((m) => !m.enabled).sort((a, b) => a.priority - b.priority);
  const hasPriorityGap =
    enabledMods.some((m, i) => m.priority !== i + 1) ||
    disabledMods.some((m, i) => m.priority !== enabledMods.length + i + 1);
  const conflictCount = conflictMap.size > 0 ? new Set([...conflictMap.keys()]).size : 0;

  // Filter by search query (case-insensitive substring on name). Drag-and-drop
  // reorder is still correct because it targets the full enabled list order,
  // not the filtered view.
  const searchNeedle = search.trim().toLowerCase();
  const matchesSearch = (m: typeof mods[number]) =>
    !searchNeedle || m.name.toLowerCase().includes(searchNeedle);
  const visibleEnabled = enabledMods.filter(matchesSearch);
  const visibleDisabled = disabledMods.filter(matchesSearch);
  const totalMatches = visibleEnabled.length + visibleDisabled.length;

  const resetDragState = () => {
    setDraggingId(null);
    setDraggingSection(null);
    setDropTargetId(null);
    setDropPosition(null);
  };

  const applyReorder = (
    sourceId: string,
    targetId: string,
    position: DropPosition,
    section: 'enabled' | 'disabled'
  ) => {
    if (sourceId === targetId) return;
    const list = section === 'enabled' ? enabledMods : disabledMods;
    const sourceIdx = list.findIndex((m) => m.id === sourceId);
    if (sourceIdx === -1) return;

    const working = list.slice();
    const [moved] = working.splice(sourceIdx, 1);
    const adjustedTargetIdx = working.findIndex((m) => m.id === targetId);
    if (adjustedTargetIdx === -1) return;
    const insertAt = position === 'before' ? adjustedTargetIdx : adjustedTargetIdx + 1;
    working.splice(insertAt, 0, moved);

    const unchanged = working.every((m, i) => m.id === list[i].id);
    if (unchanged) return;

    reorderMods(working.map((m) => m.fileName));
  };

  const compactPriorities = () => {
    // Renumber every installed mod sequentially (enabled first, then disabled)
    // so priority slots are tight 1..N with no gaps from prior delete/disable.
    const ordered = [...enabledMods, ...disabledMods];
    if (ordered.length === 0) return;
    reorderMods(ordered.map((m) => m.fileName));
  };

  // No mods at all
  if (mods.length === 0) {
    return (
      <>
        <EmptyState
          icon={Package}
          title="No Mods Found"
          description="No mods installed yet. Download mods from the Browse tab, import a custom VPK, or manually place VPK files in your addons folder."
          action={
            <div className="flex items-center gap-3">
              <Button onClick={() => navigate('/browse')} icon={Search}>
                Browse Mods
              </Button>
              <Button variant="secondary" onClick={() => setImportOpen(true)} icon={FilePlus}>
                Import Custom Mod
              </Button>
            </div>
          }
        />
        {importOpen && (
          <ImportCustomModModal
            onClose={() => setImportOpen(false)}
            onImport={async (args) => {
              await importCustomMod(args);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="Installed Mods"
        action={
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search installed..."
                className="bg-bg-secondary border border-border rounded-lg pl-8 pr-8 py-2 text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none focus:ring-2 focus:ring-accent w-56"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  title="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-bg-tertiary cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {conflictCount > 0 && (
              <Button
                variant="warning"
                size="sm"
                onClick={() => navigate('/conflicts')}
                icon={AlertTriangle}
              >
                {conflictMap.size / 2} conflicts
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => setImportOpen(true)}
              icon={FilePlus}
              title="Import a VPK from disk with a custom name and thumbnail"
            >
              Add Custom Mod
            </Button>
            <Button
              variant="secondary"
              onClick={() => openModsFolder().catch(() => {})}
              icon={FolderOpen}
              title="Open mods folder"
            >
              Open Folder
            </Button>
            <ViewModeToggle
              value={viewMode}
              options={[
                { value: 'list', label: 'List', icon: List },
                { value: 'grid', label: 'Cards', icon: LayoutGrid },
                { value: 'compact', label: 'Compact', icon: Grid3x3 },
              ]}
              onChange={setViewMode}
            />
          </div>
        }
        className="mb-6"
      />

      {searchNeedle && totalMatches === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <Search className="w-12 h-12 mb-3 opacity-50" />
          <p className="mb-2">No installed mods match &ldquo;{search}&rdquo;</p>
          <button
            onClick={() => setSearch('')}
            className="mt-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors cursor-pointer text-sm"
          >
            Clear search
          </button>
        </div>
      )}

      {visibleEnabled.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <SectionHeader count={visibleEnabled.length} className="!mb-0">Enabled</SectionHeader>
            {hasPriorityGap && !searchNeedle && (
              <Button
                variant="secondary"
                size="sm"
                onClick={compactPriorities}
                title="Renumber all installed mods 1, 2, 3, … to remove gaps from disable/delete"
              >
                Compact priorities
              </Button>
            )}
          </div>
          <div
            className={
              viewMode === 'compact'
                ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
                : viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                  : 'space-y-2'
            }
          >
            {visibleEnabled.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                viewMode={viewMode}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                conflicts={conflictMap.get(mod.id) || []}
                soundVolume={soundVolume}
                updateAvailable={updatesAvailable.has(mod.id)}
                onOpenDetails={mod.gameBananaId ? () => openModDetails(mod) : undefined}
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
                draggable={!searchNeedle}
                isDragging={draggingId === mod.id}
                isDropTarget={dropTargetId === mod.id}
                dropPosition={dropTargetId === mod.id ? dropPosition : null}
                onDragStart={() => {
                  setDraggingId(mod.id);
                  setDraggingSection('enabled');
                }}
                onDragOver={(pos) => {
                  if (!draggingId || draggingId === mod.id) return;
                  if (draggingSection !== 'enabled') return;
                  setDropTargetId(mod.id);
                  setDropPosition(pos);
                }}
                onDragLeaveCard={() => {
                  if (dropTargetId === mod.id) {
                    setDropTargetId(null);
                    setDropPosition(null);
                  }
                }}
                onDrop={() => {
                  if (draggingId && dropTargetId && dropPosition && draggingSection === 'enabled') {
                    applyReorder(draggingId, dropTargetId, dropPosition, 'enabled');
                  }
                  resetDragState();
                }}
                onDragEnd={resetDragState}
              />
            ))}
          </div>
        </div>
      )}

      {visibleDisabled.length > 0 && (
        <div>
          <SectionHeader count={visibleDisabled.length}>Disabled</SectionHeader>
          <div
            className={
              viewMode === 'compact'
                ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
                : viewMode === 'grid'
                  ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                  : 'space-y-2'
            }
          >
            {visibleDisabled.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                viewMode={viewMode}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                conflicts={conflictMap.get(mod.id) || []}
                soundVolume={soundVolume}
                updateAvailable={updatesAvailable.has(mod.id)}
                onOpenDetails={mod.gameBananaId ? () => openModDetails(mod) : undefined}
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
                draggable={!searchNeedle}
                isDragging={draggingId === mod.id}
                isDropTarget={dropTargetId === mod.id}
                dropPosition={dropTargetId === mod.id ? dropPosition : null}
                onDragStart={() => {
                  setDraggingId(mod.id);
                  setDraggingSection('disabled');
                }}
                onDragOver={(pos) => {
                  if (!draggingId || draggingId === mod.id) return;
                  if (draggingSection !== 'disabled') return;
                  setDropTargetId(mod.id);
                  setDropPosition(pos);
                }}
                onDragLeaveCard={() => {
                  if (dropTargetId === mod.id) {
                    setDropTargetId(null);
                    setDropPosition(null);
                  }
                }}
                onDrop={() => {
                  if (draggingId && dropTargetId && dropPosition && draggingSection === 'disabled') {
                    applyReorder(draggingId, dropTargetId, dropPosition, 'disabled');
                  }
                  resetDragState();
                }}
                onDragEnd={resetDragState}
              />
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!modToDelete}
        title="Delete Mod?"
        message={
          <>
            Are you sure you want to delete{' '}
            <span className="font-medium text-text-primary">{modToDelete?.name}</span>? This action
            cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setModToDelete(null)}
      />

      {importOpen && (
        <ImportCustomModModal
          onClose={() => setImportOpen(false)}
          onImport={async (args) => {
            await importCustomMod(args);
          }}
        />
      )}

      {detailsLoading && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in"
          onClick={closeModDetails}
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
            <span className="text-sm text-text-secondary">Loading mod details...</span>
          </div>
        </div>
      )}

      {detailsError && !detailsMod && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={closeModDetails}
        >
          <div
            className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-red-400 mb-2">Couldn't load mod details</h3>
            <p className="text-sm text-text-secondary mb-4">{detailsError}</p>
            <div className="flex justify-end">
              <Button onClick={closeModDetails}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {detailsMod && (
        <ModDetailsModal
          mod={detailsMod}
          section={detailsSection}
          installed={true}
          installedFileIds={detailsInstalledFileIds}
          downloadingFileId={null}
          extracting={false}
          progress={null}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          dateAdded={detailsDates?.dateAdded}
          dateModified={detailsDates?.dateModified}
          updateAvailable={detailsUpdateAvailable}
          onClose={closeModDetails}
          onDownload={handleDetailsDownload}
        />
      )}
    </div>
  );
}

function InstalledSkeleton({ viewMode }: { viewMode: ViewMode }) {
  const isGridLike = viewMode !== 'list';
  const rows = viewMode === 'compact' ? 12 : viewMode === 'grid' ? 8 : 6;
  return (
    <div className="p-6 animate-fade-in" aria-busy="true" aria-live="polite">
      <div className="flex items-end justify-between gap-4 pb-4 border-b border-border mb-6">
        <div className="space-y-2">
          <div className="skeleton-shimmer bg-bg-tertiary rounded-md h-9 w-52" />
          <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-36" />
        </div>
        <div className="skeleton-shimmer bg-bg-tertiary rounded-lg h-9 w-56" />
      </div>
      <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-20 mb-3" />
      <div
        className={
          viewMode === 'compact'
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2'
            : viewMode === 'grid'
              ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
              : 'space-y-2'
        }
      >
        {Array.from({ length: rows }).map((_, i) =>
          isGridLike ? (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-3 flex flex-col gap-3">
              <div className="skeleton-shimmer w-full aspect-video bg-bg-tertiary rounded-md" />
              <div className="flex items-center gap-3">
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-5 h-5" />
                <div className="flex-1 space-y-1.5">
                  <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-3/4" />
                  <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/2" />
                </div>
                <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              </div>
            </div>
          ) : (
            <div key={i} className="rounded-lg border border-border bg-bg-secondary p-4 flex items-center gap-4">
              <div className="skeleton-shimmer bg-bg-tertiary rounded w-5 h-5" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-20 h-12 flex-shrink-0" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <div className="skeleton-shimmer bg-bg-tertiary rounded h-3.5 w-1/2" />
                <div className="skeleton-shimmer bg-bg-tertiary/70 rounded h-3 w-1/3" />
              </div>
              <div className="skeleton-shimmer bg-bg-tertiary rounded-full w-11 h-6" />
              <div className="skeleton-shimmer bg-bg-tertiary rounded-md w-8 h-8" />
            </div>
          )
        )}
      </div>
    </div>
  );
}

interface ModCardProps {
  mod: {
    id: string;
    name: string;
    fileName: string;
    enabled: boolean;
    priority: number;
    size: number;
    thumbnailUrl?: string;
    audioUrl?: string;
    sourceSection?: string;
    categoryName?: string;
    nsfw?: boolean;
    gameBananaId?: number;
  };
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  conflicts: ModConflict[];
  soundVolume: number;
  updateAvailable?: boolean;
  onOpenDetails?: () => void;
  onToggle: () => void;
  onDelete: () => void;
  draggable?: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  dropPosition?: DropPosition | null;
  onDragStart?: () => void;
  onDragOver?: (position: DropPosition) => void;
  onDragLeaveCard?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
}

function ModCard({
  mod,
  viewMode,
  hideNsfwPreviews,
  conflicts,
  soundVolume,
  updateAvailable,
  onOpenDetails,
  onToggle,
  onDelete,
  draggable,
  isDragging,
  isDropTarget,
  dropPosition,
  onDragStart,
  onDragOver,
  onDragLeaveCard,
  onDrop,
  onDragEnd,
}: ModCardProps) {
  const hasConflicts = conflicts.length > 0;
  const handleDownRef = useRef<boolean>(false);

  const indicatorClasses = (() => {
    if (!isDropTarget || !dropPosition) return '';
    const base = 'absolute bg-accent pointer-events-none rounded-full';
    if (viewMode === 'list') {
      return dropPosition === 'before'
        ? `${base} left-2 right-2 -top-[3px] h-[3px]`
        : `${base} left-2 right-2 -bottom-[3px] h-[3px]`;
    }
    return dropPosition === 'before'
      ? `${base} top-2 bottom-2 -left-[3px] w-[3px]`
      : `${base} top-2 bottom-2 -right-[3px] w-[3px]`;
  })();

  return (
    <div
      className={`relative rounded-lg border transition-colors ${
        hasConflicts
          ? 'bg-state-warning/5 border-state-warning/50'
          : mod.enabled
            ? 'bg-accent/5 border-accent/40'
            : 'bg-bg-secondary/60 border-border/70 text-text-primary/80 hover:bg-bg-secondary hover:text-text-primary'
      } ${viewMode === 'compact' ? 'p-2 flex flex-col gap-2' : viewMode === 'grid' ? 'p-3 flex flex-col gap-3' : 'flex items-center gap-4 p-4'} ${
        isDragging ? 'opacity-40' : ''
      }`}
      draggable={draggable}
      onDragStart={(e) => {
        if (!draggable || !onDragStart) {
          e.preventDefault();
          return;
        }
        // Require drag to originate from the grip handle so clicks on toggle/delete don't start a drag
        if (!handleDownRef.current) {
          e.preventDefault();
          return;
        }
        handleDownRef.current = false;
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs setData to start a drag
        try {
          e.dataTransfer.setData('text/plain', mod.id);
        } catch {
          // ignore
        }
        onDragStart();
      }}
      onDragOver={(e) => {
        if (!draggable || !onDragOver) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        if (viewMode === 'list') {
          const mid = rect.top + rect.height / 2;
          onDragOver(e.clientY < mid ? 'before' : 'after');
        } else {
          const mid = rect.left + rect.width / 2;
          onDragOver(e.clientX < mid ? 'before' : 'after');
        }
      }}
      onDragLeave={(e) => {
        // Only count leaves where we're exiting the card itself
        const related = e.relatedTarget as Node | null;
        if (related && e.currentTarget.contains(related)) return;
        onDragLeaveCard?.();
      }}
      onDrop={(e) => {
        if (!draggable || !onDrop) return;
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={() => onDragEnd?.()}
    >
      {indicatorClasses && <div className={indicatorClasses} />}

      {viewMode !== 'list' && (() => {
        const isSoundCard = mod.sourceSection === 'Sound' && !!mod.audioUrl;
        const overlayBadges = (
          <>
            {mod.enabled && (
              <div className="absolute top-2 left-2 z-10">
                <Tag
                  tone="accent"
                  variant="overlay"
                  title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
                  className="tabular-nums"
                >
                  Load #{mod.priority}
                </Tag>
              </div>
            )}
            <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
              {hasConflicts && (
                <Tag
                  tone="warning"
                  variant="overlay"
                  icon={AlertTriangle}
                  title={conflicts.map((c) => c.details).join(', ')}
                >
                  Conflict
                </Tag>
              )}
              {updateAvailable && (
                <Tag
                  tone="info"
                  variant="overlay"
                  icon={Download}
                  title="A newer version is available on GameBanana"
                >
                  Update
                </Tag>
              )}
            </div>
          </>
        );

        if (isSoundCard) {
          // Match Browse's Sound section: infer the hero from the mod title
          // and reuse the locker render so the card carries the same hero
          // art the user saw when they downloaded it.
          const inferredHero = inferHeroFromTitle(mod.name);
          const heroRenderUrl = inferredHero ? getHeroRenderPath(inferredHero) : null;
          const heroFacePos = inferredHero ? getHeroFacePosition(inferredHero) : 50;
          return (
            <div className="group relative w-full aspect-video rounded-md overflow-hidden bg-gradient-to-br from-bg-tertiary via-bg-secondary to-bg-tertiary border border-border">
              {overlayBadges}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetails?.();
                }}
                disabled={!onOpenDetails}
                className="absolute inset-0 w-full h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
                title={onOpenDetails ? 'View mod details' : undefined}
                aria-label={onOpenDetails ? `View details for ${mod.name}` : undefined}
              >
                {heroRenderUrl ? (
                  <>
                    <img
                      src={heroRenderUrl}
                      alt={inferredHero ?? mod.name}
                      className="w-full h-full object-cover transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
                      style={{ objectPosition: `${heroFacePos}% 25%` }}
                    />
                    {/* Gradient so the overlaid player stays legible */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-1 text-text-secondary group-hover:text-accent transition-colors">
                    <div className="flex items-end gap-0.5 h-6 opacity-60">
                      {[4, 7, 12, 16, 20, 14, 8, 12, 18, 10, 6, 14, 9].map((h, i) => (
                        <span
                          key={i}
                          className="w-1 rounded-full bg-accent/70"
                          style={{ height: `${h}px` }}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider">Sound preview</span>
                  </div>
                )}
              </button>
              <div
                className="absolute inset-x-2 bottom-2 z-20"
                onClick={(e) => e.stopPropagation()}
              >
                <AudioPreviewPlayer
                  src={mod.audioUrl!}
                  compact
                  volume={soundVolume}
                  className="w-full backdrop-blur-md bg-bg-primary/70 border border-white/10 rounded-md"
                />
              </div>
            </div>
          );
        }

        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDetails?.();
            }}
            disabled={!onOpenDetails}
            className="group relative w-full aspect-video bg-bg-tertiary rounded-md overflow-hidden block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-default enabled:cursor-pointer"
            title={onOpenDetails ? 'View mod details' : undefined}
            aria-label={onOpenDetails ? `View details for ${mod.name}` : undefined}
          >
            <ModThumbnail
              src={mod.thumbnailUrl}
              alt={mod.name}
              nsfw={mod.nsfw}
              hideNsfw={hideNsfwPreviews}
              className="w-full h-full transition-transform duration-200 group-enabled:group-hover:scale-[1.03]"
            />
            {onOpenDetails && (
              <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/20" />
            )}
            {overlayBadges}
          </button>
        );
      })()}

      <div className={viewMode !== 'list' ? 'flex items-center gap-3' : 'contents'}>
        {draggable && (
          <div
            onMouseDown={() => {
              handleDownRef.current = true;
            }}
            onMouseUp={() => {
              handleDownRef.current = false;
            }}
            className="p-1 text-text-secondary hover:text-text-primary cursor-grab active:cursor-grabbing select-none"
            title="Drag to reorder"
            aria-label="Drag to reorder"
          >
            <GripVertical className="w-5 h-5" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-medium truncate flex-1 min-w-0" title={mod.name}>{mod.name}</h3>
            {hasConflicts && viewMode === 'list' && (
              <Tag tone="warning" icon={AlertTriangle} className="flex-shrink-0">
                Conflict
              </Tag>
            )}
            {mod.sourceSection === 'Sound' && (
              <Tag tone="accent" icon={Volume2} className="flex-shrink-0">
                Sound
              </Tag>
            )}
            {mod.nsfw && (
              <Tag tone="danger" className="flex-shrink-0">18+</Tag>
            )}
            {updateAvailable && viewMode === 'list' && (
              <Tag
                tone="info"
                icon={Download}
                title="A newer version is available on GameBanana"
                className="flex-shrink-0"
              >
                Update
              </Tag>
            )}
            {mod.enabled && viewMode === 'list' && (
              <Tag
                tone="accent"
                title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
                className="flex-shrink-0 tabular-nums"
              >
                Load #{mod.priority}
              </Tag>
            )}
          </div>
          <div className="flex flex-nowrap items-center gap-2 text-xs text-text-secondary mt-1 min-w-0 overflow-hidden">
            {mod.categoryName && (
              <span className="flex-shrink-0 px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">{mod.categoryName}</span>
            )}
            <span className="flex-shrink-0">{formatBytes(mod.size)}</span>
            <span
              className="font-mono truncate opacity-60 hover:opacity-100 cursor-help min-w-0"
              title={mod.fileName}
            >
              {mod.fileName}
            </span>
          </div>
        </div>

        {/* List-mode: audio preview sits between meta and delete, using the
            empty right-side space. Grid mode puts it below the card body. */}
        {viewMode === 'list' && mod.sourceSection === 'Sound' && mod.audioUrl && (
          <div
            className="hidden md:flex w-72 flex-shrink-0 items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <AudioPreviewPlayer
              src={mod.audioUrl}
              compact
              volume={soundVolume}
              className="w-full border border-border"
            />
          </div>
        )}

        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          {onOpenDetails && viewMode === 'list' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails();
              }}
              className="p-1 text-text-secondary hover:text-accent transition-colors cursor-pointer"
              title="View mod details"
              aria-label={`View details for ${mod.name}`}
            >
              <Info className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 text-text-secondary hover:text-red-500 transition-colors cursor-pointer"
            title="Delete mod"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onToggle}
            aria-pressed={mod.enabled}
            aria-label={mod.enabled ? 'Disable mod' : 'Enable mod'}
            title={mod.enabled ? 'Disable mod' : 'Enable mod'}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
              mod.enabled ? 'bg-accent' : 'bg-bg-tertiary border border-border'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform ${
                mod.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
              aria-hidden
            />
          </button>
        </div>
      </div>

    </div>
  );
}

interface ImportCustomModModalProps {
  onClose: () => void;
  onImport: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function deriveModNameFromPath(p: string): string {
  const base = p.split(/[\\/]/).pop() ?? '';
  return base
    .replace(/_dir\.vpk$/i, '')
    .replace(/\.vpk$/i, '')
    .replace(/^pak\d{2}_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function ImportCustomModModal({ onClose, onImport }: ImportCustomModModalProps) {
  const [vpkPath, setVpkPath] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [imagePath, setImagePath] = useState<string>('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string>('');
  const [nsfw, setNsfw] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [vpkDragActive, setVpkDragActive] = useState(false);
  const [imgDragActive, setImgDragActive] = useState(false);

  const acceptVpkPath = (picked: string) => {
    setVpkPath(picked);
    setError(null);
    if (!name) setName(deriveModNameFromPath(picked));
  };

  const acceptImagePath = async (picked: string) => {
    setImagePath(picked);
    setError(null);
    try {
      const dataUrl = await readImageDataUrl(picked);
      setThumbnailDataUrl(dataUrl);
    } catch (err) {
      setThumbnailDataUrl('');
      setError(`Couldn't read image: ${String(err)}`);
    }
  };

  const pickVpk = async () => {
    const picked = await showOpenDialog({
      title: 'Select VPK file',
      filters: [{ name: 'VPK files', extensions: ['vpk'] }],
    });
    if (picked) acceptVpkPath(picked);
  };

  const pickImage = async () => {
    const picked = await showOpenDialog({
      title: 'Select thumbnail image',
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    });
    if (picked) await acceptImagePath(picked);
  };

  const handleVpkDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setVpkDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.vpk$/i.test(file.name)) {
      setError(`Expected a .vpk file — got "${file.name}".`);
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError('Could not resolve the dropped file path.');
      return;
    }
    acceptVpkPath(path);
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImgDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!IMAGE_EXTS.includes(ext)) {
      setError(`Expected an image (${IMAGE_EXTS.join(', ')}) — got "${file.name}".`);
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError('Could not resolve the dropped image path.');
      return;
    }
    await acceptImagePath(path);
  };

  const onZoneKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const canSubmit = !!vpkPath && !!name.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onImport({
        vpkPath,
        name: name.trim(),
        thumbnailDataUrl: thumbnailDataUrl || undefined,
        nsfw,
      });
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-bg-secondary border border-border rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <FilePlus className="w-5 h-5" />
            Import Custom Mod
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              VPK file <span className="text-red-400">*</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label={vpkPath ? `VPK selected: ${vpkPath}. Press Enter to change.` : 'Drop a VPK file here or press Enter to browse'}
              onClick={pickVpk}
              onKeyDown={(e) => onZoneKeyDown(e, pickVpk)}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setVpkDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setVpkDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setVpkDragActive(false); }}
              onDrop={handleVpkDrop}
              className={`relative flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border border-dashed text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                vpkDragActive
                  ? 'border-accent bg-accent/10'
                  : vpkPath
                    ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
                    : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
              }`}
            >
              {vpkPath ? (
                <>
                  <FilePlus className="w-5 h-5 text-accent" aria-hidden />
                  <span className="text-sm text-text-primary font-medium truncate max-w-full">
                    {vpkPath.split(/[\\/]/).pop()}
                  </span>
                  <span className="text-xs text-text-secondary font-mono truncate max-w-full">{vpkPath}</span>
                  <span className="text-xs text-accent">Click or drop another to replace</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-6 h-6 text-text-secondary" aria-hidden />
                  <span className="text-sm text-text-primary font-medium">
                    Drop a <code className="font-mono text-accent">.vpk</code> here
                  </span>
                  <span className="text-xs text-text-secondary">or click to browse</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              The file will be copied into your addons folder and renamed with the next available pak## priority.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Mod name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome skin"
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              Thumbnail image <span className="text-text-secondary font-normal">(optional)</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label={imagePath ? `Thumbnail selected: ${imagePath}. Press Enter to change.` : 'Drop an image here or press Enter to browse'}
              onClick={pickImage}
              onKeyDown={(e) => onZoneKeyDown(e, pickImage)}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setImgDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(false); }}
              onDrop={handleImageDrop}
              className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                imgDragActive
                  ? 'border-accent bg-accent/10'
                  : thumbnailDataUrl
                    ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
                    : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-white/20'
              }`}
            >
              <div className="w-24 aspect-video bg-bg-tertiary rounded-md overflow-hidden flex items-center justify-center text-text-secondary flex-shrink-0">
                {thumbnailDataUrl ? (
                  <img src={thumbnailDataUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-5 h-5" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {imagePath ? (
                  <>
                    <div className="text-sm text-text-primary font-medium truncate">{imagePath.split(/[\\/]/).pop()}</div>
                    <div className="text-xs text-text-secondary font-mono truncate">{imagePath}</div>
                    <div className="text-xs text-accent mt-0.5">Click or drop another to replace</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-text-primary font-medium">Drop an image here</div>
                    <div className="text-xs text-text-secondary">or click to browse — {IMAGE_EXTS.join(', ')}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={nsfw}
              onChange={(e) => setNsfw(e.target.checked)}
              className="w-4 h-4 accent-accent cursor-pointer"
            />
            Mark as NSFW
          </label>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-border">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-black rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
