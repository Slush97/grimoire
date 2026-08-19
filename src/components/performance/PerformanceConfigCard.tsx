import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate } from 'react-router-dom';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Eraser,
  Gauge,
  Info,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Settings2,
  SquarePen,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Card, Badge, Button, IconButton, Toggle } from '../common/ui';
import { AnchoredPopover } from '../common/AnchoredPopover';
import EditorPickerModal from './EditorPickerModal';
import PresetPicker from './PresetPicker';
import PresetSummary from './PresetSummary';
import VersionPicker from './VersionPicker';
import VersionHistoryModal from './VersionHistoryModal';
import GameplayOptIns from './GameplayOptIns';
import { useAppStore, type BrowseArtistRef } from '../../stores/appStore';
import {
  applyPerformanceConfig,
  checkPerformanceLatest,
  getPerformanceConfigStatus,
  listPerformancePresets,
  openPerformanceConfigFile,
  removePerformanceConfig,
  resetPerformanceConfigOverrides,
  restorePerformanceConfigBackup,
} from '../../lib/api';
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
  pinnedOlder = false,
  /** With upstream tracking on, "newest" is the fetched upstream release, not
   *  the newest bundled one; passing it keeps the outdated-nag honest in both
   *  directions (no nag when the applied release IS the fetched latest, a nag
   *  when upstream moved past what is applied). */
  newestKnownVersion?: string
): string {
  const overrideCount = status.overrideCount ?? 0;
  const newest = newestKnownVersion ?? status.bundledVersion;
  const appliedName =
    presets.find((p) => p.id === status.appliedPresetId)?.name ?? status.appliedPresetId ?? '';
  switch (status.state) {
    case 'applied': {
      const base =
        pinnedOlder || status.appliedVersion === newest
          ? t('performance.status.applied', { preset: appliedName, version: status.appliedVersion })
          : t('performance.status.appliedOutdated', {
              preset: appliedName,
              version: status.appliedVersion,
              latest: newest,
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

/**
 * Icon and tone for the status sentence. The state is the one thing on this
 * card a user scans for, so it gets a glyph rather than being a fourth
 * paragraph of grey text.
 */
function statusLook(status: PerformanceConfigStatus): { Icon: LucideIcon; tone: string } {
  switch (status.state) {
    case 'applied':
      return status.handEdited
        ? { Icon: SquarePen, tone: 'text-state-info' }
        : { Icon: CircleCheck, tone: 'text-state-success' };
    case 'wiped':
      return { Icon: TriangleAlert, tone: 'text-state-warning' };
    case 'error':
      return { Icon: CircleAlert, tone: 'text-state-danger' };
    default:
      return { Icon: CircleDashed, tone: 'text-text-secondary' };
  }
}

/** The header pill: same state, said in two words. */
function statusBadge(
  status: PerformanceConfigStatus,
  t: TFunction
): { variant: 'success' | 'warning' | 'error' | 'info' | 'neutral'; label: string } {
  switch (status.state) {
    case 'applied':
      return status.handEdited
        ? { variant: 'info', label: t('performance.badge.appliedEdited', { version: status.appliedVersion }) }
        : { variant: 'success', label: t('performance.badge.applied', { version: status.appliedVersion }) };
    case 'wiped':
      return { variant: 'warning', label: t('performance.badge.wiped') };
    case 'error':
      return { variant: 'error', label: t('performance.badge.error') };
    default:
      return { variant: 'neutral', label: t('performance.badge.notApplied') };
  }
}

// Settings card for the bundled performance presets. Applies a selected
// community fps config onto gameinfo.gi in place, shows whether a game update
// wiped it, and credits the upstream project the preset came from.
export default function PerformanceConfigCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PerformanceConfigStatus | null>(null);
  const [presets, setPresets] = useState<PerformancePresetSummary[]>([]);
  const [latest, setLatest] = useState<PerformanceLatestInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  // A historical upstream version pinned from the full-history browser. Only
  // meaningful while the saved version selection actually names it.
  const remotePin = settings?.performanceConfigRemotePins?.[selectedId] ?? null;

  // Which release of that preset to write: a bundled one, or a remote-pinned
  // historical one (whose body lives in the main-process fetch cache). A saved
  // pin naming a release this build no longer bundles falls back to the newest
  // rather than erroring: the history window slides on every upstream bump, so
  // an old pin aging out is expected, not a fault.
  const selectedVersion = useMemo(() => {
    if (!selected) return '';
    const saved = settings?.performanceConfigVersions?.[selectedId];
    if (saved && selected.versions.some((v) => v.version === saved)) return saved;
    if (saved && remotePin?.version === saved) return saved;
    return selected.versions[0].version;
  }, [settings?.performanceConfigVersions, selectedId, selected, remotePin]);

  // For a remote-pinned historical version this falls back to the newest
  // bundled release, whose opt-in list stands in for the pinned one's (the
  // sets are near-identical across releases, and the apply filters the chosen
  // keys against the release it actually writes, so a mismatch cannot inject
  // anything).
  const selectedRelease =
    selected?.versions.find((v) => v.version === selectedVersion) ?? selected?.versions[0] ?? null;

  // Track the newest upstream release rather than the newest bundled one.
  // Default on: these presets exist to mirror living community configs. An
  // explicit version pin (rollback) still beats tracking below.
  const trackLatest = settings?.performanceTrackLatest !== false;

  const selectedOptIns = useMemo(() => {
    if (!selectedRelease) return [];
    const saved = settings?.performanceConfigOptIns?.[selectedId];
    // Missing means the user has not customized this preset yet: preserve the
    // creator's intended visibility/camera values. An explicit [] is different
    // and means the user turned every optional setting off. Developer/testing
    // tools are never implicit defaults.
    const wanted =
      saved ??
      selectedRelease.optIn
        .filter((control) => control.group !== 'devtools')
        .map((control) => control.key);
    // Drop keys this release does not define. Optional settings differ between
    // releases, so filter against the chosen release rather than the newest.
    return wanted.filter((key) => selectedRelease.optIn.some((c) => c.key === key));
  }, [settings?.performanceConfigOptIns, selectedId, selectedRelease]);

  const viewSqookyInBrowse = () => {
    // This affordance says "Mods", so do not inherit a previously selected
    // Sound/WiP section when entering the artist page from Settings.
    setBrowseUi({
      submitter: SQOOKY_ARTIST,
      section: 'Mod',
      hiddenCreatorOverrideId: SQOOKY_ARTIST.id,
    });
    navigate('/browse');
  };

  // Dismissal (outside click, Escape) is AnchoredPopover's job; it just needs a
  // stable closer.
  const closeMenu = useCallback(() => setMenuOpen(false), []);

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

  // Ask upstream what its newest release is, once settings are loaded and only
  // while tracking is on. The main process throttles repeat checks, so preset
  // switches within a session are mostly cache reads. Keyed on booleans, not
  // the settings object, so unrelated settings saves do not re-trigger it.
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
    // Any bundled pick supersedes a remote-pinned historical version.
    const pins = { ...(settings.performanceConfigRemotePins ?? {}) };
    if (pins[selectedId]?.version !== version) delete pins[selectedId];
    await saveSettings({
      ...settings,
      performanceConfigVersions: next,
      performanceConfigRemotePins: pins,
    });
  };

  // Pin a historical upstream version fetched (and gated + cached) by the
  // main process. It rides the same settings slot as a bundled rollback, plus
  // display metadata so the picker can name it while it is active.
  const onPickRemoteVersion = async (version: string, ref: string, date: string) => {
    if (!settings) return;
    setHistoryOpen(false);
    if (selected?.versions.some((v) => v.version === version)) {
      // The fetch resolved to a release we bundle (byte-identical content
      // reuses the bundled identity): treat it as a plain bundled pick.
      await onSelectVersion(version);
      return;
    }
    await saveSettings({
      ...settings,
      performanceConfigVersions: {
        ...(settings.performanceConfigVersions ?? {}),
        [selectedId]: version,
      },
      performanceConfigRemotePins: {
        ...(settings.performanceConfigRemotePins ?? {}),
        [selectedId]: { version, ref, date },
      },
    });
  };

  const onChangeOptIns = async (keys: string[]) => {
    if (!settings) return;
    await saveSettings({
      ...settings,
      performanceConfigOptIns: { ...settings.performanceConfigOptIns, [selectedId]: keys },
    });
  };

  const onToggleTrackLatest = async (on: boolean) => {
    if (!settings) return;
    // The check effect reacts to the flag flipping on; flipping it off clears
    // the fetched info so the card talks about bundled releases again.
    await saveSettings({ ...settings, performanceTrackLatest: on });
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
  // precisely what they rolled back from. It also beats upstream tracking: a
  // rollback is the stronger, deliberate choice.
  const pinnedOlder = !!selected && selectedVersion !== selected.versions[0].version;
  // Tracking is in force and upstream holds something newer than the bundle:
  // the next apply writes the fetched release instead of a bundled one. When
  // the fetched file is byte-identical to the newest bundled release, the
  // bundled (human-reviewed) identity is the better thing to write and show.
  const latestUsable = trackLatest && !pinnedOlder && !!latest?.version && !latest?.matchesBundled;
  // The version the next apply would write.
  const targetVersion = latestUsable ? latest!.version! : selectedVersion;
  // Same preset, different release than the file holds: a reapply is needed to
  // write it, just like a pending creator-setting change.
  const pendingVersion =
    applied && !willSwitch && !!targetVersion && status?.appliedVersion !== targetVersion;

  // Apply, with upstream tracking folded in: re-check right before writing so
  // a stale cache never decides what lands in gameinfo.gi. Within the main
  // process's throttle window the check is a cache read, so the common case
  // costs nothing. Offline (or with nothing fetched yet) this falls back to
  // the bundled release, which is the designed degradation.
  const onApply = async () => {
    setBusy(true);
    try {
      let version = selectedVersion;
      if (trackLatest && !pinnedOlder) {
        const info = await checkPerformanceLatest(selectedId).catch(() => null);
        if (info) setLatest(info);
        if (info?.version && !info.matchesBundled) version = 'latest';
      }
      setStatus(await applyPerformanceConfig(selectedId, selectedOptIns, version));
    } catch {
      void refresh();
    } finally {
      setBusy(false);
    }
  };
  // Toggling a creator setting only records the choice; nothing reaches gameinfo.gi
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

  // Everything the next apply would change, collected into one callout. Three
  // separate blue sentences all saying "press Reapply" was the bulk of the
  // card's noise; they mean one thing, so they look like one thing.
  const pendingNotes: string[] = [];
  if (willSwitch) {
    pendingNotes.push(
      t('performance.switchNote', { current: appliedName, next: selected?.name ?? '' })
    );
  }
  if (pendingVersion) pendingNotes.push(t('performance.version.pending', { version: targetVersion }));
  if (pendingOptIns > 0) pendingNotes.push(t('performance.optIn.pending', { count: pendingOptIns }));

  // Actions that operate on the file rather than on the config: rarely used,
  // and five buttons of near-equal weight in one row was reading as a toolbar
  // rather than as "one obvious action plus some tools".
  const menuActions = applied
    ? [
        { key: 'edit', icon: SquarePen, label: t('performance.editFile'), run: onEditFile },
        ...(settings?.externalEditorPath !== undefined
          ? [
              {
                key: 'editor',
                icon: Settings2,
                label: t('performance.changeEditor'),
                run: () => setPickerOpen(true),
              },
            ]
          : []),
        ...((status?.overrideCount ?? 0) > 0
          ? [
              {
                key: 'reset',
                icon: Eraser,
                label: t('performance.resetOverrides'),
                // Reset acts on the preset that is IN the file, not the one
                // selected in the picker: the override count this is gated on
                // belongs to the applied preset, and "reset my overrides" must
                // not quietly switch preset as a side effect. The applied
                // version is passed for the same reason: resetting overrides
                // must not also move the user off the release they rolled back
                // to.
                run: () =>
                  void run(() =>
                    resetPerformanceConfigOverrides(
                      status?.appliedPresetId ?? selectedId,
                      status?.appliedOptIns ?? [],
                      status?.appliedVersion ?? selectedVersion
                    )
                  ),
              },
            ]
          : []),
      ]
    : [];

  const look = status ? statusLook(status) : null;
  const badge = status ? statusBadge(status, t) : null;
  // A healthy, current apply is completely described by the badge. Keep the
  // longer sentence only when it adds a warning or other actionable context.
  const appliedStatusNeedsDetail =
    applied &&
    (!!status?.handEdited ||
      (status?.overrideCount ?? 0) > 0 ||
      (!pinnedOlder &&
        !!status?.appliedVersion &&
        status.appliedVersion !== (latestUsable ? latest?.version : status.bundledVersion)));
  const showStatusDetail = !status || !applied || appliedStatusNeedsDetail;

  // One sentence about what tracking currently knows: still checking, what the
  // newest upstream release is, that upstream matches the bundle, or that the
  // repo is unreachable (with the bundled fallback spelled out).
  const latestLine = !trackLatest
    ? null
    : !latest
      ? t('performance.trackLatest.checking')
      : latest.matchesBundled
        ? t('performance.trackLatest.upToDate', { version: latest.matchesBundled })
        : latest.version
          ? t('performance.trackLatest.available', { ref: latest.ref, date: latest.date }) +
            (latest.withheldCount > 0
              ? t('performance.trackLatest.withheld', { count: latest.withheldCount })
              : '') +
            (latest.error ? t('performance.trackLatest.staleNote') : '')
          : t('performance.trackLatest.unreachable');

  return (
    <Card
      title={t('performance.title')}
      icon={Gauge}
      className="lg:col-span-2"
      contentClassName="p-0"
    >
      <div className="divide-y divide-white/5">
        <section className="p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {presets.length > 0 && (
              <PresetPicker
                presets={presets}
                selectedId={selectedId}
                onSelect={(id) => void onSelectPreset(id)}
                disabled={busy}
              />
            )}
            {selected && (
              <VersionPicker
                versions={selected.versions}
                selected={selectedVersion}
                remotePinned={remotePin}
                onSelect={(version) => void onSelectVersion(version)}
                disabled={busy}
              />
            )}
          </div>

          {selected && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                disabled={busy}
                className="shrink-0 cursor-pointer text-left text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 sm:text-right"
              >
                {t('performance.history.browse')}
              </button>
            </div>
          )}

          {selected && selectedRelease && (
            <div className="mt-4">
              <PresetSummary
                preset={selected}
                release={selectedRelease}
                creditSlot={
                  selected.upstream.repo === SQOOKY_REPO ? (
                    <>
                      <button
                        type="button"
                        onClick={viewSqookyInBrowse}
                        className="text-accent hover:underline"
                      >
                        {t('performance.preset.authorMods')}
                      </button>
                      <a
                        href={SQOOKY_KOFI_URL}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-3 text-accent hover:underline"
                      >
                        Ko-fi
                      </a>
                    </>
                  ) : null
                }
              />
            </div>
          )}
        </section>

        <section className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Toggle
              checked={trackLatest}
              onChange={(on) => void onToggleTrackLatest(on)}
              label={
                <span title={t('performance.trackLatest.description')}>
                  {t('performance.trackLatest.label')}
                </span>
              }
              disabled={busy}
            />
            {latestLine && <p className="pl-14 text-xs text-text-secondary">{latestLine}</p>}
          </div>

          {selectedRelease && (
            <GameplayOptIns
              controls={selectedRelease.optIn}
              selected={selectedOptIns}
              onChange={(keys) => void onChangeOptIns(keys)}
              disabled={busy}
            />
          )}
        </section>

        <section className="space-y-4 bg-bg-tertiary/15 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {look && <look.Icon className={`h-4 w-4 shrink-0 ${look.tone}`} aria-hidden="true" />}
                {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
              </div>
              {showStatusDetail && (
                <p className="mt-2 text-sm text-text-secondary">
                  {status
                    ? performanceStatusMessage(
                        status,
                        t,
                        presets,
                        pinnedOlder,
                        latestUsable ? latest!.version! : undefined
                      )
                    : t('performance.checkingGameinfo')}
                </p>
              )}
              {pinnedOlder && !pendingVersion && (
                <p className="mt-2 text-xs text-text-secondary">
                  {t('performance.version.pinned', {
                    version: selectedVersion,
                    latest: selected?.versions[0].version ?? '',
                  })}
                </p>
              )}
              {openError && <p className="mt-2 text-xs text-state-danger">{openError}</p>}
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
                onClick={() => void onApply()}
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
              {menuActions.length > 0 && (
                // Wrapper, not the button itself: AnchoredPopover treats the
                // anchor as the "inside" region for outside-click, and the
                // trigger owns toggling.
                <div ref={menuRef} className="relative shrink-0">
                  <IconButton
                    icon={MoreHorizontal}
                    label={t('performance.moreActions')}
                    onClick={() => setMenuOpen((v) => !v)}
                    disabled={busy}
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                  />
                  <AnchoredPopover
                    open={menuOpen}
                    onClose={closeMenu}
                    anchorRef={menuRef}
                    width={224}
                    role="menu"
                    ariaLabel={t('performance.moreActions')}
                    className="p-1"
                  >
                    {menuActions.map(({ key, icon: Icon, label, run: onRun }) => (
                      <button
                        key={key}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          onRun();
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer"
                      >
                        <Icon className="w-4 h-4 text-text-secondary shrink-0" aria-hidden="true" />
                        <span className="min-w-0 truncate">{label}</span>
                      </button>
                    ))}
                  </AnchoredPopover>
                </div>
              )}
            </div>
          </div>

          {pendingNotes.length > 0 && (
            <div className="rounded-sm border border-state-info/20 bg-state-info/5 px-3 py-2 space-y-1">
              {pendingNotes.map((note) => (
                <p key={note} className="flex items-start gap-2 text-xs text-state-info">
                  <Info className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
                  <span>{note}</span>
                </p>
              ))}
            </div>
          )}

        </section>
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
