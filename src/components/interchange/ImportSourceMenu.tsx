import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, ChevronDown, FileInput, FolderSearch } from 'lucide-react';
import { listInterchangeSources, showOpenDialog } from '../../lib/api';
import type { InterchangeSourceInfo, InterchangeSourceRequest } from '../../lib/modInterchange';
import { AnchoredPopover } from '../common/AnchoredPopover';
import ImportWizardModal from './ImportWizardModal';

interface ImportSourceMenuProps {
  onImported: () => void;
  /** Compact icon button (toolbar) vs labelled button (empty state). */
  compact?: boolean;
}

const itemClass =
  'w-full flex items-center gap-3 px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-tertiary rounded-md transition-colors cursor-pointer';

/**
 * "Import from other mod managers": one entry per mod manager Grimoire can
 * read (reported by the main-process registry), plus any manager's exported
 * mod-interchange file.
 */
export default function ImportSourceMenu({ onImported, compact = false }: ImportSourceMenuProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<InterchangeSourceInfo[] | null>(null);
  const [active, setActive] = useState<{ request: InterchangeSourceRequest; name: string } | null>(
    null
  );

  const toggle = () => {
    setOpen((v) => !v);
    if (!sources) {
      listInterchangeSources()
        .then(setSources)
        .catch(() => setSources([]));
    }
  };
  const close = useCallback(() => setOpen(false), []);

  const pickFolder = async (info: InterchangeSourceInfo) => {
    close();
    const dir = await showOpenDialog({
      directory: true,
      title: t('interchange.pickManagerFolder', { source: info.name }),
    });
    if (dir) setActive({ request: { kind: 'manager', id: info.id, location: dir }, name: info.name });
  };

  const pickBundle = async () => {
    close();
    const file = await showOpenDialog({
      title: t('interchange.pickBundle'),
      filters: [{ name: 'mod-interchange.json', extensions: ['json'] }],
    });
    if (file) setActive({ request: { kind: 'bundle', path: file }, name: t('interchange.exportFile') });
  };

  return (
    <div className="relative flex-shrink-0" ref={anchorRef}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('interchange.importButtonHint')}
        aria-label={t('interchange.importButton')}
        className={
          compact
            ? 'inline-flex items-center gap-1 rounded-sm border border-hl/5 bg-bg-tertiary px-2.5 py-2 text-text-primary transition-colors hover:bg-hl/10 cursor-pointer'
            : 'inline-flex items-center gap-2 rounded-sm border border-hl/5 bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-hl/10 cursor-pointer'
        }
      >
        <ArrowRightLeft className="h-4 w-4" />
        {!compact && t('interchange.importButton')}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>

      <AnchoredPopover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        width={300}
        role="menu"
        ariaLabel={t('interchange.importButton')}
        className="p-1"
      >
        <p className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wider text-text-secondary">
          {t('interchange.managersLabel')}
        </p>
        {!sources && <p className="px-3 py-2 text-sm text-text-secondary">{t('interchange.detecting')}</p>}
        {sources?.map((info) => (
          <button
            key={info.id}
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              if (!info.found) {
                void pickFolder(info);
                return;
              }
              close();
              setActive({ request: { kind: 'manager', id: info.id }, name: info.name });
            }}
          >
            <ArrowRightLeft className="h-4 w-4 shrink-0 text-text-secondary" />
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <span className="truncate">{info.name}</span>
              <span className="text-[11px] text-text-secondary">
                {info.found ? t('interchange.detected') : t('interchange.notDetected')}
              </span>
            </div>
          </button>
        ))}
        {sources?.map((info) => (
          <button
            key={`${info.id}-folder`}
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => void pickFolder(info)}
          >
            <FolderSearch className="h-4 w-4 shrink-0 text-text-secondary" />
            <span className="truncate">{t('interchange.chooseManagerFolder', { source: info.name })}</span>
          </button>
        ))}
        <div className="my-1 border-t border-border" />
        <button type="button" role="menuitem" className={itemClass} onClick={() => void pickBundle()}>
          <FileInput className="h-4 w-4 shrink-0 text-text-secondary" />
          <span>{t('interchange.openBundle')}</span>
        </button>
      </AnchoredPopover>

      {active && (
        <ImportWizardModal
          source={active.request}
          sourceName={active.name}
          onClose={() => setActive(null)}
          onImported={onImported}
        />
      )}
    </div>
  );
}
