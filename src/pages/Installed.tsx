import { useEffect, useState } from 'react';
import { Package, Loader2, Settings, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { getActiveDeadlockPath } from '../lib/appSettings';

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

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (activeDeadlockPath) {
      loadMods();
    }
  }, [activeDeadlockPath, loadMods]);

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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Installed Mods</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-secondary">
            {enabledMods.length} enabled / {mods.length} total
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`px-3 py-2 rounded-lg border transition-colors ${
                viewMode === 'grid'
                  ? 'bg-bg-tertiary border-accent text-text-primary'
                  : 'bg-bg-secondary border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-2 rounded-lg border transition-colors ${
                viewMode === 'list'
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
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => deleteMod(mod.id)}
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
                onToggle={() => toggleMod(mod.id)}
                onDelete={() => deleteMod(mod.id)}
              />
            ))}
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
  };
  viewMode: ViewMode;
  onToggle: () => void;
  onDelete: () => void;
}

function ModCard({ mod, viewMode, onToggle, onDelete }: ModCardProps) {
  return (
    <div
      className={`rounded-lg border transition-colors ${
        mod.enabled
          ? 'bg-bg-secondary border-accent/30'
          : 'bg-bg-tertiary border-border opacity-75'
      } ${viewMode === 'grid' ? 'p-3 flex flex-col gap-3' : 'flex items-center gap-4 p-4'}`}
    >
      {viewMode === 'grid' && (
        <div className="w-full aspect-video bg-bg-tertiary rounded-md overflow-hidden">
          {mod.thumbnailUrl ? (
            <img src={mod.thumbnailUrl} alt={mod.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-secondary">
              No preview
            </div>
          )}
        </div>
      )}

      <div className={viewMode === 'grid' ? 'flex items-center gap-3' : 'contents'}>
        {/* Toggle */}
        <button
          onClick={onToggle}
          className={`transition-colors ${
            mod.enabled ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
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
          <h3 className="font-medium truncate">{mod.name}</h3>
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
