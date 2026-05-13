import { useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Play, Save, RefreshCw, AlertTriangle, User, ChevronDown, ChevronUp, Terminal, Check } from 'lucide-react';
import {
  getProfiles,
  createProfile,
  applyProfile,
  updateProfile,
  deleteProfile,
  getSettings,
} from '../lib/api';
import type { Profile, ProfileCrosshairSettings } from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useCrosshairStore } from '../stores/crosshairStore';
import { Card, Badge, Button } from '../components/common/ui';
import { ConfirmModal, EmptyState, PageHeader } from '../components/common/PageComponents';
import CrosshairPreview from '../components/crosshair/CrosshairPreview';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { mods, loadMods } = useAppStore();
  const { getSettings: getCrosshairSettings, loadSettingsFromPreset } = useCrosshairStore();

  const modByFileName = new Map(mods.map(m => [m.fileName, m]));

  const loadProfileList = async () => {
    setLoading(true);
    setError(null);
    try {
      const [profilesResult, settings] = await Promise.all([
        getProfiles(),
        getSettings(),
      ]);
      setProfiles(profilesResult);
      setActiveProfileId(settings.activeProfileId || null);
      setCrosshairEnabled(settings.experimentalCrosshair ?? false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfileList();
  }, []);

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
            </div>
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

                return (
                  <Card
                    key={profile.id}
                    title={profile.name}
                    icon={Layers}
                    className={`transition-all duration-300 ${isActive ? 'ring-1 ring-accent border-accent/50 shadow-[0_0_20px_rgba(203,166,247,0.15)]' : 'hover:border-white/10'}`}
                    action={
                      <div className="flex items-center gap-2">
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

                      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                        {!isActive && (
                          <Button
                            size="sm"
                            className="flex-1"
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
                          className={isActive ? "flex-1" : ""}
                          variant="secondary"
                          onClick={() => handleUpdateProfile(profile.id)}
                          disabled={isUpdating || isApplying}
                          isLoading={isUpdating}
                          icon={Save}
                          title="Overwrite with current mods"
                        >
                          Update
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleExpand(profile.id)}
                          icon={isExpanded ? ChevronUp : ChevronDown}
                          className="px-1.5"
                        />
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setDeleteConfirmId(profile.id)}
                          disabled={isApplying || isUpdating}
                          icon={Trash2}
                          title="Delete Profile"
                          className="px-1.5"
                        />
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
    </div>
  );
}
