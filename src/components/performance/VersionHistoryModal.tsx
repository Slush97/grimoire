import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, HardDriveDownload, Loader2, Package } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ModalHeader } from '../common/ui';
import { fetchPerformanceRemoteVersion, listPerformanceRemoteVersions } from '../../lib/api';
import { performanceHistoryRowCopy } from '../../lib/performanceHistory';
import type {
  PerformanceLatestInfo,
  PerformancePresetSummary,
  PerformanceRemoteVersion,
} from '../../types/electron';

interface Props {
  preset: PerformancePresetSummary;
  /** The version the picker currently has selected, to highlight its row. */
  selectedVersion: string;
  onClose: () => void;
  /** The picked version is bundled with this build: no fetch needed. */
  onPickBundled: (version: string) => void;
  /** A historical version was fetched, gated, and cached; pin it. */
  onPickRemote: (info: PerformanceLatestInfo) => void;
}

/**
 * The preset's full upstream history: every release OptiLock has published, or
 * every commit that touched a Sqooky config (those repos version in prose, so
 * the commit subject is the row's human handle). Rows are pointers; picking a
 * non-bundled one fetches that exact version, runs it through the same safety
 * gates as a tracked latest, and caches it locally so the pin keeps applying
 * offline.
 */
export default function VersionHistoryModal({
  preset,
  selectedVersion,
  onClose,
  onPickBundled,
  onPickRemote,
}: Props) {
  const { t } = useTranslation();
  const [versions, setVersions] = useState<PerformanceRemoteVersion[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [fetchingRef, setFetchingRef] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const bundledVersionFor = (entry: PerformanceRemoteVersion) =>
    preset.versions.find(
      (version) => version.version === entry.version || (!!entry.commit && version.commit === entry.commit)
    )?.version;

  useEffect(() => {
    let cancelled = false;
    listPerformanceRemoteVersions(preset.id)
      .then((result) => {
        if (cancelled) return;
        setVersions(result.versions);
        setListError(result.error);
      })
      .catch((err) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [preset.id]);

  const pick = async (entry: PerformanceRemoteVersion) => {
    setFetchError(null);
    const bundledVersion = bundledVersionFor(entry);
    if (bundledVersion) {
      onPickBundled(bundledVersion);
      return;
    }
    setFetchingRef(entry.ref);
    try {
      const info = await fetchPerformanceRemoteVersion(preset.id, entry.ref, entry.commit);
      if (info.version && !info.error) {
        onPickRemote(info);
      } else {
        setFetchError(info.error ?? t('performance.history.fetchFailed'));
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingRef(null);
    }
  };

  return (
    <Modal onClose={onClose} size="md" labelledBy="perf-version-history-title">
      <ModalHeader
        title={t('performance.history.title')}
        titleId="perf-version-history-title"
        subtitle={t('performance.history.subtitle', { repo: preset.upstream.repo })}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
      />
      <div className="max-h-[60vh] overflow-y-auto p-3 space-y-1">
        {versions === null && !listError && (
          <p className="flex items-center gap-2 px-2 py-4 text-sm text-text-secondary">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {t('performance.history.loading')}
          </p>
        )}
        {listError && versions?.length === 0 && (
          <p className="flex items-start gap-2 px-2 py-4 text-sm text-state-danger">
            <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            {t('performance.history.listFailed')}
          </p>
        )}
        {versions?.length === 0 && !listError && (
          <p className="px-2 py-4 text-sm text-text-secondary">{t('performance.history.empty')}</p>
        )}
        {versions?.map((entry) => {
          const bundledVersion = bundledVersionFor(entry);
          const row = performanceHistoryRowCopy(entry, bundledVersion);
          const isBundled = !!bundledVersion;
          const isSelected = (bundledVersion ?? entry.version) === selectedVersion;
          const isFetching = fetchingRef === entry.ref;
          return (
            <button
              key={entry.ref}
              type="button"
              onClick={() => void pick(entry)}
              disabled={fetchingRef !== null}
              className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors cursor-pointer border ${
                isSelected
                  ? 'border-accent/50 bg-accent/10'
                  : 'border-transparent hover:bg-bg-tertiary'
              } ${fetchingRef !== null && !isFetching ? 'opacity-50' : ''}`}
            >
              <span
                className="w-24 shrink-0 truncate font-mono text-sm text-text-primary"
                title={entry.commit ?? entry.ref}
              >
                {row.primary}
              </span>
              <span className="shrink-0 text-xs text-text-secondary w-20">{entry.date}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                {row.detail ?? ''}
              </span>
              <span className="shrink-0 flex items-center gap-1.5">
                {isFetching && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" aria-hidden="true" />
                )}
                {isBundled && (
                  <span
                    className="inline-flex items-center gap-1 rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] text-text-secondary"
                    title={t('performance.history.bundledHint')}
                  >
                    <Package className="w-3 h-3" aria-hidden="true" />
                    {t('performance.history.bundled')}
                  </span>
                )}
                {!isBundled && entry.cached && (
                  <span
                    className="inline-flex items-center gap-1 rounded-sm bg-white/5 px-1.5 py-0.5 text-[10px] text-text-secondary"
                    title={t('performance.history.downloadedHint')}
                  >
                    <HardDriveDownload className="w-3 h-3" aria-hidden="true" />
                    {t('performance.history.downloaded')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {fetchError && (
        <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-state-danger">
          <CircleAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          {fetchError}
        </p>
      )}
    </Modal>
  );
}
