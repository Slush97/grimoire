import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import type { PerformancePresetVersion } from '../../types/electron';

interface VersionPickerProps {
  /** Bundled releases of the selected preset, newest first, never empty. */
  versions: PerformancePresetVersion[];
  /** The release the user has picked. Newest when they have not picked one. */
  selected: string;
  onSelect: (version: string) => void;
  disabled?: boolean;
}

/**
 * Roll a preset back to an older bundled release.
 *
 * Upstream authors tune these configs against whatever hardware they have, and
 * a release that gains frames on one machine can lose them on another (or break
 * something outright, as OptiLock v4.2 did with Doorman's door). Bundling the
 * previous releases means "the update made it worse" has an answer that does not
 * depend on the user hunting down an old gameinfo.gi by hand.
 *
 * Hidden entirely when a preset has only one bundled release, which is the
 * common case: releases whose upstream file was byte-identical are collapsed at
 * generation time, so several presets legitimately have nothing to roll back to.
 */
export default function VersionPicker({
  versions,
  selected,
  onSelect,
  disabled,
}: VersionPickerProps) {
  const { t } = useTranslation();
  if (versions.length < 2) return null;

  const newest = versions[0].version;

  return (
    <div className="rounded-sm border border-white/5 bg-black/20 px-4 py-3 space-y-2">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-text-primary">
          {t('performance.version.label')}
        </span>
      </div>
      <p className="text-xs text-text-secondary">{t('performance.version.description')}</p>
      <div className="flex flex-wrap gap-2 pt-1">
        {versions.map((entry) => {
          const active = entry.version === selected;
          return (
            <button
              key={entry.version}
              type="button"
              onClick={() => onSelect(entry.version)}
              disabled={disabled}
              aria-pressed={active}
              className={`rounded-sm border px-3 py-2 text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? 'border-accent bg-accent/10'
                  : 'border-white/10 hover:border-white/20 hover:bg-white/[0.03]'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-primary">{entry.ref}</span>
                {entry.version === newest && (
                  <span className="text-[10px] uppercase tracking-wide text-accent">
                    {t('performance.version.newest')}
                  </span>
                )}
              </span>
              {/* The date is not decoration: upstream tag names do not reliably
                  sort into release order (OptiLock tagged v4.0d after v4.1), so
                  the name alone cannot tell you which one is actually older. */}
              <span className="block text-[11px] text-text-secondary">
                {t('performance.version.releasedOn', { date: entry.date })}
              </span>
              <span className="block text-[11px] text-text-secondary">
                {t('performance.version.settings', { count: entry.settingCount })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
