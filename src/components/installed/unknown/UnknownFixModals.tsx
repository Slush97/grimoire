import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { Loader2, X, Search, RotateCcw, Wrench, Link2 } from 'lucide-react';
import type { Mod, UnknownModDetectionProgress, UnknownModFilterGuess, AssociateUnknownModArgs } from '../../../types/mod';
import { useBackdropDismiss } from '../../common/useBackdropDismiss';
import { Button, IconButton } from '../../common/ui';
import { ConfirmModal } from '../../common/PageComponents';
import type { FoundUnknownMatch } from './foundMatch';
import { UnknownMatchPanel } from './UnknownMatchPanel';

export function UnknownFilterGuessModal({
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  onApplyMatch,
  onAssociate,
  onViewMatch,
  onMakeCustom,
  onFind,
  onRetry,
  onCancel,
  onClose,
}: {
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
    progress?: UnknownModDetectionProgress;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onAssociate: (mod: Mod, args: AssociateUnknownModArgs) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { mod } = state;
  const backdropRef = useBackdropDismiss<HTMLDivElement>(onClose);

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unknown-filter-title"
    >
      <div
        className="bg-bg-secondary border border-hl/10 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hl/10">
          <div className="min-w-0">
            <h2 id="unknown-filter-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
              {mod.isUnknown ? (
                <Wrench className="w-4 h-4 text-orange-400" />
              ) : (
                <Link2 className="w-4 h-4 text-accent" />
              )}
              {mod.isUnknown ? t('installed.unknown.fixModTitle') : t('installed.unknown.linkToGamebanana')}
            </h2>
            <p className="text-xs text-text-secondary mt-1 truncate" title={mod.fileName}>
              {mod.fileName}
            </p>
          </div>
          <IconButton
            icon={X}
            label={t('common.actions.close')}
            onClick={onClose}
          />
        </div>

        <UnknownMatchPanel
          key={mod.id}
          state={state}
          hideNsfwPreviews={hideNsfwPreviews}
          autoMatchEnabled={autoMatchEnabled}
          onApplyMatch={onApplyMatch}
          onAssociate={onAssociate}
          onViewMatch={onViewMatch}
          onMakeCustom={onMakeCustom}
          onFind={onFind}
          onRetry={onRetry}
          onCancel={onCancel}
        />

      </div>
    </div>,
    document.body
  );
}

export function BulkUnknownFixModal({
  unknownMods,
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  cache,
  pendingIds,
  errors,
  onSelect,
  onApplyMatch,
  onAssociate,
  onViewMatch,
  onMakeCustom,
  onFindAll,
  onRetryAll,
  onFind,
  onRetry,
  onCancel,
  onClose,
}: {
  unknownMods: Mod[];
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
    progress?: UnknownModDetectionProgress;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  cache: Record<string, UnknownModFilterGuess>;
  pendingIds: Set<string>;
  errors: Record<string, string>;
  onSelect: (mod: Mod) => void;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onAssociate: (mod: Mod, args: AssociateUnknownModArgs) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFindAll: (mods: Mod[]) => void;
  onRetryAll: (mods: Mod[]) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const findableCount = unknownMods.filter((mod) => !pendingIds.has(mod.id) && !cache[mod.id]).length;
  const retryableCount = unknownMods.filter(
    (mod) => !pendingIds.has(mod.id) && cache[mod.id]?.crcMatch.status === 'not-found'
  ).length;
  const [confirmFindAll, setConfirmFindAll] = useState(false);
  const backdropRef = useBackdropDismiss<HTMLDivElement>(onClose);

  return createPortal(
    <>
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-unknown-title"
    >
      <div
        className="bg-bg-secondary border border-hl/10 rounded-xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-hl/10">
          <div className="min-w-0">
            <h2 id="bulk-unknown-title" className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <Wrench className="w-4 h-4 text-orange-400" />
              {t('settings.experimental.fixUnknownMods')}
            </h2>
            <p className="text-xs text-text-secondary mt-1">
              {t('installed.unknown.unknownModCount', { count: unknownMods.length })}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {autoMatchEnabled && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={RotateCcw}
                  disabled={retryableCount === 0}
                  onClick={() => onRetryAll(unknownMods)}
                  title={t('installed.unknown.retryAllHint')}
                >
                  {t('installed.unknown.retryAll')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Search}
                  disabled={findableCount === 0}
                  onClick={() => setConfirmFindAll(true)}
                  title={t('installed.unknown.searchAllHint')}
                >
                  {t('installed.unknown.searchAll')}
                </Button>
              </>
            )}
            <IconButton
              icon={X}
              label={t('common.actions.close')}
              onClick={onClose}
            />
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[240px_1fr] flex-1">
          <div className="border-r border-hl/10 p-3 overflow-y-auto space-y-1.5">
            {unknownMods.map((mod) => {
              const cached = cache[mod.id];
              const cachedMatch = cached?.crcMatch;
              const isSelected = state.mod.id === mod.id;
              const isLoading = pendingIds.has(mod.id);
              const hasError = !!errors[mod.id];
              const statusLabel = cachedMatch?.status === 'found'
                  ? t('installed.unknown.statusFound')
                : isLoading
                  ? t('installed.unknown.statusSearching')
                  : hasError
                    ? t('installed.unknown.statusError')
                  : cachedMatch?.status === 'not-found'
                    ? t('installed.unknown.statusNoMatch')
                    : t('installed.unknown.statusUnknown');
              const statusTone = cachedMatch?.status === 'found'
                ? 'text-state-success'
                : hasError
                  ? 'text-state-danger'
                : cachedMatch?.status === 'not-found'
                  ? 'text-text-tertiary'
                  : 'text-text-secondary';

              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => onSelect(mod)}
                  className={`w-full text-left rounded-md border px-3 py-2 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-accent/10 border-accent/40'
                      : 'bg-bg-tertiary/40 border-hl/5 hover:bg-bg-tertiary hover:border-hl/10'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary truncate">{mod.name}</span>
                    {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-2xs min-w-0">
                    <span className="font-mono text-text-tertiary truncate" title={mod.fileName}>{mod.fileName}</span>
                    <span className={`flex-shrink-0 ${statusTone}`}>{statusLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <UnknownMatchPanel
            key={state.mod.id}
            state={state}
            hideNsfwPreviews={hideNsfwPreviews}
            autoMatchEnabled={autoMatchEnabled}
            onApplyMatch={onApplyMatch}
            onAssociate={onAssociate}
            onViewMatch={onViewMatch}
            onMakeCustom={onMakeCustom}
            onFind={onFind}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </div>
      </div>
    </div>
    {/* Sibling of the backdrop: portal events bubble through the React tree,
        so nesting this inside the backdrop would close the whole dialog on
        any click in the confirm. */}
    <ConfirmModal
      isOpen={confirmFindAll}
      title={t('installed.unknown.searchAllConfirmTitle')}
      message={t('installed.unknown.searchAllConfirmMessage', { count: findableCount })}
      confirmLabel={t('installed.unknown.searchAll')}
      onConfirm={() => {
        setConfirmFindAll(false);
        onFindAll(unknownMods);
      }}
      onCancel={() => setConfirmFindAll(false)}
    />
    </>,
    document.body
  );
}
