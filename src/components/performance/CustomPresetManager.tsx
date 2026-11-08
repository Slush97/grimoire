import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Modal, ModalBody, ModalFooter } from '../common/Modal';
import { Button, ModalHeader, Toggle } from '../common/ui';
import { ConfirmModal } from '../common/PageComponents';
import type { PerformancePresetSummary } from '../../types/electron';
import type { CustomPerformanceToggle, PerformanceRepositoryInspection } from '../../types/performanceCustom';
import CustomPresetImport from './CustomPresetImport';
import CustomPresetToggleEditor from './CustomPresetToggleEditor';
import CustomPresetAddons from './CustomPresetAddons';
import PerformancePresetError from './PerformancePresetError';

interface Props {
  presets: PerformancePresetSummary[];
  activeId: string | null;
  initialEntryId?: string | null;
  hideBuiltIns?: boolean;
  onHideBuiltInsChange?: (hidden: boolean) => Promise<void>;
  onTurnOff?: () => Promise<void>;
  onReviewAddons?: () => void;
  selectsImported?: boolean;
  onSaveToggles?: (preset: PerformancePresetSummary, toggles: CustomPerformanceToggle[]) => Promise<void>;
  onChanged: (id?: string) => Promise<void>;
  onClose: () => void;
}

export default function CustomPresetManager({ presets, activeId, initialEntryId, hideBuiltIns, onHideBuiltInsChange, onTurnOff, onReviewAddons, selectsImported, onSaveToggles, onChanged, onClose }: Props) {
  const { t } = useTranslation();
  const titleId = useId();
  const focusRef = useRef<HTMLDivElement>(null);
  const entries = presets.filter((preset) => preset.custom);
  const [view, setView] = useState<'list' | 'add' | 'detail' | 'toggles'>(() => initialEntryId ? 'detail' : entries.length || hideBuiltIns ? 'list' : 'add');
  const [entryId, setEntryId] = useState(initialEntryId ?? null);
  const [importedEntry, setImportedEntry] = useState<PerformancePresetSummary | null>(null);
  const [inspection, setInspection] = useState<PerformanceRepositoryInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [addReturnId, setAddReturnId] = useState<string | null>(null);
  const [turnedOffId, setTurnedOffId] = useState<string | null>(null);
  const entry = entries.find((preset) => preset.id === entryId) ?? (importedEntry?.id === entryId ? importedEntry : null);
  const active = !!entry && activeId === entry.id;
  const title = view === 'add' ? t('performance.custom.add') : view === 'toggles' ? t('performance.custom.schemaTitle', { name: entry?.name }) : view === 'detail' && entry ? entry.name : t('performance.custom.manage');

  useEffect(() => { if (view !== 'add') focusRef.current?.focus(); }, [view]);
  const navigate = (next: typeof view) => { setError(null); setNotice(null); setView(next); };
  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await task(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  };
  const openEntry = (id: string) => { setEntryId(id); navigate('detail'); };

  return <Modal onClose={onClose} dismissable={!busy} size="lg" labelledBy={titleId}>
    <ModalHeader title={title} titleId={titleId} onClose={onClose} closeDisabled={busy} closeLabel={t('common.actions.close')} />
    <div ref={focusRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
      {view === 'add' ? <CustomPresetImport initialInspection={inspection} presets={entries} onInspected={setInspection} onBusy={setBusy}
        onBack={() => { if (addReturnId) { setEntryId(addReturnId); navigate('detail'); } else if (entries.length) navigate('list'); else onClose(); }}
        onImported={async (imported) => {
          setImportedEntry(imported); setEntryId(imported.id); setView('detail');
          setNotice(t('performance.custom.added', { name: imported.name }));
          try {
            await onChanged(imported.id);
            if (selectsImported) setNotice(t('performance.custom.addedSelected', { name: imported.name }));
          } catch (err) { setError(err); }
        }} /> : view === 'toggles' && entry?.custom ? <CustomPresetToggleEditor preset={entry} busy={busy} error={error}
        onCancel={() => navigate('detail')} onSave={(toggles) => void run(async () => {
          if (onSaveToggles) await onSaveToggles(entry, toggles);
          else { await window.electronAPI.savePerformancePresetToggles(entry.id, toggles); await onChanged(); }
          setView('detail'); setNotice(t('performance.custom.settingsSaved'));
        })} /> : <>
        <ModalBody className="space-y-4">
          {notice && <p role="status" className="text-sm text-text-primary">{notice}</p>}
          {view === 'detail' && entry?.custom ? <>
            {turnedOffId === entry.id && !active && <p role="status" className="text-sm text-text-secondary">{t('performance.custom.turnedOff')}</p>}
            <div className="space-y-2">
              <a href={`https://github.com/${entry.upstream.repo}/tree/${entry.upstream.commit}`} target="_blank" rel="noreferrer noopener" className="break-words text-sm text-accent hover:underline">{entry.upstream.repo}</a>
              {entry.custom.configPath && <p className="break-words font-mono text-xs text-text-secondary">{entry.custom.configPath}</p>}
              {entry.custom.videoPath && <p className="break-words font-mono text-xs text-text-secondary">{entry.custom.videoPath}</p>}
              <p className="text-xs text-text-secondary">{t('performance.custom.savedRevision', { commit: entry.upstream.commit.slice(0, 8) })}</p>
              {entry.custom.withheldCount > 0 && <p className="text-xs text-text-secondary">{t('performance.custom.withheld', { count: entry.custom.withheldCount })}</p>}
            </div>
            {active && <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm text-text-primary">{t('performance.custom.inUse')}</p>
              <p className="text-xs text-text-secondary">{t('performance.custom.turnOff')}</p>
              {onTurnOff && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void run(async () => { await onTurnOff(); setTurnedOffId(entry.id); })}>{t('performance.custom.turnOffAction')}</Button>}
            </div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-sm text-text-secondary">{t('performance.custom.optionalSettings', { count: entry.custom.toggles.length })}</p>
              <Button variant="secondary" size="sm" disabled={busy || active} onClick={() => navigate('toggles')}>{t('performance.custom.editToggles')}</Button>
            </div>
            {entry.custom.addons.length > 0 && <CustomPresetAddons key={entry.id} preset={entry} disabled={busy} onBusy={setBusy} onChanged={onChanged} onReview={onReviewAddons} />}
            {error !== null && <PerformancePresetError error={error} />}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
              {inspection?.repository === entry.upstream.repo && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setAddReturnId(entry.id); navigate('add'); }}>{t('performance.custom.addAnother')}</Button>}
              <Button variant="ghost" size="sm" disabled={busy || active} onClick={() => { setError(null); setDeleting(true); }}>{t('performance.custom.delete')}</Button>
            </div>
          </> : <>
            <p className="text-sm text-text-secondary">{t('performance.custom.description')}</p>
            <div className="divide-y divide-border">
              {entries.map((preset) => <Button key={preset.id} variant="ghost" disabled={busy} className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => openEntry(preset.id)}>
                <span className="min-w-0 flex-1">
                  <span className="flex justify-between gap-3 text-sm text-text-primary"><span className="break-words">{preset.name}</span>{activeId === preset.id && <span className="shrink-0 text-xs text-text-secondary">{t('performance.custom.inUse')}</span>}</span>
                  <span className="mt-1 block break-words text-xs text-text-secondary">{preset.upstream.repo}</span>
                  <span className="mt-1 block break-words font-mono text-2xs text-text-secondary">{preset.custom!.configPath ?? preset.custom!.videoPath}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
              </Button>)}
            </div>
            {error !== null && <PerformancePresetError error={error} />}
          </>}
        </ModalBody>
        <ModalFooter className="flex-wrap">
          {view === 'detail' && entry ? <>
            <Button variant="secondary" disabled={busy} onClick={() => navigate('list')}>{t('performance.custom.backToList')}</Button>
            <Button disabled={busy} onClick={onClose}>{t('common.actions.done')}</Button>
          </> : <>
            {onHideBuiltInsChange && <div className="mr-auto"><Toggle checked={!!hideBuiltIns} disabled={busy} label={t('performance.custom.hideBuiltIns')}
              onChange={(hidden) => void run(() => onHideBuiltInsChange(hidden))} /></div>}
            <Button disabled={busy} onClick={() => { setInspection(null); setAddReturnId(null); navigate('add'); }}>{t('performance.custom.add')}</Button>
          </>}
        </ModalFooter>
      </>}
    </div>
    {deleting && entry && <ConfirmModal isOpen title={t('performance.custom.deleteTitle', { name: entry.name })} message={t('performance.custom.deleteDescription')}
      confirmLabel={t('performance.custom.delete')} variant="danger" busy={busy} onCancel={() => { setDeleting(false); setError(null); }}
      onConfirm={() => void run(async () => {
        await window.electronAPI.deletePerformancePreset(entry.id);
        setDeleting(false); setImportedEntry(null); setEntryId(null); setView('list');
        setNotice(t('performance.custom.deleted', { name: entry.name }));
        await onChanged();
      })}>{error !== null && <div className="mt-3"><PerformancePresetError error={error} /></div>}</ConfirmModal>}
  </Modal>;
}
