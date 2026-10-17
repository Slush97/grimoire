import { useTranslation } from 'react-i18next';
import { Select, FormField } from '../common/forms';
import type { PerformancePresetVersion } from '../../types/electron';

// Option value of the tracked upstream release. Never a bundled version.
const TRACKED = 'latest';

interface VersionPickerProps {
  /** Bundled releases of the selected preset, newest first, never empty. */
  versions: PerformancePresetVersion[];
  /** The bundled release the user has picked, or null while following the
   *  tracked upstream release. */
  selected: string | null;
  /** Called with a bundled version, or null for the tracked release. */
  onSelect: (version: string | null) => void;
  disabled?: boolean;
  /** The upstream release "Always use the newest version" writes, when it is
   *  newer than every bundled one. It gets its own entry above the bundled
   *  releases, so the newest bundled one stays pickable. */
  tracked?: { ref: string; date: string } | null;
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
 * The field stays visible even when a preset bundles a single release (the
 * common case: byte-identical releases are collapsed at generation time). It
 * then reads as "this is the release you are about to write", which is worth
 * showing on its own, and the picker row keeps the same shape across presets.
 */
export default function VersionPicker({ versions, selected, onSelect, disabled, tracked }: VersionPickerProps) {
  const { t } = useTranslation();
  const newest = versions[0].version;

  return (
    <FormField label={t('performance.version.label')}>
      <Select
        value={selected ?? TRACKED}
        disabled={disabled || (versions.length < 2 && !tracked)}
        onChange={(e) => onSelect(e.target.value === TRACKED ? null : e.target.value)}
      >
        {tracked && <option value={TRACKED}>{t('performance.version.optionNewest', tracked)}</option>}
        {versions.map((entry) => (
          // The date is not decoration: upstream tag names do not reliably sort
          // into release order (OptiLock tagged v4.0d after v4.1), so the name
          // alone cannot tell you which one is actually older.
          <option key={entry.version} value={entry.version}>
            {entry.version === newest && !tracked
              ? t('performance.version.optionNewest', { ref: entry.ref, date: entry.date })
              : t('performance.version.option', { ref: entry.ref, date: entry.date })}
          </option>
        ))}
      </Select>
    </FormField>
  );
}
