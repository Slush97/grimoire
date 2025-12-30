import { useEffect, useState } from 'react';
import { Package, Loader2, Settings, Trash2, ToggleLeft, ToggleRight, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';
import { getConflicts } from '../lib/api';
import type { ModConflict } from '../lib/api';
import ModThumbnail from '../components/ModThumbnail';

type ViewMode = 'grid' | 'list';

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
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Package className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">No Game Path Set</h2>
        <p className="text-center max-w-md mb-4">
          Configure your Deadlock installation path or enable dev mode to start managing mods.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
        >
          <Settings className="w-4 h-4" />
          Open Settings
        </button>
      </div>
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
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Package className="w-16 h-16 mb-4 opacity-50 text-red-500" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">Error Loading Mods</h2>
        <p className="text-center max-w-md text-red-400">{modsError}</p>
        <button
          onClick={() => loadMods()}
          className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // No mods found
  if (mods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <Package className="w-16 h-16 mb-4 opacity-50" />
        <h2 className="text-xl font-semibold text-text-primary mb-2">No Mods Found</h2>
        <p className="text-center max-w-md">
          No mods installed yet. Download mods from the Browse tab or manually place VPK files in
          your addons folder.
        </p>
      </div>
    );
  }

  // Mod list
  const enabledMods = mods.filter((m) => m.enabled);
  const disabledMods = mods.filter((m) => !m.enabled);
  const conflictCount = conflictMap.size > 0 ? new Set([...conflictMap.keys()]).size : 0;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Installed Mods</h1>
          {conflictCount > 0 && (
            <button
              onClick={() => navigate('/conflicts')}
              className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded-lg text-sm hover:bg-yellow-500/30 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              {conflictMap.size / 2} conflicts
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-secondary">
            {enabledMods.length} enabled / {mods.length} total
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 rounded-lg border transition-colors ${viewMode === 'grid'
                  ? 'bg-bg-tertiary border-accent text-text-primary'
                  : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
                }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 rounded-lg border transition-colors ${viewMode === 'list'
                  ? 'bg-bg-tertiary border-accent text-text-primary'
                  : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
                }`}
            >
              List
            </button>
          </div>
        </div>
      </div>

      {/* Enabled Mods */}
      {enabledMods.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-text-secondary mb-3 uppercase tracking-wider">
            Enabled ({enabledMods.length})
          </h2>
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
          <h2 className="text-sm font-medium text-text-secondary mb-3 uppercase tracking-wider">
            Disabled ({disabledMods.length})
          </h2>
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
      {modToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-secondary border border-border rounded-xl p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Delete Mod?</h3>
            <p className="text-text-secondary mb-4">
              Are you sure you want to delete <span className="font-medium text-text-primary">{modToDelete.name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setModToDelete(null)}
                className="px-4 py-2 bg-bg-tertiary border border-border rounded-lg hover:bg-bg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
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
            : 'bg-bg-tertiary border-border opacity-75'
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
          className={`transition-colors ${mod.enabled ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
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
          <div className="flex items-center gap-3 text-xs text-text-secondary mt-1">
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
          className="p-2 text-text-secondary hover:text-red-500 transition-colors"
          title="Delete mod"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
