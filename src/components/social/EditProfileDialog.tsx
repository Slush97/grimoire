import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { Button, ModalHeader } from '../common/ui';
import { Input, Textarea, FormField, Select } from '../common/forms';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import {
  exportPortableProfile,
  getProfiles,
  socialUpdateProfile,
  socialUpdateProfileContents,
  type Profile,
  type SocialUpdateProfileRequest,
  type SocialUpdateProfileResponse,
} from '../../lib/api';
import type { PortableExportResult } from '../../types/portableProfile';

interface EditProfileDialogProps {
  profileId: string;
  initialTitle: string;
  initialDescription: string | null;
  onClose: () => void;
  onSaved?: (updated: SocialUpdateProfileResponse) => void;
}

export default function EditProfileDialog({
  profileId,
  initialTitle,
  initialDescription,
  onClose,
  onSaved,
}: EditProfileDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [localProfileId, setLocalProfileId] = useState('');
  const [exportResult, setExportResult] = useState<PortableExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getProfiles().then(
      (result) => { if (!cancelled) setProfiles(result); },
      (err) => { if (!cancelled) setProfilesError(String(err)); }
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!localProfileId) return;
    let cancelled = false;
    exportPortableProfile(localProfileId).then(
      (result) => { if (!cancelled) setExportResult(result); },
      (err) => { if (!cancelled) setExportError(String(err)); }
    );
    return () => { cancelled = true; };
  }, [localProfileId]);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleTooLong = trimmedTitle.length > 80;
  const descriptionTooLong = trimmedDescription.length > 1000;
  const dirty =
    localProfileId !== '' ||
    trimmedTitle !== initialTitle.trim() ||
    trimmedDescription !== (initialDescription ?? '').trim();
  const canSubmit =
    !submitting &&
    trimmedTitle.length > 0 &&
    !titleTooLong &&
    !descriptionTooLong &&
    (!localProfileId || (exportResult !== null && exportResult.profile.mods.length > 0 && !exportError)) &&
    dirty;

  const handleSave = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: SocialUpdateProfileRequest = {};
      if (trimmedTitle !== initialTitle.trim()) body.title = trimmedTitle;
      if (trimmedDescription !== (initialDescription ?? '').trim()) {
        body.description = trimmedDescription.length > 0 ? trimmedDescription : null;
      }
      const updated = localProfileId && exportResult
        ? await socialUpdateProfileContents(profileId, { ...body, share_code: exportResult.shareCode })
        : await socialUpdateProfile(profileId, body);
      setSaved(true);
      onSaved?.(updated);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      size="md"
      dismissable={!submitting}
    >
        <ModalHeader
          title={t('social.editProfile.editYourPost')}
          titleId={titleId}
          subtitle={t('social.editProfile.keepsLikesAndLink')}
          onClose={onClose}
          closeLabel={t('common.actions.close')}
          closeDisabled={submitting}
        />

        <ModalBody className="space-y-4">
          {saved ? (
            <div className="space-y-3">
              <div className="bg-state-success/10 border border-state-success/30 rounded-sm p-3 text-sm text-state-success flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{t('social.editProfile.saved')}</div>
                  <div className="text-xs text-text-secondary mt-1">
                    {t('social.editProfile.changesLiveOnDiscover')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <FormField label={t('social.editProfile.replaceModList')} error={profilesError ?? undefined}>
                  <Select
                    value={localProfileId}
                    disabled={!profiles || submitting}
                    onChange={(event) => {
                      setExportResult(null);
                      setExportError(null);
                      setSubmitError(null);
                      setLocalProfileId(event.target.value);
                    }}
                  >
                    <option value="">{t('social.editProfile.keepPublishedMods')}</option>
                    {profiles?.map((profile) => (
                      <option key={profile.id} value={profile.id} disabled={profile.mods.length === 0}>
                        {profile.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                {!profiles && !profilesError && (
                  <p className="text-xs text-text-secondary">{t('social.picker.loadingYourProfiles')}</p>
                )}
                {localProfileId && (
                  <div className="rounded-sm border border-border bg-bg-sunken p-3 space-y-2" aria-live="polite">
                    {!exportResult && !exportError && (
                      <p className="inline-flex items-center gap-2 text-sm text-text-secondary">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('social.publish.buildingPortableProfile')}
                      </p>
                    )}
                    {exportError && <p role="alert" className="text-sm text-state-danger">{exportError}</p>}
                    {exportResult && (
                      <>
                        <p className="text-sm font-medium text-text-primary">
                          {t('social.editProfile.replacementCount', { count: exportResult.profile.mods.length })}
                        </p>
                        {exportResult.profile.mods.length === 0 ? (
                          <p role="alert" className="text-sm text-state-danger">{t('social.publish.noGamebananaMods')}</p>
                        ) : (
                          <ul className="max-h-24 overflow-y-auto text-xs text-text-secondary space-y-1">
                            {exportResult.profile.mods.map((mod, index) => (
                              <li key={index}>{mod.hint?.name ?? t('social.editProfile.unnamedMod', { index: index + 1 })}</li>
                            ))}
                          </ul>
                        )}
                        {exportResult.warnings.length > 0 && (
                          <div className="text-xs text-state-warning space-y-1">
                            <p>{t('social.publish.modsWontBeShared', { count: exportResult.warnings.length })}</p>
                            <ul className="max-h-20 overflow-y-auto">
                              {exportResult.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div>
                <FormField
                  label={t('social.editProfile.title')}
                  error={titleTooLong ? t('social.editProfile.max80Characters') : undefined}
                >
                  <Input
                    disabled={submitting}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    placeholder={t('social.editProfile.titlePlaceholder')}
                  />
                </FormField>
                <div className="text-2xs text-text-secondary mt-1 flex justify-end">
                  <span className={titleTooLong ? 'text-state-danger' : ''}>
                    {trimmedTitle.length}/80
                  </span>
                </div>
              </div>

              <div>
                <FormField
                  label={t('social.editProfile.descriptionOptional')}
                  error={descriptionTooLong ? t('social.editProfile.max1000Characters') : undefined}
                >
                  <Textarea
                    disabled={submitting}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder={t('social.editProfile.descriptionPlaceholder')}
                    className="resize-none"
                  />
                </FormField>
                <div className="text-2xs text-text-secondary mt-1 flex justify-end">
                  <span className={descriptionTooLong ? 'text-state-danger' : ''}>
                    {trimmedDescription.length}/1000
                  </span>
                </div>
              </div>

              {submitError && (
                <div role="alert" className="bg-state-danger/10 border border-state-danger/30 rounded-sm p-3 text-sm text-state-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {saved ? (
            <Button onClick={onClose}>{t('common.actions.done')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                {t('common.actions.cancel')}
              </Button>
              <Button
                onClick={handleSave}
                disabled={!canSubmit}
                isLoading={submitting}
                icon={Pencil}
              >
                {t('social.editProfile.saveChanges')}
              </Button>
            </>
          )}
        </ModalFooter>
    </Modal>
  );
}
