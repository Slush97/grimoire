import { EyeOff, Lock, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GameBananaRemoval } from '../../types/gamebanana';
import { Tag } from '../common/ui';

function useRemovalCopy(removal: GameBananaRemoval) {
  const { t } = useTranslation();
  return {
    // A moderator stepping in is worth a second look. The author's own choice is not.
    moderated: removal.kind === 'withheld' || (removal.kind === 'trashed' && removal.byOwner === false),
    icon: removal.kind === 'withheld' ? EyeOff : removal.kind === 'private' ? Lock : Trash2,
    label: removal.kind === 'withheld' ? t('installed.removed.withheld')
      : removal.kind === 'private' ? t('installed.removed.private')
        : t('installed.removed.trashed'),
    lines: [
      removal.kind === 'withheld' ? t('installed.removed.withheldTitle')
        : removal.kind === 'private' ? t('installed.removed.privateTitle')
          : removal.byOwner === true ? t('installed.removed.trashedByAuthorTitle')
            : removal.byOwner === false ? t('installed.removed.trashedByModeratorTitle')
              : t('installed.removed.trashedTitle'),
      removal.kind === 'trashed' ? t('installed.removed.goneNote') : t('installed.removed.hiddenNote'),
      // Last, because GameBanana's reason is free text that may not end a sentence.
      removal.reason ? t('installed.removed.reason', { reason: removal.reason }) : '',
    ].filter(Boolean),
  };
}

/** Marks an installed mod whose GameBanana page is gone. The installed files
 *  are untouched, so this only explains why updates and re-downloads stopped. */
export function RemovedTag({ removal, variant }: { removal: GameBananaRemoval; variant: 'overlay' | 'inline' }) {
  const { moderated, icon, label, lines } = useRemovalCopy(removal);
  return (
    <Tag
      tone={moderated ? 'warning' : 'neutral'}
      variant={variant}
      icon={icon}
      title={lines.join('\n')}
      className={`uppercase tracking-wide ${moderated || variant === 'inline' ? '' : 'border-hl/20 text-white/90'}`}
    >
      {label}
    </Tag>
  );
}

/** The same explanation spelled out, for the mod page that GameBanana now serves empty. */
export function RemovedNotice({ removal }: { removal: GameBananaRemoval }) {
  const { moderated, icon: Icon, lines } = useRemovalCopy(removal);
  return (
    <div
      role="note"
      className={`flex items-center gap-2 border-b px-5 py-2 text-xs ${moderated
        ? 'border-state-warning/20 bg-state-warning/10 text-state-warning'
        : 'border-border bg-bg-tertiary text-text-secondary'}`}
    >
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      {lines.join(' ')}
    </div>
  );
}
