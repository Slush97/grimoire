import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import { Gauge, RefreshCw, RotateCcw, Settings2, SquarePen } from 'lucide-react';
import { Card, Badge, Button } from '../common/ui';
import EditorPickerModal from './EditorPickerModal';
import PresetPicker from './PresetPicker';
import VersionPicker from './VersionPicker';
import GameplayOptIns from './GameplayOptIns';
import { useAppStore, type BrowseArtistRef } from '../../stores/appStore';
import {
  applyPerformanceConfig,
  getPerformanceConfigStatus,
  listPerformancePresets,
  openPerformanceConfigFile,
  removePerformanceConfig,
  resetPerformanceConfigOverrides,
  restorePerformanceConfigBackup,
} from '../../lib/api';
import type { PerformanceConfigStatus, PerformancePresetSummary } from '../../types/electron';

const SQOOKY_KOFI_URL = 'https://ko-fi.com/sqooky';
/** Presets sourced from this repo get the in-app artist link for its author. */
const SQOOKY_REPO = 'Sqooky/OptimizationLock';

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
function performanceStatusMessage(
  status: PerformanceConfigStatus,
  t: TFunction,
  presets: PerformancePresetSummary[],
  /** The user deliberately pinned an older release, so "a newer one exists" is
   *  not news to them. The rollback gets its own quieter line instead. */
  pinnedOlder = false
): string {
  const overrideCount = status.overrideCount ?? 0;
  const appliedName =
    presets.find((p) => p.id === status.appliedPresetId)?.name ?? status.appliedPresetId ?? '';
  switch (status.state) {
    case 'applied': {
      const base =
        pinnedOlder || status.appliedVersion === status.bundledVersion
          ? t('performance.status.applied', { preset: appliedName, version: status.appliedVersion })
          : t('performance.status.appliedOutdated', {
              preset: appliedName,
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

// Settings card for the bundled performance presets (experimental). Applies a
// selected community fps config onto gameinfo.gi in place, shows whether a game
// update wiped it, and credits the upstream project the preset came from.
export default function PerformanceConfigCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PerformanceConfigStatus | null>(null);
  const [presets, setPresets] = useState<PerformancePresetSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const { settings, saveSettings, setBrowseUi } = useAppStore();
  const navigate = useNavigate();

  // Which preset the user has chosen for the next apply. Falls back to the
  // generated default; what is in gameinfo.gi right now is status.appliedPresetId.
  const selectedId =
    settings?.performanceConfigPresetId ??
    presets.find((p) => p.isDefault)?.id ??
    presets[0]?.id ??
    '';
  const selected = presets.find((p) => p.id === selectedId) ?? null;

  // Which bundled release of that preset to write. A saved pin naming a release
  // this build no longer bundles falls back to the newest rather than erroring:
  // the history window slides on every upstream bump, so an old pin aging out is
  // expected, not a fault.
  const selectedVersion = useMemo(() => {
    if (!selected) return '';
    const saved = settings?.performanceConfigVersions?.[selectedId];
    return selected.versions.some((v) => v.version === saved)
      ? saved!
      : selected.versions[0].version;
  }, [settings?.performanceConfigVersions, selectedId, selected]);

  const selectedRelease =
    selected?.versions.find((v) => v.version === selectedVersion) ?? selected?.versions[0] ?? null;

  const selectedOptIns = useMemo(() => {
    const saved = settings?.performanceConfigOptIns?.[selectedId] ?? [];
    // Drop keys this release does not define. Opt-ins differ between releases,
    // not just between presets, so this is filtered against the chosen release
    // rather than the newest one.
    return selectedRelease
      ? saved.filter((key) => selectedRelease.optIn.some((c) => c.key === key))
      : [];
  }, [settings?.performanceConfigOptIns, selectedId, selectedRelease]);

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
    void listPerformancePresets()
      .then(setPresets)
      .catch(() => setPresets([]));
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

  const onSelectPreset = async (presetId: string) => {
    if (!settings) return;
    await saveSettings({ ...settings, performanceConfigPresetId: presetId });
  };

  const onSelectVersion = async (version: string) => {
    if (!settings || !selected) return;
    // Picking the newest clears the pin rather than recording it, so the preset
    // keeps following upstream on future bumps instead of silently freezing at
    // whatever happened to be newest the day the user clicked.
    const next = { ...(settings.performanceConfigVersions ?? {}) };
    if (version === selected.versions[0].version) delete next[selectedId];
    else next[selectedId] = version;
    await saveSettings({ ...settings, performanceConfigVersions: next });
  };

  const onChangeOptIns = async (keys: string[]) => {
    if (!settings) return;
    await saveSettings({
      ...settings,
      performanceConfigOptIns: { ...settings.performanceConfigOptIns, [selectedId]: keys },
    });
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
  // A different preset than the one in the file is selected, so the primary
  // action switches rather than reapplies.
  const willSwitch = applied && status?.appliedPresetId !== selectedId;
  // The user deliberately chose an older release. This suppresses the
  // "reapply to update" nag: they already know a newer one exists, that is
  // precisely what they rolled back from.
  const pinnedOlder = !!selected && selectedVersion !== selected.versions[0].version;
  // Same preset, different release than the file holds: a reapply is needed to
  // write it, just like a pending opt-in change.
  const pendingVersion =
    applied && !willSwitch && !!selectedVersion && status?.appliedVersion !== selectedVersion;
  // Toggling an opt-in only records the choice; nothing reaches gameinfo.gi
  // until the next apply. Compare what the file says was written (the sidecar,
  // via status) with what is selected now, so a pending change is visible
  // instead of looking like it already took effect.
  const pendingOptIns = useMemo(() => {
    if (!applied || willSwitch) return 0;
    const written = new Set(status?.appliedOptIns ?? []);
    const wanted = new Set(selectedOptIns);
    let n = 0;
    for (const key of wanted) if (!written.has(key)) n++;
    for (const key of written) if (!wanted.has(key)) n++;
    return n;
  }, [applied, willSwitch, status?.appliedOptIns, selectedOptIns]);
  const appliedName =
    presets.find((p) => p.id === status?.appliedPresetId)?.name ?? status?.appliedPresetId ?? '';

  const primaryLabel = willSwitch
    ? t('performance.switchTo', { preset: selected?.name ?? '' })
    : applied
      ? t('performance.reapply')
      : wiped
        ? t('performance.reapplyConfig')
        : t('performance.applyConfig');

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
      <div className="space-y-4">
        {presets.length > 0 && (
          <PresetPicker
            presets={presets}
            selectedId={selectedId}
            selectedRelease={selectedRelease}
            onSelect={(id) => void onSelectPreset(id)}
            disabled={busy}
            creditSlot={
              selected?.upstream.repo === SQOOKY_REPO ? (
                <Trans
                  i18nKey="performance.creditSqooky"
                  components={{
                    sqooky: (
                      <button
                        type="button"
                        onClick={viewSqookyInBrowse}
                        className="text-accent hover:underline"
                      />
                    ),
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
              ) : null
            }
          />
        )}

        {selected && (
          <VersionPicker
            versions={selected.versions}
            selected={selectedVersion}
            onSelect={(version) => void onSelectVersion(version)}
            disabled={busy}
          />
        )}

        {selectedRelease && (
          <GameplayOptIns
            controls={selectedRelease.optIn}
            selected={selectedOptIns}
            onChange={(keys) => void onChangeOptIns(keys)}
            disabled={busy}
          />
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-text-secondary">
              {status
                ? performanceStatusMessage(status, t, presets, pinnedOlder)
                : t('performance.checkingGameinfo')}
            </p>
            {willSwitch && (
              <p className="text-xs text-state-info">
                {t('performance.switchNote', {
                  current: appliedName,
                  next: selected?.name ?? '',
                })}
              </p>
            )}
            {pendingVersion && (
              <p className="text-xs text-state-info">
                {t('performance.version.pending', { version: selectedVersion })}
              </p>
            )}
            {pinnedOlder && !pendingVersion && (
              <p className="text-xs text-text-secondary">
                {t('performance.version.pinned', {
                  version: selectedVersion,
                  latest: selected?.versions[0].version ?? '',
                })}
              </p>
            )}
            {pendingOptIns > 0 && (
              <p className="text-xs text-state-info">
                {t('performance.optIn.pending', { count: pendingOptIns })}
              </p>
            )}
            <p className="text-xs text-text-secondary">{t('performance.shadowsHint')}</p>
            {openError && <p className="text-xs text-state-danger">{openError}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
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
              onClick={() =>
                run(() => applyPerformanceConfig(selectedId, selectedOptIns, selectedVersion))
              }
              isLoading={busy}
              icon={wiped || willSwitch ? RefreshCw : undefined}
              variant={canRestore ? 'secondary' : 'primary'}
              size="sm"
            >
              {primaryLabel}
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
                onClick={() =>
                  // Reset acts on the preset that is IN the file, not the one
                  // selected in the picker: the override count this button is
                  // gated on belongs to the applied preset, and "reset my
                  // overrides" must not quietly switch preset as a side effect.
                  // The applied version is passed for the same reason: resetting
                  // overrides must not also move the user off the release they
                  // rolled back to.
                  run(() =>
                    resetPerformanceConfigOverrides(
                      status?.appliedPresetId ?? selectedId,
                      status?.appliedOptIns ?? [],
                      status?.appliedVersion ?? selectedVersion
                    )
                  )
                }
                disabled={busy}
                variant="ghost"
                size="sm"
              >
                {t('performance.resetOverrides')}
              </Button>
            )}
          </div>
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
