import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Layers, Plus, Trash2, Play, Save, AlertTriangle, User, ChevronDown, ChevronUp, Terminal, Check, Pencil, X, Upload, Share2, Globe, History, RotateCcw, Camera } from 'lucide-react';
import {
  getProfiles,
  createProfile,
  applyProfile,
  updateProfile,
  deleteProfile,
  renameProfile,
  getSettings,
  createSnapshot,
  listSnapshots,
  loadSnapshot,
  deleteSnapshot,
} from '../lib/api';
import type { Profile, ProfileCrosshairSettings } from '../lib/api';
import type { SnapshotSummary } from '../types/snapshot';
import { formatRelativeDate, formatAbsoluteDate } from '../lib/dates';
import type { AppSettings } from '../types/mod';
import { useAppStore } from '../stores/appStore';
import { useCrosshairStore } from '../stores/crosshairStore';
import { useSocialStore } from '../stores/socialStore';
import { Card, Badge, Button, CheckboxMark } from '../components/common/ui';
import { Input } from '../components/common/forms';
import { ConfirmModal, EmptyState, PageLayout, LoadingState } from '../components/common/PageComponents';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import ExportProfileModal from '../components/profiles/ExportProfileModal';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import PublishDialog from '../components/social/PublishDialog';
import { getActiveDeadlockPath } from '../lib/appSettings';
import Tx from '../components/translation/Tx';
import type { Mod } from '../types/mod';

type ProfileModEntry = Profile['mods'][number];

interface ProfileModVariantDisplay {
  label: string;
  hasDetail: boolean;
}

interface ProfileModGroupDisplay {
  key: string;
  name: string;
  variants: ProfileModVariantDisplay[];
  enabled: boolean;
}

function fallbackFileLabel(fileName: string): string {
  const cleaned = fileName
    .replace(/^pak\d{2}_/, '')
    .replace(/_dir\.vpk$/, '')
    .replace(/\.vpk$/, '')
    .replace(/[_-]/g, ' ')
    .trim();
  return cleaned || fileName;
}

function getVariantDisplayLabel(profileMod: ProfileModEntry, mod?: Mod): string {
  return (
    mod?.variantLabel ||
    mod?.fileDescription ||
    mod?.sourceFileName ||
    fallbackFileLabel(profileMod.fileName)
  );
}

