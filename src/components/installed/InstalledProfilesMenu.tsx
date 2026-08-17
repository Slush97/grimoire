/**
 * Compact profiles control for the Installed page's enabled-section header.
 *
 * The Profiles page is the full surface (rename, crosshair, snapshots, export,
 * publish). This is deliberately the thin slice you want while you are looking
 * at your mod list: apply a saved setup, save the current one, delete one you
 * no longer want. Everything else is a click away via "Manage profiles".
 *
 * The component owns all of its own state on purpose. Installed.tsx is a very
 * large page whose card grid is memoized, so adding page-level state here would
 * re-render the whole list on every menu open. It gains exactly one import, one
 * stable callback, and one JSX line.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, Layers, Plus, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from '../common/menu';
import { Modal } from '../common/Modal';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { Input } from '../common/forms';
import { ConfirmModal } from '../common/PageComponents';
import { showToast } from '../../stores/toastStore';
import { useCrosshairStore } from '../../stores/crosshairStore';
import {
  applyProfile,
  createProfile,
  deleteProfile,
  getProfiles,
  getSettings,
  updateProfile,
} from '../../lib/api';
import type { Profile } from '../../lib/api';

interface InstalledProfilesMenuProps {
  /**
   * Called after any op that changed what is installed or which profile is
   * active. The page reloads mods (forced) and settings from here: there is no
   * event or subscription that would tell it a profile was applied.
   */
  onApplied: () => void;
  className?: string;
}

