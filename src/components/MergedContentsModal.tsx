import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, X, Share2, Scissors, Check, PackageOpen, Loader2, AlertTriangle, Plus } from 'lucide-react';
import type { Mod, MergedModSource } from '../types/mod';
import type { MergeSourceUpdateOutcome, MergeSourceUpdateSkip } from '../lib/mergeSourceUpdate';
import ModThumbnail from './ModThumbnail';
import { Button, Tag } from './common/ui';
import { Modal } from './common/Modal';
import { formatRelativeDate } from '../lib/dates';

interface Props {
  mod: Mod;
  hideNsfw?: boolean;
  onClose: () => void;
  onUnmerge?: () => void;
  /** Pull one source out of the merge, restoring it as a standalone mod.
   *  Omitted to render the list read-only. */
  onExtractSource?: (source: MergedModSource) => Promise<void>;
  /** fileNames of sources whose GameBanana file is no longer live. */
  staleSourceFileNames?: Set<string>;
  /** Download the current file for every outdated source and rebuild the merge
   *  around them. Omitted to leave the outdated markers read-only. */
  onUpdateSources?: () => Promise<MergeSourceUpdateOutcome>;
  /** Standalone installed mods that are not already represented by this merge. */
  eligibleMods?: Mod[];
  onAddSources?: (modIds: string[], strict: boolean) => Promise<void>;
}

/**
 * View of what a merged VPK contains. Lists every source mod with its
 * thumbnail and the priority/enabled state captured at merge time. Each source
 * can be extracted back to a standalone mod; the footer surfaces the share code
 * (with a copy button) and an Unmerge shortcut.
 */
