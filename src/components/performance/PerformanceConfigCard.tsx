import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { Card, Button, Toggle } from '../common/ui';
import EditorPickerModal from './EditorPickerModal';
import VersionPicker from './VersionPicker';
import VersionHistoryModal from './VersionHistoryModal';
import GameplayOptIns from './GameplayOptIns';
import { useAppStore, type BrowseArtistRef } from '../../stores/appStore';
import { showToast } from '../../stores/toastStore';
import { useGameinfoStore } from '../../stores/gameinfoStore';
import {
  applyPerformanceConfig,
  checkPerformanceLatest,
  getPerformanceConfigStatus,
  listPerformancePresets,
  openPerformanceConfigFile,
  reapplyWipedPerformanceConfig,
  removePerformanceConfig,
  resetPerformanceConfigOverrides,
  restorePerformanceConfigBackup,
} from '../../lib/api';
import { savedOptIns, savedVersion, sortPresetsByTier } from '../../lib/performanceSelection';
import sqookyAvatar from '../../assets/performance-authors/sqooky.png';
import dacooderAvatar from '../../assets/performance-authors/dacooder.jpg';
import type {
  PerformanceConfigStatus,
  PerformanceLatestInfo,
  PerformancePresetSummary,
} from '../../types/electron';

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

// GameBanana avatars, bundled so opening Settings makes no network request.
// Authors without a GameBanana account we could verify get an initial instead.
const AUTHOR_AVATARS: Record<string, string> = {
  Sqooky: sqookyAvatar,
  dacooder: dacooderAvatar,
};

interface Notice {
  tone: 'warning' | 'danger' | 'neutral';
  text: string;
  action?: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
}

