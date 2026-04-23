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
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts, openModsFolder, readImageDataUrl, showOpenDialog } from '../lib/api';
import type { ModConflict } from '../lib/api';
import ModThumbnail from '../components/ModThumbnail';
import AudioPreviewPlayer from '../components/AudioPreviewPlayer';
import { Button } from '../components/common/ui';
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
    return stored === 'grid' ? 'grid' : 'list';
  });
  useEffect(() => {
    localStorage.setItem('installedViewMode', viewMode);
  }, [viewMode]);
  const [search, setSearch] = useState('');
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  const [modToDelete, setModToDelete] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Drag-and-drop reorder state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<DropPosition | null>(null);

  const handleDeleteConfirm = async () => {
    if (modToDelete) {
      await deleteMod(modToDelete.id);
      setModToDelete(null);
    }
  };

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
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
  const disabledMods = mods.filter((m) => !m.enabled);
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
    setDropTargetId(null);
    setDropPosition(null);
  };

  const applyReorder = (sourceId: string, targetId: string, position: DropPosition) => {
    if (sourceId === targetId) return;
    const sourceIdx = enabledMods.findIndex((m) => m.id === sourceId);
    if (sourceIdx === -1) return;

    const working = enabledMods.slice();
    const [moved] = working.splice(sourceIdx, 1);
    const adjustedTargetIdx = working.findIndex((m) => m.id === targetId);
    if (adjustedTargetIdx === -1) return;
    const insertAt = position === 'before' ? adjustedTargetIdx : adjustedTargetIdx + 1;
    working.splice(insertAt, 0, moved);

    const unchanged = working.every((m, i) => m.id === enabledMods[i].id);
    if (unchanged) return;

    reorderMods(working.map((m) => m.fileName));
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
        description={
          <span className="flex items-center gap-2 flex-wrap">
            <span>{enabledMods.length} enabled / {mods.length} total</span>
            {mods.length > 0 && enabledMods.length === 0 && (
              <span
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 text-xs font-medium"
                title="You have installed mods but none are enabled — nothing will apply when you launch."
              >
                <Info className="w-3 h-3" />
                No mods enabled
              </span>
            )}
          </span>
        }
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
                { value: 'list', label: 'List' },
                { value: 'grid', label: 'Cards' },
              ]}
              onChange={(mode) => setViewMode(mode as 'grid' | 'list')}
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
          <SectionHeader count={visibleEnabled.length}>Enabled</SectionHeader>
          <div
            className={
              viewMode === 'grid'
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
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
                draggable={!searchNeedle}
                isDragging={draggingId === mod.id}
                isDropTarget={dropTargetId === mod.id}
                dropPosition={dropTargetId === mod.id ? dropPosition : null}
                onDragStart={() => setDraggingId(mod.id)}
                onDragOver={(pos) => {
                  if (!draggingId || draggingId === mod.id) return;
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
                  if (draggingId && dropTargetId && dropPosition) {
                    applyReorder(draggingId, dropTargetId, dropPosition);
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
              viewMode === 'grid'
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
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
                draggable={false}
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
    </div>
  );
}

function InstalledSkeleton({ viewMode }: { viewMode: ViewMode }) {
  const rows = viewMode === 'grid' ? 8 : 6;
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
          viewMode === 'grid'
            ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
            : 'space-y-2'
        }
      >
        {Array.from({ length: rows }).map((_, i) =>
          viewMode === 'grid' ? (
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
      } ${viewMode === 'grid' ? 'p-3 flex flex-col gap-3' : 'flex items-center gap-4 p-4'} ${
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

      {viewMode === 'grid' && (
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
          {mod.enabled && (
            <div
              className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 bg-accent text-white rounded-full text-[10px] font-bold uppercase tracking-wide shadow-lg"
              title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
            >
              Load #{mod.priority}
            </div>
          )}
          <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
            {hasConflicts && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 bg-state-warning/90 text-black rounded-full text-[10px] font-bold uppercase shadow"
                title={conflicts.map((c) => c.details).join(', ')}
              >
                <AlertTriangle className="w-3 h-3" />
                Conflict
              </span>
            )}
            {updateAvailable && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 bg-state-info/90 text-black rounded-full text-[10px] font-bold uppercase shadow"
                title="A newer version is available on GameBanana"
              >
                <Download className="w-3 h-3" />
                Update
              </span>
            )}
          </div>
        </button>
      )}

      <div className={viewMode === 'grid' ? 'flex items-center gap-3' : 'contents'}>
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
              <span className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-state-warning/20 text-state-warning rounded text-xs font-semibold uppercase tracking-wide">
                <AlertTriangle className="w-3 h-3" />
                Conflict
              </span>
            )}
            {mod.sourceSection === 'Sound' && (
              <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-accent/15 text-accent rounded text-[10px] font-medium uppercase tracking-wide">
                <Volume2 className="w-3 h-3" />
                Sound
              </span>
            )}
            {mod.nsfw && (
              <span className="flex-shrink-0 px-1.5 py-0.5 bg-state-danger/15 text-state-danger rounded text-[10px] font-semibold uppercase tracking-wide">
                18+
              </span>
            )}
            {updateAvailable && viewMode === 'list' && (
              <span
                className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-state-info/20 text-state-info rounded text-[10px] font-semibold uppercase tracking-wide"
                title="A newer version is available on GameBanana"
              >
                <Download className="w-3 h-3" />
                Update
              </span>
            )}
            {mod.enabled && viewMode === 'list' && (
              <span
                className="flex-shrink-0 px-1.5 py-0.5 bg-accent/10 text-accent rounded text-[10px] font-semibold uppercase tracking-wide"
                title="Lower number loads first. When two mods overwrite the same file, the later-loaded mod wins."
              >
                Load #{mod.priority}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary mt-1">
            {mod.categoryName && (
              <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">{mod.categoryName}</span>
            )}
            <span>{formatBytes(mod.size)}</span>
            <span
              className="font-mono truncate opacity-60 hover:opacity-100 cursor-help"
              title={mod.fileName}
            >
              {mod.fileName.length > 20 ? `${mod.fileName.slice(0, 17)}…` : mod.fileName}
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

      {viewMode === 'grid' && mod.sourceSection === 'Sound' && mod.audioUrl && (
        <div className="w-full" onClick={(e) => e.stopPropagation()}>
          <AudioPreviewPlayer
            src={mod.audioUrl}
            compact
            volume={soundVolume}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

interface ImportCustomModModalProps {
  onClose: () => void;
  onImport: (args: { vpkPath: string; name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
}

function ImportCustomModModal({ onClose, onImport }: ImportCustomModModalProps) {
  const [vpkPath, setVpkPath] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [imagePath, setImagePath] = useState<string>('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string>('');
  const [nsfw, setNsfw] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const pickVpk = async () => {
    const picked = await showOpenDialog({
      title: 'Select VPK file',
      filters: [{ name: 'VPK files', extensions: ['vpk'] }],
    });
    if (picked) {
      setVpkPath(picked);
      if (!name) {
        const base = picked.split(/[\\/]/).pop() ?? '';
        const cleaned = base
          .replace(/_dir\.vpk$/i, '')
          .replace(/\.vpk$/i, '')
          .replace(/^pak\d{2}_/, '')
          .replace(/[_-]+/g, ' ');
        setName(cleaned.trim());
      }
    }
  };

  const pickImage = async () => {
    const picked = await showOpenDialog({
      title: 'Select thumbnail image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    });
    if (!picked) return;
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
            <div className="flex gap-2">
              <input
                type="text"
                value={vpkPath}
                readOnly
                placeholder="No file selected"
                className="flex-1 min-w-0 px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm text-text-primary placeholder:text-text-secondary focus:outline-none truncate"
              />
              <button
                onClick={pickVpk}
                className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm hover:bg-bg-secondary transition-colors cursor-pointer"
              >
                Choose…
              </button>
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
            <div className="flex items-start gap-3">
              <div className="w-24 aspect-video bg-bg-tertiary rounded-md overflow-hidden flex items-center justify-center text-text-secondary flex-shrink-0">
                {thumbnailDataUrl ? (
                  <img src={thumbnailDataUrl} alt="Thumbnail preview" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-2">
                <button
                  onClick={pickImage}
                  className="px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-sm hover:bg-bg-secondary transition-colors cursor-pointer w-fit"
                >
                  {imagePath ? 'Change image…' : 'Choose image…'}
                </button>
                {imagePath && (
                  <span className="text-xs text-text-secondary font-mono truncate">{imagePath}</span>
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
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
