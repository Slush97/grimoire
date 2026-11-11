import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Pencil, StickyNote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HIDDEN_NOTE_MAX_LENGTH, type HiddenCreator, type HiddenMod } from '../types/mod';
import type { HiddenContentPreviews, HiddenPreviewMod } from '../types/electron';
import { hiddenEntryKey, withHiddenNote } from '../lib/hiddenContent';
import { formatDateParts } from '../lib/dateFormat';
import { shouldBlurNsfw } from '../lib/appSettings';
import { useAppStore } from '../stores/appStore';
import { useRequirementsStore } from '../stores/requirementsStore';
import ModThumbnail from './ModThumbnail';
import { Modal, ModalBody } from './common/Modal';
import { Input } from './common/forms';
import { Button, IconButton, ModalHeader } from './common/ui';

interface HiddenEntry {
  id: number;
  name: string;
  /** Hidden mods only: ids repeat across GameBanana sections. */
  section?: string;
  hiddenAt?: number;
  note?: string;
}

const NO_PREVIEWS: HiddenContentPreviews = { creators: {}, mods: {} };

/** What the local catalog holds for the listed creators and mods. Nothing is
 *  fetched: an entry the catalog lacks keeps its letter tile. */
function useHiddenPreviews(creators: readonly HiddenCreator[], mods: readonly HiddenMod[]): HiddenContentPreviews {
  const [previews, setPreviews] = useState(NO_PREVIEWS);
  const stamp = `${creators.map((creator) => creator.id).join(',')}|${mods.map(hiddenEntryKey).join(',')}`;
  useEffect(() => {
    let current = true;
    const [creatorPart, modPart] = stamp.split('|');
    const creatorIds = creatorPart ? creatorPart.split(',').map(Number) : [];
    const modRefs = modPart ? modPart.split(',').map((key) => {
      const [section, id] = key.split(':');
      return { id: Number(id), section };
    }) : [];
    if (!creatorIds.length && !modRefs.length) return;
    window.electronAPI.getHiddenContentPreviews(creatorIds, modRefs)
      .then((result) => { if (current) setPreviews(result); })
      // The previews are a reminder, not data: the list works without them.
      .catch(() => undefined);
    return () => { current = false; };
  }, [stamp]);
  return previews;
}

/**
 * One catalog thumbnail. It stays blurred until the pointer or focus is on its
 * row: these are things the user chose not to see, so the list only shows them
 * on request. An NSFW thumbnail keeps the NSFW setting's own cover on top.
 */
function PeekThumbnail({ mod, className = '' }: { mod: HiddenPreviewMod; className?: string }) {
  const { t } = useTranslation();
  const hideNsfw = useAppStore((state) => shouldBlurNsfw(state.settings));
  return (
    <button
      type="button"
      aria-label={t('hiddenContent.openMod', { name: mod.name })}
      title={mod.name}
      onClick={() => useRequirementsStore.getState().openTarget({ id: mod.id, section: mod.section })}
      className={`h-10 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-sm border border-border bg-bg-sunken focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className}`}
    >
      <ModThumbnail
        src={mod.thumbnailUrl ?? undefined}
        alt=""
        nsfw={mod.isNsfw}
        hideNsfw={hideNsfw}
        width={64}
        enableImageContextMenu={false}
        className="h-full w-full"
        imageClassName="scale-110 blur-sm transition-[filter,transform] duration-150 group-focus-within/hidden:scale-100 group-focus-within/hidden:blur-none group-hover/hidden:scale-100 group-hover/hidden:blur-none"
        fallback={<LetterTile name={mod.name} />}
      />
    </button>
  );
}

function LetterTile({ name, round = false }: { name: string; round?: boolean }) {
  return (
    <div className={`flex flex-shrink-0 items-center justify-center border border-accent/25 bg-accent/10 font-semibold uppercase text-accent ${round ? 'h-9 w-9 rounded-full' : 'h-full w-full'}`}>
      {name.charAt(0)}
    </div>
  );
}

interface HiddenListCopy<T> {
  emptyTitle: string;
  emptyDescription: string;
  idLine: (id: number) => string;
  showLabel: string;
  /** What Grimoire can say about the entry on its own, most useful first. */
  facts: (entry: T) => string[];
}

interface HiddenListProps<T extends HiddenEntry> {
  entries: T[];
  onRemove: (entry: T) => void | Promise<void>;
  onNote: (entry: T, note: string) => void | Promise<void>;
  preview: (entry: T) => ReactNode;
  copy: HiddenListCopy<T>;
  className?: string;
}

/** Shared hidden creator/mod list used by both Settings and Browse's management
 *  dialogs. Keeping removal and notes in one component prevents the entry points
 *  from drifting in behavior or accessibility. */
