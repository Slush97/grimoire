import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FilePlus, ImagePlus } from 'lucide-react';
import { readImageDataUrl, showOpenDialog } from '../../lib/api';
import { IMAGE_EXTS } from '../../lib/customModImport';
import { Modal } from '../common/Modal';
import { Button, CheckboxMark, ModalHeader } from '../common/ui';
import { FormField, Input } from '../common/forms';

interface MakeCustomModModalProps {
  onClose: () => void;
  onSave: (args: { name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
  /** The already-installed VPK the metadata attaches to. Display only. */
  vpkPath: string;
  initialName: string;
}

/**
 * Attach custom metadata (name, thumbnail, NSFW) to a VPK that is ALREADY on
 * disk: the "make this unknown mod custom" flow. The file is fixed, so there is
 * no picker and nothing is copied. Importing fresh files from disk goes through
 * ImportCustomModsModal instead.
 */
export function MakeCustomModModal({ onClose, onSave, vpkPath, initialName }: MakeCustomModModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState<string>(initialName);
  const [imagePath, setImagePath] = useState<string>('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string>('');
  const [nsfw, setNsfw] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [imgDragActive, setImgDragActive] = useState(false);

  const acceptImagePath = async (picked: string) => {
    setImagePath(picked);
    setError(null);
    try {
      const dataUrl = await readImageDataUrl(picked);
      setThumbnailDataUrl(dataUrl);
    } catch (err) {
      setThumbnailDataUrl('');
      setError(t('installed.imageField.readFailed', { error: String(err) }));
    }
  };

  const pickImage = async () => {
    const picked = await showOpenDialog({
      title: t('installed.imageField.selectImage'),
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    });
    if (picked) await acceptImagePath(picked);
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setImgDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!IMAGE_EXTS.includes(ext)) {
      setError(t('installed.imageField.expectedImage', { exts: IMAGE_EXTS.join(', '), name: file.name }));
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError(t('installed.imageField.dropUnresolved'));
      return;
    }
    await acceptImagePath(path);
  };

  const canSubmit = !!name.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        thumbnailDataUrl: thumbnailDataUrl || undefined,
        nsfw,
      });
      onClose();
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="make-custom-mod-title"
      size="lg"
      dismissable={!submitting}
      panelClassName="flex max-h-[80vh] flex-col overflow-hidden"
    >
        <ModalHeader
          title={t('installed.import.makeCustomTitle')}
          titleId="make-custom-mod-title"
          onClose={onClose}
          closeLabel={t('common.actions.close')}
          closeDisabled={submitting}
        />

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3.5">
          <p className="text-xs leading-5 text-text-secondary">
            {t('installed.import.alreadyInstalledHint')}
          </p>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              {t('installed.import.vpkFile')}
            </label>
            <div className="flex flex-col items-center gap-1 rounded-lg border border-border bg-bg-tertiary/40 px-4 py-3 text-center">
              <FilePlus className="w-5 h-5 text-accent" aria-hidden />
              <span className="text-sm text-text-primary font-medium truncate max-w-full">
                {vpkPath.split(/[\\/]/).pop()}
              </span>
              <span className="text-xs text-text-secondary font-mono truncate max-w-full">{vpkPath}</span>
            </div>
          </div>

          <FormField label={t('installed.import.modName')} required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('installed.import.modNamePlaceholder')}
            />
          </FormField>

          <div>
            <label className="block text-sm font-medium text-text-primary mb-1.5">
              {t('installed.import.thumbnailImage')} <span className="text-text-secondary font-normal">{t('locker.soulImport.fields.notesOptional')}</span>
            </label>
            <div
              role="button"
              tabIndex={0}
              aria-label={imagePath ? t('installed.import.thumbnailSelected', { path: imagePath }) : t('installed.imageField.ariaBrowse')}
              onClick={pickImage}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void pickImage();
                }
              }}
              onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(true); }}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setImgDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(false); }}
              onDrop={handleImageDrop}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
                imgDragActive
                  ? 'border-accent bg-accent/10'
                  : thumbnailDataUrl
                    ? 'border-accent/40 bg-bg-tertiary/60 hover:bg-bg-tertiary'
                    : 'border-border bg-bg-tertiary/40 hover:bg-bg-tertiary hover:border-hl/20'
              }`}
            >
              <div className="w-24 aspect-video bg-bg-tertiary rounded-md overflow-hidden flex items-center justify-center text-text-secondary flex-shrink-0">
                {thumbnailDataUrl ? (
                  <img src={thumbnailDataUrl} alt={t('installed.imageField.thumbnailPreview')} className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="w-5 h-5" aria-hidden />
                )}
              </div>
              <div className="flex-1 min-w-0">
                {imagePath ? (
                  <>
                    <div className="text-sm text-text-primary font-medium truncate">{imagePath.split(/[\\/]/).pop()}</div>
                    <div className="text-xs text-text-secondary font-mono truncate">{imagePath}</div>
                    <div className="text-xs text-accent mt-0.5">{t('installed.imageField.clickToReplaceAnother')}</div>
                  </>
                ) : (
                  <>
                    <div className="text-sm text-text-primary font-medium">{t('installed.imageField.dropImageHere')}</div>
                    <div className="text-xs text-text-secondary">{t('installed.imageField.orClickToBrowse', { exts: IMAGE_EXTS.join(', ') })}</div>
                  </>
                )}
              </div>
            </div>
          </div>

          <label className="group flex items-center gap-2 text-sm font-medium text-text-primary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={nsfw}
              onChange={(e) => setNsfw(e.target.checked)}
              className="peer sr-only"
            />
            <CheckboxMark checked={nsfw} />
            {t('locker.soulImport.fields.nsfw')}
          </label>

          {error && (
            <div className="text-sm text-state-danger bg-red-500/10 border border-red-500/30 rounded-lg p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-center border-t border-border px-5 py-3">
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
            isLoading={submitting}
            className="!px-10 !py-1.5"
          >
            {t('installed.import.saveCustom')}
          </Button>
        </div>
    </Modal>
  );
}
