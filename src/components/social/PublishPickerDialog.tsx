import { useEffect, useMemo, useState } from 'react';
import { X, Loader2, AlertTriangle, Boxes, Globe, FolderOpen } from 'lucide-react';
import { Button } from '../common/ui';
import { EmptyState } from '../common/PageComponents';
import { getProfiles, type Profile } from '../../lib/api';
import { formatRelativeDate } from '../../lib/dates';

interface PublishPickerDialogProps {
  onClose: () => void;
  onPick: (profile: { id: string; name: string }) => void;
}

export default function PublishPickerDialog({ onClose, onPick }: PublishPickerDialogProps) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getProfiles()
      .then((p) => { if (!cancelled) setProfiles(p); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Most recently updated first so the profile the user just finished
  // tweaking is at the top.
  const sorted = useMemo(() => {
    if (!profiles) return null;
    return [...profiles].sort((a, b) => {
      const ta = Date.parse(a.updatedAt) || 0;
      const tb = Date.parse(b.updatedAt) || 0;
      return tb - ta;
    });
  }, [profiles]);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-pick-title"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="publish-pick-title" className="text-xl font-bold text-text-primary flex items-center gap-2">
              <Globe className="w-5 h-5 text-accent" />
              Publish a profile
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              Pick which local profile to share on Discover.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {loading && (
            <div className="text-sm text-text-secondary inline-flex items-center gap-2 p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading your profiles...
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && sorted && sorted.length === 0 && (
            <EmptyState
              icon={FolderOpen}
              title="No local profiles yet"
              description="Create a profile under Profiles, add some mods, then come back to publish."
            />
          )}

          {sorted && sorted.length > 0 && (
            <ul className="divide-y divide-white/5 border border-white/10 rounded-lg bg-bg-tertiary/30 overflow-hidden">
              {sorted.map((p) => {
                const modCount = p.mods.length;
                const noMods = modCount === 0;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => onPick({ id: p.id, name: p.name })}
                      disabled={noMods}
                      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                        noMods
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-white/[0.04] cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-text-primary font-medium truncate" title={p.name}>
                          {p.name}
                        </div>
                        <div className="text-xs text-text-secondary flex items-center gap-x-3 mt-0.5 flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <Boxes className="w-3 h-3" />
                            {modCount} {modCount === 1 ? 'mod' : 'mods'}
                          </span>
                          <span className="text-text-tertiary">
                            updated {formatRelativeDate(p.updatedAt)}
                          </span>
                          {noMods && (
                            <span className="text-text-tertiary italic">empty</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-accent shrink-0">
                        {noMods ? '' : 'Publish →'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
