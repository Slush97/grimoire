import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Download, Upload, X } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { FormField, Input } from '../common/forms';
import { readImageDataUrl, revealPath, showOpenDialog, showSaveDialog } from '../../lib/api';
import { encodeCursorBmp } from '../../lib/cursorBmp';
import { useCursorPackStore } from '../../stores/cursorPackStore';
import { showToast } from '../../stores/toastStore';
import type { CursorHotspot, CursorImageFile, CursorPreview } from '../../types/electron';
import CardCropper from './CardCropper';

interface Slot {
  file: string;
  width: number;
  height: number;
}

// The stock sizes. The game draws a cursor at whatever size its BMP is, so
// these only set the scale. A slot left empty keeps the game's own cursor.
const SLOTS: readonly Slot[] = [
  { file: 'cursor.bmp', width: 48, height: 58 },
  { file: 'cursor_ping.bmp', width: 48, height: 58 },
  { file: 'cursor_shop.bmp', width: 60, height: 60 },
  { file: 'cursor_commend.bmp', width: 88, height: 88 },
];

async function pngToBmp(dataUrl: string): Promise<Uint8Array> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return encodeCursorBmp(canvas.width, canvas.height, ctx.getImageData(0, 0, canvas.width, canvas.height).data);
}

/**
 * Build a cursor pack from the user's own images: one tile per cursor the game
 * ships, each framed with the cropper at that cursor's size. Creating applies it.
 */
export default function CursorCreateModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { busy, create } = useCursorPackStore();
  const [name, setName] = useState('');
  const [stock, setStock] = useState<CursorPreview>({});
  // Framed PNG data URL per cursor file name, at the slot's exact size.
  const [picks, setPicks] = useState<Record<string, { dataUrl: string; hotspot: CursorHotspot }>>({});
  const [cropping, setCropping] = useState<{ slot: Slot; sourceDataUrl: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const labels: Record<string, string> = {
    'cursor.bmp': t('locker.cursors.create.pointer'),
    'cursor_ping.bmp': t('locker.cursors.create.ping'),
    'cursor_shop.bmp': t('locker.cursors.create.shop'),
    'cursor_commend.bmp': t('locker.cursors.create.commend'),
  };

  useEffect(() => {
    let live = true;
    window.electronAPI
      .getCursorPreview(null)
      .then((preview) => {
        if (live) setStock(preview);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const pickImage = async (slot: Slot) => {
    try {
      const path = await showOpenDialog({
        title: t('locker.cursors.create.chooseImage', { cursor: labels[slot.file] }),
        filters: [{ name: t('locker.cursors.create.imageFilter'), extensions: ['png', 'webp', 'gif', 'jpg', 'jpeg'] }],
      });
      if (!path) return;
      setCropping({ slot, sourceDataUrl: await readImageDataUrl(path) });
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), { tone: 'error' });
    }
  };

  const clear = (file: string) =>
    setPicks((prev) => {
      const next = { ...prev };
      delete next[file];
      return next;
    });

  const hasPicks = Object.keys(picks).length > 0;
  const packName = name.trim() || t('locker.cursors.create.defaultName');
  const buildFiles = (): Promise<CursorImageFile[]> =>
    Promise.all(
      Object.entries(picks).map(async ([fileName, { dataUrl, hotspot }]) => ({
        fileName,
        bytes: await pngToBmp(dataUrl),
        hotspot,
      }))
    );

  const submit = async () => {
    try {
      await create(packName, await buildFiles());
      showToast(t('locker.cursors.applied', { name: packName }), { tone: 'success' });
      onClose();
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), { tone: 'error' });
    }
  };

  const exportZip = async () => {
    try {
      const destPath = await showSaveDialog({
        title: t('locker.cursors.create.exportTitle', { name: packName }),
        defaultPath: `${packName.replace(/[\\/:*?"<>|]+/g, '').trim() || 'cursor'}.zip`,
        filters: [{ name: t('locker.cursors.create.exportFilter'), extensions: ['zip'] }],
      });
      if (!destPath) return;
      setExporting(true);
      await window.electronAPI.exportCursorImages(destPath, await buildFiles());
      showToast(t('locker.cursors.create.exported', { path: destPath }), { tone: 'success' });
      void revealPath(destPath);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), { tone: 'error' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal onClose={onClose} dismissable={!busy} size="lg" labelledBy={titleId}>
      <ModalHeader
        title={t('locker.cursors.create.title')}
        titleId={titleId}
        subtitle={t('locker.cursors.create.subtitle')}
        onClose={onClose}
        closeDisabled={busy}
        closeLabel={t('common.actions.close')}
      />
      <ModalBody className="flex flex-col gap-5">
        <FormField label={t('locker.cursors.create.nameLabel')}>
          <Input
            value={name}
            maxLength={60}
            placeholder={t('locker.cursors.create.defaultName')}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <div className="grid grid-cols-4 gap-3">
          {SLOTS.map((slot) => {
            const pick = picks[slot.file];
            const art = pick?.dataUrl ?? stock[slot.file];
            return (
              <div key={slot.file} className="flex min-w-0 flex-col gap-1.5">
                <div className="relative">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => pickImage(slot)}
                    title={t('locker.cursors.create.chooseImage', { cursor: labels[slot.file] })}
                    className={`group flex aspect-square w-full cursor-pointer items-center justify-center rounded-sm border bg-bg-sunken transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed ${
                      pick ? 'border-accent' : 'border-border hover:border-hl/25'
                    }`}
                  >
                    {art && (
                      <img
                        src={art}
                        alt=""
                        draggable={false}
                        className={`h-16 w-16 object-contain ${pick ? '' : 'opacity-30'}`}
                      />
                    )}
                    {!pick && (
                      <Upload
                        className="absolute h-5 w-5 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100"
                        aria-hidden
                      />
                    )}
                  </button>
                  {pick && (
                    <IconButton
                      icon={X}
                      size="sm"
                      label={t('locker.cursors.create.clear', { cursor: labels[slot.file] })}
                      disabled={busy}
                      onClick={() => clear(slot.file)}
                      className="absolute right-1.5 top-1.5 bg-bg-secondary"
                    />
                  )}
                </div>
                <div className="truncate text-xs text-text-primary">{labels[slot.file]}</div>
                <div className="text-2xs tabular-nums text-text-secondary">
                  {slot.width} x {slot.height}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-2xs leading-snug text-text-secondary">{t('locker.cursors.create.hint')}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          {t('common.actions.cancel')}
        </Button>
        <Button
          variant="secondary"
          icon={Download}
          isLoading={exporting}
          disabled={busy || !hasPicks}
          onClick={exportZip}
        >
          {t('locker.cursors.create.export')}
        </Button>
        <Button icon={Check} isLoading={busy} disabled={exporting || !hasPicks} onClick={submit}>
          {t('locker.cursors.create.submit')}
        </Button>
      </ModalFooter>
      {cropping && (
        <CardCropper
          cursor
          imageDataUrl={cropping.sourceDataUrl}
          targetWidth={cropping.slot.width}
          targetHeight={cropping.slot.height}
          variantLabel={labels[cropping.slot.file]}
          onCancel={() => setCropping(null)}
          onCrop={(dataUrl, hotspot) => {
            setPicks((prev) => ({ ...prev, [cropping.slot.file]: { dataUrl, hotspot } }));
            setCropping(null);
          }}
        />
      )}
    </Modal>
  );
}