function HiddenList<T extends HiddenEntry>({ entries, onRemove, onNote, preview, copy, className = '' }: HiddenListProps<T>) {
  const { t } = useTranslation();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  // The note just entered, shown until settings hold it. Saving goes through the
  // main process, and without this the row shows its old line for a frame first.
  const [saving, setSaving] = useState<{ key: string; note: string } | null>(null);
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    [entries]
  );

  if (sortedEntries.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-5 py-8 text-center ${className}`}>
        <EyeOff className="mb-3 h-8 w-8 text-text-tertiary" aria-hidden />
        <p className="text-sm font-medium text-text-primary">{copy.emptyTitle}</p>
        <p className="mt-1 max-w-sm text-xs text-text-secondary">{copy.emptyDescription}</p>
      </div>
    );
  }

  return (
    <div className={`@container space-y-2 ${className}`}>
      {sortedEntries.map((entry) => {
        const key = hiddenEntryKey(entry);
        const facts = [...copy.facts(entry), copy.idLine(entry.id)];
        const isEditing = editing?.key === key;
        const note = saving?.key === key ? saving.note : entry.note;
        const commit = () => {
          if (!editing || editing.key !== key) return;
          setEditing(null);
          const next = editing.draft.trim().slice(0, HIDDEN_NOTE_MAX_LENGTH);
          if (next === (entry.note ?? '')) return;
          setSaving({ key, note: next });
          void Promise.resolve(onNote(entry, next)).finally(() => {
            setSaving((current) => (current?.key === key && current.note === next ? null : current));
          });
        };
        return (
          <div
            key={key}
            className="group/hidden flex items-center gap-3 rounded-sm border border-border bg-bg-tertiary/45 px-3 py-2.5"
          >
            {preview(entry)}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text-primary">{entry.name}</div>
              {isEditing ? (
                <Input
                  autoFocus
                  inputSize="sm"
                  className="mt-1 w-full"
                  aria-label={t('hiddenContent.noteFor', { name: entry.name })}
                  placeholder={t('hiddenContent.notePlaceholder')}
                  maxLength={HIDDEN_NOTE_MAX_LENGTH}
                  value={editing.draft}
                  onChange={(event) => setEditing({ key, draft: event.target.value })}
                  onBlur={commit}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit();
                    if (event.key === 'Escape') { event.stopPropagation(); setEditing(null); }
                  }}
                />
              ) : note ? (
                <div className="flex items-center gap-1 text-2xs text-text-secondary" title={facts.join(' · ')}>
                  <StickyNote className="h-3 w-3 flex-shrink-0 text-text-tertiary" aria-hidden />
                  <span className="truncate">{note}</span>
                </div>
              ) : (
                <div className="truncate text-2xs text-text-tertiary" title={facts.slice(1).join(' · ') || undefined}>{facts[0]}</div>
              )}
            </div>
            {!isEditing && (
              <IconButton
                size="sm"
                icon={Pencil}
                label={t(note ? 'hiddenContent.editNote' : 'hiddenContent.addNote')}
                className="opacity-0 transition-opacity focus-visible:opacity-100 group-focus-within/hidden:opacity-100 group-hover/hidden:opacity-100"
                onClick={() => setEditing({ key, draft: note ?? '' })}
              />
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={Eye}
              isLoading={pendingKey === key}
              disabled={pendingKey !== null}
              onClick={async () => {
                setPendingKey(key);
                try {
                  await onRemove(entry);
                } finally {
                  setPendingKey(null);
                }
              }}
            >
              {copy.showLabel}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

interface HiddenListModalProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}

function HiddenListModal({ open, onClose, titleId, title, subtitle, children }: HiddenListModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      size="md"
      panelClassName="max-h-[min(680px,100%)]"
    >
      <ModalHeader titleId={titleId} title={title} subtitle={subtitle} onClose={onClose} />
      <ModalBody>{children}</ModalBody>
    </Modal>
  );
}

/** "Hidden 11/03/2026", with the mod it was hidden from when Grimoire knows it. */
function hiddenOn(t: ReturnType<typeof useTranslation>['t'], hiddenAt: number | undefined, fromMod?: string): string[] {
  const date = hiddenAt ? formatDateParts(new Date(hiddenAt)) : '';
  if (!date) return [];
  return [fromMod ? t('hiddenContent.hiddenOnFrom', { date, mod: fromMod }) : t('hiddenContent.hiddenOn', { date })];
}

/** Notes live in settings next to the entry, so both entry points save them the same way. */
async function saveNote(change: (settings: { hiddenCreators: HiddenCreator[]; hiddenMods: HiddenMod[] }) => Partial<{ hiddenCreators: HiddenCreator[]; hiddenMods: HiddenMod[] }>) {
  const { settings, saveSettings } = useAppStore.getState();
  if (!settings) return;
  await saveSettings({
    ...settings,
    ...change({ hiddenCreators: settings.hiddenCreators ?? [], hiddenMods: settings.hiddenMods ?? [] }),
  });
}

interface HiddenCreatorsManagerProps {
  creators: HiddenCreator[];
  onRemove: (creator: HiddenCreator) => void | Promise<void>;
  className?: string;
}

export function HiddenCreatorsManager({ creators, onRemove, className }: HiddenCreatorsManagerProps) {
  const { t } = useTranslation();
  const previews = useHiddenPreviews(creators, []);
  return (
    <HiddenList
      entries={creators}
      onRemove={onRemove}
      onNote={(creator, note) => saveNote(({ hiddenCreators }) => ({
        hiddenCreators: hiddenCreators.map((entry) => (entry.id === creator.id ? withHiddenNote(entry, note) : entry)),
      }))}
      className={className}
      preview={(creator) => {
        const uploads = previews.creators[creator.id]?.mods ?? [];
        // One width for every row, so names line up whatever the creator uploaded.
        // The management dialog is narrow: it shows one upload, Settings shows them all.
        return (
          <div className="flex w-16 flex-shrink-0 gap-1 @xl:w-[200px]">
            {uploads.length
              ? uploads.map((mod, index) => (
                <PeekThumbnail key={hiddenEntryKey(mod)} mod={mod} className={index > 0 ? 'hidden @xl:block' : ''} />
              ))
              : <LetterTile name={creator.name} round />}
          </div>
        );
      }}
      copy={{
        emptyTitle: t('hiddenCreators.emptyTitle'),
        emptyDescription: t('hiddenCreators.emptyDescription'),
        idLine: (id) => t('hiddenCreators.gamebananaId', { id }),
        showLabel: t('hiddenCreators.showCreator'),
        facts: (creator) => {
          const count = previews.creators[creator.id]?.count;
          return [
            ...hiddenOn(t, creator.hiddenAt, creator.fromMod?.name),
            ...(count ? [t('hiddenContent.uploads', { count })] : []),
          ];
        },
      }}
    />
  );
}

export function HiddenCreatorsModal({
  open,
  onClose,
  creators,
  onRemove,
}: HiddenCreatorsManagerProps & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <HiddenListModal
      open={open}
      onClose={onClose}
      titleId="hidden-creators-modal-title"
      title={t('hiddenCreators.title')}
      subtitle={t('hiddenCreators.description')}
    >
      <HiddenCreatorsManager creators={creators} onRemove={onRemove} />
    </HiddenListModal>
  );
}

interface HiddenModsManagerProps {
  mods: HiddenMod[];
  onRemove: (mod: HiddenMod) => void | Promise<void>;
  className?: string;
}

export function HiddenModsManager({ mods, onRemove, className }: HiddenModsManagerProps) {
  const { t } = useTranslation();
  const previews = useHiddenPreviews([], mods);
  return (
    <HiddenList
      entries={mods}
      onRemove={onRemove}
      onNote={(mod, note) => saveNote(({ hiddenMods }) => ({
        hiddenMods: hiddenMods.map((entry) => (hiddenEntryKey(entry) === hiddenEntryKey(mod) ? withHiddenNote(entry, note) : entry)),
      }))}
      className={className}
      preview={(mod) => {
        const cached = previews.mods[hiddenEntryKey(mod)];
        return cached
          ? <PeekThumbnail mod={cached} />
          : <div className="h-10 w-16 flex-shrink-0 overflow-hidden rounded-sm"><LetterTile name={mod.name} /></div>;
      }}
      copy={{
        emptyTitle: t('hiddenMods.emptyTitle'),
        emptyDescription: t('hiddenMods.emptyDescription'),
        idLine: (id) => t('hiddenMods.gamebananaId', { id }),
        showLabel: t('hiddenMods.showMod'),
        facts: (mod) => {
          const author = previews.mods[hiddenEntryKey(mod)]?.submitterName;
          return [
            ...hiddenOn(t, mod.hiddenAt),
            ...(author ? [t('hiddenContent.byCreator', { name: author })] : []),
          ];
        },
      }}
    />
  );
}

export function HiddenModsModal({
  open,
  onClose,
  mods,
  onRemove,
}: HiddenModsManagerProps & { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <HiddenListModal
      open={open}
      onClose={onClose}
      titleId="hidden-mods-modal-title"
      title={t('hiddenMods.title')}
      subtitle={t('hiddenMods.description')}
    >
      <HiddenModsManager mods={mods} onRemove={onRemove} />
    </HiddenListModal>
  );
}
