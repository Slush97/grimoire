import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FolderOpen } from 'lucide-react';
import { exportModsForOtherManagers, onInterchangeProgress, showOpenDialog, revealPath } from '../../lib/api';
import type {
  InterchangeExportReport,
  InterchangeExportSelection,
  InterchangeProgress,
} from '../../lib/modInterchange';
import { showToast } from '../../stores/toastStore';
import { Modal } from '../common/Modal';
import { Button, CheckboxMark, ModalHeader } from '../common/ui';

interface ExportModalProps {
  onClose: () => void;
}

/** Export for other mod managers: choose what to include, where to save,
 *  watch it copy, then open the result. */
export default function ExportModal({ onClose }: ExportModalProps) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<InterchangeExportSelection>({
    profiles: true,
    crosshairs: true,
  });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<InterchangeProgress | null>(null);
  const [report, setReport] = useState<InterchangeExportReport | null>(null);

  useEffect(() => onInterchangeProgress(setProgress), []);

  const run = async () => {
    const destination = await showOpenDialog({ directory: true, title: t('interchange.exportPickFolder') });
    if (!destination) return;
    setRunning(true);
    try {
      setReport(await exportModsForOtherManagers(destination, selection));
    } catch (err) {
      showToast(
        t('interchange.exportFailed', { error: err instanceof Error ? err.message : String(err) }),
        { tone: 'error', duration: 8000, dismissable: true }
      );
    } finally {
      setRunning(false);
    }
  };

  const option = (key: keyof InterchangeExportSelection, title: string, detail: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-sm border border-border p-3 hover:bg-hl/5">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={selection[key]}
        onChange={(e) => setSelection((s) => ({ ...s, [key]: e.target.checked }))}
      />
      <CheckboxMark checked={selection[key]} />
      <div>
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-secondary">{detail}</p>
      </div>
    </label>
  );

  const percent = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Modal onClose={onClose} dismissable={!running} size="md" labelledBy="interchange-export-title">
      <ModalHeader
        title={t('interchange.exportTitle')}
        titleId="interchange-export-title"
        subtitle={t('interchange.exportDescription')}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
        closeDisabled={running}
      />
      <div className="space-y-2 px-5 py-4">
        {!report && !running && (
          <>
            <div className="flex items-start gap-3 rounded-sm border border-border p-3 opacity-80">
              <CheckboxMark checked disabled />
              <div>
                <p className="text-sm font-medium text-text-primary">{t('interchange.sectionMods')}</p>
                <p className="text-xs text-text-secondary">{t('interchange.exportModsDetail')}</p>
              </div>
            </div>
            {option('profiles', t('interchange.sectionProfiles'), t('interchange.exportProfilesDetail'))}
            {option('crosshairs', t('interchange.sectionCrosshairs'), t('interchange.exportCrosshairsDetail'))}
          </>
        )}
        {running && (
          <div className="space-y-3 py-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-text-secondary">
              {progress
                ? t('interchange.exporting', { current: Math.min(progress.current + 1, progress.total), total: progress.total })
                : t('interchange.progress.starting')}
            </p>
          </div>
        )}
        {report && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-text-primary">
              <CheckCircle2 className="h-5 w-5 text-state-success" />
              {t('interchange.exportedSummary', {
                mods: report.exported,
                profiles: report.profiles,
                crosshairs: report.crosshairs,
              })}
            </div>
            <p className="break-all text-text-secondary">{report.bundlePath}</p>
            {report.skipped.map((s) => (
              <p key={s.name} className="text-text-secondary">
                {s.name}: {s.reason}
              </p>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        {report ? (
          <>
            <Button variant="secondary" icon={FolderOpen} onClick={() => void revealPath(report.bundlePath)}>
              {t('interchange.openFolder')}
            </Button>
            <Button onClick={onClose}>{t('common.actions.close')}</Button>
          </>
        ) : (
          <Button onClick={run} isLoading={running} disabled={running}>
            {t('interchange.chooseFolderAndExport')}
          </Button>
        )}
      </div>
    </Modal>
  );
}