export default function MergedContentsModal({
  mod,
  hideNsfw,
  onClose,
  onUnmerge,
  onExtractSource,
  staleSourceFileNames,
  onUpdateSources,
  eligibleMods = [],
  onAddSources,
}: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  // The fileName of the source row currently being extracted, and the last
  // error surfaced by an extract.
  const [busyFileName, setBusyFileName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [selectedAddIds, setSelectedAddIds] = useState<Set<string>>(new Set());
  const [strict, setStrict] = useState(false);
  const [addingSources, setAddingSources] = useState(false);
  const [updatingSources, setUpdatingSources] = useState(false);
  const [updateSkips, setUpdateSkips] = useState<MergeSourceUpdateSkip[]>([]);
  const merged = mod.merged;
  // Render nothing if the prop is malformed rather than throwing; the parent
  // only opens this modal when `mod.merged` is truthy so this is defensive.
  if (!merged) return null;

  const canExtract = !!onExtractSource;
  const canAdd = !!onAddSources;

  const handleExtract = async (src: MergedModSource) => {
    if (!onExtractSource || busyFileName || addingSources) return;
    setActionError(null);
    setBusyFileName(src.fileName);
    try {
      // The parent runs the IPC, refreshes mods, and then either re-syncs this
      // modal's `mod` prop with the rebuilt merge (fewer sources) or closes it
      // when the merge collapsed. Nothing else to do on success here.
      await onExtractSource(src);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyFileName(null);
    }
  };

  const handleUpdateSources = async () => {
    if (!onUpdateSources || updatingSources || busyFileName || addingSources) return;
    setActionError(null);
    setUpdateSkips([]);
    setUpdatingSources(true);
    try {
      // The parent downloads the replacements, rebuilds the merge, and re-syncs
      // this modal's `mod` prop. Only the leftovers need reporting here.
      const outcome = await onUpdateSources();
      setUpdateSkips(outcome.skipped);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingSources(false);
    }
  };

  const toggleAddSelection = (modId: string) => {
    setSelectedAddIds((current) => {
      const next = new Set(current);
      if (next.has(modId)) next.delete(modId);
      else next.add(modId);
      return next;
    });
  };

  const handleAddSources = async () => {
    if (!onAddSources || selectedAddIds.size === 0 || addingSources || busyFileName) return;
    setActionError(null);
    setAddingSources(true);
    try {
      await onAddSources([...selectedAddIds], strict);
      setSelectedAddIds(new Set());
      setAddPickerOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddingSources(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(merged.shareCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Silently no-op: surfacing a toast inside a child modal is overkill.
      // The button text resetting tells the user it didn't take.
    }
  };

  const createdLabel = formatRelativeDate(merged.createdAt) || merged.createdAt;

  // merged.sources is stored in the merger's argv order (descending priority,
  // because vpkmerge is last-input-wins). Display it in load order instead:
  // ascending pakNN, so the lowest-pakNN source (the collision winner that
  // loads first) sits at the top, matching the Installed load-order list and
  // the merge modal. Sort a copy so the stored snapshot (used by extract /
  // unmerge) is untouched.
  const orderedSources = [...merged.sources].sort(
    (a, b) => a.priorityAtMergeTime - b.priorityAtMergeTime
  );
  const staleCount = staleSourceFileNames
    ? merged.sources.filter((s) => staleSourceFileNames.has(s.fileName)).length
    : 0;

  return (
    <Modal onClose={onClose} labelledBy="merged-contents-title" size="lg">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h3
            id="merged-contents-title"
            className="text-lg font-semibold text-text-primary flex items-center gap-2 min-w-0"
          >
            <Layers className="w-5 h-5 text-text-secondary flex-shrink-0" />
            <span className="truncate">{mod.name}</span>
          </h3>
          <button
            onClick={onClose}
            disabled={addingSources || busyFileName !== null}
            className="p-1 text-text-secondary hover:text-text-primary rounded cursor-pointer flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t('common.actions.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-4">
            <div className="w-28 aspect-square flex-shrink-0 rounded-lg overflow-hidden border border-border bg-bg-tertiary">
              <ModThumbnail
                src={mod.thumbnailUrl}
                alt={mod.name}
                hideNsfw={hideNsfw}
                nsfw={mod.nsfw}
                mergedSources={merged.sources}
                className="w-full h-full"
              />
            </div>
            <div className="flex-1 min-w-0 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Tag className="border-white/20 text-white/90" icon={Layers}>
                  {t('mergedContents.merged', { count: merged.sources.length })}
                </Tag>
                <span className="text-text-secondary text-xs">{t('mergedContents.created', { date: createdLabel })}</span>
              </div>
              <div className="text-text-secondary text-xs font-mono truncate" title={mod.fileName}>
                {mod.fileName}
              </div>
              <p className="text-text-secondary text-xs leading-relaxed pt-1">
                {t('mergedContents.sourcesStayOnDisk')}
              </p>
              {staleCount > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <p className="text-amber-200/90 text-xs leading-relaxed flex-1 min-w-[16rem]">
                    {onUpdateSources
                      ? t('mergedContents.staleSourcesUpdatable', { count: staleCount })
                      : t('mergedContents.staleSourcesNote', { count: staleCount })}
                  </p>
                  {onUpdateSources && (
                    <Button
                      variant="warning"
                      size="sm"
                      onClick={() => void handleUpdateSources()}
                      isLoading={updatingSources}
                      disabled={busyFileName !== null || addingSources}
                    >
                      {t('mergedContents.updateSources', { count: staleCount })}
                    </Button>
                  )}
                </div>
              )}
              {updateSkips.length > 0 && (
                <ul className="text-amber-200/80 text-[11px] leading-relaxed pt-1 space-y-0.5">
                  {updateSkips.map((skip) => (
                    <li key={`${skip.modName}:${skip.reason}`}>
                      {t(`mergedContents.skipReason.${skip.reason}`, { modName: skip.modName })}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-xs uppercase tracking-wide text-text-secondary">
                {t('mergedContents.sources', { count: merged.sources.length })}
              </div>
              {canExtract && merged.sources.length === 2 && (
                <div className="text-[11px] text-amber-400/90">
                  {t('mergedContents.extractingDissolves')}
                </div>
              )}
            </div>
            <ul className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {orderedSources.map((src) => {
                const busy = busyFileName === src.fileName;
                // Dim and lock other rows while an extract is in flight.
                const rowLocked = addingSources || (busyFileName !== null && !busy);
                return (
                  <li
                    key={src.fileName}
                    className={`flex items-center gap-3 px-2 py-2 rounded bg-bg-tertiary/50 border border-border/60 ${rowLocked ? 'opacity-50' : ''}`}
                  >
                    <div className="w-12 h-12 flex-shrink-0 rounded overflow-hidden bg-bg-tertiary">
                      <ModThumbnail
                        src={src.thumbnailUrl}
                        alt={src.modName}
                        hideNsfw={hideNsfw}
                        className="w-full h-full"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate" title={src.modName}>
                        {src.modName}
                      </div>
                      <div className="text-[11px] text-text-secondary font-mono truncate" title={src.fileName}>
                        {src.fileName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className="text-[10px] uppercase tracking-wide text-text-secondary tabular-nums"
                        title={t('mergedContents.priorityCaptured')}
                      >
                        #{src.priorityAtMergeTime}
                      </span>
                      {!src.enabledAtMergeTime && (
                        <span
                          className="text-[10px] uppercase tracking-wide text-text-secondary/70 px-1.5 py-0.5 rounded border border-border"
                          title={t('mergedContents.disabledAtMerge')}
                        >
                          off
                        </span>
                      )}
                      {staleSourceFileNames?.has(src.fileName) && (
                        <span
                          className="text-[10px] uppercase tracking-wide text-amber-200 px-1.5 py-0.5 rounded border border-amber-300/70"
                          title={t('mergedContents.sourceOutdatedTitle')}
                        >
                          {t('mergedContents.sourceOutdated')}
                        </span>
                      )}
                      {canExtract && (
                        <button
                          onClick={() => void handleExtract(src)}
                          disabled={rowLocked}
                          className="p-1 ml-0.5 text-text-secondary hover:text-accent transition-colors rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          title={t('mergedContents.extractTitle')}
                          aria-label={`Extract ${src.modName}`}
                        >
                          {busy ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <PackageOpen className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {addPickerOpen && (
              <div className="mt-3 space-y-3 rounded-sm border border-border bg-bg-secondary p-3">
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {t('mergedContents.addMods')}
                  </div>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {t('mergedContents.addModsDescription')}
                  </p>
                </div>
                {eligibleMods.length === 0 ? (
                  <div className="text-sm text-text-secondary py-2">
                    {t('mergedContents.noEligibleMods')}
                  </div>
                ) : (
                  <ul className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {eligibleMods.map((eligible) => (
                      <li key={eligible.id}>
                        <label className="flex items-center gap-3 rounded border border-border/60 bg-bg-tertiary/50 px-2.5 py-2 cursor-pointer hover:border-border">
                          <input
                            type="checkbox"
                            checked={selectedAddIds.has(eligible.id)}
                            disabled={addingSources}
                            onChange={() => toggleAddSelection(eligible.id)}
                            className="accent-accent"
                          />
                          <div className="w-9 h-9 flex-shrink-0 rounded overflow-hidden bg-bg-tertiary">
                            <ModThumbnail
                              src={eligible.thumbnailUrl}
                              alt={eligible.name}
                              hideNsfw={hideNsfw}
                              nsfw={eligible.nsfw}
                              className="w-full h-full"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-text-primary truncate">{eligible.name}</div>
                            <div className="text-[11px] text-text-secondary font-mono truncate">
                              {eligible.fileName}
                            </div>
                          </div>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={strict}
                    disabled={addingSources}
                    onChange={(event) => setStrict(event.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-accent cursor-pointer flex-shrink-0"
                  />
                  <span>
                    {t('mergeMods.strictMode')}
                    <span className="block text-xs text-text-secondary mt-0.5">
                      {t('mergeMods.strictDescription')}
                    </span>
                  </span>
                </label>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={addingSources}
                    onClick={() => {
                      setSelectedAddIds(new Set());
                      setAddPickerOpen(false);
                    }}
                  >
                    {t('common.actions.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={addingSources ? Loader2 : Plus}
                    disabled={selectedAddIds.size === 0 || addingSources}
                    onClick={() => void handleAddSources()}
                  >
                    {addingSources
                      ? t('mergedContents.addingMods')
                      : t('mergedContents.addSelected', { count: selectedAddIds.size })}
                  </Button>
                </div>
              </div>
            )}

            {actionError && (
              <div className="flex items-start gap-2 text-sm text-red-200 bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 mt-2">
                <AlertTriangle className="w-4 h-4 text-state-danger flex-shrink-0 mt-0.5" />
                <div>{actionError}</div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end p-4 border-t border-border">
          {canAdd && (
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              disabled={addingSources || busyFileName !== null}
              onClick={() => setAddPickerOpen((open) => !open)}
            >
              {t('mergedContents.addMods')}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={copied ? Check : Share2}
            disabled={addingSources || busyFileName !== null}
            onClick={() => void handleCopy()}
          >
            {copied ? t('common.status.copied') : t('mergedContents.copyShareCode')}
          </Button>
          {onUnmerge && (
            <Button
              variant="secondary"
              size="sm"
              icon={Scissors}
              disabled={addingSources || busyFileName !== null}
              onClick={() => {
                onClose();
                onUnmerge();
              }}
            >
              {t('mergedContents.unmerge')}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={addingSources || busyFileName !== null}
            onClick={onClose}
          >
            {t('common.actions.close')}
          </Button>
        </div>
    </Modal>
  );
}
