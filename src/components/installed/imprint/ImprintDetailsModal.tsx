import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Copy, ExternalLink } from 'lucide-react';
import { showToast } from '../../../stores/toastStore';
import { readImprintDetails } from '../../../lib/api';
import type { ImprintDetails } from '../../../lib/api';
import type { Mod } from '../../../types/mod';
import { Modal } from '../../common/Modal';
import { formatAbsoluteDate } from '../../../lib/dates';
import { formatBytes } from '../../../lib/formatBytes';
import { Button, IconButton, ModalHeader, Tag } from '../../common/ui';
import { EmptyState, LoadingState } from '../../common/PageComponents';

// One labeled row of the imprint detail sheet: a fixed-width muted label and a
// wrapping value column, so the sheet reads like a spec table.
function ImprintDetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-32 flex-shrink-0 text-xs text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 break-words text-text-primary">{children}</span>
    </div>
  );
}

// A monospace hash value with a copy-to-clipboard button, for the identity rows.
function ImprintHashValue({ value, copyLabel, onCopy }: {
  value: string;
  copyLabel: string;
  onCopy: (value: string) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value}</code>
      <IconButton size="sm" icon={Copy} label={copyLabel} onClick={() => onCopy(value)} />
    </span>
  );
}

// "View imprint" details modal: shows the FULL embedded imprint of one
// installed VPK (the parsed addoninfo.txt fields, the original identity
// triple, the grimoire_meta.json merge companion for merged VPKs, and the raw
// addoninfo.txt text). Strictly read-only and offline. Deliberately NOT gated
// on experimentalVpkImprinting: like the provenance card, reading an imprint
// back is recognition of data already inside the file, not writing, so files
// imprinted elsewhere or before the flag was toggled off stay inspectable.
export function ImprintDetailsModal({ mod, onClose }: { mod: Mod; onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = 'imprint-details-modal-title';
  // undefined = fetch in flight; null = the file carries no valid imprint
  // (reachable when the local `imprinted` flag is stale).
  const [details, setDetails] = useState<ImprintDetails | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  // Same unmount guard as handleImprintAllInstalled: no setState after the
  // modal unmounts mid-fetch.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // No synchronous state reset here: the render site keys this modal by
  // mod.id, so switching mods remounts it with fresh loading state.
  useEffect(() => {
    readImprintDetails(mod.id)
      .then((result) => {
        if (mountedRef.current) setDetails(result);
      })
      .catch((err) => {
        if (mountedRef.current) setError(err instanceof Error ? err.message : String(err));
      });
  }, [mod.id]);

  // Matches the file's clipboard pattern (copyEntryShareCode): writeText +
  // success toast, error toast on refusal.
  const copyValue = (value: string) => {
    navigator.clipboard.writeText(value).then(
      () => showToast(t('installed.imprintDetails.copied'), { tone: 'success', duration: 2200 }),
      (err) => showToast(`Couldn't copy: ${err instanceof Error ? err.message : String(err)}`, { tone: 'error' })
    );
  };

  const sectionHeading = 'text-xs font-semibold uppercase tracking-wider text-text-tertiary';
  const sectionBox = 'space-y-1.5 rounded-md border border-hl/5 bg-bg-tertiary/40 p-3';

  let body: ReactNode;
  if (error) {
    body = <p className="text-sm text-state-danger">{t('installed.imprintDetails.error', { error })}</p>;
  } else if (details === undefined) {
    body = <LoadingState label={t('installed.imprintDetails.loading')} className="min-h-40" />;
  } else if (details === null) {
    body = (
      <EmptyState
        icon={Fingerprint}
        title={t('installed.imprintDetails.empty')}
        className="min-h-40"
      />
    );
  } else {
    const modinfo = details.modinfo;
    const merge = modinfo?.kind === 'merge' ? modinfo : null;
    body = (
      <>
        <div className={sectionBox}>
          <ImprintDetailRow label={t('installed.imprintDetails.modTitle')}>
            {details.title ?? mod.name}
          </ImprintDetailRow>
          {details.author && (
            <ImprintDetailRow label={t('installed.imprintDetails.author')}>
              {details.author}
            </ImprintDetailRow>
          )}
          {modinfo?.description && (
            <ImprintDetailRow label={t('installed.imprintDetails.description')}>
              {modinfo.description}
            </ImprintDetailRow>
          )}
          {details.gamebananaId && (
            <ImprintDetailRow label={t('installed.imprintDetails.gamebananaId')}>
              <span className="tabular-nums">#{details.gamebananaId}</span>
            </ImprintDetailRow>
          )}
          {details.gamebananaFileId && (
            <ImprintDetailRow label={t('installed.imprintDetails.gamebananaFileId')}>
              <span className="tabular-nums">#{details.gamebananaFileId}</span>
            </ImprintDetailRow>
          )}
          {details.sourceUrl && (
            <ImprintDetailRow label={t('installed.imprintDetails.sourceUrl')}>
              <a
                href={details.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-baseline gap-1 break-all text-accent hover:underline"
              >
                <span className="min-w-0">{details.sourceUrl}</span>
                <ExternalLink className="h-3 w-3 flex-shrink-0 self-center" aria-hidden />
              </a>
            </ImprintDetailRow>
          )}
          {modinfo?.packaging?.variantLabel && (
            <ImprintDetailRow label={t('installed.imprintDetails.variant')}>
              {modinfo.packaging.variantLabel}
            </ImprintDetailRow>
          )}
          {typeof modinfo?.packaging?.vpkIndex === 'number' && (
            <ImprintDetailRow label={t('installed.imprintDetails.vpkIndex')}>
              <span className="tabular-nums">{modinfo.packaging.vpkIndex}</span>
            </ImprintDetailRow>
          )}
          {/* Current-format imprints carry both timestamps; a legacy imprint
              only has its addoninfo buildDate. */}
          {modinfo ? (
            <>
              <ImprintDetailRow label={t('installed.imprintDetails.firstImprinted')}>
                {formatAbsoluteDate(modinfo.firstImprintedAt)}
              </ImprintDetailRow>
              <ImprintDetailRow label={t('installed.imprintDetails.lastWritten')}>
                {formatAbsoluteDate(modinfo.writtenAt)}
              </ImprintDetailRow>
            </>
          ) : (
            details.buildDate && (
              <ImprintDetailRow label={t('installed.imprintDetails.buildDate')}>
                {formatAbsoluteDate(details.buildDate)}
              </ImprintDetailRow>
            )
          )}
        </div>

        <div className="space-y-2">
          <div className={sectionHeading}>{t('installed.imprintDetails.identityTitle')}</div>
          <div className={sectionBox}>
            <ImprintDetailRow label={t('installed.imprintDetails.sha256')}>
              <ImprintHashValue
                value={details.originalSha256}
                copyLabel={t('installed.imprintDetails.copyValue')}
                onCopy={copyValue}
              />
            </ImprintDetailRow>
            {details.originalCrc32 && (
              <ImprintDetailRow label={t('installed.imprintDetails.crc32')}>
                <ImprintHashValue
                  value={details.originalCrc32}
                  copyLabel={t('installed.imprintDetails.copyValue')}
                  onCopy={copyValue}
                />
              </ImprintDetailRow>
            )}
            {typeof details.originalSize === 'number' && (
              <ImprintDetailRow label={t('installed.imprintDetails.size')}>
                <span className="tabular-nums">{formatBytes(details.originalSize)}</span>
              </ImprintDetailRow>
            )}
          </div>
        </div>

        {merge && (
          <div className="space-y-2">
            <div className={sectionHeading}>{t('installed.imprintDetails.mergeTitle')}</div>
            <div className={sectionBox}>
              <ImprintDetailRow label={t('installed.imprintDetails.mergeName')}>
                {merge.merge.title}
              </ImprintDetailRow>
              <ImprintDetailRow label={t('installed.imprintDetails.createdAt')}>
                {formatAbsoluteDate(merge.writtenAt)}
              </ImprintDetailRow>
              <ImprintDetailRow label={t('installed.imprintDetails.createdBy')}>
                {`${merge.writtenBy.tool} ${merge.writtenBy.version}`}
              </ImprintDetailRow>
              <ImprintDetailRow label={t('installed.imprintDetails.schemaVersion')}>
                <span className="tabular-nums">{merge.schemaVersion}</span>
              </ImprintDetailRow>
            </div>
            {merge.sources.length > 0 && (
              <>
                <div className={sectionHeading}>
                  {t('installed.imprintDetails.sourcesTitle', { count: merge.sources.length })}
                </div>
                {/* Tag rows consistent with UnknownEmbeddedCard's source list. */}
                <div className={sectionBox}>
                  {merge.sources.map((source, i) => (
                    <div
                      key={`${source.fileNameAtMergeTime}-${i}`}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Tag tone="neutral" title={source.fileNameAtMergeTime}>
                        {source.title}
                        {typeof source.gamebananaId === 'number' ? ` (#${source.gamebananaId})` : ''}
                      </Tag>
                      <span className="text-xs tabular-nums text-text-tertiary">
                        {t('installed.imprintDetails.sourcePriority', { priority: source.priorityAtMergeTime })}
                      </span>
                      <span className="text-xs text-text-tertiary">
                        {source.enabledAtMergeTime
                          ? t('installed.imprintDetails.sourceEnabled')
                          : t('installed.imprintDetails.sourceDisabled')}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Same collapsible pattern as ImprintReportList: details/summary,
            collapsed by default so the sheet stays tidy. */}
        <details className="overflow-hidden rounded-md border border-hl/5 bg-bg-tertiary/40">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary">
            {t('installed.imprintDetails.rawToggle')}
          </summary>
          <pre className="max-h-64 overflow-auto border-t border-hl/5 p-3 font-mono text-xs leading-relaxed text-text-secondary">
            {details.rawAddonInfo}
          </pre>
        </details>
      </>
    );
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      labelledBy={titleId}
      panelClassName="flex max-h-[85vh] flex-col"
    >
      <ModalHeader
        title={t('installed.imprintDetails.title')}
        titleId={titleId}
        subtitle={mod.fileName}
        subtitleTitle={mod.fileName}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <div className="flex-1 space-y-4 overflow-y-auto p-5">{body}</div>
      <div className="flex flex-shrink-0 justify-end gap-2 border-t border-border p-4">
        <Button variant="secondary" onClick={onClose}>{t('common.actions.close')}</Button>
      </div>
    </Modal>
  );
}
