import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, X } from 'lucide-react';
import { getConflicts, disableMod, getMods } from '../lib/api';
import type { ModConflict } from '../lib/api';
import type { Mod } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { Button } from '../components/common/ui';
import { PageHeader, EmptyState } from '../components/common/PageComponents';
interface ModWithThumbnail {
  id: string;
  name: string;
  fileName: string;
  thumbnailUrl?: string;
}

export default function Conflicts() {
  const [conflicts, setConflicts] = useState<ModConflict[]>([]);
  const [modsMap, setModsMap] = useState<Map<string, ModWithThumbnail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { loadMods } = useAppStore();

  const loadConflicts = async () => {
    setLoading(true);
    setError(null);
    try {
      const [conflictResult, modsResult] = await Promise.all([
        getConflicts(),
        getMods(),
      ]);

      const map = new Map<string, ModWithThumbnail>();
      for (const mod of modsResult as Mod[]) {
        map.set(mod.id, {
          id: mod.id,
          name: mod.name,
          fileName: mod.fileName,
          thumbnailUrl: mod.thumbnailUrl,
        });
      }
      setModsMap(map);
      setConflicts(conflictResult);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConflicts();
  }, []);

  const handleDisableMod = async (modId: string) => {
    try {
      await disableMod(modId);
      await loadMods();
      await loadConflicts();
    } catch (err) {
      setError(String(err));
    }
  };

  const getModInfo = (modId: string, fallbackName: string): ModWithThumbnail => {
    return modsMap.get(modId) || { id: modId, name: fallbackName, fileName: '' };
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary" role="status" aria-live="polite">
        <RefreshCw className="w-8 h-8 animate-spin mb-4 text-accent" />
        <p>Scanning for conflicts...</p>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Error Loading Conflicts"
        description={error ?? undefined}
        variant="error"
        action={
          <Button onClick={loadConflicts}>Retry</Button>
        }
      />
    );
  }

  if (conflicts.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle}
        title="No Conflicts Detected"
        description="Your installed mods don't have any conflicts. Great!"
        action={
          <Button variant="secondary" onClick={loadConflicts} icon={RefreshCw}>Refresh</Button>
        }
      />
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        icon={AlertTriangle}
        title={`Conflicts (${conflicts.length})`}
        description="Resolve conflicts between installed mods"
        action={
          <Button variant="secondary" onClick={loadConflicts} icon={RefreshCw}>Refresh</Button>
        }
        className="mb-6"
      />

      {/* Grid of conflict cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {conflicts.map((conflict, i) => {
          const modA = getModInfo(conflict.modA, conflict.modAName);
          const modB = getModInfo(conflict.modB, conflict.modBName);

          return (
            <div
              key={`${conflict.modA}-${conflict.modB}-${i}`}
              className="bg-bg-secondary border border-yellow-500/30 rounded-xl overflow-hidden"
            >
              {/* Header */}
              <div className="bg-yellow-500/10 px-4 py-2 flex items-center gap-2 border-b border-yellow-500/20">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span className="text-sm text-yellow-400">{conflict.details}</span>
              </div>

              {/* Two mod cards */}
              <div className="p-4 flex gap-4">
                {/* Mod A Card */}
                <div className="flex-1 group">
                  <div className="relative aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
                    {modA.thumbnailUrl ? (
                      <img
                        src={modA.thumbnailUrl}
                        alt={modA.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                        No Preview
                      </div>
                    )}
                    <button
                      onClick={() => handleDisableMod(modA.id)}
                      aria-label={`Disable ${modA.name}`}
                      className="absolute inset-x-0 bottom-0 bg-red-500/80 hover:bg-red-500 flex items-center justify-center py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                    >
                      <span className="text-white text-sm font-medium flex items-center gap-1">
                        <X className="w-4 h-4" /> Disable
                      </span>
                    </button>
                  </div>
                  <p className="text-sm font-medium text-text-primary text-center truncate">
                    {modA.name}
                  </p>
                  {modA.fileName && (
                    <p className="text-xs text-text-tertiary text-center truncate" title={modA.fileName}>
                      {modA.fileName}
                    </p>
                  )}
                </div>

                {/* VS divider */}
                <div className="flex items-center">
                  <span className="text-text-tertiary text-sm font-bold">VS</span>
                </div>

                {/* Mod B Card */}
                <div className="flex-1 group">
                  <div className="relative aspect-video bg-bg-tertiary rounded-lg overflow-hidden mb-2">
                    {modB.thumbnailUrl ? (
                      <img
                        src={modB.thumbnailUrl}
                        alt={modB.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-text-tertiary">
                        No Preview
                      </div>
                    )}
                    <button
                      onClick={() => handleDisableMod(modB.id)}
                      aria-label={`Disable ${modB.name}`}
                      className="absolute inset-x-0 bottom-0 bg-red-500/80 hover:bg-red-500 flex items-center justify-center py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white cursor-pointer"
                    >
                      <span className="text-white text-sm font-medium flex items-center gap-1">
                        <X className="w-4 h-4" /> Disable
                      </span>
                    </button>
                  </div>
                  <p className="text-sm font-medium text-text-primary text-center truncate">
                    {modB.name}
                  </p>
                  {modB.fileName && (
                    <p className="text-xs text-text-tertiary text-center truncate" title={modB.fileName}>
                      {modB.fileName}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
