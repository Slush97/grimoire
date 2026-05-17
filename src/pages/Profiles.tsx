import { useCallback, useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Play, Save, RefreshCw, AlertTriangle, User, ChevronDown, ChevronUp, Terminal, Check, Pencil, X, Upload, Share2, Globe, History, RotateCcw, Camera } from 'lucide-react';
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
import { Card, Badge, Button } from '../components/common/ui';
import { ConfirmModal, EmptyState, PageHeader } from '../components/common/PageComponents';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
import ExportProfileModal from '../components/profiles/ExportProfileModal';
import ImportProfileDialog from '../components/profiles/ImportProfileDialog';
import PublishDialog from '../components/social/PublishDialog';
import { getActiveDeadlockPath } from '../lib/appSettings';
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
    const key = mod?.gameBananaId ? `gamebanana:${mod.gameBananaId}` : `file:${profileMod.fileName}`;
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
      setError(`Failed to load snapshot: ${String(err)}`);
    } finally {
      setRestoringSnapshotId(null);
    }
  }, []);

  const handleCreateManualSnapshot = useCallback(async () => {
    setCreatingSnapshot(true);
    try {
      await createSnapshot('manual');
      await loadSnapshotList();
      setSnapshotsExpanded(true);
    } catch (err) {
      setError(`Failed to capture snapshot: ${String(err)}`);
    } finally {
      setCreatingSnapshot(false);
    }
  }, [loadSnapshotList]);

  const handleDeleteSnapshot = useCallback(async (snapshotId: string) => {
    try {
      await deleteSnapshot(snapshotId);
      await loadSnapshotList();
    } catch (err) {
      setError(`Failed to delete snapshot: ${String(err)}`);
    } finally {
      setDeleteSnapshotConfirmId(null);
    }
  }, [loadSnapshotList]);

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
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <RefreshCw className="w-8 h-8 animate-spin mb-4 text-accent" />
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="p-6 h-full max-w-5xl mx-auto w-full flex flex-col overflow-hidden">
      <PageHeader
        title="Profiles"
        description="Save and restore your mod configurations"
        className="mb-6 shrink-0"
      />

      <div className="flex flex-col gap-6 flex-1 overflow-auto px-1">
        <div className="space-y-6 pr-1">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          )}

          {/* Create New Profile */}
          <Card title="Create New Profile" icon={Plus}>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
                placeholder="Enter profile name (e.g. Competitive, Casual, Testing)..."
                aria-label="Profile name"
                className="flex-1 px-4 py-2.5 bg-bg-tertiary border border-white/5 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent transition-all"
              />
              <Button
                onClick={handleCreateProfile}
                disabled={!newProfileName.trim() || isCreating}
                isLoading={isCreating}
                icon={Save}
              >
                Create Profile
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowImport(true)}
                icon={Upload}
                title="Import a portable profile from a share code or file"
              >
                Import
              </Button>
            </div>
          </Card>

          {/* Snapshots — automatic recovery points captured before
              destructive operations (mod updates, profile apply). Also
              supports manual capture. Restore re-uses the portable-import
              dialog so the user sees exactly what will re-download. */}
          <Card
            title={`Snapshots${snapshots.length > 0 ? ` (${snapshots.length})` : ''}`}
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
                  title="Capture your current installed mods now. Use this before experimenting (mass-installing variants, testing a collection, etc.) so you can roll back to this exact state."
                  aria-label="Snapshot now"
                >
                  Snapshot now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSnapshotsExpanded((v) => !v)}
                  icon={snapshotsExpanded ? ChevronUp : ChevronDown}
                  aria-label={snapshotsExpanded ? 'Collapse snapshots' : 'Expand snapshots'}
                  title={snapshotsExpanded ? 'Collapse list' : 'Show all snapshots'}
                  className="px-1.5"
                />
              </div>
            }
          >
            {!snapshotsExpanded ? (
              <p
                className="text-xs text-text-secondary"
                title="Snapshots are automatic recovery points taken before mod updates and profile applies. They store the list of installed mods (not the VPK files), and restore by re-downloading from GameBanana. Snapshots accumulate until you delete them."
              >
                {snapshots.length === 0
                  ? 'Automatic recovery points captured before updates or profile applies. None yet — one will appear here the next time you run either.'
                  : `Most recent: ${formatRelativeDate(snapshots[0].createdAt)} · ${snapshots[0].modCount} mods.`}
              </p>
            ) : snapshots.length === 0 ? (
              <p className="text-xs text-text-secondary">
                Grimoire takes a snapshot of your installed mod set automatically before each mod update and before applying a profile. Restore re-downloads those mods from GameBanana, so a bad update or wrong-profile-applied can be rolled back. Snapshots store only the list of mods (their GameBanana IDs), never the VPK files, so disk cost stays tiny — they accumulate until you delete them. You can also capture one manually with the button above before experimenting.
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {snapshots.map((snap) => {
                  const isRestoring = restoringSnapshotId === snap.snapshotId;
                  const triggerLabel =
                    snap.trigger === 'pre-update'
                      ? 'Before update'
                      : snap.trigger === 'pre-apply-profile'
                      ? 'Before applying profile'
                      : 'Manual';
                  const triggerExplanation =
                    snap.trigger === 'pre-update'
                      ? 'Captured automatically right before mod files were replaced by an update.'
                      : snap.trigger === 'pre-apply-profile'
                      ? 'Captured automatically right before a saved profile was applied (enable/disable layout rewritten).'
                      : 'You captured this manually from the Snapshot now button.';
                  return (
                    <li
                      key={snap.snapshotId}
                      className="flex flex-wrap items-center gap-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-sm text-text-primary truncate"
                          title={triggerExplanation}
                        >
                          {triggerLabel}
                          <span className="text-text-secondary"> · {snap.modCount} mods</span>
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
                          title="Opens the import dialog with this snapshot's mod list pre-resolved. Mods already on disk stay as-is; anything missing or different re-downloads from GameBanana. Confirming creates a new profile you can apply to swap your install set back to this state."
                        >
                          Restore
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={() => setDeleteSnapshotConfirmId(snap.snapshotId)}
                          title="Delete this snapshot file. Other snapshots are unaffected; your installed mods are unaffected."
                          aria-label="Delete snapshot"
                          className="px-1.5"
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Profile List */}
          {profiles.length === 0 ? (
            <div className="py-16">
              <EmptyState
                icon={User}
                title="No Profiles Yet"
                description="Create your first profile above to save your current mod configuration."
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
                          aria-label="Rename profile"
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
                            aria-label="Rename profile"
                            title="Rename profile"
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
                            aria-label="Cancel rename"
                            title="Cancel"
                            className="p-1 text-text-secondary hover:text-text-primary hover:bg-white/5 rounded transition-colors disabled:opacity-50"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isActive ? (
                          <Badge variant="success" className="animate-pulse">Active</Badge>
                        ) : (
                          <Badge variant="neutral">Inactive</Badge>
                        )}
                      </div>
                    }
                  >
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between text-sm text-text-secondary bg-black/20 p-4 rounded-lg border border-white/5">
                        <div className="flex flex-col items-center">
                          <span className="text-2xl font-bold text-text-primary">{profileModGroups.length}</span>
                          <span className="text-xs uppercase tracking-wider opacity-70">Mods</span>
                        </div>
                        <div className="text-right text-xs">
                          <div className="mb-1 opacity-70">Updated</div>
                          <div className="text-text-primary font-mono">{new Date(profile.updatedAt).toLocaleDateString()}</div>
                        </div>
                      </div>

                      {/* Capabilities Indicators */}
                      {profile.autoexecCommands && profile.autoexecCommands.length > 0 && (
                        <div className="flex gap-2">
                          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 rounded-md text-xs text-text-secondary" title="Includes Autoexec Commands">
                            <Terminal className="w-3 h-3 text-blue-400" />
                            <span>Autoexec ({profile.autoexecCommands.length})</span>
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
                        <div className="flex items-center gap-2 flex-1 min-w-0 basis-full @sm/profile-card:basis-auto">
                          {!isActive && (
                            <Button
                              size="sm"
                              className="flex-1 min-w-0"
                              onClick={() => handleApplyProfile(profile.id)}
                              disabled={isApplying || isUpdating}
                              isLoading={isApplying}
                              icon={Play}
                            >
                              Apply
                            </Button>
                          )}
                          <Button
                            size="sm"
                            className="flex-1 min-w-0"
                            variant="secondary"
                            onClick={() => handleUpdateProfile(profile.id)}
                            disabled={isUpdating || isApplying}
                            isLoading={isUpdating}
                            icon={Save}
                            title="Overwrite with current mods"
                          >
                            Update
                          </Button>
                        </div>
                        <div className="flex items-center gap-1 ml-auto">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExportingProfileId(profile.id)}
                            disabled={isApplying || isUpdating}
                            icon={Share2}
                            title="Export / share profile"
                            aria-label="Export profile"
                            className="px-1.5"
                          />
                          {socialSignedIn && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setPublishingProfileId(profile.id)}
                              disabled={isApplying || isUpdating}
                              icon={Globe}
                              title="Publish to Discover"
                              aria-label="Publish to Discover"
                              className="px-1.5"
                            />
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggleExpand(profile.id)}
                            icon={isExpanded ? ChevronUp : ChevronDown}
                            title={isExpanded ? 'Collapse details' : 'Expand details'}
                            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                            className="px-1.5"
                          />
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeleteConfirmId(profile.id)}
                            disabled={isApplying || isUpdating}
                            icon={Trash2}
                            title="Delete Profile"
                            aria-label="Delete profile"
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
                              {`Mods (${profileModGroups.length}${profileFileCount !== profileModGroups.length ? `, ${profileFileCount} files` : ''})`}
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
                                          {group.variants.length} files
                                        </span>
                                      )}
                                      {group.enabled && <Check className="w-3 h-3 text-green-400" />}
                                    </div>
                                  </div>
                                );
                              })}
                              {profileModGroups.length === 0 && (
                                <div className="text-xs text-text-secondary italic">No mods in profile</div>
                              )}
                            </div>
                          </div>

                          {/* Crosshair Preview */}
                          {profile.crosshair && (
                            <div className="pt-3 border-t border-white/5">
                              <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">Crosshair</div>
                              <div className="flex items-center gap-4">
                                <CrosshairPreview size={56} scale={1.3} settings={profile.crosshair} />
                                <div className="text-xs text-text-secondary space-y-1">
                                  <div>Gap: {profile.crosshair.pipGap} | Height: {profile.crosshair.pipHeight} | Width: {profile.crosshair.pipWidth}</div>
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-3 h-3 rounded-sm border border-white/20"
                                      style={{ backgroundColor: `rgb(${profile.crosshair.colorR}, ${profile.crosshair.colorG}, ${profile.crosshair.colorB})` }}
                                    />
                                    <span>RGB({profile.crosshair.colorR}, {profile.crosshair.colorG}, {profile.crosshair.colorB})</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Autoexec Commands */}
                          {profile.autoexecCommands && profile.autoexecCommands.length > 0 && (
                            <div className="pt-3 border-t border-white/5">
                              <div className="text-xs font-bold text-text-secondary mb-2 uppercase tracking-wider">
                                Autoexec ({profile.autoexecCommands.length} commands)
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

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteProfile(deleteConfirmId)}
        title="Delete Profile"
        message="Are you sure you want to delete this profile? This action cannot be undone."
        confirmLabel="Delete"
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
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          onClose={() => setShowImport(false)}
          onImported={() => { void loadProfileList({ silent: true }); void loadMods(); }}
        />
      )}

      {/* Snapshot restore: same dialog, JSON pre-seeded so the user sees
          exactly which mods will re-download before committing. */}
      {restoringSnapshotJson !== null && (
        <ImportProfileDialog
          activeDeadlockPath={getActiveDeadlockPath(settings)}
          hideNsfwPreviews={settings?.hideNsfwPreviews ?? false}
          initialInput={restoringSnapshotJson}
          onClose={() => setRestoringSnapshotJson(null)}
          onImported={() => { void loadProfileList({ silent: true }); void loadMods(); }}
        />
      )}

      <ConfirmModal
        isOpen={deleteSnapshotConfirmId !== null}
        onCancel={() => setDeleteSnapshotConfirmId(null)}
        onConfirm={() => deleteSnapshotConfirmId && handleDeleteSnapshot(deleteSnapshotConfirmId)}
        title="Delete Snapshot"
        message="Delete this recovery snapshot? You won't be able to restore from it later."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
