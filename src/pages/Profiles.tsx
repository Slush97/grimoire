import { useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Play, Save, RefreshCw, Check } from 'lucide-react';
import {
  getProfiles,
  createProfile,
  applyProfile,
  updateProfile,
  deleteProfile,
  getSettings,
} from '../lib/api';
import type { Profile } from '../lib/api';
import { useAppStore } from '../stores/appStore';

export default function Profiles() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProfileName, setNewProfileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { loadMods } = useAppStore();

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
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProfileList();
  }, []);

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) return;

    setIsCreating(true);
    try {
      const newProfile = await createProfile(newProfileName.trim());
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
      await applyProfile(profileId);
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
      await updateProfile(profileId);
      await loadProfileList();
    } catch (err) {
      setError(String(err));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm('Delete this profile?')) return;

    try {
      await deleteProfile(profileId);
      if (activeProfileId === profileId) {
        setActiveProfileId(null);
      }
      await loadProfileList();
    } catch (err) {
      setError(String(err));
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-secondary">
        <RefreshCw className="w-8 h-8 animate-spin mb-4" />
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Profiles</h1>
          <p className="text-sm text-text-secondary mt-1">
            Save and restore your mod configurations
          </p>
        </div>
      </div>

      {/* Create new profile card */}
      <div className="bg-gradient-to-r from-accent-primary/20 to-accent-secondary/20 border border-accent-primary/30 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-accent-primary mb-3 uppercase tracking-wide">
          New Profile
        </h2>
        <div className="flex gap-3">
          <input
            type="text"
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
            placeholder="Enter profile name..."
            className="flex-1 px-4 py-2.5 bg-bg-primary border border-border-primary rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary transition-all"
          />
          <button
            onClick={handleCreateProfile}
            disabled={!newProfileName.trim() || isCreating}
            className="px-5 py-2.5 bg-accent-primary text-white font-medium rounded-lg transition-all flex items-center gap-2 hover:bg-accent-secondary hover:scale-[1.02] active:scale-[0.98] disabled:bg-bg-tertiary disabled:text-text-tertiary disabled:hover:scale-100 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            {isCreating ? 'Saving...' : 'Save Current'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Profile list */}
      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-secondary">
          <div className="w-20 h-20 mb-4 rounded-full bg-bg-tertiary flex items-center justify-center">
            <Layers className="w-10 h-10 opacity-40" />
          </div>
          <h3 className="text-lg font-medium text-text-primary mb-2">No Profiles Yet</h3>
          <p className="text-center max-w-sm">
            Create your first profile to save your current mod configuration.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {profiles.map((profile) => {
            const enabledCount = profile.mods.filter((m) => m.enabled).length;
            const isApplying = applyingId === profile.id;
            const isUpdating = updatingId === profile.id;
            const isActive = activeProfileId === profile.id;

            return (
              <div
                key={profile.id}
                className={`bg-bg-secondary border rounded-xl p-5 transition-all ${isActive
                    ? 'border-green-500/50 ring-1 ring-green-500/20'
                    : 'border-border-primary hover:border-border-secondary'
                  }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Profile info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-text-primary">
                        {profile.name}
                      </h3>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs font-medium rounded-full">
                          <Check className="w-3 h-3" />
                          Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-sm text-text-secondary">
                      <span>{profile.mods.length} mods</span>
                      <span className="text-green-400">{enabledCount} enabled</span>
                      <span className="text-text-tertiary">
                        {new Date(profile.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {!isActive && (
                      <button
                        onClick={() => handleApplyProfile(profile.id)}
                        disabled={isApplying}
                        className="px-4 py-2 bg-accent-primary text-white font-medium rounded-lg transition-all flex items-center gap-2 hover:bg-accent-secondary hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
                      >
                        {isApplying ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                        Apply
                      </button>
                    )}
                    <button
                      onClick={() => handleUpdateProfile(profile.id)}
                      disabled={isUpdating}
                      className="px-4 py-2 bg-bg-tertiary text-text-primary rounded-lg transition-all flex items-center gap-2 hover:bg-bg-primary hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                      title="Update with current configuration"
                    >
                      {isUpdating ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4" />
                      )}
                      Update
                    </button>
                    <button
                      onClick={() => handleDeleteProfile(profile.id)}
                      className="p-2 text-text-tertiary rounded-lg transition-all hover:text-red-400 hover:bg-red-500/10 hover:scale-[1.05] active:scale-[0.95]"
                      title="Delete profile"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
