import { useTranslation } from 'react-i18next';
import { ExternalLink, GitCommitHorizontal, Tag, TriangleAlert } from 'lucide-react';
import { Badge } from '../common/ui';
import { Select, FormField } from '../common/forms';
import type { PerformancePresetSummary, PerformancePresetVersion } from '../../types/electron';

interface PresetPickerProps {
  presets: PerformancePresetSummary[];
  selectedId: string;
  /** The release the user will actually write. The provenance line describes
   *  THIS release, not the newest one: after a rollback, crediting the newest
   *  commit would name code the user is not about to apply, which is the same
   *  false claim the tag-pin check in the generator exists to prevent. */
  selectedRelease: PerformancePresetVersion | null;
  onSelect: (presetId: string) => void;
  disabled?: boolean;
  /** Rendered inline after the upstream credit (e.g. an in-app artist link). */
  creditSlot?: React.ReactNode;
}

const TIER_VARIANT: Record<
  PerformancePresetSummary['tier'],
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  balanced: 'success',
  preview: 'info',
  competitive: 'neutral',
  aggressive: 'warning',
  maximum: 'warning',
  potato: 'error',
};

/**
 * Preset selector plus the provenance line for the chosen preset. Provenance is
 * shown rather than hidden: these are third-party community configs, and the
 * exact upstream commit is what makes a given preset reproducible (and what a
 * bug report needs to name).
 */
export default function PresetPicker({
  presets,
  selectedId,
  selectedRelease,
  onSelect,
  disabled,
  creditSlot,
}: PresetPickerProps) {
  const { t } = useTranslation();
  const selected = presets.find((p) => p.id === selectedId) ?? presets[0];
  if (!selected) return null;
  // Falls back to the newest release, which is what `selected` already
  // describes, so an omitted release changes nothing.
  const release = selectedRelease ?? selected.versions[0];

  return (
    <div className="space-y-2">
      <FormField label={t('performance.preset.label')}>
        <Select
          value={selected.id}
          disabled={disabled}
          onChange={(e) => onSelect(e.target.value)}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name} ({t(`performance.preset.tier.${preset.tier}`)})
            </option>
          ))}
        </Select>
      </FormField>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TIER_VARIANT[selected.tier]}>
          {t(`performance.preset.tier.${selected.tier}`)}
        </Badge>
        <span className="text-xs text-text-secondary">
          {t('performance.preset.meta', {
            count: release.settingCount,
            author: selected.author,
          })}
        </span>
      </div>

      <p className="text-xs text-text-secondary">
        {t(`performance.preset.tierBlurb.${selected.tier}`)}
      </p>

      {selected.unstable && (
        <p className="text-xs text-state-warning flex items-start gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t('performance.preset.unstable')}</span>
        </p>
      )}

      <p className="text-xs text-text-secondary">
        {t('performance.preset.credit', {
          credit: selected.upstream.credit,
          license: selected.upstream.license,
        })}{' '}
        {creditSlot}
      </p>

      {/* The pin. `ref` is a real tag for some upstreams and a version stated in
          prose for others, so the commit is shown either way. */}
      <p className="text-[11px] text-text-secondary/80 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          {release.refKind === 'tag' ? (
            <Tag className="w-3 h-3" aria-hidden="true" />
          ) : (
            <GitCommitHorizontal className="w-3 h-3" aria-hidden="true" />
          )}
          {release.refKind === 'tag'
            ? t('performance.preset.pinnedTag', { ref: release.ref })
            : t('performance.preset.pinnedCommit', { ref: release.ref })}
        </span>
        <a
          href={`${selected.upstream.url}/tree/${release.commit}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline inline-flex items-center gap-0.5 font-mono"
        >
          {release.commit.slice(0, 8)}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
