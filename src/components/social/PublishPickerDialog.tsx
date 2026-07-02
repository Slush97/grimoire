import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, AlertTriangle, Boxes, Globe, FolderOpen } from 'lucide-react';
import { Button } from '../common/ui';
import { Modal } from '../common/Modal';
import { EmptyState } from '../common/PageComponents';
import { getProfiles, type Profile } from '../../lib/api';
import { formatRelativeDate } from '../../lib/dates';

interface PublishPickerDialogProps {
  onClose: () => void;
  onPick: (profile: { id: string; name: string }) => void;
}

export default function PublishPickerDialog({ onClose, onPick }: PublishPickerDialogProps) {
  const { t } = useTranslation();
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
    <Modal
      onClose={onClose}
      labelledBy="publish-pick-title"
      size="md"
      panelClassName="max-h-[80vh] flex flex-col overflow-hidden"
    >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="publish-pick-title" className="text-xl font-bold text-text-primary flex items-center gap-2">
              <Globe className="w-5 h-5 text-accent" />
              {t('social.picker.publishAProfile')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {t('social.picker.pickLocalProfile')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label={t('common.actions.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto">
          {loading && (
            <div className="text-sm text-text-secondary inline-flex items-center gap-2 p-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('social.picker.loadingYourProfiles')}
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!loading && !error && sorted && sorted.length === 0 && (
            <EmptyState
              icon={FolderOpen}
              title={t('social.picker.noLocalProfilesYet')}
              description={t('social.picker.createAProfileHint')}
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
                            {t('profiles.mods.count', { count: modCount })}
                          </span>
                          <span className="text-text-tertiary">
                            {t('social.picker.updatedRelative', { date: formatRelativeDate(p.updatedAt) })}
                          </span>
                          {noMods && (
                            <span className="text-text-tertiary italic">{t('social.picker.empty')}</span>
                          )}
                        </div>
                      </div>
                      <span className="text-xs text-accent shrink-0">
                        {noMods ? '' : t('social.picker.publishArrow')}
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
            {t('common.actions.cancel')}
          </Button>
        </div>
    </Modal>
  );
}
