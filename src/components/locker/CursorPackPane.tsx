import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Search, Trash2, Upload } from 'lucide-react';
import { Button } from '../common/ui';
import { LockerCardAction, LockerCardHeader, LockerGeneralCard, LOCKER_CARD_GRID_CLASS, LOCKER_CARD_MEDIA_CLASS, LOCKER_CARD_TITLE_CLASS } from './ShuffleControls';
import { ConfirmModal } from '../common/PageComponents';
import { showOpenDialogMulti } from '../../lib/api';
import { useAppStore } from '../../stores/appStore';
import { useCursorPackStore } from '../../stores/cursorPackStore';
import { showToast } from '../../stores/toastStore';
import type { CursorPack, CursorPreview } from '../../types/electron';

// Session cache: previews are read off disk once per pack install.
const previewCache = new Map<string, CursorPreview>();

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function CursorPreviewArt({ previewKey, packId }: { previewKey: string; packId: string | null }) {
  // Rerender once the cache fills; the cache itself is the source of truth.
  const [, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    if (previewCache.has(previewKey)) return;
    let live = true;
    window.electronAPI
      .getCursorPreview(packId)
      .catch(() => ({}))
      .then((loaded) => {
        previewCache.set(previewKey, loaded);
        if (live) setLoadedKey(previewKey);
      });
    return () => {
      live = false;
    };
  }, [previewKey, packId]);

  const preview = previewCache.get(previewKey);
  if (!preview) return null;
  // Size variants (`_vsz<N>`) repeat an image the card already shows.
  const names = Object.keys(preview).filter((name) => !name.includes('_vsz'));
  const main = names.includes('cursor.bmp') ? 'cursor.bmp' : names[0];
  const extras = names.filter((name) => name !== main);

  return (
    <div className="flex h-full w-full items-center justify-center gap-5">
      {main && <img src={preview[main]} alt="" draggable={false} className="h-16 w-16 object-contain" />}
      {extras.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {extras.map((name) => (
            <img key={name} src={preview[name]} alt="" title={name} draggable={false} className="h-8 w-8 object-contain" />
          ))}
        </div>
      )}
    </div>
  );
}

interface CursorCardProps {
  name: string;
  subtitle: string;
  active: boolean;
  busy: boolean;
  previewKey: string;
  packId: string | null;
  onSelect: () => void;
  onDelete?: () => void;
}

function CursorCard({ name, subtitle, active, busy, previewKey, packId, onSelect, onDelete }: CursorCardProps) {
  const { t } = useTranslation();
  return (
    <LockerGeneralCard active={active} data-locker-cursor-card={packId ?? 'default'}>
      <div className={`${LOCKER_CARD_MEDIA_CLASS} aspect-video`}>
        <CursorPreviewArt previewKey={previewKey} packId={packId} />
        <LockerCardHeader active={active}>
          {onDelete && <LockerCardAction icon={Trash2} label={t('locker.cursors.deleteNamed', { name })}
            disabled={busy} onClick={onDelete} />}
        </LockerCardHeader>
      </div>
      <div className="mt-auto px-0.5">
        <div className={LOCKER_CARD_TITLE_CLASS}>{name}</div>
        <div className="truncate text-2xs text-text-secondary">{subtitle}</div>
      </div>
      <button type="button" aria-label={name} aria-pressed={active} disabled={busy} onClick={onSelect}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait" />
    </LockerGeneralCard>
  );
}

/**
 * The Locker's Cursor tab. Cursor mods are loose BMPs written over the game's
 * resource/cursors folder rather than VPKs, so one pack (or the stock set) is
 * active at a time and selecting a card applies it immediately.
 */
export default function CursorPackPane() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setBrowseUi = useAppStore((s) => s.setBrowseUi);
  const { packs, activeId, busy, setActive, remove } = useCursorPackStore();
  const [pendingDelete, setPendingDelete] = useState<CursorPack | null>(null);

  const select = async (pack: CursorPack | null) => {
    if ((pack?.id ?? null) === activeId) return;
    try {
      await setActive(pack?.id ?? null);
      showToast(pack ? t('locker.cursors.applied', { name: pack.name }) : t('locker.cursors.restored'), {
        tone: 'success',
      });
    } catch (err) {
      showToast(errorText(err), { tone: 'error' });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await remove(pendingDelete.id);
    } catch (err) {
      showToast(errorText(err), { tone: 'error' });
    }
    setPendingDelete(null);
  };

  const findCursors = () => {
    setBrowseUi({ section: 'Mod', categoryId: 'all', heroCategoryId: 'all', search: 'cursor', submitter: undefined });
    navigate('/browse');
  };

  return (
    <>
      <div className={LOCKER_CARD_GRID_CLASS}>
        <CursorCard
          name={t('locker.cursors.default')}
          subtitle={t('locker.cursors.defaultSubtitle')}
          active={activeId === null}
          busy={busy}
          previewKey="stock"
          packId={null}
          onSelect={() => select(null)}
        />
        {packs.map((pack) => (
          <CursorCard
            key={pack.id}
            name={pack.name}
            subtitle={t('locker.cursors.fileCount', { count: pack.files.length })}
            active={pack.id === activeId}
            busy={busy}
            previewKey={`${pack.id}:${pack.installedAt}`}
            packId={pack.id}
            onSelect={() => select(pack)}
            onDelete={() => setPendingDelete(pack)}
          />
        ))}
      </div>
      {packs.length === 0 && (
        <div className="flex max-w-md flex-col items-start gap-3">
          <p className="text-sm text-text-secondary">{t('locker.cursors.empty')}</p>
          <Button variant="secondary" size="sm" icon={Search} onClick={findCursors}>
            {t('locker.cursors.find')}
          </Button>
        </div>
      )}
      <ConfirmModal
        isOpen={pendingDelete !== null}
        title={t('locker.cursors.deleteTitle', { name: pendingDelete?.name ?? '' })}
        message={t('locker.cursors.deleteMessage')}
        confirmLabel={t('common.actions.delete')}
        variant="danger"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

/** Header action for the Cursor tab: pick an archive or loose BMPs and apply them. */
export function CursorImportButton() {
  const { t } = useTranslation();
  const { busy, importPaths } = useCursorPackStore();

  const pick = async () => {
    const paths = await showOpenDialogMulti({
      title: t('locker.cursors.importTitle'),
      filters: [{ name: t('locker.cursors.importFilter'), extensions: ['bmp', 'res', 'zip', '7z', 'rar'] }],
    });
    if (paths.length === 0) return;
    try {
      await importPaths(paths);
      showToast(t('locker.cursors.imported'), { tone: 'success' });
    } catch (err) {
      showToast(errorText(err), { tone: 'error' });
    }
  };

  return (
    <Button size="sm" icon={Upload} isLoading={busy} onClick={pick} className="ml-auto">
      {t('locker.cursors.import')}
    </Button>
  );
}
