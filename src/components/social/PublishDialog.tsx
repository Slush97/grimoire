import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, CheckCircle2, Globe } from 'lucide-react';
import { Button, ModalHeader } from '../common/ui';
import { Input, Textarea, FormField } from '../common/forms';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import {
  exportPortableProfile,
  socialPublish,
  type SocialPublishResponse,
} from '../../lib/api';
import type { PortableExportResult } from '../../types/portableProfile';

const TOS_STORAGE_KEY = 'grimoire-social-tos-accepted-v1';

interface PublishDialogProps {
  profileId: string;
  profileName: string;
  onClose: () => void;
  onPublished?: (result: SocialPublishResponse) => void;
}

function hasAcceptedTos(): boolean {
  try {
    return localStorage.getItem(TOS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function markTosAccepted(): void {
  try {
    localStorage.setItem(TOS_STORAGE_KEY, 'true');
  } catch {
    // Private mode or quota — best-effort; the gate just shows next time.
  }
}

export default function PublishDialog({
  profileId,
  profileName,
  onClose,
  onPublished,
}: PublishDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const [title, setTitle] = useState(profileName);
  const [description, setDescription] = useState('');
  const [exportResult, setExportResult] = useState<PortableExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [tosAccepted, setTosAccepted] = useState<boolean>(hasAcceptedTos());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [published, setPublished] = useState<SocialPublishResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    exportPortableProfile(profileId)
      .then((r) => { if (!cancelled) setExportResult(r); })
      .catch((err) => {
        if (!cancelled) setExportError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [profileId]);

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  const titleTooLong = trimmedTitle.length > 80;
  const descriptionTooLong = trimmedDescription.length > 1000;
  const noShareableMods = exportResult && exportResult.profile.mods.length === 0;
  const canSubmit =
    tosAccepted &&
    exportResult !== null &&
    !exportError &&
    !submitting &&
    trimmedTitle.length > 0 &&
    !titleTooLong &&
    !descriptionTooLong &&
    !noShareableMods;

  const handlePublish = async () => {
    if (!exportResult || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await socialPublish({
        title: trimmedTitle,
        description: trimmedDescription || undefined,
        share_code: exportResult.shareCode,
      });
      setPublished(response);
      onPublished?.(response);
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
          title={t('profiles.actions.publishToDiscover')}
          titleId={titleId}
          subtitle={profileName}
          subtitleTitle={profileName}
          onClose={onClose}
          closeLabel={t('common.actions.close')}
          closeDisabled={submitting}
        />

        <ModalBody className="space-y-4">
          {published ? (
            <div className="space-y-3">
              <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 text-sm text-green-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">{t('social.publish.published')}</div>
                  <div className="text-xs text-text-secondary mt-1">
                    {t('social.publish.liveOnDiscover')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              {exportError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{t('social.publish.couldNotBuildShareCode', { error: exportError })}</span>
                </div>
              )}

              {!exportResult && !exportError && (
                <div className="text-text-secondary text-sm inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('social.publish.buildingPortableProfile')}
                </div>
              )}

              {exportResult && exportResult.warnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-sm text-yellow-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">
                      {t('social.publish.modsWontBeShared', { count: exportResult.warnings.length })}
                    </div>
                    <div className="text-xs text-text-secondary mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                      {exportResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                    <div className="text-xs text-text-secondary mt-2">
                      {t('social.publish.localBlocked')}
                    </div>
                  </div>
                </div>
              )}

              {noShareableMods && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{t('social.publish.noGamebananaMods')}</span>
                </div>
              )}

              <div>
                <FormField
                  label={t('social.publish.title')}
                  error={titleTooLong ? t('social.publish.max80Characters') : undefined}
                >
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={80}
                    placeholder={t('social.publish.titlePlaceholder')}
                  />
                </FormField>
                <div className="text-2xs text-text-secondary mt-1 flex justify-end">
                  <span className={titleTooLong ? 'text-state-danger' : ''}>{trimmedTitle.length}/80</span>
                </div>
              </div>

              <div>
                <FormField
                  label={t('social.publish.descriptionOptional')}
                  error={descriptionTooLong ? t('social.publish.max1000Characters') : undefined}
                >
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    placeholder={t('social.publish.descriptionPlaceholder')}
                    className="resize-none"
                  />
                </FormField>
                <div className="text-2xs text-text-secondary mt-1 flex justify-end">
                  <span className={descriptionTooLong ? 'text-state-danger' : ''}>{trimmedDescription.length}/1000</span>
                </div>
              </div>

              {!tosAccepted && (
                <div className="bg-bg-tertiary border border-hl/10 rounded-md p-3 text-xs text-text-secondary space-y-2">
                  <p className="leading-relaxed">
                    {t('social.publish.tosBody')}
                  </p>
                  <label className="flex items-center gap-2 text-text-primary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tosAccepted}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setTosAccepted(next);
                        if (next) markTosAccepted();
                      }}
                      className="accent-accent"
                    />
                    <span>{t('social.publish.tosAccept')}</span>
                  </label>
                </div>
              )}

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          {published ? (
            <Button onClick={onClose}>{t('common.actions.done')}</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                {t('common.actions.cancel')}
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!canSubmit}
                isLoading={submitting}
                icon={Globe}
              >
                {t('social.publish.publish')}
              </Button>
            </>
          )}
        </ModalFooter>
    </Modal>
  );
}
