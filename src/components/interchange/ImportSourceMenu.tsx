import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, ChevronDown, FileInput, FileOutput, FolderSearch } from 'lucide-react';
import { listInterchangeSources, showOpenDialog } from '../../lib/api';
import type { InterchangeSourceInfo, InterchangeSourceRequest } from '../../lib/modInterchange';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { Button, IconButton } from '../common/ui';
import ImportWizardModal from './ImportWizardModal';

interface ImportSourceMenuProps {
  onImported: () => void;
  /** Adds an export entry, making this the toolbar's one import/export menu. */
  onExport?: () => void;
}

/** Keep source selection and its modal alive when the containing popup closes. */
function useInterchangeImport(closeMenu: () => void) {
  const { t } = useTranslation();
  const [sources, setSources] = useState<InterchangeSourceInfo[] | null>(null);
  const pendingSources = useRef<Promise<void> | null>(null);
  const [active, setActive] = useState<{ request: InterchangeSourceRequest; name: string } | null>(
    null
  );
  const loadSources = useCallback(() => {
    if (sources || pendingSources.current) return;
    pendingSources.current = listInterchangeSources()
        .then(setSources)
        .catch(() => setSources([]))
        .finally(() => { pendingSources.current = null; });
  }, [sources]);

  const pickFolder = async (info: InterchangeSourceInfo) => {
    closeMenu();
    const dir = await showOpenDialog({
      directory: true,
      title: t('interchange.pickManagerFolder', { source: info.name }),
    });
    if (dir) setActive({ request: { kind: 'manager', id: info.id, location: dir }, name: info.name });
  };

  const pickBundle = async () => {
    closeMenu();
    const file = await showOpenDialog({
      title: t('interchange.pickBundle'),
      filters: [{ name: 'mod-interchange.json', extensions: ['json'] }],
    });
    if (file) setActive({ request: { kind: 'bundle', path: file }, name: t('interchange.exportFile') });
  };

  const openManager = (info: InterchangeSourceInfo) => {
    if (!info.found) {
      void pickFolder(info);
      return;
    }
    closeMenu();
    setActive({ request: { kind: 'manager', id: info.id }, name: info.name });
  };
  return { sources, active, loadSources, openManager, pickFolder, pickBundle, closeMenu, closeImport: () => setActive(null) };
}

type InterchangeImportController = ReturnType<typeof useInterchangeImport>;

function ManagerName({ info }: { info: InterchangeSourceInfo }) {
  const { t } = useTranslation();
  const labelRef = useRef<HTMLSpanElement>(null);
  const fullNameRef = useRef<HTMLSpanElement>(null);
  const [abbreviated, setAbbreviated] = useState(false);
  const isDmm = info.id === 'deadlock-mod-manager';

  useLayoutEffect(() => {
    const label = labelRef.current;
    const fullName = fullNameRef.current;
    if (!isDmm || !label || !fullName || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setAbbreviated(fullName.getBoundingClientRect().width > label.getBoundingClientRect().width);
    });
    observer.observe(label);
    observer.observe(fullName);
    return () => observer.disconnect();
  }, [isDmm, info.name]);

  return <span ref={labelRef} className={`relative min-w-0 flex-1 text-left ${isDmm ? 'overflow-hidden' : 'truncate'}`}>
    {isDmm && <span ref={fullNameRef} aria-hidden className="pointer-events-none invisible absolute w-max whitespace-nowrap">{info.name}</span>}
    {abbreviated ? t('interchange.dmmShortName') : info.name}
  </span>;
}

export function InterchangeImportHost({ open, onDismiss, onImported, children }: {
  open: boolean;
  onDismiss: () => void;
  onImported: () => void;
  children: (controller: InterchangeImportController) => ReactNode;
}) {
  const controller = useInterchangeImport(onDismiss);
  const { loadSources } = controller;
  useEffect(() => { if (open) loadSources(); }, [open, loadSources]);
  return <>
    {children(controller)}
    {controller.active && <ImportWizardModal
      source={controller.active.request}
      sourceName={controller.active.name}
      onClose={controller.closeImport}
      onImported={onImported}
    />}
  </>;
}

/** Used by both the empty-state launcher and the Installed options popup. */
export function InterchangeTransferActions({ controller, onExport }: { controller: InterchangeImportController; onExport?: () => void }) {
  const { t } = useTranslation();
  return <div className="space-y-1">
    {!controller.sources && <p className="px-2 py-1.5 text-xs text-text-secondary">{t('interchange.detecting')}</p>}
    {controller.sources?.map(info => <div key={info.id} className="flex items-center gap-1">
      <Button type="button" variant="ghost" icon={ArrowRightLeft} aria-label={info.name} title={info.name}
        className="min-w-0 flex-1 justify-start !px-2 !text-xs !text-text-primary" onClick={() => controller.openManager(info)}>
        <ManagerName info={info} />
        <span className="shrink-0 text-2xs text-text-secondary">{info.found ? t('interchange.detected') : t('interchange.notDetected')}</span>
      </Button>
      {info.found && <IconButton icon={FolderSearch} className="!border-transparent" label={info.id === 'deadlock-mod-manager'
        ? t('interchange.chooseDmmFolder') : t('interchange.chooseManagerFolder', { source: info.name })}
        onClick={() => void controller.pickFolder(info)} />}
    </div>)}
    <Button type="button" variant="ghost" icon={FileInput} title={t('interchange.pickBundle')} className="w-full justify-start !px-2 !text-xs !text-text-primary"
      onClick={() => void controller.pickBundle()}>{t('interchange.openBundle')}</Button>
    {onExport && <Button type="button" variant="ghost" icon={FileOutput} title={t('interchange.exportHint')}
      className="w-full justify-start !px-2 !text-xs !text-text-primary" onClick={() => { controller.closeMenu(); onExport(); }}>
      {t('interchange.exportMenu')}
    </Button>}
  </div>;
}

export default function ImportSourceMenu({ onImported, onExport }: ImportSourceMenuProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const toggle = () => setOpen(value => !value);

  return (
    <InterchangeImportHost open={open} onDismiss={close} onImported={onImported}>{controller => <div className="relative flex-shrink-0" ref={anchorRef}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={onExport ? t('interchange.transferHint') : t('interchange.importButtonHint')}
        aria-label={onExport ? t('interchange.transferButton') : t('interchange.importButton')}
        className="inline-flex items-center gap-2 rounded-sm border border-hl/5 bg-bg-tertiary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-hl/10 cursor-pointer"
      >
        <ArrowRightLeft className="h-4 w-4" />
        {t('interchange.importButton')}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>

      <AnchoredPopover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        width={300}
        role="dialog"
        ariaLabel={onExport ? t('interchange.transferButton') : t('interchange.importButton')}
        className="p-3"
      >
        <p className="mb-1.5 text-xs font-medium text-text-secondary">
          {t('interchange.managersLabel')}
        </p>
        <InterchangeTransferActions controller={controller} onExport={onExport} />
      </AnchoredPopover>
    </div>}</InterchangeImportHost>
  );
}
