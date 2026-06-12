import { useEffect, useState } from 'react';
import { X, AlertTriangle, Loader2, CheckCircle2, Globe } from 'lucide-react';
import { Button } from '../common/ui';
import { Modal } from '../common/Modal';
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
      labelledBy="publish-profile-title"
      size="md"
      dismissable={!submitting}
      panelClassName="flex flex-col overflow-hidden"
    >
        <div className="flex items-start justify-between p-6 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="publish-profile-title" className="text-xl font-bold text-text-primary flex items-center gap-2">
              <Globe className="w-5 h-5 text-accent" />
              Publish to Discover
            </h2>
            <p className="text-sm text-text-secondary mt-1 truncate" title={profileName}>
              {profileName}
            </p>
          </div>
          <button
            onClick={() => { if (!submitting) onClose(); }}
            disabled={submitting}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {published ? (
            <div className="space-y-3">
              <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 text-sm text-green-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-medium">Published.</div>
                  <div className="text-xs text-text-secondary mt-1">
                    Your profile is live on Discover.
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              {exportError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Could not build share code: {exportError}</span>
                </div>
              )}

              {!exportResult && !exportError && (
                <div className="text-text-secondary text-sm inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Building portable profile...
                </div>
              )}

              {exportResult && exportResult.warnings.length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 text-sm text-yellow-200 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">
                      {exportResult.warnings.length} mod{exportResult.warnings.length === 1 ? '' : 's'} won't be shared
                    </div>
                    <div className="text-xs text-text-secondary mt-1 space-y-0.5 max-h-20 overflow-y-auto">
                      {exportResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                    </div>
                    <div className="text-xs text-text-secondary mt-2">
                      Locally-imported mods (not from GameBanana) can't be published.
                    </div>
                  </div>
                </div>
              )}

              {noShareableMods && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>This profile has no GameBanana-backed mods to share.</span>
                </div>
              )}

              <div>
                <label htmlFor="publish-title" className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                  Title
                </label>
                <input
                  id="publish-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Short, memorable title"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-white/5 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="text-[11px] text-text-secondary mt-1 flex justify-between">
                  <span>{titleTooLong ? 'Max 80 characters' : ' '}</span>
                  <span className={titleTooLong ? 'text-red-400' : ''}>{trimmedTitle.length}/80</span>
                </div>
              </div>

              <div>
                <label htmlFor="publish-description" className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  id="publish-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="What's the vibe? Who's it for?"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-white/5 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
                <div className="text-[11px] text-text-secondary mt-1 flex justify-between">
                  <span>{descriptionTooLong ? 'Max 1000 characters' : ' '}</span>
                  <span className={descriptionTooLong ? 'text-red-400' : ''}>{trimmedDescription.length}/1000</span>
                </div>
              </div>

              {!tosAccepted && (
                <div className="bg-bg-tertiary border border-white/10 rounded-md p-3 text-xs text-text-secondary space-y-2">
                  <p className="leading-relaxed">
                    Publishing makes this profile's title, description, and the list of GameBanana mods it
                    references public on Discover. By continuing, you confirm the referenced mods comply
                    with GameBanana's terms, you grant Grimoire permission to host this metadata, and you
                    accept that profiles may be removed for community-guideline violations.
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
                    <span>I understand and want to publish.</span>
                  </label>
                </div>
              )}

              {submitError && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-red-400 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={onClose} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  onClick={handlePublish}
                  disabled={!canSubmit}
                  isLoading={submitting}
                  icon={Globe}
                >
                  Publish
                </Button>
              </div>
            </>
          )}
        </div>
    </Modal>
  );
}
