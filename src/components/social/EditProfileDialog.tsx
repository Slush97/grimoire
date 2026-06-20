import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { Button } from '../common/ui';
import { Input, Textarea, FormField } from '../common/forms';
import { Modal } from '../common/Modal';
import { socialUpdateProfile, type SocialUpdateProfileResponse } from '../../lib/api';

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
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleTooLong = trimmedTitle.length > 80;
  const descriptionTooLong = trimmedDescription.length > 1000;
  const dirty =
    trimmedTitle !== initialTitle.trim() ||
    trimmedDescription !== (initialDescription ?? '').trim();
  const canSubmit =
    !submitting &&
    trimmedTitle.length > 0 &&
    !titleTooLong &&
    !descriptionTooLong &&
    dirty;

  const handleSave = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: { title?: string; description?: string | null } = {};
      if (trimmedTitle !== initialTitle.trim()) body.title = trimmedTitle;
      if (trimmedDescription !== (initialDescription ?? '').trim()) {
        body.description = trimmedDescription.length > 0 ? trimmedDescription : null;
      }
      const updated = await socialUpdateProfile(profileId, body);
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
      labelledBy="edit-profile-title"
      size="md"
      dismissable={!submitting}
      panelClassName="flex flex-col overflow-hidden"
    >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="min-w-0">
            <h2
              id="edit-profile-title"
              className="text-xl font-bold text-text-primary flex items-center gap-2"
            >
              <Pencil className="w-5 h-5 text-accent" />
              {t('social.editProfile.editYourPost')}
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              {t('social.editProfile.modListStays')}
            </p>
          </div>
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0 disabled:opacity-50"
            aria-label={t('common.actions.close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {saved ? (
            <div className="space-y-3">
              <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 text-sm text-green-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{t('social.editProfile.saved')}</div>
                  <div className="text-xs text-text-secondary mt-1">
                    {t('social.editProfile.changesLiveOnDiscover')}
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={onClose}>{t('common.actions.done')}</Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <FormField
                  label={t('social.editProfile.title')}
                  error={titleTooLong ? t('social.editProfile.max80Characters') : undefined}
                >
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    placeholder={t('social.editProfile.titlePlaceholder')}
                  />
                </FormField>
                <div className="text-[11px] text-text-secondary mt-1 flex justify-end">
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
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder={t('social.editProfile.descriptionPlaceholder')}
                    className="resize-none"
                  />
                </FormField>
                <div className="text-[11px] text-text-secondary mt-1 flex justify-end">
                  <span className={descriptionTooLong ? 'text-state-danger' : ''}>
                    {trimmedDescription.length}/1000
                  </span>
                </div>
              </div>

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
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
              </div>
            </>
          )}
        </div>
    </Modal>
  );
}
