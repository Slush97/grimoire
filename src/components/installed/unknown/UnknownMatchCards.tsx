import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Check, RotateCcw, Link2, Fingerprint } from 'lucide-react';
import type { Mod, AssociateUnknownModArgs } from '../../../types/mod';
import ModThumbnail from '../../ModThumbnail';
import { Button, Tag } from '../../common/ui';
import type { FoundUnknownMatch } from './foundMatch';

// Self-identifying VPK card: the mod's identity was read offline from its own
// Grimoire imprint (addoninfo.txt / grimoire_meta.json), not matched over the
// network. Distinct from UnknownMatchCard so an imprint is never confused with a
// verified upstream CRC-32 hit, and so a merge can list its reconstructed
// sources. For a single imprinted mod it offers a zero-download "Link in place"
// (link the existing file) instead of a re-download Apply. The wire provenance
// keeps the 'embedded-*' union values; the copy says "imprint".
export function UnknownEmbeddedCard({
  mod,
  match,
  hideNsfwPreviews,
  onAssociate,
  onView,
}: {
  mod: Mod;
  match: FoundUnknownMatch;
  hideNsfwPreviews: boolean;
  onAssociate: (mod: Mod, args: AssociateUnknownModArgs) => Promise<void>;
  onView: () => void;
}) {
  const { t } = useTranslation();
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const isMerge = match.provenance === 'embedded-merge';
  const mergeSources = match.mergeSources ?? [];

  const handleLink = async () => {
    if (linking || typeof match.modId !== 'number') return;
    setLinking(true);
    setLinkError(null);
    try {
      await onAssociate(mod, {
        gameBananaId: match.modId,
        modName: match.modName ?? mod.name,
        gameBananaFileId: match.fileId,
        thumbnailUrl: match.thumbnailUrl,
        nsfw: match.nsfw,
        categoryName: match.categoryName,
        sourceSection: match.section,
      });
    } catch (err) {
      setLinkError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="rounded-md border border-state-success/35 bg-state-success/10 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-4">
          {!isMerge && (
            <ModThumbnail
              src={match.thumbnailUrl}
              alt={match.modName ?? t('installed.unknown.gamebananaMod')}
              nsfw={match.nsfw}
              hideNsfw={hideNsfwPreviews}
              className="w-24 h-16 rounded-md bg-bg-primary border border-hl/10 flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <Tag tone="success" icon={Fingerprint}>
              {isMerge ? t('installed.provenance.fromMergeImprint') : t('installed.provenance.fromImprint')}
            </Tag>
            <h3 className="text-base font-semibold text-text-primary mt-2 truncate" title={match.modName}>
              {match.modName ?? t('installed.unknown.gamebananaMod')}
            </h3>
            <p className="text-sm text-text-secondary mt-1">
              {isMerge
                ? t('installed.unknown.embeddedMergeDesc', { count: mergeSources.length })
                : t('installed.unknown.embeddedMetadataDesc')}
            </p>
          </div>
        </div>

        {!isMerge && (
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {match.section && (
              <Tag tone="neutral">
                {match.section === 'Mod' ? t('installed.unknown.sectionMods') : match.section === 'Sound' ? t('installed.unknown.sectionSounds') : match.section}
              </Tag>
            )}
            {match.categoryName && <Tag tone="neutral">{match.categoryName}</Tag>}
            {typeof match.modId === 'number' && <Tag tone="neutral">{t('installed.unknown.modIdTag', { id: match.modId })}</Tag>}
          </div>
        )}

        {isMerge && mergeSources.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {mergeSources.map((source, i) => (
              <Tag key={`${source.fileName ?? source.modName}-${i}`} tone="neutral" title={source.modName}>
                {source.modName}
                {typeof source.gameBananaId === 'number' ? ` (#${source.gameBananaId})` : ''}
              </Tag>
            ))}
          </div>
        )}

        {linkError && <p className="text-xs text-state-danger mt-3">{linkError}</p>}
      </div>

      {!isMerge && typeof match.modId === 'number' && (
        <div className="border-t border-state-success/20 px-4 py-3 bg-black/10 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" icon={Info} disabled={linking} onClick={onView}>
            {t('installed.unknown.viewMod')}
          </Button>
          <Button variant="primary" size="sm" icon={Link2} isLoading={linking} onClick={() => void handleLink()}>
            {t('installed.unknown.linkInPlace')}
          </Button>
        </div>
      )}
    </div>
  );
}

export function UnknownMatchCard({
  match,
  hideNsfwPreviews,
  applying,
  onApply,
  onView,
  onRetry,
}: {
  match: FoundUnknownMatch;
  hideNsfwPreviews: boolean;
  applying: boolean;
  onApply: () => void;
  onView: () => void;
  /** Omitted when the experimental matcher is disabled (nothing to retry
   *  against), so the card hides the Retry button entirely. */
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-state-success/35 bg-state-success/10 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-4">
          <ModThumbnail
            src={match.thumbnailUrl}
            alt={match.modName ?? t('installed.unknown.gamebananaMod')}
            nsfw={match.nsfw}
            hideNsfw={hideNsfwPreviews}
            className="w-24 h-16 rounded-md bg-bg-primary border border-hl/10 flex-shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-state-success">
              {t('installed.unknown.match')}
            </div>
            <h3 className="text-base font-semibold text-text-primary mt-1 truncate" title={match.modName}>
              {match.modName ?? t('installed.unknown.gamebananaMod')}
            </h3>
            {match.fileName && (
              <p className="text-sm text-text-secondary mt-1 truncate" title={match.fileName}>
                {match.fileName}
              </p>
            )}
          </div>
          <Tag tone="success">{t('installed.unknown.crcMatch')}</Tag>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {match.section && (
            <Tag tone="neutral">
              {match.section === 'Mod' ? t('installed.unknown.sectionMods') : match.section === 'Sound' ? t('installed.unknown.sectionSounds') : match.section}
            </Tag>
          )}
          {match.categoryName && <Tag tone="neutral">{match.categoryName}</Tag>}
          {typeof match.modId === 'number' && <Tag tone="neutral">{t('installed.unknown.modIdTag', { id: match.modId })}</Tag>}
          {typeof match.fileId === 'number' && <Tag tone="neutral">{t('installed.unknown.fileIdTag', { id: match.fileId })}</Tag>}
        </div>

        {match.reason && (
          <p className="text-xs text-text-secondary mt-3">{match.reason}</p>
        )}

      </div>

      <div className="border-t border-state-success/20 px-4 py-3 bg-black/10 flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={Info}
          disabled={applying}
          onClick={onView}
        >
          {t('installed.unknown.viewMod')}
        </Button>
        {onRetry && (
          <Button
            variant="secondary"
            size="sm"
            icon={RotateCcw}
            disabled={applying}
            onClick={onRetry}
          >
            {t('common.actions.retry')}
          </Button>
        )}
        <Button
          variant="success"
          size="sm"
          icon={Check}
          isLoading={applying}
          onClick={onApply}
        >
          {t('common.actions.apply')}
        </Button>
      </div>
    </div>
  );
}
