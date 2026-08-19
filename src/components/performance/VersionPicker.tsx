import { useTranslation } from 'react-i18next';
import { Select, FormField } from '../common/forms';
import type { PerformancePresetVersion } from '../../types/electron';

interface VersionPickerProps {
  /** Bundled releases of the selected preset, newest first, never empty. */
  versions: PerformancePresetVersion[];
  /** The release the user has picked. Newest when they have not picked one. */
  selected: string;
  /** A historical upstream version pinned from the full-history browser; shown
   *  as an extra option while it is the selection (its body lives in the
   *  main-process fetch cache, not in the bundle). */
  remotePinned?: { version: string; ref: string; date: string } | null;
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
 * depend on the user hunting down an old gameinfo.gi by hand; the full-history
 * browser extends the same answer to every version upstream ever published.
 *
 * The field stays visible even when a preset bundles a single release (the
 * common case: byte-identical releases are collapsed at generation time). It
 * then reads as "this is the release you are about to write", which is worth
 * showing on its own, and the picker row keeps the same shape across presets.
 */
export default function VersionPicker({
  versions,
  selected,
  remotePinned,
  onSelect,
  disabled,
}: VersionPickerProps) {
  const { t } = useTranslation();
  const newest = versions[0].version;
  const pinnedActive = !!remotePinned && remotePinned.version === selected;
  const rollbackAvailable = versions.length > 1 || pinnedActive;

  return (
    <FormField label={t('performance.version.label')}>
      <Select
        value={selected}
        disabled={disabled || !rollbackAvailable}
        onChange={(e) => onSelect(e.target.value)}
      >
        {pinnedActive && (
          <option value={remotePinned.version}>
            {t('performance.version.optionRemote', {
              ref: remotePinned.ref,
              date: remotePinned.date,
            })}
          </option>
        )}
        {versions.map((entry) => (
          // The date is not decoration: upstream tag names do not reliably sort
          // into release order (OptiLock tagged v4.0d after v4.1), so the name
          // alone cannot tell you which one is actually older.
          <option key={entry.version} value={entry.version}>
            {entry.version === newest
              ? t('performance.version.optionNewest', { ref: entry.ref, date: entry.date })
              : t('performance.version.option', { ref: entry.ref, date: entry.date })}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
