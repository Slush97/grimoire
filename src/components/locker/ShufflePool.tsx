import { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, ModalHeader } from '../common/ui';
import { Modal, ModalBody } from '../common/Modal';
import { Input } from '../common/forms';
import { useAppStore } from '../../stores/appStore';
import { shufflePoolKey } from '../../lib/lockerRandomizer';

export default function ShufflePool() {
  const { t } = useTranslation();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const mods = useAppStore((s) => s.mods);
  const included = useAppStore((s) => s.shuffleIncluded);
  const variants = useAppStore((s) => s.shuffleVariants);
  const remove = useAppStore((s) => s.toggleShuffleIncluded);
  const rows = useMemo(() => {
    const names = new Map<string, string>();
    for (const mod of mods) names.set(shufflePoolKey(mod), mod.name);
    return [...included].map((key) => ({ key, name: names.get(key) }))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }, [mods, included]);
  const filtered = rows.filter((row) => (row.name ?? t('locker.randomize.pool.unavailable')).toLowerCase().includes(query.trim().toLowerCase()));

  return <>
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
      {t('locker.randomize.pool.open', { count: included.size })}
    </Button>
    {open && <Modal onClose={() => setOpen(false)} labelledBy={titleId} size="lg">
      <ModalHeader title={t('locker.randomize.pool.title')} titleId={titleId} onClose={() => setOpen(false)} />
      <ModalBody className="space-y-4">
        <p className="text-sm text-text-secondary">{t('locker.randomize.pool.profileHint')}</p>
        {rows.length > 0 && <Input aria-label={t('locker.randomize.pool.search')} placeholder={t('locker.randomize.pool.search')} value={query} onChange={(event) => setQuery(event.target.value)} />}
        {filtered.length === 0 ? <p className="py-4 text-sm text-text-secondary">{t(rows.length === 0 ? 'locker.randomize.pool.empty' : 'locker.randomize.pool.noMatch')}</p> :
          <ul className="divide-y divide-border">
            {filtered.map(({ key, name }) => <li key={key} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary">{name ?? t('locker.randomize.pool.unavailable')}</p>
                <p className="text-xs text-text-secondary">{!name ? t('locker.randomize.pool.missing') : variants.get(key) === 'random' ? t('locker.randomize.pool.randomVariant') : variants.has(key) ? t('locker.randomize.pool.pinnedVariant') : t('locker.randomize.pool.currentVariant')}</p>
              </div>
              <IconButton icon={X} label={t('locker.randomize.removeFromShuffle', { name: name ?? t('locker.randomize.pool.unavailable') })} onClick={() => remove(key)} />
            </li>)}
          </ul>}
      </ModalBody>
    </Modal>}
  </>;
}
