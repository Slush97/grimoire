import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Download, ExternalLink, Eye, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Mod } from '../../types/mod';
import { groupModUpdates } from '../../lib/updateActions';
import { showToast } from '../../stores/toastStore';
import { ConfirmModal } from '../common/PageComponents';
import { IconButton } from '../common/ui';

interface Props {
  mods: Mod[];
  updateIds: ReadonlySet<string>;
  onUpdate: (modIds: string[]) => void | Promise<void>;
  onIgnore: (modIds: string[]) => Promise<void>;
  onOpen: (modId: string) => void;
  onClose: () => void;
}

export default function ModUpdatesModal({ mods, updateIds, onUpdate, onIgnore, onOpen, onClose }: Props) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupModUpdates(mods, updateIds), [mods, updateIds]);
  const [ignoring, setIgnoring] = useState<string | null>(null);
  const pendingIds = groups.flatMap(group => group.pending.map(mod => mod.id));
  const disabled = ignoring !== null;

  useEffect(() => {
    if (groups.length === 0) onClose();
  }, [groups.length, onClose]);

  const update = (modIds: string[]) => {
    if (disabled || modIds.length === 0) return;
    // Remove accepted rows before another click can reach the same button.
    flushSync(() => { void onUpdate(modIds); });
  };

  const ignore = async (group: typeof groups[number]) => {
    if (disabled) return;
    setIgnoring(group.key);
    try {
      await onIgnore(group.installed.filter(mod => !mod.ignoreUpdates).map(mod => mod.id));
    } catch {
      showToast(t('installed.updateAll.ignoreFailed', { name: group.name }), { tone: 'error' });
    } finally {
      setIgnoring(null);
    }
  };

  if (groups.length === 0) return null;

  return (
    <ConfirmModal
      isOpen
      size="lg"
      title={t('installed.updateAll.confirmTitle', { count: pendingIds.length })}
      message={
        <>
          <p className="mb-3">{t('installed.updateAll.description')}</p>
          <div className="update-stripes rounded-md border border-accent/20 bg-bg-tertiary/40">
            <div className="max-h-80 overflow-y-auto px-3 py-2">
              <div className="mb-1.5 text-2xs font-semibold text-accent">
                {t('installed.updateAll.receivingUpdates', { count: groups.length })}
              </div>
              <ul className="space-y-1 text-sm text-text-primary">
                {groups.map(group => (
                  <li key={group.key} className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      className="group flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left transition-colors hover:text-accent disabled:cursor-default disabled:opacity-60"
                      title={group.pending.map(mod => mod.variantLabel?.trim() || mod.fileDescription?.trim() || mod.sourceFileName || mod.fileName).join('\n')}
                      aria-label={t('installed.card.viewDetailsFor', { name: group.name })}
                      disabled={disabled}
                      onClick={() => {
                        onClose();
                        onOpen(group.pending[0].id);
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-tertiary transition-colors group-hover:text-accent" aria-hidden />
                      <span className="truncate">{group.name}</span>
                      <span className="shrink-0 text-text-secondary">({group.pending.length})</span>
                    </button>
                    <IconButton
                      icon={ignoring === group.key ? Loader2 : Eye}
                      size="sm"
                      className={`bg-bg-secondary hover:bg-bg-tertiary! disabled:opacity-100 disabled:text-text-tertiary ${ignoring === group.key ? '[&_svg]:animate-spin' : ''}`}
                      label={t('installed.updateAll.ignoreMod', { name: group.name })}
                      disabled={disabled}
                      onClick={() => void ignore(group)}
                    />
                    <IconButton
                      icon={Download}
                      size="sm"
                      className="bg-bg-secondary hover:bg-bg-tertiary! disabled:opacity-100 disabled:text-text-tertiary"
                      label={t('installed.updateAll.updateMod', { name: group.name })}
                      disabled={disabled}
                      onClick={() => update(group.pending.map(mod => mod.id))}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      }
      confirmLabel={t('installed.updateAll.updateAll')}
      variant="primary"
      busy={disabled}
      onConfirm={() => update(pendingIds)}
      onCancel={onClose}
    />
  );
}