// Settings card for the bundled community performance configs. Picking a
// config, version or gameplay setting writes it to gameinfo.gi straight away;
// the only other actions put it back after something removed it, or forget it.
export default function PerformanceConfigCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PerformanceConfigStatus | null>(null);
  const [presets, setPresets] = useState<PerformancePresetSummary[]>([]);
  const [latest, setLatest] = useState<PerformanceLatestInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const { settings, saveSettings, setBrowseUi } = useAppStore();
  const navigate = useNavigate();

  const applied = status?.state === 'applied';
  const wiped = status?.state === 'wiped';
  // A game update resets the search paths too, so a file that still loads mods
  // had the config taken out on purpose.
  const gameinfoLoadsMods = useGameinfoStore(
    (s) =>
      s.gameinfo?.configured === true ||
      s.gameinfo?.reason === 'language-paths-missing' ||
      s.gameinfo?.reason === 'boot-paths-missing'
  );

  // While a config is in the file, the file is the truth. Otherwise show the
  // saved choice, falling back to the recommended preset.
  const selectedId =
    (applied ? status?.appliedPresetId : null) ??
    settings?.performanceConfigPresetId ??
    presets.find((p) => p.isDefault)?.id ??
    presets[0]?.id ??
    '';
  const selected = presets.find((p) => p.id === selectedId) ?? null;
  const remotePin = settings?.performanceConfigRemotePins?.[selectedId] ?? null;
  const selectedVersion = useMemo(
    () => (selected ? savedVersion(settings, selected) : ''),
    [settings, selected]
  );
  const selectedRelease =
    selected?.versions.find((v) => v.version === selectedVersion) ?? selected?.versions[0] ?? null;
  const selectedOptIns = useMemo(
    () => (selected ? savedOptIns(settings, selected, selectedVersion) : []),
    [settings, selected, selectedVersion]
  );

  // Default on: these presets mirror living community configs. A deliberate
  // rollback to an older version still beats tracking.
  const trackLatest = settings?.performanceTrackLatest !== false;
  const pinnedOlder = !!selected && selectedVersion !== selected.versions[0].version;

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

  // Ask upstream for its newest release while tracking is on. The main
  // process throttles repeat checks, so this is mostly a cache read.
  const settingsLoaded = !!settings;
  useEffect(() => {
    if (!settingsLoaded || !trackLatest || !selectedId) {
      setLatest(null);
      return;
    }
    let stale = false;
    void checkPerformanceLatest(selectedId)
      .then((info) => {
        if (!stale) setLatest(info);
      })
      .catch(() => {
        if (!stale) setLatest(null);
      });
    return () => {
      stale = true;
    };
  }, [settingsLoaded, trackLatest, selectedId]);

  // Hand edits made in an external editor show up without a restart.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Every write goes through here. The returned status of an apply omits the
  // written opt-ins, so a successful write re-reads the full status.
  const run = async (action: () => Promise<PerformanceConfigStatus>) => {
    setBusy(true);
    try {
      const result = await action();
      if (result.state === 'error') setStatus(result);
      else await refresh();
      return result;
    } catch {
      await refresh();
      return null;
    } finally {
      setBusy(false);
      // Keep the app-wide banner in step with what this card just wrote.
      void useGameinfoStore.getState().recheck();
    }
  };

  // Write a preset, folding in upstream tracking: re-check right before
  // writing so a stale cache never decides what lands in the file. Offline
  // this falls back to the bundled release.
  const write = (preset: PerformancePresetSummary, version: string, optIns: string[]) =>
    run(async () => {
      let target = version;
      if (trackLatest && version === preset.versions[0].version) {
        const info = await checkPerformanceLatest(preset.id).catch(() => null);
        if (info) setLatest(info);
        if (info?.version && !info.matchesBundled) target = 'latest';
      }
      return applyPerformanceConfig(preset.id, optIns, target);
    });

  const onToggle = async (on: boolean) => {
    if (!selected) return;
    if (on) await write(selected, selectedVersion, selectedOptIns);
    else await run(removePerformanceConfig);
  };

  const onSelectPreset = async (preset: PerformancePresetSummary) => {
    if (!settings || preset.id === selectedId) return;
    const before = settings;
    const previous = status;
    const next = { ...settings, performanceConfigPresetId: preset.id };
    await saveSettings(next);
    if (!applied || !previous) return;
    const version = savedVersion(next, preset);
    const result = await write(preset, version, savedOptIns(next, preset, version));
    if (result?.state !== 'applied') return;
    showToast(t('performance.switched', { preset: t(`performance.preset.tier.${preset.tier}`) }), {
      tone: 'success',
      actionLabel: t('common.actions.undo'),
      onAction: () => {
        void saveSettings(before);
        void run(() =>
          applyPerformanceConfig(
            previous.appliedPresetId ?? undefined,
            previous.appliedOptIns ?? [],
            previous.appliedVersion
          )
        );
      },
    });
  };

  const onSelectVersion = async (version: string) => {
    if (!settings || !selected) return;
    // Picking the newest clears the pin, so the preset keeps following
    // upstream instead of freezing at whatever was newest that day.
    const versions = { ...(settings.performanceConfigVersions ?? {}) };
    if (version === selected.versions[0].version) delete versions[selectedId];
    else versions[selectedId] = version;
    const pins = { ...(settings.performanceConfigRemotePins ?? {}) };
    if (pins[selectedId]?.version !== version) delete pins[selectedId];
    const next = {
      ...settings,
      performanceConfigVersions: versions,
      performanceConfigRemotePins: pins,
    };
    await saveSettings(next);
    if (applied) await write(selected, version, savedOptIns(next, selected, version));
  };

  // A historical upstream version from the full-history browser rides the same
  // settings slot as a bundled rollback, plus display metadata for the picker.
  const onPickRemoteVersion = async (version: string, ref: string, date: string) => {
    if (!settings || !selected) return;
    setHistoryOpen(false);
    if (selected.versions.some((v) => v.version === version)) {
      await onSelectVersion(version);
      return;
    }
    const next = {
      ...settings,
      performanceConfigVersions: { ...(settings.performanceConfigVersions ?? {}), [selectedId]: version },
      performanceConfigRemotePins: {
        ...(settings.performanceConfigRemotePins ?? {}),
        [selectedId]: { version, ref, date },
      },
    };
    await saveSettings(next);
    if (applied) await write(selected, version, savedOptIns(next, selected, version));
  };

  const onChangeOptIns = async (keys: string[]) => {
    if (!settings || !selected) return;
    await saveSettings({
      ...settings,
      performanceConfigOptIns: { ...settings.performanceConfigOptIns, [selectedId]: keys },
    });
    if (applied) await write(selected, selectedVersion, keys);
  };

  const onToggleTrackLatest = async (on: boolean) => {
    if (!settings || !selected) return;
    await saveSettings({ ...settings, performanceTrackLatest: on });
    if (on && applied && !pinnedOlder) await write(selected, selectedVersion, selectedOptIns);
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

  const viewSqookyInBrowse = () => {
    // This link says "Mods", so do not inherit a previously selected
    // Sound/WiP section when entering the artist page from Settings.
    setBrowseUi({
      submitter: SQOOKY_ARTIST,
      section: 'Mod',
      hiddenCreatorOverrideId: SQOOKY_ARTIST.id,
    });
    navigate('/browse');
  };

  // With tracking on, "newest" is the fetched upstream release unless it is
  // byte-identical to a bundled one (then the reviewed bundled identity wins).
  const newestVersion =
    trackLatest && latest?.version && !latest.matchesBundled
      ? latest.version
      : selected?.versions[0].version;
  const updateAvailable =
    applied && !pinnedOlder && !!newestVersion && status?.appliedVersion !== newestVersion;

  const notice: Notice | null = !status
    ? null
    : status.state === 'error'
      ? { tone: 'danger', text: status.message }
      : wiped && status.canRestoreBackup
        ? {
            tone: 'warning',
            text: t('performance.notice.damaged'),
            action: { label: t('performance.restoreBackup'), run: () => void run(restorePerformanceConfigBackup) },
          }
        : wiped && gameinfoLoadsMods
          ? {
              tone: 'neutral',
              text: t('performance.notice.removed'),
              action: { label: t('performance.restore'), run: () => void run(reapplyWipedPerformanceConfig) },
              secondary: { label: t('common.actions.dismiss'), run: () => void run(removePerformanceConfig) },
            }
          : wiped
            ? {
                tone: 'warning',
                text: t('performance.notice.wiped'),
                action: { label: t('performance.restore'), run: () => void run(reapplyWipedPerformanceConfig) },
              }
            : updateAvailable && selected
              ? {
                  tone: 'neutral',
                  text: t('performance.notice.update'),
                  action: {
                    label: t('performance.update'),
                    run: () => void write(selected, selectedVersion, selectedOptIns),
                  },
                }
              : applied && status.handEdited
                ? { tone: 'neutral', text: t('performance.notice.handEdited') }
                : null;

  const overrideCount = status?.overrideCount ?? 0;
  const sortedPresets = sortPresetsByTier(presets);

  return (
    <Card
      title={t('performance.title')}
      description={t('performance.description')}
      accentEdge="none"
      className="lg:col-span-2"
      contentClassName="p-0!"
      action={
        <Toggle
          checked={applied}
          onChange={(on) => void onToggle(on)}
          label={applied ? t('performance.on') : t('performance.off')}
          disabled={busy || !selected || !!status?.canRestoreBackup}
        />
      }
    >
      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hl/5 px-5 py-3">
          <p
            className={`text-sm ${
              notice.tone === 'danger'
                ? 'text-state-danger'
                : notice.tone === 'warning'
                  ? 'text-state-warning'
                  : 'text-text-primary'
            }`}
          >
            {notice.text}
          </p>
          <div className="flex items-center gap-2">
            {notice.secondary && (
              <Button size="sm" variant="secondary" onClick={notice.secondary.run} disabled={busy}>
                {notice.secondary.label}
              </Button>
            )}
            {notice.action && (
              <Button size="sm" onClick={notice.action.run} isLoading={busy}>
                {notice.action.label}
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        role="radiogroup"
        aria-label={t('performance.presetsLabel')}
        className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3"
      >
        {sortedPresets.map((preset) => {
          const checked = preset.id === selectedId;
          const avatar = AUTHOR_AVATARS[preset.author];
          return (
            <label
              key={preset.id}
              className={`flex gap-3 rounded-sm border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                checked ? 'border-accent bg-accent/5' : 'border-border hover:border-hl/20'
              } ${busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <input
                type="radio"
                name="performance-preset"
                checked={checked}
                onChange={() => void onSelectPreset(preset)}
                disabled={busy}
                className="mt-0.5 h-4 w-4 shrink-0 accent-accent cursor-pointer focus:outline-none disabled:cursor-not-allowed"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-text-primary">
                    {t(`performance.preset.tier.${preset.tier}`)}
                  </span>
                  {preset.isDefault && (
                    <span className="text-xs text-text-secondary">{t('performance.preset.recommended')}</span>
                  )}
                  {preset.unstable && (
                    <span className="text-xs text-state-warning">{t('performance.preset.experimental')}</span>
                  )}
                </span>
                <span className="mt-1.5 flex items-center gap-2 text-xs text-text-secondary">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-[10px] font-medium uppercase text-text-secondary"
                    >
                      {preset.author.charAt(0)}
                    </span>
                  )}
                  <span className="min-w-0 truncate" title={preset.name}>
                    {preset.author}
                  </span>
                </span>
                <span className="mt-2 block text-xs text-text-secondary">
                  {t(`performance.preset.tierBlurb.${preset.tier}`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <div className="border-t border-hl/5">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex w-full cursor-pointer items-center justify-between px-5 py-3 text-left text-sm text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t('performance.advanced')}
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {advancedOpen && selected && selectedRelease && (
          <div className="space-y-5 px-5 pb-5">
            <div>
              <VersionPicker
                versions={selected.versions}
                selected={selectedVersion}
                remotePinned={remotePin}
                onSelect={(version) => void onSelectVersion(version)}
                disabled={busy}
              />
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                disabled={busy}
                className="mt-2 cursor-pointer text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('performance.history.browse')}
              </button>
            </div>

            <Toggle
              checked={trackLatest}
              onChange={(on) => void onToggleTrackLatest(on)}
              label={t('performance.trackLatest.label')}
              description={t('performance.trackLatest.description')}
              disabled={busy}
            />

            <GameplayOptIns
              controls={selectedRelease.optIn}
              selected={selectedOptIns}
              onChange={(keys) => void onChangeOptIns(keys)}
              fileValues={applied ? status?.managedConvarValues : undefined}
              savedValues={applied ? status?.savedConvarValues : undefined}
              disabled={busy}
            />

            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            {applied && (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={onEditFile} disabled={busy}>
                    {t('performance.editFile')}
                  </Button>
                  {settings?.externalEditorPath !== undefined && (
                    <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)} disabled={busy}>
                      {t('performance.changeEditor')}
                    </Button>
                  )}
                  {overrideCount > 0 && (
                    // Acts on what is in the file, so discarding edits never
                    // also switches preset or moves off a rolled-back release.
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          resetPerformanceConfigOverrides(
                            status?.appliedPresetId ?? selectedId,
                            status?.appliedOptIns ?? [],
                            status?.appliedVersion ?? selectedVersion
                          )
                        )
                      }
                    >
                      {t('performance.resetOverrides', { count: overrideCount })}
                    </Button>
                  )}
                </div>
                {openError && <p className="mt-2 text-xs text-state-danger">{openError}</p>}
              </div>
            )}

            <p className="ml-auto flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
              <span>
                {selected.upstream.credit} ({selected.upstream.license})
              </span>
              <a
                href={`${selected.upstream.url}/tree/${selectedRelease.commit}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                {t('performance.source')}
              </a>
              {selected.upstream.repo === SQOOKY_REPO && (
                <>
                  <button type="button" onClick={viewSqookyInBrowse} className="cursor-pointer text-accent hover:underline">
                    {t('performance.preset.authorMods')}
                  </button>
                  <a href={SQOOKY_KOFI_URL} target="_blank" rel="noreferrer noopener" className="text-accent hover:underline">
                    Ko-fi
                  </a>
                </>
              )}
            </p>
            </div>
          </div>
        )}
      </div>

      {pickerOpen && (
        <EditorPickerModal
          onClose={() => setPickerOpen(false)}
          onChoose={(editorPath) => void onChooseEditor(editorPath)}
        />
      )}
      {historyOpen && selected && (
        <VersionHistoryModal
          preset={selected}
          selectedVersion={selectedVersion}
          onClose={() => setHistoryOpen(false)}
          onPickBundled={(version) => {
            setHistoryOpen(false);
            void onSelectVersion(version);
          }}
          onPickRemote={(info) =>
            void onPickRemoteVersion(info.version ?? '', info.ref ?? info.version ?? '', info.date ?? '')
          }
        />
      )}
    </Card>
  );
}
