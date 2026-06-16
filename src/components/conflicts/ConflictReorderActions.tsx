import { ArrowDownUp, Crown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModConflict } from '../../lib/api';
import Tx from '../translation/Tx';

interface ConflictModRef {
  id: string;
  name: string;
}

interface ConflictReorderActionsProps {
  conflict: ModConflict;
  modA: ConflictModRef;
  modB: ConflictModRef;
  /** Enabled mod ids in true load order (index 0 loads first). */
  orderedEnabledIds: string[];
  /** True while a reorder for this pair is in flight. */
  busy: boolean;
  /** Reorder so `winnerId` loads immediately before `loserId` (earlier = wins). */
  onSetWinner: (winnerId: string, loserId: string) => void;
}

/**
 * Inline load-order control for a conflict card. The mod that loads first (the
 * lower pakNN slot, an earlier SearchPaths entry) wins overlapping files, so
 * "wins" places the chosen mod immediately before the other in load order. For
 * a priority conflict (shared pak slot) the reorder also separates the two into
 * distinct slots, clearing the conflict; for a file overlap the pair stays
 * flagged but the winner is now deterministic.
 */
export default function ConflictReorderActions({
  conflict,
  modA,
  modB,
  orderedEnabledIds,
  busy,
  onSetWinner,
}: ConflictReorderActionsProps) {
  const { t } = useTranslation();
  const aIdx = orderedEnabledIds.indexOf(modA.id);
  const bIdx = orderedEnabledIds.indexOf(modB.id);
  // Reordering only moves mods that hold a load-order slot. A disabled mod has
  // none, so guard the control until both sides are enabled.
  const bothEnabled = aIdx !== -1 && bIdx !== -1;
  // Lower load-order slot (earlier SearchPaths entry, lower pakNN) wins shared
  // files, so the mod at the smaller index is the current winner.
  const aWins = bothEnabled && aIdx < bIdx;
  const bWins = bothEnabled && bIdx < aIdx;

  const hint = bothEnabled
    ? t('conflicts.reorder.hint')
    : t('conflicts.reorder.enableBothHint');

  const renderButton = (mod: ConflictModRef, other: ConflictModRef, isWinner: boolean) => (
    <button
      type="button"
      onClick={() => onSetWinner(mod.id, other.id)}
      disabled={busy || !bothEnabled || isWinner}
      title={
        !bothEnabled
          ? t('conflicts.reorder.enableBothHint')
          : isWinner
            ? t('conflicts.reorder.alreadyWins', { name: mod.name })
            : t('conflicts.reorder.makeWinner', { name: mod.name, other: other.name })
      }
      className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
        isWinner
          ? 'border-accent/40 bg-accent/15 text-accent cursor-default'
          : 'border-border bg-bg-tertiary text-text-secondary hover:text-text-primary hover:border-text-tertiary cursor-pointer'
      } disabled:cursor-not-allowed ${!bothEnabled ? 'opacity-50' : ''}`}
    >
      {isWinner && <Crown className="w-3.5 h-3.5 flex-shrink-0" />}
      <span className="truncate" title={mod.name}>
        {mod.name}
      </span>
    </button>
  );

  return (
    <div className="px-4 pb-4">
      <div
        className="mb-1.5 flex items-center justify-center gap-1.5 text-[11px] text-text-tertiary"
        title={hint}
      >
        <ArrowDownUp className="w-3 h-3 flex-shrink-0" />
        {conflict.conflictType === 'file' ? (
          <Tx k="conflicts.reorder.winsSharedFiles" fallback="Wins shared files" />
        ) : (
          <Tx k="conflicts.reorder.resolveByLoadOrder" fallback="Resolve by load order" />
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {renderButton(modA, modB, aWins)}
        {renderButton(modB, modA, bWins)}
      </div>
    </div>
  );
}
