import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, Search, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { Card, Button, Badge } from '../common/ui';
import { Input } from '../common/forms';
import Tx from '../translation/Tx';
import { showToast } from '../../stores/toastStore';
import { showOpenDialog, dmmMigrateScan, dmmMigrateExecute } from '../../lib/api';
import type { DmmMigrationReport } from '../../lib/dmmMigration';

/**
 * Settings section: migrate an existing Deadlock Mod Manager (DMM) install into
 * Grimoire by adopting its on-disk VPKs and attaching metadata. Non-destructive
 * (DMM's files are copied, not moved) and entirely local (no DMM cloud).
 *
 * Two-step flow: Scan builds a non-mutating preview of what would be adopted;
 * Migrate executes the copy + metadata write.
 */
export default function DmmMigrateSection() {
  const { t } = useTranslation();
  const [dmmDir, setDmmDir] = useState('');
  const [scanning, setScanning] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [report, setReport] = useState<DmmMigrationReport | null>(null);

  const handleBrowse = useCallback(async () => {
    const selected = await showOpenDialog({
      directory: true,
      title: t('settings.dmmMigrate.selectFolderTitle', 'Select the DMM addons folder'),
    });
    if (selected) {
      setDmmDir(selected);
      setReport(null);
    }
  }, [t]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setReport(null);
    try {
      const result = await dmmMigrateScan({ dmmAddonsDir: dmmDir || undefined });
      setReport(result);
    } catch (err) {
      showToast(
        t('settings.dmmMigrate.scanFailed', 'Could not scan that folder') + ': ' + String(err),
        { tone: 'error', duration: 8000, dismissable: true }
      );
    } finally {
      setScanning(false);
    }
  }, [dmmDir, t]);

  const handleMigrate = useCallback(async () => {
    setMigrating(true);
    try {
      const result = await dmmMigrateExecute({ dmmAddonsDir: dmmDir || undefined });
      setReport(result);
      showToast(
        t('settings.dmmMigrate.migrated', {
          count: result.adopted.length,
          defaultValue: 'Imported {{count}} mods from DMM',
        }),
        { tone: 'success', duration: 6000 }
      );
    } catch (err) {
      showToast(
        t('settings.dmmMigrate.migrateFailed', 'Migration failed') + ': ' + String(err),
        { tone: 'error', duration: 8000, dismissable: true }
      );
    } finally {
      setMigrating(false);
    }
  }, [dmmDir, t]);

  const enabledCount = report?.preview.filter((p) => p.enabled).length ?? 0;
  const disabledCount = report?.preview.filter((p) => !p.enabled).length ?? 0;
  const busy = scanning || migrating;

  return (
    <Card
      title={<Tx k="settings.dmmMigrate.title" fallback="Migrate from Deadlock Mod Manager" />}
      icon={ArrowRightLeft}
      className="lg:col-span-2"
    >
      <p className="text-xs text-text-secondary">
        <Tx
          k="settings.dmmMigrate.description"
          fallback="Adopt the mods from an existing Deadlock Mod Manager install. Grimoire reads DMM's data and attaches metadata to the mods, so nothing is re-downloaded and no DMM server is contacted. If DMM shares Grimoire's addons folder (the default), the mods are adopted in place."
        />
      </p>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="flex-1">
          <label className="text-xs text-text-secondary">
            <Tx k="settings.dmmMigrate.folderLabel" fallback="DMM addons folder (optional)" />
          </label>
          <Input
            value={dmmDir}
            onChange={(e) => setDmmDir(e.target.value)}
            placeholder={t('settings.dmmMigrate.folderPlaceholder', 'Leave empty for the default install; set only if DMM uses a separate folder')}
          />
        </div>
        <Button onClick={handleBrowse} variant="secondary" icon={FolderOpen} disabled={busy}>
          <Tx k="settings.dmmMigrate.browse" fallback="Browse" />
        </Button>
        <Button onClick={handleScan} variant="secondary" icon={Search} disabled={busy} isLoading={scanning}>
          <Tx k="settings.dmmMigrate.scan" fallback="Scan" />
        </Button>
      </div>

      {report && (
        <div className="flex flex-col gap-2 rounded-md bg-black/20 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{report.profileName}</span>
            <Badge variant="success">
              {t('settings.dmmMigrate.enabledCount', { count: enabledCount, defaultValue: '{{count}} on' })}
            </Badge>
            <Badge variant="neutral">
              {t('settings.dmmMigrate.disabledCount', { count: disabledCount, defaultValue: '{{count}} off' })}
            </Badge>
            <Badge variant={report.enrichment === 'state.json' ? 'success' : 'warning'}>
              {report.enrichment === 'state.json'
                ? t('settings.dmmMigrate.fullMetadata', 'full metadata')
                : t('settings.dmmMigrate.partialMetadata', 'partial metadata')}
            </Badge>
            <Badge variant="neutral">
              {report.mode === 'in-place'
                ? t('settings.dmmMigrate.modeInPlace', 'in place, no copy')
                : t('settings.dmmMigrate.modeCopy', 'copied')}
            </Badge>
          </div>

          {report.adopted.length > 0 && (
            <p className="text-xs text-text-secondary">
              {t(
                'settings.dmmMigrate.adoptedSummary',
                'Imported into the Installed tab. Mods keep their DMM on/off state, so most arrive turned off. Turn on the ones you want in Installed.'
              )}
            </p>
          )}

          {report.skipped.length > 0 && (
            <p className="text-xs text-warning flex items-center gap-1">
              <AlertTriangle size={12} />
              {t('settings.dmmMigrate.skippedSummary', {
                count: report.skipped.length,
                defaultValue: '{{count}} skipped',
              })}
            </p>
          )}

          {report.warnings.map((w, i) => (
            <p key={i} className="text-xs text-text-secondary">
              {w}
            </p>
          ))}

          {report.adopted.length === 0 && report.preview.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={handleMigrate} icon={ArrowRightLeft} disabled={busy} isLoading={migrating}>
                <Tx k="settings.dmmMigrate.migrate" fallback="Migrate" />
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
