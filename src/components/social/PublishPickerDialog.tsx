import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle, Boxes, FolderOpen } from 'lucide-react';
import { Button, ModalHeader } from '../common/ui';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { EmptyState } from '../common/PageComponents';
import { getProfiles, type Profile } from '../../lib/api';
import { formatRelativeDate } from '../../lib/dates';

interface PublishPickerDialogProps {
  onClose: () => void;
  onPick: (profile: { id: string; name: string }) => void;
}

export default function PublishPickerDialog({ onClose, onPick }: PublishPickerDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
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
    <Modal onClose={onClose} labelledBy={titleId} size="md">
        <ModalHeader
          title={t('social.picker.publishAProfile')}
          titleId={titleId}
          subtitle={t('social.picker.pickLocalProfile')}
          onClose={onClose}
          closeLabel={t('common.actions.close')}
        />

        <ModalBody>
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
            <ul className="divide-y divide-hl/5 border border-hl/10 rounded-lg bg-bg-tertiary/30 overflow-hidden">
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
                          : 'hover:bg-hl/[0.04] cursor-pointer'
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
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
        </ModalFooter>
    </Modal>
  );
}
