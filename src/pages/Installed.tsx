import { useEffect, useState } from 'react';
import { Package, Loader2, Settings, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts } from '../lib/api';
import type { ModConflict } from '../lib/api';
import ModThumbnail from '../components/ModThumbnail';
import { Button } from '../components/common/ui';
import { PageHeader, ViewModeToggle, EmptyState, ConfirmModal, SectionHeader, type ViewMode } from '../components/common/PageComponents';
import { Search } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function Installed() {
  const navigate = useNavigate();
  const { settings, mods, modsLoading, modsError, loadSettings, loadMods, toggleMod, deleteMod } =
    useAppStore();
  const activeDeadlockPath = getActiveDeadlockPath(settings);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [conflictMap, setConflictMap] = useState<Map<string, ModConflict[]>>(new Map());
  const [modToDelete, setModToDelete] = useState<{ id: string; name: string } | null>(null);

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

  // Load conflicts and build a map of mod ID -> conflicts
  useEffect(() => {
    const loadConflictData = async () => {
      try {
        const conflicts = await getConflicts();
        const map = new Map<string, ModConflict[]>();

        for (const conflict of conflicts) {
          // Add to modA's conflicts
          const existingA = map.get(conflict.modA) || [];
          existingA.push(conflict);
          map.set(conflict.modA, existingA);

          // Add to modB's conflicts
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

  // No path configured
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

  // Loading
  if (modsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  // Error
  if (modsError) {
    return (
      <EmptyState
        icon={Package}
        title="Error Loading Mods"
        description={modsError ?? undefined}
        variant="error"
        action={
          <Button onClick={() => loadMods()}>Retry</Button>
        }
      />
    );
  }

  // No mods found
  if (mods.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No Mods Found"
        description="No mods installed yet. Download mods from the Browse tab or manually place VPK files in your addons folder."
        action={
          <Button onClick={() => navigate('/browse')} icon={Search}>
            Browse Mods
          </Button>
        }
      />
    );
  }

  // Mod list
  const enabledMods = mods.filter((m) => m.enabled);
  const disabledMods = mods.filter((m) => !m.enabled);
  const conflictCount = conflictMap.size > 0 ? new Set([...conflictMap.keys()]).size : 0;

  return (
    <div className="p-6">
      <PageHeader
        icon={Package}
        title="Installed Mods"
        description={`${enabledMods.length} enabled / ${mods.length} total`}
        action={
          <div className="flex items-center gap-3">
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
            <ViewModeToggle
              value={viewMode}
              options={[
                { value: 'grid', label: 'Cards' },
                { value: 'list', label: 'List' },
              ]}
              onChange={(mode) => setViewMode(mode as 'grid' | 'list')}
            />
          </div>
        }
        className="mb-6"
      />

      {/* Enabled Mods */}
      {enabledMods.length > 0 && (
        <div className="mb-6">
          <SectionHeader count={enabledMods.length}>Enabled</SectionHeader>
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                : 'space-y-2'
            }
          >
            {enabledMods.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                viewMode={viewMode}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                conflicts={conflictMap.get(mod.id) || []}
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Disabled Mods */}
      {disabledMods.length > 0 && (
        <div>
          <SectionHeader count={disabledMods.length}>Disabled</SectionHeader>
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
                : 'space-y-2'
            }
          >
            {disabledMods.map((mod) => (
              <ModCard
                key={mod.id}
                mod={mod}
                viewMode={viewMode}
                hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
                conflicts={conflictMap.get(mod.id) || []}
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => setModToDelete({ id: mod.id, name: mod.name })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={!!modToDelete}
        title="Delete Mod?"
        message={
          <>
            Are you sure you want to delete <span className="font-medium text-text-primary">{modToDelete?.name}</span>? This action cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setModToDelete(null)}
      />
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
    nsfw?: boolean;
  };
  viewMode: ViewMode;
  hideNsfwPreviews: boolean;
  conflicts: ModConflict[];
  onToggle: () => void;
  onDelete: () => void;
}

function ModCard({ mod, viewMode, hideNsfwPreviews, conflicts, onToggle, onDelete }: ModCardProps) {
  const hasConflicts = conflicts.length > 0;

  return (
    <div
      className={`rounded-lg border transition-colors ${hasConflicts
        ? 'bg-yellow-500/5 border-yellow-500/50'
        : mod.enabled
          ? 'bg-bg-secondary border-accent/30'
          : 'bg-bg-tertiary border-border grayscale-[50%]'
        } ${viewMode === 'grid' ? 'p-3 flex flex-col gap-3' : 'flex items-center gap-4 p-4'}`}
    >
      {viewMode === 'grid' && (
        <div className="relative w-full aspect-video bg-bg-tertiary rounded-md overflow-hidden">
          <ModThumbnail
            src={mod.thumbnailUrl}
            alt={mod.name}
            nsfw={mod.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-full h-full"
          />
          {hasConflicts && (
            <div className="absolute top-2 right-2 p-1.5 bg-yellow-500 rounded-full" title={conflicts.map(c => c.details).join(', ')}>
              <AlertTriangle className="w-3 h-3 text-black" />
            </div>
          )}
        </div>
      )}

      <div className={viewMode === 'grid' ? 'flex items-center gap-3' : 'contents'}>
        {/* Toggle */}
        <button
          onClick={onToggle}
          aria-pressed={mod.enabled}
          aria-label={mod.enabled ? 'Disable mod' : 'Enable mod'}
          className={`transition-colors cursor-pointer ${mod.enabled ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          title={mod.enabled ? 'Disable mod' : 'Enable mod'}
        >
          {mod.enabled ? (
            <ToggleRight className="w-8 h-8" />
          ) : (
            <ToggleLeft className="w-8 h-8" />
          )}
        </button>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{mod.name}</h3>
            {hasConflicts && viewMode === 'list' && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs">
                <AlertTriangle className="w-3 h-3" />
                Conflict
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary mt-1">
            <span className="font-mono">{mod.fileName}</span>
            <span>{formatBytes(mod.size)}</span>
            <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-xs">
              Priority: {mod.priority}
            </span>
          </div>
        </div>

        {/* Delete */}
        <button
          onClick={onDelete}
          className="p-2 text-text-secondary hover:text-red-500 transition-colors cursor-pointer"
          title="Delete mod"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
