import { useCallback, useEffect, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { Gauge, ExternalLink, RefreshCw, RotateCcw, Settings2, SquarePen } from 'lucide-react';
import { Card, Badge, Button } from '../common/ui';
import EditorPickerModal from './EditorPickerModal';
import { useAppStore, type BrowseArtistRef } from '../../stores/appStore';
import {
  applyPerformanceConfig,
  getPerformanceConfigStatus,
  openPerformanceConfigFile,
  removePerformanceConfig,
  resetPerformanceConfigOverrides,
  restorePerformanceConfigBackup,
} from '../../lib/api';
import type { PerformanceConfigStatus } from '../../types/electron';

const OPTIMIZATIONLOCK_URL = 'https://github.com/Sqooky/OptimizationLock';
const SQOOKY_KOFI_URL = 'https://ko-fi.com/sqooky';

// Sqooky's GameBanana identity, so the credit opens the in-app artist view
// (Browse scoped to their submissions) like any other artist link.
const SQOOKY_ARTIST: BrowseArtistRef = {
  id: 3826762,
  name: 'Sqooky!',
  avatarUrl: 'https://images.gamebanana.com/img/av/69f9ec7828119.png',
  profileUrl: 'https://gamebanana.com/members/3826762',
  kofiUrl: SQOOKY_KOFI_URL,
};

/**
 * Localized status sentence built from the structured status fields, so the
 * line follows the UI language instead of the English prose the main process
 * composes. Mirrors the message logic in performanceConfig.ts; falls back to
 * the backend message for the error state (which carries a raw error detail).
 */
function performanceStatusMessage(status: PerformanceConfigStatus, t: TFunction): string {
  const overrideCount = status.overrideCount ?? 0;
  switch (status.state) {
    case 'applied': {
      const base =
        status.appliedVersion === status.bundledVersion
          ? t('performance.status.applied', { version: status.appliedVersion })
          : t('performance.status.appliedOutdated', {
              version: status.appliedVersion,
              latest: status.bundledVersion,
            });
      const overrideNote = overrideCount
        ? t('performance.status.overrideNote', { count: overrideCount })
        : '';
      const handEditedNote = status.handEdited ? t('performance.status.handEditedNote') : '';
      return `${base}${overrideNote}${handEditedNote}`;
    }
    case 'wiped':
      if (status.canRestoreBackup === true) return t('performance.status.wipedRestorable');
      return (
        t('performance.status.wiped') +
        (overrideCount ? t('performance.status.wipedRestoreNote', { count: overrideCount }) : '')
      );
    case 'not-applied':
      return t('performance.status.notApplied');
    default:
      // error: keep the backend message (carries the raw error detail).
      return status.message;
  }
}

// Settings card for the OptimizationLock performance preset (experimental).
// Applies Sqooky's community fps config onto gameinfo.gi in place, shows
// whether a game update wiped it, and credits the upstream project.
export default function PerformanceConfigCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PerformanceConfigStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const { settings, saveSettings, setBrowseUi } = useAppStore();
  const navigate = useNavigate();

  const viewSqookyInBrowse = () => {
    setBrowseUi({ submitter: SQOOKY_ARTIST });
    navigate('/browse');
  };

  const refresh = useCallback(async () => {
    try {
      setStatus(await getPerformanceConfigStatus());
    } catch {
      setStatus({
        state: 'error',
        appliedVersion: null,
        bundledVersion: '',
        message: t('performance.statusReadError'),
      });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check when the window regains focus so hand edits made in an external
  // editor show up as the "edited" badge without a restart.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const run = async (action: () => Promise<PerformanceConfigStatus>) => {
    setBusy(true);
    try {
      setStatus(await action());
    } catch {
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const openFile = async () => {
    setOpenError(null);
    try {
      await openPerformanceConfigFile();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setOpenError(detail.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  const onEditFile = () => {
    // First use: ask which app to open with (.gi maps to text/plain, which
    // often resolves to a word processor). The choice persists in settings.
    if (settings?.externalEditorPath === undefined) setPickerOpen(true);
    else void openFile();
  };

  const onChooseEditor = async (editorPath: string | null) => {
    setPickerOpen(false);
    if (settings) await saveSettings({ ...settings, externalEditorPath: editorPath });
    void openFile();
  };

  const applied = status?.state === 'applied';
  const wiped = status?.state === 'wiped';
  // gameinfo.gi is empty/corrupt but we hold a backup: offer one-click recovery
  // so a manually cleared file is never a dead-end.
  const canRestore = status?.canRestoreBackup === true;

  return (
    <Card
      title={t('settings.experimental.performanceConfig')}
      icon={Gauge}
      className="lg:col-span-2"
      description={t('performance.cardDescription')}
      action={
        status && (
          <Badge variant={applied ? (status.handEdited ? 'info' : 'success') : wiped ? 'warning' : status.state === 'error' ? 'error' : 'neutral'}>
            {applied
              ? status.handEdited
                ? t('performance.badge.appliedEdited', { version: status.appliedVersion })
                : t('performance.badge.applied', { version: status.appliedVersion })
              : wiped ? t('performance.badge.wiped') : status.state === 'error' ? t('performance.badge.error') : t('performance.badge.notApplied')}
          </Badge>
        )
      }
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-text-secondary">{status ? performanceStatusMessage(status, t) : t('performance.checkingGameinfo')}</p>
          <p className="text-xs text-text-secondary">
            <Trans
              i18nKey="performance.credit"
              components={{
                sqooky: (
                  <button
                    type="button"
                    onClick={viewSqookyInBrowse}
                    className="text-accent hover:underline"
                  />
                ),
                contributors: (
                  <a
                    href={OPTIMIZATIONLOCK_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline inline-flex items-center gap-0.5"
                  />
                ),
                extlink: <ExternalLink className="w-3 h-3" aria-hidden="true" />,
                kofi: (
                  <a
                    href={SQOOKY_KOFI_URL}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-accent hover:underline"
                  />
                ),
              }}
            />
          </p>
          {openError && <p className="text-xs text-state-danger">{openError}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canRestore && (
            <Button
              onClick={() => run(restorePerformanceConfigBackup)}
              disabled={busy}
              icon={RotateCcw}
              size="sm"
            >
              {t('performance.restoreBackup')}
            </Button>
          )}
          <Button
            onClick={() => run(applyPerformanceConfig)}
            isLoading={busy}
            icon={wiped ? RefreshCw : undefined}
            variant={canRestore ? 'secondary' : 'primary'}
            size="sm"
          >
            {applied ? t('performance.reapply') : wiped ? t('performance.reapplyConfig') : t('performance.applyConfig')}
          </Button>
          {(applied || wiped) && (
            <Button onClick={() => run(removePerformanceConfig)} disabled={busy} variant="secondary" size="sm">
              {t('common.actions.remove')}
            </Button>
          )}
          {applied && (
            <Button onClick={onEditFile} disabled={busy} variant="ghost" size="sm" icon={SquarePen}>
              {t('performance.editFile')}
            </Button>
          )}
          {applied && settings?.externalEditorPath !== undefined && (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              disabled={busy}
              title={t('performance.changeEditor')}
              aria-label={t('performance.changeEditor')}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary"
            >
              <Settings2 className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
          {applied && (status?.overrideCount ?? 0) > 0 && (
            <Button
              onClick={() => run(resetPerformanceConfigOverrides)}
              disabled={busy}
              variant="ghost"
              size="sm"
            >
              {t('performance.resetOverrides')}
            </Button>
          )}
        </div>
      </div>
      {pickerOpen && (
        <EditorPickerModal
          onClose={() => setPickerOpen(false)}
          onChoose={(editorPath) => void onChooseEditor(editorPath)}
        />
      )}
    </Card>
  );
}