export function InstalledProfilesMenu({ onApplied, className = '' }: InstalledProfilesMenuProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const loadSettingsFromPreset = useCrosshairStore((s) => s.loadSettingsFromPreset);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  // Last-applied marker written by the main process. It is NOT live truth: the
  // user can enable or disable mods afterwards and the marker stays put. So it
  // is only ever shown as a name, never as a claim that the install matches.
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(true);

  const [open, setOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [updateConfirmOpen, setUpdateConfirmOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Synchronous re-entry guard: the main process serializes applies, but two
  // clicks landing in the same tick would both read a stale `applyingId` of
  // null and queue two applies. A ref cannot be stale that way.
  const applyInFlightRef = useRef(false);
  // Same shape for update and delete: their state flags render the busy UI,
  // but only a ref is immune to two clicks landing in the same tick.
  const updateInFlightRef = useRef(false);
  const deleteInFlightRef = useRef(false);

  // IPC errors arrive as Error objects whose String() form leads with
  // "Error: "; strip that so toasts read as a sentence, not a stack line.
  const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

  // Deleting a profile does not clear settings.activeProfileId, so the marker
  // can point at a profile that no longer exists. Resolve it by lookup and let
  // it come back null, which falls the trigger back to the generic label.
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? null;

  const refresh = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([getProfiles(), getSettings()]);
      setProfiles(list);
      setActiveProfileId(settings.activeProfileId || null);
      setConfirmUpdate(settings.confirmProfileUpdate ?? true);
    } catch (err) {
      // A failed list read leaves the previous list rendered rather than
      // blanking the control: this is a convenience surface, not the page of
      // record for profiles.
      console.warn('[InstalledProfilesMenu] failed to load profiles:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Re-read on open: profiles can be created, renamed, or deleted on the
    // Profiles page while this component stays mounted.
    if (next) void refresh();
  };

  const handleApply = async (profileId: string) => {
    if (applyInFlightRef.current) return;
    applyInFlightRef.current = true;
    setApplyingId(profileId);
    setOpen(false);
    try {
      const { profile, failures } = await applyProfile(profileId);

      if (profile.crosshair) {
        // We cast to any to satisfy the Preset type since loadSettingsFromPreset only uses the .settings property
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        loadSettingsFromPreset({ settings: profile.crosshair } as any);
      }

      setActiveProfileId(profileId);
      onApplied();
      await refresh();

      // The apply is best-effort: per-mod toggles that could not complete
      // (typically a VPK locked by the running game) come back counted, not
      // thrown, so the partial case gets its own warning instead of a success.
      if (failures.length > 0) {
        showToast(t('profiles.errors.applyPartial', { count: failures.length }), { tone: 'warning' });
      } else {
        showToast(t('installed.profiles.appliedToast', { name: profile.name }), { tone: 'success' });
      }
    } catch (err) {
      // api.applyProfile already toasts the game-running case and rethrows, so
      // this must not add a second toast for it beyond the generic failure.
      showToast(t('installed.profiles.applyFailed', { error: errText(err) }), { tone: 'error' });
    } finally {
      applyInFlightRef.current = false;
      setApplyingId(null);
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const name = saveName.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      // No crosshair: baking one in is a Profiles-page decision, and silently
      // attaching the editor's current crosshair here would surprise people.
      const created = await createProfile(name);
      setSaveOpen(false);
      setSaveName('');
      setActiveProfileId(created.id);
      await refresh();
      // Creating also sets the active profile in main, so the page needs to
      // pick the new settings up.
      onApplied();
      showToast(t('installed.profiles.savedToast', { name: created.name }), { tone: 'success' });
    } catch (err) {
      showToast(t('installed.profiles.saveFailed', { error: errText(err) }), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!activeProfile || updateInFlightRef.current) return;
    updateInFlightRef.current = true;
    setUpdating(true);
    try {
      // Pass the profile's existing crosshair straight back through. Update
      // overwrites the saved mod list only: it must not re-bake the editor's
      // current crosshair, which would undo a Remove done on the Profiles page.
      await updateProfile(activeProfile.id, activeProfile.crosshair);
      await refresh();
      showToast(t('installed.profiles.updatedToast', { name: activeProfile.name }), { tone: 'success' });
    } catch (err) {
      showToast(t('installed.profiles.saveFailed', { error: errText(err) }), { tone: 'error' });
    } finally {
      updateInFlightRef.current = false;
      setUpdating(false);
    }
  };

  const handleDelete = async (profileId: string) => {
    if (deleteInFlightRef.current) return;
    deleteInFlightRef.current = true;
    const doomed = profiles.find((p) => p.id === profileId);
    setDeletingId(profileId);
    try {
      await deleteProfile(profileId);
      // Main leaves settings.activeProfileId pointing at the deleted profile,
      // and refresh() re-reads that stale marker. The activeProfile lookup
      // already resolves it to null, so the trigger falls back to the generic
      // label without any local clearing.
      await refresh();
      showToast(t('installed.profiles.deletedToast', { name: doomed?.name ?? '' }), { tone: 'success' });
    } catch (err) {
      showToast(t('installed.profiles.deleteFailed', { error: errText(err) }), { tone: 'error' });
    } finally {
      deleteInFlightRef.current = false;
      setDeletingId(null);
      setDeleteConfirmId(null);
    }
  };

  const deleteTarget = profiles.find((p) => p.id === deleteConfirmId) ?? null;
  const triggerLabel = activeProfile?.name ?? t('installed.profiles.trigger');

  return (
    <>
      <MenuRoot kind="dropdown" open={open} onOpenChange={handleOpenChange}>
        <MenuTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            icon={Layers}
            isLoading={!!applyingId || updating || deletingId !== null}
            title={activeProfile ? activeProfile.name : t('installed.profiles.triggerHint')}
            className={`flex-shrink-0 ${className}`}
          >
            <span className="max-w-[10rem] truncate">
              {applyingId ? t('installed.profiles.applying') : triggerLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </Button>
        </MenuTrigger>

        {/* Cap the height: someone with a long list of profiles would otherwise
            get a menu taller than the window. */}
        <MenuContent className="max-h-[60vh] overflow-y-auto">
          <MenuLabel>{t('installed.profiles.applyLabel')}</MenuLabel>
          {profiles.length === 0 ? (
            <MenuItem disabled onSelect={() => {}}>
              {t('installed.profiles.none')}
            </MenuItem>
          ) : (
            profiles.map((profile) => (
              <MenuItem key={profile.id} onSelect={() => void handleApply(profile.id)}>
                {/* Fixed-width indicator slot so unticked rows line up with the
                    ticked one, same rhythm as MenuCheckboxItem. */}
                <span
                  className="flex min-w-0 items-center gap-2"
                  aria-current={profile.id === activeProfileId ? 'true' : undefined}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {profile.id === activeProfileId && <Check className="h-3.5 w-3.5 text-accent" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                </span>
              </MenuItem>
            ))
          )}

          <MenuSeparator />

          {activeProfile && (
            <MenuItem
              icon={Save}
              onSelect={() => {
                if (confirmUpdate) setUpdateConfirmOpen(true);
                else void handleUpdate();
              }}
            >
              {t('installed.profiles.update', { name: activeProfile.name })}
            </MenuItem>
          )}
          <MenuItem
            icon={Plus}
            onSelect={() => {
              setSaveName('');
              setSaveOpen(true);
            }}
          >
            {t('installed.profiles.saveAs')}
          </MenuItem>

          <MenuSeparator />

          {profiles.length > 0 && (
            <MenuItem tone="danger" icon={Trash2} onSelect={() => setDeletePickerOpen(true)}>
              {t('installed.profiles.deletePicker')}
            </MenuItem>
          )}
          <MenuItem icon={ArrowRight} onSelect={() => navigate('/profiles')}>
            {t('installed.profiles.manage')}
          </MenuItem>
        </MenuContent>
      </MenuRoot>

      {/* Every dialog below is a SIBLING of the menu, never a child: a child
          would unmount with the closing menu the moment its item was picked. */}
      {saveOpen && (
        <Modal
          onClose={() => setSaveOpen(false)}
          labelledBy="installed-save-profile-title"
          size="sm"
          dismissable={!saving}
        >
          <form onSubmit={handleCreate}>
            <ModalHeader
              titleId="installed-save-profile-title"
              title={t('installed.profiles.saveTitle')}
              onClose={() => setSaveOpen(false)}
              closeLabel={t('common.actions.close')}
              closeDisabled={saving}
            />
            <div className="p-5">
              <Input
                autoFocus
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                placeholder={t('installed.profiles.savePlaceholder')}
                aria-label={t('installed.profiles.saveTitle')}
                maxLength={80}
                disabled={saving}
              />
              {/* The page's search and filters narrow what you see, not what a
                  save captures. Say so, or a filtered view reads as a subset. */}
              <p className="mt-2 text-xs text-text-secondary">{t('installed.profiles.saveHint')}</p>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)} disabled={saving}>
                {t('common.actions.cancel')}
              </Button>
              <Button type="submit" disabled={!saveName.trim()} isLoading={saving}>
                {t('common.actions.save')}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {deletePickerOpen && (
        <Modal
          onClose={() => setDeletePickerOpen(false)}
          labelledBy="installed-delete-profile-title"
          size="sm"
          // Blocked while a per-row confirmation is armed or a delete is in
          // flight, so Escape answers the confirmation instead of yanking the
          // list out from under it.
          dismissable={deleteConfirmId === null && deletingId === null}
          panelClassName="flex max-h-[min(600px,calc(100vh-2rem))] flex-col overflow-hidden"
        >
          <ModalHeader
            titleId="installed-delete-profile-title"
            title={t('installed.profiles.deleteTitle')}
            onClose={() => setDeletePickerOpen(false)}
            closeLabel={t('common.actions.close')}
            closeDisabled={deleteConfirmId !== null || deletingId !== null}
          />
          <div className="min-h-0 overflow-y-auto p-5">
            {profiles.length === 0 ? (
              <p className="text-sm text-text-secondary">{t('installed.profiles.none')}</p>
            ) : (
              <ul className="space-y-2">
                {profiles.map((profile) => (
                  <li
                    key={profile.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary/40 p-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary" title={profile.name}>
                      {profile.name}
                    </span>
                    <IconButton
                      size="sm"
                      tone="danger"
                      icon={Trash2}
                      label={t('profiles.actions.deleteProfile')}
                      disabled={deletingId !== null}
                      onClick={() => setDeleteConfirmId(profile.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      <ConfirmModal
        isOpen={deleteConfirmId !== null}
        onCancel={() => setDeleteConfirmId(null)}
        onConfirm={() => {
          if (deleteConfirmId) void handleDelete(deleteConfirmId);
        }}
        title={t('installed.profiles.deleteTitle')}
        message={t('installed.profiles.deleteMessage', {
          name: deleteTarget?.name ?? t('profiles.thisProfile'),
        })}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
      />

      {/* Update overwrites the saved mod list, so it is gated on the same
          preference the Profiles page honors (Settings -> Preferences). */}
      <ConfirmModal
        isOpen={updateConfirmOpen}
        onCancel={() => setUpdateConfirmOpen(false)}
        onConfirm={() => {
          setUpdateConfirmOpen(false);
          void handleUpdate();
        }}
        title={t('profiles.confirm.updateTitle')}
        message={t('profiles.confirm.updateMessage', {
          name: activeProfile?.name ?? t('profiles.thisProfile'),
        })}
        confirmLabel={t('profiles.actions.update')}
      />
    </>
  );
}
