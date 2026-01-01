import { useEffect, useState } from 'react';
import { Layers, Plus, Trash2, Play, Save, RefreshCw, AlertTriangle, User } from 'lucide-react';
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
import { Card, Badge, Button } from '../components/common/ui';

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
        <RefreshCw className="w-8 h-8 animate-spin mb-4 text-accent" />
        <p>Loading profiles...</p>
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-accent/10 rounded-xl">
            <Layers className="w-8 h-8 text-accent" />
          </div>
          <div>
            <h1 className="text-3xl font-bold font-reaver tracking-wide">Profiles</h1>
            <p className="text-text-secondary">Save and restore your mod configurations</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 flex-1 overflow-auto pr-2 custom-scrollbar">
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <p>{error}</p>
          </div>
        )}

        {/* Create New Profile */}
        <Card title="Create New Profile" icon={Plus}>
          <div className="flex gap-3">
            <input
              type="text"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateProfile()}
              placeholder="Enter profile name (e.g. Competitive, Casual, Testing)..."
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-6">
          {profiles.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-text-secondary border border-dashed border-white/10 rounded-xl bg-bg-secondary/30">
              <div className="w-20 h-20 mb-4 rounded-full bg-bg-tertiary flex items-center justify-center">
                <User className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-lg font-medium text-text-primary mb-2">No Profiles Yet</h3>
              <p className="text-center max-w-sm">
                Create your first profile above to save your current mod configuration.
              </p>
            </div>
          ) : (
            profiles.map((profile) => {
              const enabledCount = profile.mods.filter((m) => m.enabled).length;
              const isApplying = applyingId === profile.id;
              const isUpdating = updatingId === profile.id;
              const isActive = activeProfileId === profile.id;

              return (
                <Card
                  key={profile.id}
                  title={profile.name}
                  icon={Layers}
                  className={`transition-all duration-300 ${isActive ? 'ring-1 ring-accent border-accent/50 shadow-[0_0_20px_rgba(249,115,22,0.1)]' : 'hover:border-white/10'}`}
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
                    <div className="flex items-center gap-4 text-sm text-text-secondary bg-black/20 p-3 rounded-lg border border-white/5">
                      <div className="flex flex-col items-center px-4 border-r border-white/5">
                        <span className="text-2xl font-bold text-text-primary mb-1">{profile.mods.length}</span>
                        <span className="text-xs uppercase tracking-wider opacity-70">Mods</span>
                      </div>
                      <div className="flex flex-col items-center px-4 border-r border-white/5">
                        <span className="text-2xl font-bold text-green-400 mb-1">{enabledCount}</span>
                        <span className="text-xs uppercase tracking-wider opacity-70">Enabled</span>
                      </div>
                      <div className="flex-1 text-right text-xs">
                        <div className="mb-1">Last Updated</div>
                        <div className="text-text-primary font-mono">{new Date(profile.updatedAt).toLocaleDateString()}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-2">
                      {!isActive && (
                        <Button
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
                        variant="danger"
                        onClick={() => handleDeleteProfile(profile.id)}
                        disabled={isApplying || isUpdating}
                        icon={Trash2}
                        title="Delete Profile"
                      />
                    </div>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
