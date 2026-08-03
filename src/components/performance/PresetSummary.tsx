import { useTranslation } from 'react-i18next';
import { ExternalLink, GitCommitHorizontal, Tag, TriangleAlert } from 'lucide-react';
import { Badge } from '../common/ui';
import type { PerformancePresetSummary, PerformancePresetVersion } from '../../types/electron';

interface PresetSummaryProps {
  preset: PerformancePresetSummary;
  /** The release the user will actually write. The provenance describes THIS
   *  release, not the newest one: after a rollback, crediting the newest commit
   *  would name code the user is not about to apply, which is the same false
   *  claim the tag-pin check in the generator exists to prevent. */
  release: PerformancePresetVersion;
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
 * What the chosen preset is, in three descending weights: the facts (tier, how
 * many settings, whose), what it does to your game, and where it came from.
 *
 * Provenance is shown rather than hidden: these are third-party community
 * configs, and the exact upstream commit is what makes a given preset
 * reproducible (and what a bug report needs to name). It is deliberately the
 * quietest line on the card, since it is reference material, not a decision.
 */
export default function PresetSummary({ preset, release, creditSlot }: PresetSummaryProps) {
  const { t } = useTranslation();
  const isTag = release.refKind === 'tag';
  const PinIcon = isTag ? Tag : GitCommitHorizontal;
  // `ref` is a real tag for some upstreams and a version stated in prose for
  // others. The picker already shows it, so here the distinction only needs to
  // survive as the commit link's tooltip.
  const pinLabel = isTag
    ? t('performance.preset.pinnedTag', { ref: release.ref })
    : t('performance.preset.pinnedCommit', { ref: release.ref });

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={TIER_VARIANT[preset.tier]}>
          {t(`performance.preset.tier.${preset.tier}`)}
        </Badge>
        <span className="text-xs text-text-secondary">
          {t('performance.preset.meta', {
            count: release.settingCount,
            author: preset.author,
          })}
        </span>
      </div>

      <p className="text-xs text-text-secondary">
        {t(`performance.preset.tierBlurb.${preset.tier}`)}
      </p>

      {preset.unstable && (
        <p className="text-xs text-state-warning flex items-start gap-1.5">
          <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{t('performance.preset.unstable')}</span>
        </p>
      )}

      <p className="text-[11px] leading-relaxed text-text-secondary/80">
        {t('performance.preset.credit', {
          credit: preset.upstream.credit,
          license: preset.upstream.license,
        })}{' '}
        {creditSlot}{' '}
        <a
          href={`${preset.upstream.url}/tree/${release.commit}`}
          target="_blank"
          rel="noreferrer noopener"
          title={pinLabel}
          className="text-accent hover:underline inline-flex items-center gap-1 align-middle font-mono"
        >
          <PinIcon className="w-3 h-3" aria-hidden="true" />
          {release.commit.slice(0, 8)}
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
        </a>
      </p>
    </div>
  );
}