function getProfileModGroups(
  profileMods: ProfileModEntry[],
  modByFileName: Map<string, Mod>
): ProfileModGroupDisplay[] {
  const groups = new Map<string, ProfileModGroupDisplay>();

  for (const profileMod of profileMods) {
    const mod = modByFileName.get(profileMod.fileName);
    // Prefer the saved stable id over the live scan: a multi-VPK pair whose
    // pakNN_ prefix shifted since save would otherwise miss in modByFileName
    // and split into two file:<fileName> groups, inflating the displayed
    // count by one per stranded sibling.
    const gbId = profileMod.gameBananaId ?? mod?.gameBananaId;
    const key = gbId ? `gamebanana:${gbId}` : `file:${profileMod.fileName}`;
    const group = groups.get(key) ?? {
      key,
      name: mod?.name || fallbackFileLabel(profileMod.fileName),
      variants: [],
      enabled: false,
    };

    group.enabled = group.enabled || profileMod.enabled;
    group.variants.push({
      label: getVariantDisplayLabel(profileMod, mod),
      hasDetail: !!(mod?.variantLabel || mod?.fileDescription || mod?.sourceFileName),
    });
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

export default function Profiles() {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [crosshairEnabled, setCrosshairEnabled] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Profile id pending an "overwrite this profile?" confirmation. Gated on the
  // confirmProfileUpdate setting (on by default) so Update isn't a one-click,
  // no-undo overwrite sitting right next to Apply.
  const [updateConfirmId, setUpdateConfirmId] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [exportingProfileId, setExportingProfileId] = useState<string | null>(null);
  const [publishingProfileId, setPublishingProfileId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  // When set, the ImportProfileDialog renders with this JSON pre-seeded (via
  // initialInput) and auto-resolves it — the snapshot restore flow.
  const [restoringSnapshotJson, setRestoringSnapshotJson] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const [snapshotsExpanded, setSnapshotsExpanded] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState<string | null>(null);
  const [deleteSnapshotConfirmId, setDeleteSnapshotConfirmId] = useState<string | null>(null);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [selectedSnapshotIds, setSelectedSnapshotIds] = useState<Set<string>>(new Set());
  const [bulkDeleteSnapshotsOpen, setBulkDeleteSnapshotsOpen] = useState(false);
  const [bulkDeletingSnapshots, setBulkDeletingSnapshots] = useState(false);

  const { mods, loadMods } = useAppStore();
  const { getSettings: getCrosshairSettings, loadSettingsFromPreset } = useCrosshairStore();
  const socialSignedIn = useSocialStore((s) => s.status.signedIn);

  const modByFileName = new Map(mods.map((m) => [m.fileName, m]));

  const loadProfileList = async (opts?: { silent?: boolean }) => {
    // Silent refresh leaves the page rendered: needed for in-modal flows
    // (e.g. portable import) that would otherwise unmount the modal when
    // the page swaps to its loading-spinner state mid-flow.
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const [profilesResult, loadedSettings] = await Promise.all([
        getProfiles(),
        getSettings(),
      ]);
      setProfiles(profilesResult);
      setSettings(loadedSettings);
      setActiveProfileId(loadedSettings.activeProfileId || null);
      setCrosshairEnabled(loadedSettings.experimentalCrosshair ?? false);
    } catch (err) {
      setError(String(err));
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };

  const loadSnapshotList = useCallback(async () => {
    try {
      setSnapshots(await listSnapshots());
    } catch (err) {
      // Snapshot listing failures shouldn't gate the rest of the page.
      console.warn('[Profiles] failed to load snapshots:', err);
    }
  }, []);

  useEffect(() => {
    loadProfileList();
    void loadSnapshotList();
  }, [loadSnapshotList]);

  const handleRestoreSnapshot = useCallback(async (snapshotId: string) => {
    setRestoringSnapshotId(snapshotId);
    try {
      const json = await loadSnapshot(snapshotId);
      setRestoringSnapshotJson(json);
    } catch (err) {
      setError(t('profiles.errors.loadSnapshotFailed', { error: String(err) }));
    } finally {
      setRestoringSnapshotId(null);
    }
  }, [t]);

  const handleCreateManualSnapshot = useCallback(async () => {
    setCreatingSnapshot(true);
    try {
      await createSnapshot('manual');
      await loadSnapshotList();
      setSnapshotsExpanded(true);
    } catch (err) {
      setError(t('profiles.errors.captureSnapshotFailed', { error: String(err) }));
    } finally {
      setCreatingSnapshot(false);
    }
  }, [loadSnapshotList, t]);

  const handleDeleteSnapshot = useCallback(async (snapshotId: string) => {
    try {
      await deleteSnapshot(snapshotId);
      await loadSnapshotList();
      setSelectedSnapshotIds((prev) => {
        if (!prev.has(snapshotId)) return prev;
        const next = new Set(prev);
        next.delete(snapshotId);
        return next;
      });
    } catch (err) {
      setError(t('profiles.errors.deleteSnapshotFailed', { error: String(err) }));
    } finally {
      setDeleteSnapshotConfirmId(null);
    }
  }, [loadSnapshotList, t]);

  const toggleSnapshotSelected = useCallback((snapshotId: string) => {
    setSelectedSnapshotIds((prev) => {
      const next = new Set(prev);
      if (next.has(snapshotId)) next.delete(snapshotId);
      else next.add(snapshotId);
      return next;
    });
  }, []);

  const handleBulkDeleteSnapshots = useCallback(async () => {
    const ids = Array.from(selectedSnapshotIds);
    if (ids.length === 0) {
      setBulkDeleteSnapshotsOpen(false);
      return;
    }
    setBulkDeletingSnapshots(true);
    // Sequential, not Promise.all: deleteSnapshot rewrites the snapshots/
    // directory listing on each call, and concurrent unlinks against the
    // shared list scan have raced into "Snapshot not found" before.
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await deleteSnapshot(id);
      } catch (err) {
        failures.push(String(err));
      }
    }
    await loadSnapshotList();
    setSelectedSnapshotIds(new Set());
    setBulkDeleteSnapshotsOpen(false);
    setBulkDeletingSnapshots(false);
    if (failures.length > 0) {
      setError(t('profiles.errors.bulkDeleteSnapshotsFailed', {
        failed: failures.length,
        total: ids.length,
        error: failures[0],
      }));
    }
  }, [selectedSnapshotIds, loadSnapshotList, t]);

  // Drop selections that refer to snapshots no longer in the list (deleted
  // elsewhere, refresh dropped them). Keeps the bulk-delete count honest.
  useEffect(() => {
    setSelectedSnapshotIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(snapshots.map((s) => s.snapshotId));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [snapshots]);

  const toggleExpand = (id: string) => {
    const next = new Set(expandedProfiles);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedProfiles(next);
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsCreating(true);
    try {
      // Only include crosshair settings if the experimental crosshair feature is enabled
      const crosshair = crosshairEnabled ? getCrosshairSettings() : undefined;
      const newProfile = await createProfile(newProfileName.trim(), crosshair as unknown as ProfileCrosshairSettings | undefined);

      setNewProfileName('');
      setActiveProfileId(newProfile.id);
      await loadProfileList();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleApplyProfile = async (profileId: string) => {
    setApplyingId(profileId);
    try {
      const profile = await applyProfile(profileId);

      // Update local crosshair store if profile has settings
      if (profile.crosshair) {
        // We cast to any to satisfy the Preset type since loadSettingsFromPreset only uses the .settings property
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loadSettingsFromPreset({ settings: profile.crosshair } as any);
      }

      setActiveProfileId(profileId);
      await loadMods();
    } catch (err) {
      setError(String(err));
    } finally {
      setApplyingId(null);
    }
  };

  const handleUpdateProfile = async (profileId: string) => {
    setUpdatingId(profileId);
    try {
      // Only include crosshair settings if the experimental crosshair feature is enabled
      const crosshair = crosshairEnabled ? getCrosshairSettings() : undefined;
      await updateProfile(profileId, crosshair as unknown as ProfileCrosshairSettings | undefined);
      await loadProfileList();
    } catch (err) {
      setError(String(err));
    } finally {
      setUpdatingId(null);
    }
  };

  const startRename = (profile: Profile) => {
    setRenamingId(profile.id);
    setRenameValue(profile.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue('');
  };

  const submitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    const current = profiles.find(p => p.id === renamingId);
    if (!trimmed || !current || trimmed === current.name) {
      cancelRename();
      return;
    }
    setIsRenaming(true);
    try {
      await renameProfile(renamingId, trimmed);
      await loadProfileList();
      cancelRename();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    try {
      await deleteProfile(profileId);
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
      }
      await loadProfileList();
    } catch (err) {
      setError(String(err));
    } finally {
      setDeleteConfirmId(null);
    }
  };

  if (loading) {
    return <LoadingState label={<Tx k="profiles.loading" fallback="Loading profiles..." />} />;
  }

  return (
    <PageLayout variant="fill" maxWidth="5xl">
      <div className="flex flex-col gap-6 flex-1 overflow-auto px-1">
        <div className="space-y-6 pr-1">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-2 text-state-danger">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          )}

          {/* Create New Profile */}
          <Card title={<Tx k="profiles.create.title" fallback="Create New Profile" />} icon={Plus}>
            <div className="flex flex-wrap gap-3">
              <Input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                placeholder={t('profiles.create.placeholder')}
                aria-label={t('profiles.create.profileName')}
                className="flex-1"
              />
              <Button
                onClick={handleCreateProfile}
                disabled={!newProfileName.trim() || isCreating}
                isLoading={isCreating}
                icon={Save}
              >
                <Tx k="profiles.create.submit" fallback="Create Profile" />
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowImport(true)}
                icon={Upload}
                title={t('profiles.import.title')}
              >
                <Tx k="profiles.actions.import" fallback="Import" />
              </Button>
            </div>
          </Card>

          {/* Snapshots — automatic recovery points captured before
              destructive operations (mod updates, profile apply). Also
              supports manual capture. Restore re-uses the portable-import
              dialog so the user sees exactly what will re-download. */}
          <Card
            title={
              <Tx
                k="profiles.snapshots.title"
                values={{ count: snapshots.length }}
                fallback={`Snapshots${snapshots.length > 0 ? ` (${snapshots.length})` : ''}`}
              />
            }
            icon={History}
            action={
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Camera}
                  onClick={handleCreateManualSnapshot}
                  isLoading={creatingSnapshot}
                  disabled={creatingSnapshot}
                  title={t('profiles.snapshots.snapshotNowTitle')}
                  aria-label={t('profiles.snapshots.snapshotNow')}
                >
                  <Tx k="profiles.snapshots.snapshotNow" fallback="Snapshot now" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSnapshotsExpanded((v) => !v)}
                  icon={snapshotsExpanded ? ChevronUp : ChevronDown}
                  aria-label={snapshotsExpanded ? t('profiles.snapshots.collapse') : t('profiles.snapshots.expand')}
                  title={snapshotsExpanded ? t('profiles.snapshots.collapseList') : t('profiles.snapshots.showAll')}
                  className="px-1.5"
                />
              </div>
            }
          >
            {!snapshotsExpanded ? (
              <p
                className="text-xs text-text-secondary"
                title={t('profiles.snapshots.tooltip')}
              >
                {snapshots.length === 0
                  ? (
                    <Tx
                      k="profiles.snapshots.collapsedEmpty"
                      fallback="Automatic recovery points captured before updates or profile applies. None yet - one will appear here the next time you run either."
                    />
                  )
                  : (
                    <Tx
                      k="profiles.snapshots.mostRecent"
                      values={{
                        date: formatRelativeDate(snapshots[0].createdAt),
                        count: snapshots[0].modCount,
                      }}
                      fallback={`Most recent: ${formatRelativeDate(snapshots[0].createdAt)} - ${snapshots[0].modCount} mods.`}
                    />
                  )}
              </p>
            ) : snapshots.length === 0 ? (
              <p className="text-xs text-text-secondary">
                <Tx
                  k="profiles.snapshots.expandedEmpty"
                  fallback="Grimoire takes a snapshot of your installed mod set automatically before each mod update and before applying a profile. Restore re-downloads those mods from GameBanana, so a bad update or wrong-profile-applied can be rolled back. Snapshots store only the list of mods (their GameBanana IDs), never the VPK files, so disk cost stays tiny - they accumulate until you delete them. You can also capture one manually with the button above before experimenting."
                />
              </p>
            ) : (
              <>
                {(() => {
                  const allSelected = snapshots.length > 0 && selectedSnapshotIds.size === snapshots.length;
                  const someSelected = selectedSnapshotIds.size > 0 && !allSelected;
                  const toggleAll = () => {
                    if (allSelected) {
                      setSelectedSnapshotIds(new Set());
                    } else {
                      setSelectedSnapshotIds(new Set(snapshots.map((s) => s.snapshotId)));
                    }
                  };
                  return (
                    <div className="flex items-center gap-3 pb-2 mb-1 border-b border-white/5 text-xs text-text-secondary">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleAll}
                          aria-label={allSelected ? t('profiles.snapshots.clearSelection') : t('profiles.snapshots.selectAll')}
                          className="peer sr-only"
                        />
                        <CheckboxMark checked={allSelected} indeterminate={someSelected} />
                        <span>
                          {selectedSnapshotIds.size === 0 ? (
                            <Tx
                              k="profiles.snapshots.selectToBulkDelete"
                              values={{ count: snapshots.length }}
                              fallback={`Select to bulk delete (${snapshots.length})`}
                            />
                          ) : (
                            <Tx
                              k="profiles.snapshots.selected"
                              values={{ count: selectedSnapshotIds.size }}
                              fallback={`${selectedSnapshotIds.size} selected`}
                            />
                          )}
                        </span>
                      </label>
                      {selectedSnapshotIds.size > 0 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => setBulkDeleteSnapshotsOpen(true)}
                          className="ml-auto text-state-danger hover:text-red-300"
                          title={t('profiles.snapshots.deleteSelectedTitle', { count: selectedSnapshotIds.size })}
                        >
                          <Tx
                            k="profiles.actions.deleteCount"
                            values={{ count: selectedSnapshotIds.size }}
                            fallback={`Delete ${selectedSnapshotIds.size}`}
                          />
                        </Button>
                      )}
                    </div>
                  );
                })()}
                <ul className="divide-y divide-white/5">
                {snapshots.map((snap) => {
                  const isRestoring = restoringSnapshotId === snap.snapshotId;
                  const isSelected = selectedSnapshotIds.has(snap.snapshotId);
                  const triggerLabel =
                    snap.trigger === 'pre-update'
                      ? t('profiles.snapshots.trigger.preUpdate')
                      : snap.trigger === 'pre-apply-profile'
                      ? t('profiles.snapshots.trigger.preApplyProfile')
                      : t('profiles.snapshots.trigger.manual');
                  const triggerExplanation =
                    snap.trigger === 'pre-update'
                      ? t('profiles.snapshots.explanation.preUpdate')
                      : snap.trigger === 'pre-apply-profile'
                      ? t('profiles.snapshots.explanation.preApplyProfile')
                      : t('profiles.snapshots.explanation.manual');
                  return (
                    <li
                      key={snap.snapshotId}
                      className="flex flex-wrap items-center gap-3 py-2.5"
                    >
                      <label className="shrink-0 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSnapshotSelected(snap.snapshotId)}
                          aria-label={isSelected ? t('profiles.snapshots.unselect') : t('profiles.snapshots.select')}
                          className="peer sr-only"
                        />
                        <CheckboxMark checked={isSelected} />
                      </label>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-sm text-text-primary truncate"
                          title={triggerExplanation}
                        >
                          {triggerLabel}
                          <span className="text-text-secondary">
                            {' · '}
                            <Tx
                              k="profiles.mods.count"
                              values={{ count: snap.modCount }}
                              fallback={`${snap.modCount} mods`}
                            />
                          </span>
                        </div>
                        <div
                          className="text-xs text-text-secondary"
                          title={formatAbsoluteDate(snap.createdAt)}
                        >
                          {formatRelativeDate(snap.createdAt)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={RotateCcw}
                          onClick={() => handleRestoreSnapshot(snap.snapshotId)}
                          isLoading={isRestoring}
                          disabled={isRestoring}
                          title={t('profiles.snapshots.restoreTitle')}
                        >
                          <Tx k="profiles.actions.restore" fallback="Restore" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => setDeleteSnapshotConfirmId(snap.snapshotId)}
                          title={t('profiles.snapshots.deleteTitle')}
                          aria-label={t('profiles.snapshots.delete')}
                          className="px-1.5"
                        />
                      </div>
                    </li>
                  );
                })}
                </ul>
              </>
            )}
          </Card>

          {/* Profile List */}
          {profiles.length === 0 ? (
            <div className="py-16">
              <EmptyState
                icon={User}
                title={<Tx k="profiles.empty.title" fallback="No Profiles Yet" />}
                description={<Tx k="profiles.empty.noProfiles" fallback="Create a profile to save your current mod setup." />}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 pb-6">
              {profiles.map((profile) => {
                const isApplying = applyingId === profile.id;
                const isUpdating = updatingId === profile.id;
                const isActive = activeProfileId === profile.id;
                const isExpanded = expandedProfiles.has(profile.id);
                const profileModGroups = getProfileModGroups(profile.mods, modByFileName);
                const profileFileCount = profile.mods.length;

                const isRenamingThis = renamingId === profile.id;

                return (
                  <Card
                    key={profile.id}
                    title={
                      isRenamingThis ? (
                        <input
                          type="text"
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            else if (e.key === 'Escape') cancelRename();
                          }}
                          onBlur={submitRename}
                          disabled={isRenaming}
                          aria-label={t('profiles.actions.renameProfile')}
                          className="w-full px-2 py-1 bg-bg-tertiary border border-white/10 rounded text-text-primary text-lg font-semibold font-reaver focus:outline-none focus:ring-2 focus:ring-accent"
                        />
                      ) : (
                        profile.name
                      )
                    }
                    icon={Layers}
                    accentEdge={isActive ? 'active' : 'none'}
                    className={`@container/profile-card transition-all duration-300 ${isActive ? '' : 'hover:border-white/10'}`}
                    action={
                      <div className="flex items-center gap-2">
                        {!isRenamingThis && (
                          <button
                            type="button"
                            onClick={() => startRename(profile)}
                            disabled={isApplying || isUpdating}
                            aria-label={t('profiles.actions.renameProfile')}
                            title={t('profiles.actions.renameProfile')}
                            className="p-1 text-text-secondary hover:text-text-primary hover:bg-white/5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isRenamingThis && (
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={cancelRename}
                            disabled={isRenaming}
                            aria-label={t('profiles.actions.cancelRename')}
                            title={t('common.actions.cancel')}
                            className="p-1 text-text-secondary hover:text-text-primary hover:bg-white/5 rounded transition-colors disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isActive ? (
                          <Badge variant="success" className="animate-pulse">
                            <Tx k="common.status.active" fallback="Active" />
                          </Badge>
                        ) : (
                          <Badge variant="neutral">
                            <Tx k="common.status.inactive" fallback="Inactive" />
                          </Badge>
                        )}
                      </div>
                    }
                  >
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between text-sm text-text-secondary bg-black/20 p-4 rounded-lg border border-white/5">
                          <div className="flex flex-col items-center">
                            <span className="text-2xl font-bold text-text-primary">{profileModGroups.length}</span>
                            <span className="text-xs uppercase tracking-wider opacity-70">
                              <Tx k="profiles.mods.label" fallback="Mods" />
                            </span>
                          </div>
                          <div className="text-right text-xs">
                          <div className="mb-1 opacity-70">
                            <Tx k="profiles.updated" fallback="Updated" />
                          </div>
                          <div className="text-text-primary font-mono">{new Date(profile.updatedAt).toLocaleDateString()}</div>
                        </div>
                      </div>

                      {/* Capabilities Indicators */}
                      {profile.autoexecCommands && profile.autoexecCommands.length > 0 && (
                        <div className="flex gap-2">
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md text-xs text-text-secondary" title={t('profiles.autoexec.includesTitle')}>
                            <Terminal className="w-3 h-3 text-blue-400" />
                            <span>
                              <Tx
                                k="profiles.autoexec.count"
                                values={{ count: profile.autoexecCommands.length }}
                                fallback={`Autoexec (${profile.autoexecCommands.length})`}
                              />
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
                        <div className="flex items-center gap-2 flex-1 min-w-0 basis-full @sm/profile-card:basis-auto">
                          <Button
                            size="sm"
                            className="flex-1 min-w-0"
                            onClick={() => handleApplyProfile(profile.id)}
                            disabled={isApplying || isUpdating}
                            isLoading={isApplying}
                            icon={isActive ? RotateCcw : Play}
                            variant={isActive ? 'secondary' : 'primary'}
                            title={
                              isActive
                                ? t('profiles.actions.reapplyTitle')
                                : undefined
                            }
                          >
                            {isActive ? (
                              <Tx k="profiles.actions.reapply" fallback="Re-apply" />
                            ) : (
                              <Tx k="profiles.actions.apply" fallback="Apply" />
                            )}
                          </Button>
                          <Button
                            size="sm"
                            className="flex-1 min-w-0"
                            variant="secondary"
                            onClick={() =>
                              (settings?.confirmProfileUpdate ?? true)
                                ? setUpdateConfirmId(profile.id)
                                : handleUpdateProfile(profile.id)
                            }
                            disabled={isUpdating || isApplying}
                            isLoading={isUpdating}
                            icon={Save}
                            title={t('profiles.actions.updateTitle')}
                          >
                            <Tx k="profiles.actions.update" fallback="Update" />
                          </Button>
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExportingProfileId(profile.id)}
                            disabled={isApplying || isUpdating}
                            icon={Share2}
                            title={t('profiles.actions.exportTitle')}
                            aria-label={t('profiles.actions.exportProfile')}
                            className="px-1.5"
                          />
                          {socialSignedIn && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPublishingProfileId(profile.id)}
                              disabled={isApplying || isUpdating}
                              icon={Globe}
                              title={t('profiles.actions.publishToDiscover')}
                              aria-label={t('profiles.actions.publishToDiscover')}
                              className="px-1.5"
                            />
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleExpand(profile.id)}
                            icon={isExpanded ? ChevronUp : ChevronDown}
                            title={isExpanded ? t('common.actions.collapseDetails') : t('common.actions.expandDetails')}
                            aria-label={isExpanded ? t('common.actions.collapseDetails') : t('common.actions.expandDetails')}
                            className="px-1.5"
                          />
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleteConfirmId(profile.id)}
                            disabled={isApplying || isUpdating}
                            icon={Trash2}
                            title={t('profiles.actions.deleteProfile')}
                            aria-label={t('profiles.actions.deleteProfile')}
                            className="px-1.5"
                          />
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <div className="mt-2 pt-4 border-t border-white/5 animate-fade-in space-y-4">
                          {/* Mods List */}
                          <div>
                            <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                              {profileFileCount !== profileModGroups.length ? (
                                <Tx
                                  k="profiles.mods.groupsAndFiles"
                                  values={{ mods: profileModGroups.length, files: profileFileCount }}
                                  fallback={`Mods (${profileModGroups.length}, ${profileFileCount} files)`}
                                />
                              ) : (
                                <Tx
                                  k="profiles.mods.groups"
                                  values={{ count: profileModGroups.length }}
                                  fallback={`Mods (${profileModGroups.length})`}
                                />
                              )}
                            </div>
                            <div className="max-h-32 overflow-y-auto pr-2 space-y-1">
                              {profileModGroups.map((group) => {
                                const variantSummary = group.variants.map((variant) => variant.label).join(', ');
                                const showVariantSummary = group.variants.length > 1 || group.variants.some((variant) => variant.hasDetail);
                                return (
                                  <div key={group.key} className="flex items-center justify-between gap-2 text-xs py-1.5 px-2 hover:bg-white/5 rounded">
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-text-primary" title={group.name}>{group.name}</div>
                                      {showVariantSummary && (
                                        <div className="truncate text-[11px] text-text-secondary" title={variantSummary}>
                                          {variantSummary}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {group.variants.length > 1 && (
                                        <span className="text-[10px] text-text-secondary bg-white/5 rounded px-1.5 py-0.5">
                                          <Tx
                                            k="profiles.mods.files"
                                            values={{ count: group.variants.length }}
                                            fallback={`${group.variants.length} files`}
                                          />
                                        </span>
                                      )}
                                      {group.enabled && <Check className="w-3 h-3 text-green-400" />}
                                    </div>
                                  </div>
                                );
                              })}
                              {profileModGroups.length === 0 && (
                                <div className="text-xs text-text-secondary italic">
                                  <Tx k="profiles.mods.empty" fallback="No mods in profile" />
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Crosshair Preview */}
                          {profile.crosshair && (
                            <div className="pt-3 border-t border-white/5">
                              <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                                <Tx k="nav.crosshair" fallback="Crosshair" />
                              </div>
                              <div className="flex items-center gap-4">
                                <CrosshairPreview size={56} scale={1.3} settings={profile.crosshair} />
                                <div className="text-xs text-text-secondary space-y-1">
                                  <div>
                                    <Tx
                                      k="profiles.crosshair.summary"
                                      values={{
                                        gap: profile.crosshair.pipGap,
                                        height: profile.crosshair.pipHeight,
                                        width: profile.crosshair.pipWidth,
                                      }}
                                      fallback={`Gap: ${profile.crosshair.pipGap} | Height: ${profile.crosshair.pipHeight} | Width: ${profile.crosshair.pipWidth}`}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-3 h-3 rounded-sm border border-white/20"
                                      style={{ backgroundColor: `rgb(${profile.crosshair.colorR}, ${profile.crosshair.colorG}, ${profile.crosshair.colorB})` }}
                                    />
                                    <span>
                                      <Tx
                                        k="profiles.crosshair.rgb"
                                        values={{
                                          r: profile.crosshair.colorR,
                                          g: profile.crosshair.colorG,
                                          b: profile.crosshair.colorB,
                                        }}
                                        fallback={`RGB(${profile.crosshair.colorR}, ${profile.crosshair.colorG}, ${profile.crosshair.colorB})`}
                                      />
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Autoexec Commands */}
                          {profile.autoexecCommands && profile.autoexecCommands.length > 0 && (
                            <div className="pt-3 border-t border-white/5">
                              <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                                <Tx
                                  k="profiles.autoexec.commandsCount"
                                  values={{ count: profile.autoexecCommands.length }}
                                  fallback={`Autoexec (${profile.autoexecCommands.length} commands)`}
                                />
                              </div>
                              <div className="space-y-1 max-h-24 overflow-y-auto">
                                {profile.autoexecCommands.map((cmd, idx) => (
                                  <div key={idx} className="text-xs font-mono bg-white/5 rounded px-2 py-1 truncate" title={cmd}>
                                    {cmd}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Update (overwrite) Confirmation Modal. Gated on confirmProfileUpdate so
          Update isn't a one-click overwrite that gets fired when Apply was meant. */}
      <ConfirmModal
        isOpen={updateConfirmId !== null}
        onCancel={() => setUpdateConfirmId(null)}
        onConfirm={() => {
          const id = updateConfirmId;
          setUpdateConfirmId(null);
          if (id) handleUpdateProfile(id);
        }}
        title={<Tx k="profiles.confirm.updateTitle" fallback="Update Profile" />}
        message={
          <>
            <Tx
              k="profiles.confirm.updateMessage"
              values={{ name: profiles.find((p) => p.id === updateConfirmId)?.name ?? t('profiles.thisProfile') }}
              fallback={`Overwrite ${profiles.find((p) => p.id === updateConfirmId)?.name ?? 'this profile'} with your currently enabled mods? The profile's saved mod list will be replaced and can't be undone. (To load this profile onto your install instead, use Apply.) You can turn this prompt off in Settings -> Preferences.`}
            />
          </>
        }
        confirmLabel={<Tx k="profiles.actions.update" fallback="Update" />}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteProfile(deleteConfirmId)}
        title={<Tx k="profiles.confirm.deleteTitle" fallback="Delete Profile" />}
        message={<Tx k="profiles.confirm.deleteMessage" fallback="Are you sure you want to delete this profile? This action cannot be undone." />}
        confirmLabel={<Tx k="common.actions.delete" fallback="Delete" />}
        variant="danger"
      />

      {exportingProfileId && (
        <ExportProfileModal
          profileId={exportingProfileId}
          profileName={profiles.find((p) => p.id === exportingProfileId)?.name ?? ''}
          onClose={() => setExportingProfileId(null)}
        />
      )}

      {publishingProfileId && (
        <PublishDialog
          profileId={publishingProfileId}
          profileName={profiles.find((p) => p.id === publishingProfileId)?.name ?? ''}
          onClose={() => setPublishingProfileId(null)}
        />
      )}

      {showImport && (
        <ImportProfileDialog
          activeDeadlockPath={getActiveDeadlockPath(settings)}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          onClose={() => setShowImport(false)}
          onImported={() => { void loadProfileList({ silent: true }); void loadMods(); }}
        />
      )}

      {/* Snapshot restore: same dialog, JSON pre-seeded so the user sees
          exactly which mods will re-download before committing. */}
      {restoringSnapshotJson !== null && (
        <ImportProfileDialog
          activeDeadlockPath={getActiveDeadlockPath(settings)}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? true}
          initialInput={restoringSnapshotJson}
          onClose={() => setRestoringSnapshotJson(null)}
          onImported={() => { void loadProfileList({ silent: true }); void loadMods(); }}
        />
      )}

      <ConfirmModal
        isOpen={deleteSnapshotConfirmId !== null}
        onCancel={() => setDeleteSnapshotConfirmId(null)}
        onConfirm={() => deleteSnapshotConfirmId && handleDeleteSnapshot(deleteSnapshotConfirmId)}
        title={<Tx k="profiles.confirm.deleteSnapshotTitle" fallback="Delete Snapshot" />}
        message={<Tx k="profiles.confirm.deleteSnapshotMessage" fallback="Delete this recovery snapshot? You won't be able to restore from it later." />}
        confirmLabel={<Tx k="common.actions.delete" fallback="Delete" />}
        variant="danger"
      />

      <ConfirmModal
        isOpen={bulkDeleteSnapshotsOpen}
        onCancel={() => !bulkDeletingSnapshots && setBulkDeleteSnapshotsOpen(false)}
        onConfirm={handleBulkDeleteSnapshots}
        title={<Tx k="profiles.confirm.deleteSelectedSnapshotsTitle" fallback="Delete Selected Snapshots" />}
        message={
          <Tx
            k="profiles.confirm.deleteSelectedSnapshotsMessage"
            values={{ count: selectedSnapshotIds.size }}
            fallback={`Delete ${selectedSnapshotIds.size} snapshot${selectedSnapshotIds.size === 1 ? '' : 's'}? Your installed mods are unaffected. You won't be able to restore from the deleted snapshots later.`}
          />
        }
        confirmLabel={
          bulkDeletingSnapshots ? (
            <Tx k="profiles.actions.deleting" fallback="Deleting..." />
          ) : (
            <Tx
              k="profiles.actions.deleteCount"
              values={{ count: selectedSnapshotIds.size }}
              fallback={`Delete ${selectedSnapshotIds.size}`}
            />
          )
        }
        variant="danger"
      />
    </PageLayout>
  );
}
