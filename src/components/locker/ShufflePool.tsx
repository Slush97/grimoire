import { useId, useMemo, useState } from 'react';
import { ImageOff, ListChecks, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton, ModalHeader } from '../common/ui';
import { Modal, ModalBody } from '../common/Modal';
import { Input } from '../common/forms';
import ModThumbnail from '../ModThumbnail';
import { useAppStore } from '../../stores/appStore';
import { shufflePoolKey } from '../../lib/lockerRandomizer';
import { shouldBlurNsfw } from '../../lib/appSettings';
import type { Mod } from '../../types/mod';

export default function ShufflePool() {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const mods = useAppStore((s) => s.mods);
  const included = useAppStore((s) => s.shuffleIncluded);
  const variants = useAppStore((s) => s.shuffleVariants);
  const remove = useAppStore((s) => s.toggleShuffleIncluded);
  const hideNsfw = useAppStore((s) => shouldBlurNsfw(s.settings));
  const rows = useMemo(() => {
    const byKey = new Map<string, Mod>();
    for (const mod of mods) byKey.set(shufflePoolKey(mod), mod);
    return [...included].map((key) => ({ key, mod: byKey.get(key) }))
      .sort((a, b) => (a.mod?.name ?? '').localeCompare(b.mod?.name ?? ''));
  }, [mods, included]);
  const filtered = rows.filter(({ mod }) => (mod?.name ?? t('locker.randomize.pool.unavailable')).toLowerCase().includes(query.trim().toLowerCase()));
  const placeholder = <div className="flex h-full w-full items-center justify-center text-text-secondary"><ImageOff className="h-4 w-4" aria-hidden /></div>;

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="flex items-center gap-1.5 self-stretch rounded-sm border border-border bg-bg-secondary px-3 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
    >
      <ListChecks className="w-4 h-4" />
      {t('locker.randomize.pool.open', { count: included.size })}
    </button>
    {open && <Modal onClose={() => setOpen(false)} labelledBy={titleId} size="lg">
      <ModalHeader title={t('locker.randomize.pool.title')} titleId={titleId} onClose={() => setOpen(false)} />
      <ModalBody className="space-y-4">
        <p className="text-sm text-text-secondary">{t('locker.randomize.pool.profileHint')}</p>
        {rows.length > 0 && <Input aria-label={t('locker.randomize.pool.search')} placeholder={t('locker.randomize.pool.search')} value={query} onChange={(event) => setQuery(event.target.value)} />}
        {filtered.length === 0 ? <p className="py-4 text-sm text-text-secondary">{t(rows.length === 0 ? 'locker.randomize.pool.empty' : 'locker.randomize.pool.noMatch')}</p> :
          <ul className="divide-y divide-border">
            {filtered.map(({ key, mod }) => <li key={key} className="flex items-center gap-3 py-3">
              <div className="h-9 w-16 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
                {mod ? <ModThumbnail
                  src={mod.thumbnailUrl}
                  alt={mod.name}
                  nsfw={mod.nsfw}
                  hideNsfw={hideNsfw}
                  className="h-full w-full"
                  width={64}
                  height={36}
                  mergedSources={mod.merged?.sources}
                  forgeInstalled={!!mod.forgeInstall}
                  enableImageContextMenu={false}
                  fallback={placeholder}
                /> : placeholder}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary">{mod?.name ?? t('locker.randomize.pool.unavailable')}</p>
                <p className="text-xs text-text-secondary">{!mod ? t('locker.randomize.pool.missing') : variants.get(key) === 'random' ? t('locker.randomize.pool.randomVariant') : variants.has(key) ? t('locker.randomize.pool.pinnedVariant') : t('locker.randomize.pool.currentVariant')}</p>
              </div>
              <IconButton icon={X} label={t('locker.randomize.removeFromShuffle', { name: mod?.name ?? t('locker.randomize.pool.unavailable') })} onClick={() => remove(key)} />
            </li>)}
          </ul>}
      </ModalBody>
    </Modal>}
  </>;
}
