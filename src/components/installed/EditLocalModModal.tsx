import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { ImagePlus, Pencil } from 'lucide-react';
import { readImageDataUrl, showOpenDialog } from '../../lib/api';
import type { Mod } from '../../types/mod';
import { IMAGE_EXTS } from '../../lib/customModImport';
import { useBackdropDismiss } from '../common/useBackdropDismiss';
import { Button } from '../common/ui';
import { FormField, Input } from '../common/forms';

interface EditLocalModModalProps {
  mod: Mod;
  onClose: () => void;
  onSave: (args: { name: string; thumbnailDataUrl?: string; nsfw?: boolean }) => Promise<void>;
}

export function EditLocalModModal({ mod, onClose, onSave }: EditLocalModModalProps) {
  const { t } = useTranslation();
  // Drag-selecting the name field and releasing outside the panel used to
  // close this dialog and drop the edit.
  const backdropRef = useBackdropDismiss<HTMLDivElement>(onClose);
  const [name, setName] = useState(mod.name);
  const [imagePath, setImagePath] = useState('');
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState(mod.thumbnailUrl ?? '');
  const [nsfw, setNsfw] = useState(!!mod.nsfw);
  const [imgDragActive, setImgDragActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const acceptImagePath = async (picked: string) => {
    setImagePath(picked);
    setError(null);
    try {
      const dataUrl = await readImageDataUrl(picked);
      setThumbnailDataUrl(dataUrl);
    } catch (err) {
      setThumbnailDataUrl(mod.thumbnailUrl ?? '');
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

  const onZoneKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  };

  const submit = async () => {
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        thumbnailDataUrl: thumbnailDataUrl || undefined,
        nsfw,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-primary/75 p-4 backdrop-blur-sm"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent">
            <Pencil className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-text-primary">{t('installed.edit.title')}</h3>
            <p className="mt-1 text-sm text-text-secondary">
              {t('installed.edit.description')}
            </p>
          </div>
        </div>

        <FormField className="mt-5" label={t('locker.soulImport.fields.name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') onClose();
            }}
            autoFocus
            placeholder={t('installed.edit.modNamePlaceholder')}
          />
        </FormField>
        <p className="mt-2 truncate text-xs text-text-secondary" title={mod.fileName}>
          {t('installed.edit.fileLabel', { fileName: mod.fileName })}
        </p>

        <div className="mt-5">
          <label className="block text-sm font-medium text-text-primary mb-1.5">
            {t('installed.imageField.image')}
          </label>
          <div
            role="button"
            tabIndex={0}
            aria-label={thumbnailDataUrl ? t('installed.imageField.ariaSelected') : t('installed.imageField.ariaBrowse')}
            onClick={pickImage}
            onKeyDown={(e) => onZoneKeyDown(e, pickImage)}
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setImgDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setImgDragActive(false); }}
            onDrop={handleImageDrop}
            className={`flex items-center gap-3 p-3 rounded-lg border border-dashed cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
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
              ) : thumbnailDataUrl ? (
                <>
                  <div className="text-sm text-text-primary font-medium">{t('installed.imageField.currentImage')}</div>
                  <div className="text-xs text-text-secondary">{t('installed.imageField.clickToReplace')}</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-text-primary font-medium">{t('installed.imageField.dropImageHere')}</div>
                  <div className="text-xs text-text-secondary">{t('installed.imageField.orClickToBrowse', { exts: IMAGE_EXTS.join(', ') })}</div>
                </>
              )}
            </div>
          </div>
          {thumbnailDataUrl && (
            <button
              type="button"
              onClick={() => {
                setImagePath('');
                setThumbnailDataUrl('');
              }}
              className="mt-2 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
            >
              {t('installed.imageField.removeImage')}
            </button>
          )}
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm text-text-primary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={nsfw}
            onChange={(e) => setNsfw(e.target.checked)}
            className="w-4 h-4 accent-accent cursor-pointer"
          />
          {t('installed.imageField.nsfw')}
        </label>

        {error && (
          <div className="mt-4 rounded-md border border-state-danger/35 bg-state-danger/10 px-3 py-2 text-sm text-state-danger">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={submit} isLoading={saving} disabled={!trimmed}>
            {t('common.actions.save')}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
