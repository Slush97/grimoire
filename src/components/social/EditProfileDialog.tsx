import { useState } from 'react';
import { X, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react';
import { Button } from '../common/ui';
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
              Edit your post
            </h2>
            <p className="text-sm text-text-secondary mt-1">
              Update the title or description. The mod list stays as published.
            </p>
          </div>
          <button
            onClick={() => {
              if (!submitting) onClose();
            }}
            disabled={submitting}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0 disabled:opacity-50"
            aria-label="Close"
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
                  <div className="font-medium">Saved.</div>
                  <div className="text-xs text-text-secondary mt-1">
                    Your changes are live on Discover.
                  </div>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label
                  htmlFor="edit-profile-title-input"
                  className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-1.5"
                >
                  Title
                </label>
                <input
                  id="edit-profile-title-input"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="Short, memorable title"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-white/5 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <div className="text-[11px] text-text-secondary mt-1 flex justify-between">
                  <span>{titleTooLong ? 'Max 80 characters' : ' '}</span>
                  <span className={titleTooLong ? 'text-red-400' : ''}>
                    {trimmedTitle.length}/80
                  </span>
                </div>
              </div>

              <div>
                <label
                  htmlFor="edit-profile-description"
                  className="block text-xs font-medium text-text-secondary uppercase tracking-wider mb-1.5"
                >
                  Description (optional)
                </label>
                <textarea
                  id="edit-profile-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={1000}
                  rows={4}
                  placeholder="What's the vibe? Who's it for?"
                  className="w-full px-3 py-2 bg-bg-tertiary border border-white/5 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
                <div className="text-[11px] text-text-secondary mt-1 flex justify-between">
                  <span>{descriptionTooLong ? 'Max 1000 characters' : ' '}</span>
                  <span className={descriptionTooLong ? 'text-red-400' : ''}>
                    {trimmedDescription.length}/1000
                  </span>
                </div>
              </div>

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
                  onClick={handleSave}
                  disabled={!canSubmit}
                  isLoading={submitting}
                  icon={Pencil}
                >
                  Save changes
                </Button>
              </div>
            </>
          )}
        </div>
    </Modal>
  );
}
