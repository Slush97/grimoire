import { useState } from 'react';
import { Ban, ChevronRight, Crown, EyeOff, ImageOff, MoreHorizontal, PowerOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ModConflict } from '../../lib/api';
import { overlapKinds, sharesModel } from '../../lib/overlapKinds';
import { Button, IconButton, Tag } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuLabel, MenuSeparator } from '../common/menu';
import OverlapFileList from './OverlapFileList';

export interface OverlapMod {
  id: string;
  name: string;
  fileName: string;
  identity: string;
  thumbnailUrl?: string;
  /** Set when the mod is one of several files from the same GameBanana page. */
  variant: string | null;
  /** Lives in the citadel/grimoire priority root, which loads before every addon. */
  global?: boolean;
}

type CardState = 'front' | 'back' | 'undecided';

function StackCard({
  mod,
  side,
  state,
  locked,
  busy,
  onPick,
}: {
  mod: OverlapMod;
  side: 'left' | 'right';
  state: CardState;
  locked: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  const { t } = useTranslation();
  const front = state === 'front';
  const pickable = !front && !locked;
  const outer = side === 'left' ? 'left-2' : 'right-2';
  return (
    <button
      type="button"
      onClick={pickable ? onPick : undefined}
      disabled={busy || !pickable}
      aria-label={pickable ? t('overlap.stack.pick', { name: mod.name }) : mod.name}
      title={locked ? t('overlap.actions.swapLocked') : pickable ? t('overlap.stack.pick', { name: mod.name }) : mod.name}
      style={{ transform: `translateY(-50%) scale(${front ? 1 : 0.93})`, zIndex: front ? 2 : 1 }}
      className={`group/card absolute top-1/2 aspect-video w-[58%] overflow-hidden rounded-sm border bg-bg-tertiary text-left transition-[transform,translate,box-shadow,border-color] duration-300 ease-out motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default ${
        side === 'left' ? 'left-0 origin-left' : 'right-0 origin-right'
      } ${front ? 'border-accent shadow-2xl shadow-black/70' : 'border-hl/10 shadow-lg shadow-black/50'} ${
        pickable ? 'cursor-pointer enabled:hover:-translate-y-1.5' : ''
      }`}
    >
      {mod.thumbnailUrl ? (
        <img
          src={mod.thumbnailUrl}
          alt=""
          loading="lazy"
          className={`h-full w-full object-cover transition-[filter] duration-300 ${
            front ? '' : 'brightness-[.4] saturate-[.4] group-enabled/card:group-hover/card:brightness-90 group-enabled/card:group-hover/card:saturate-100'
          }`}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-6 w-6 text-text-tertiary" aria-hidden />
        </span>
      )}
      {/* A back card's inner edge sits under the front one, so its name keeps clear of it. */}
      <span
        className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-2.5 pt-8 ${
          front ? 'px-3' : side === 'left' ? 'pl-3 pr-[30%]' : 'pl-[30%] pr-3'
        } ${side === 'left' ? 'text-left' : 'text-right'}`}
      >
        <span className={`block truncate font-mod-title text-base ${front ? 'text-white' : 'text-white/60'}`}>{mod.name}</span>
        {mod.variant && <span className="block truncate text-2xs text-white/60">{mod.variant}</span>}
      </span>
      {front && (
        <Tag tone="accent" variant="overlay" icon={Crown} className={`absolute top-2 ${outer}`}>
          {t('overlap.standing.wins')}
        </Tag>
      )}
      {pickable && (
        <span
          className={`pointer-events-none absolute top-2 ${outer} opacity-0 transition-opacity duration-200 group-hover/card:opacity-100 group-focus-visible/card:opacity-100`}
        >
          <Tag tone="accent" variant="overlay" icon={Crown}>
            {t('overlap.stack.makeWin')}
          </Tag>
        </span>
      )}
    </button>
  );
}

interface OverlapCardProps {
  conflict: ModConflict;
  /** Left and right card. Fixed per pair, so a swap restacks without the sides jumping. */
  a: OverlapMod;
  b: OverlapMod;
  /** The mod that loads first and so wins the shared files. */
  winnerId: string;
  /** Shared files to list (narrowed to the matches while searching). */
  files: string[];
  /** Open the file list, e.g. when a search matched a path in it. */
  autoOpen: boolean;
  busy: boolean;
  /** Reorder so `winner` loads directly before `loser`. */
  onSetWinner: (winner: OverlapMod, loser: OverlapMod) => Promise<void>;
  onIgnore: () => void;
  onIgnoreMod: (mod: OverlapMod) => void;
  onDisable: (mod: OverlapMod) => void;
  onIgnoreFile: (filePath: string) => void;
  onIgnoreFileEverywhere: (filePath: string) => void;
}

export default function OverlapCard({
  conflict,
  a,
  b,
  winnerId,
  files,
  autoOpen,
  busy,
  onSetWinner,
  onIgnore,
  onIgnoreMod,
  onDisable,
  onIgnoreFile,
  onIgnoreFileEverywhere,
}: OverlapCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(autoOpen);
  const [lastAutoOpen, setLastAutoOpen] = useState(autoOpen);
  if (autoOpen !== lastAutoOpen) {
    setLastAutoOpen(autoOpen);
    setOpen(autoOpen);
  }
  // Restack the moment a card is picked; the reorder and re-scan take a beat,
  // and the reload brings the real order back either way.
  const [picked, setPicked] = useState<string | null>(null);

  // Two mods in one load slot have no defined winner until one is picked.
  const undecided = conflict.conflictType === 'priority' && picked === null;
  const shownWinner = picked ?? winnerId;
  const winner = shownWinner === b.id ? b : a;
  const loser = winner === a ? b : a;
  // A Global mod sits in the priority root, which always loads first; reorder
  // can't move a numbered addon ahead of it.
  const locked = !undecided && !!winner.global;

  const pick = async (mod: OverlapMod) => {
    setPicked(mod.id);
    try {
      await onSetWinner(mod, mod === a ? b : a);
    } finally {
      setPicked(null);
    }
  };

  const allFiles = conflict.files ?? [];
  const kindLabel = overlapKinds(allFiles).map((kind) => t(`overlap.kinds.${kind}`)).join(', ');
  const stateOf = (mod: OverlapMod): CardState => (undecided ? 'undecided' : mod === winner ? 'front' : 'back');

  return (
    <li className="overflow-hidden rounded-sm border border-border bg-bg-secondary">
      <div className="px-5 pb-3 pt-5">
        <div className="relative aspect-[3/1]">
          <StackCard mod={a} side="left" state={stateOf(a)} locked={locked} busy={busy} onPick={() => pick(a)} />
          <StackCard mod={b} side="right" state={stateOf(b)} locked={locked} busy={busy} onPick={() => pick(b)} />
        </div>
        {undecided ? (
          <p className="mt-3 text-center text-xs text-state-warning">{t('overlap.notes.sameSlot')}</p>
        ) : (
          sharesModel(allFiles) && (
            <p className="mt-3 text-center text-xs text-text-secondary">
              {t('overlap.notes.sharedModel', { name: loser.name })}
            </p>
          )
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-hl/5 px-2 py-1.5">
        {allFiles.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? t('overlap.files.hide') : t('overlap.files.show')}
            className="flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-2 text-xs text-text-secondary transition-colors hover:bg-hl/5 hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <ChevronRight className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            <span className="truncate">{kindLabel}</span>
            <span className="flex-shrink-0 tabular-nums text-text-tertiary">
              {t('overlap.files.count', { count: allFiles.length })}
            </span>
          </button>
        )}
        <div className="ml-auto flex flex-shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" icon={EyeOff} disabled={busy} onClick={onIgnore} title={t('overlap.actions.ignoreTitle')}>
            {t('overlap.actions.ignore')}
          </Button>
          <MenuRoot kind="dropdown">
            <MenuTrigger asChild>
              <IconButton icon={MoreHorizontal} size="sm" label={t('overlap.actions.more')} className="border-transparent" />
            </MenuTrigger>
            <MenuContent>
              {[winner, loser].map((mod) => (
                <MenuItem key={mod.id} icon={Ban} disabled={busy} onSelect={() => onIgnoreMod(mod)}>
                  {t('overlap.actions.ignoreMod', { name: mod.name })}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuLabel>{t('overlap.actions.disableHeading')}</MenuLabel>
              {[winner, loser].map((mod) => (
                <MenuItem key={mod.id} icon={PowerOff} tone="danger" disabled={busy} onSelect={() => onDisable(mod)}>
                  {mod.name}
                </MenuItem>
              ))}
            </MenuContent>
          </MenuRoot>
        </div>
      </div>

      {open && files.length > 0 && (
        <OverlapFileList
          files={files}
          busy={busy}
          onIgnoreFile={onIgnoreFile}
          onIgnoreFileEverywhere={onIgnoreFileEverywhere}
        />
      )}
    </li>
  );
}
