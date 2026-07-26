import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  EyeOff,
  Fingerprint,
  FilePlus,
  ImagePlus,
  Loader2,
  Plus,
  UploadCloud,
  X,
} from 'lucide-react';
import { Modal } from './common/Modal';
import { Button, IconButton, ModalHeader, Tag } from './common/ui';
import { Input } from './common/forms';
import {
  onImportCustomModsProgress,
  peekImprint,
  readImageDataUrl,
  showOpenDialog,
  showOpenDialogMulti,
} from '../lib/api';
import type {
  ImportCustomModArgs,
  ImportCustomModResult,
  PeekImprintResult,
} from '../lib/api';
import {
  IMAGE_EXTS,
  VPK_IMPORT_EXTS,
  VPK_IMPORT_RE,
  deriveModNameFromPath,
} from '../lib/customModImport';

type RowStatus = 'pending' | 'importing' | 'done' | 'failed';

interface ImportRow {
  /** Stable key, independent of the path (which is also the dedupe key). */
  id: string;
  path: string;
  name: string;
  /** The current name came from the user typing, not from a parse/peek fill. */
  nameTouched: boolean;
  imagePath: string;
  thumbnailDataUrl: string;
  nsfw: boolean;
  recognized: PeekImprintResult | null;
  status: RowStatus;
  imported: number;
  error?: string;
}

interface ImportCustomModsModalProps {
  onClose: () => void;
  /** Runs the batch. Resolves with one result per item, in the order given. */
  onImport: (items: ImportCustomModArgs[]) => Promise<ImportCustomModResult[]>;
  /** Fired once after a batch, with every source's outcome. The page reports
   *  these as toasts too: on a first-ever import the mod list flips from empty
   *  to non-empty, which re-renders this dialog from the page's other branch
   *  and resets it, so the inline row errors alone can't be the only channel. */
  onFinished?: (results: ImportCustomModResult[]) => void;
}

let rowSeq = 0;
const nextRowId = (): string => `row-${++rowSeq}`;

const fileNameOf = (p: string): string => p.split(/[\\/]/).pop() ?? p;

/**
 * Batch local import: pick or drop any number of `.vpk` files and archives, get
 * a row per file with its name already parsed from the filename, and import the
 * lot in one go. Every row is editable (name, thumbnail, NSFW) for the users who
 * want per-file settings, but the default path is: drop, glance, import.
 *
 * Failures are per row, not per batch: the main process keeps going after a bad
 * source, so a corrupt archive in the middle of 20 files doesn't cost the other
 * 19. Rows that landed disappear; rows that failed stay put with the reason, so
 * the button retries exactly what's left.
 */
export default function ImportCustomModsModal({
  onClose,
  onImport,
  onFinished,
}: ImportCustomModsModalProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Row ids in submit order, so a progress event's index maps back to a row.
  const submittedIdsRef = useRef<string[]>([]);

  const patchRow = useCallback((id: string, patch: Partial<ImportRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  // Progress is streamed while the batch runs so a long copy shows movement
  // instead of one frozen spinner. Subscribed for the modal's whole life: the
  // main process only emits during our own invoke.
  useEffect(() => {
    return onImportCustomModsProgress((progress) => {
      const id = submittedIdsRef.current[progress.index];
      if (!id) return;
      if (progress.phase === 'importing') {
        patchRow(id, { status: 'importing', error: undefined });
      } else if (progress.phase === 'done') {
        patchRow(id, { status: 'done', imported: progress.imported ?? 1 });
      } else {
        patchRow(id, { status: 'failed', error: progress.error });
      }
    });
  }, [patchRow]);

  /**
   * Best-effort imprint recognition for a bare `.vpk`: a re-imported Grimoire
   * file already knows its own title. Archives skip it (extraction happens later
   * in main, and every extracted VPK still goes through adoption at import time,
   * so nothing is lost). Only fills a name the user hasn't typed over.
   */
  const peekRow = useCallback(
    (id: string, path: string) => {
      if (!path.toLowerCase().endsWith('.vpk')) return;
      void peekImprint(path)
        .then((result) => {
          if (!result) return;
          setRows((prev) =>
            prev.map((row) =>
              row.id === id
                ? {
                    ...row,
                    recognized: result,
                    name: result.title && !row.nameTouched ? result.title : row.name,
                  }
                : row
            )
          );
        })
        .catch(() => {
          // Recognition is a nicety; a failed peek just shows no note.
        });
    },
    []
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const fresh: ImportRow[] = [];
      setRows((prev) => {
        const seen = new Set(prev.map((row) => row.path));
        for (const path of paths) {
          if (seen.has(path)) continue;
          seen.add(path);
          fresh.push({
            id: nextRowId(),
            path,
            name: deriveModNameFromPath(path),
            nameTouched: false,
            imagePath: '',
            thumbnailDataUrl: '',
            nsfw: false,
            recognized: null,
            status: 'pending',
            imported: 0,
          });
        }
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      for (const row of fresh) peekRow(row.id, row.path);
    },
    [peekRow]
  );

  const pickFiles = async () => {
    if (submitting) return;
    const picked = await showOpenDialogMulti({
      title: t('installed.batchImport.selectFiles'),
      filters: [{ name: 'VPK or archive', extensions: VPK_IMPORT_EXTS }],
    });
    setError(null);
    addPaths(picked);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (submitting) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    const paths: string[] = [];
    const rejected: string[] = [];
    let unresolved = 0;
    for (const file of files) {
      if (!VPK_IMPORT_RE.test(file.name)) {
        rejected.push(file.name);
        continue;
      }
      // No real on-disk path: almost always a file dragged out of Windows'
      // built-in zip viewer (a virtual shell file). Point them at the zip itself.
      const path = window.electronAPI.getDroppedFilePath(file);
      if (!path) unresolved++;
      else paths.push(path);
    }

    if (unresolved > 0) setError(t('installed.import.dropUnresolved'));
    else if (rejected.length > 0) setError(t('installed.import.expectedVpk', { name: rejected[0] }));
    else setError(null);
    addPaths(paths);
  };

  const pickThumbnail = async (row: ImportRow) => {
    if (submitting) return;
    const picked = await showOpenDialog({
      title: t('installed.imageField.selectImage'),
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }],
    });
    if (!picked) return;
    try {
      const dataUrl = await readImageDataUrl(picked);
      patchRow(row.id, { imagePath: picked, thumbnailDataUrl: dataUrl });
      setError(null);
    } catch (err) {
      patchRow(row.id, { imagePath: '', thumbnailDataUrl: '' });
      setError(t('installed.imageField.readFailed', { error: String(err) }));
    }
  };

  const dropThumbnail = async (row: ImportRow, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (submitting) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!IMAGE_EXTS.includes(ext)) {
      setError(t('installed.imageField.expectedImage', { exts: IMAGE_EXTS.join(', '), name: file.name }));
      return;
    }
    const path = window.electronAPI.getDroppedFilePath(file);
    if (!path) {
      setError(t('installed.imageField.dropUnresolved'));
      return;
    }
    try {
      const dataUrl = await readImageDataUrl(path);
      patchRow(row.id, { imagePath: path, thumbnailDataUrl: dataUrl });
      setError(null);
    } catch (err) {
      setError(t('installed.imageField.readFailed', { error: String(err) }));
    }
  };

  const allNsfw = rows.length > 0 && rows.every((row) => row.nsfw);
  const namedRows = rows.filter((row) => row.name.trim().length > 0);
  const canSubmit = rows.length > 0 && namedRows.length === rows.length && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const batch = rows;
    submittedIdsRef.current = batch.map((row) => row.id);
    setRows((prev) => prev.map((row) => ({ ...row, status: 'pending', error: undefined })));

    try {
      const results = await onImport(
        batch.map((row) => ({
          vpkPath: row.path,
          name: row.name.trim(),
          thumbnailDataUrl: row.thumbnailDataUrl || undefined,
          nsfw: row.nsfw,
        }))
      );

      const failedIds = new Set<string>();
      results.forEach((result, index) => {
        const id = batch[index]?.id;
        if (id && !result.ok) failedIds.add(id);
      });
      onFinished?.(results);

      // Drop what landed, keep what didn't (with its reason) so the button
      // retries exactly the leftovers.
      if (failedIds.size === 0) {
        onClose();
        return;
      }
      setRows((prev) =>
        prev
          .filter((row) => failedIds.has(row.id))
          .map((row) => {
            const index = batch.findIndex((b) => b.id === row.id);
            const result = index >= 0 ? results[index] : undefined;
            return { ...row, status: 'failed' as const, error: result?.error };
          })
      );
      setError(t('installed.batchImport.someFailed', { count: failedIds.size }));
      setSubmitting(false);
    } catch (err) {
      // The batch never ran (no game path, empty list): nothing landed.
      setError(String(err));
      setRows((prev) => prev.map((row) => ({ ...row, status: 'pending' as const })));
      setSubmitting(false);
    }
  };

  const statusIcon = (row: ImportRow) => {
    if (row.status === 'importing') {
      return <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-accent" aria-hidden />;
    }
    if (row.status === 'done') {
      return <Check className="h-4 w-4 flex-shrink-0 text-state-success" aria-hidden />;
    }
    if (row.status === 'failed') {
      return <AlertCircle className="h-4 w-4 flex-shrink-0 text-state-danger" aria-hidden />;
    }
    return null;
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="import-custom-mods-title"
      size="xl"
      dismissable={!submitting}
      panelClassName="flex max-h-[85vh] flex-col overflow-hidden"
    >
      <ModalHeader
        title={t('installed.batchImport.title')}
        titleId="import-custom-mods-title"
        subtitle={rows.length > 0 ? t('installed.batchImport.fileCount', { count: rows.length }) : undefined}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
        closeDisabled={submitting}
      />

      <div
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3.5"
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); if (!submitting) setDragActive(true); }}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = submitting ? 'none' : 'copy'; if (!submitting) setDragActive(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); }}
        onDrop={handleDrop}
      >
        <p className="text-xs leading-5 text-text-secondary">{t('installed.batchImport.help')}</p>

        {rows.length === 0 ? (
          <div
            role="button"
            tabIndex={0}
            aria-label={t('installed.batchImport.ariaBrowse')}
            onClick={pickFiles}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void pickFiles();
              }
            }}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-10 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-secondary ${
              dragActive
                ? 'border-accent bg-accent/10'
                : 'cursor-pointer border-border bg-bg-tertiary/40 hover:border-white/20 hover:bg-bg-tertiary'
            }`}
          >
            <UploadCloud className="h-7 w-7 text-text-secondary" aria-hidden />
            <span className="text-sm font-medium text-text-primary">
              <Trans
                i18nKey="installed.batchImport.dropFilesHere"
                components={{ code: <code className="font-mono text-accent" /> }}
              />
            </span>
            <span className="text-xs text-text-secondary">{t('installed.import.orClickToBrowse')}</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-text-secondary">
                {t('installed.batchImport.namesHint')}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" icon={Plus} onClick={pickFiles} disabled={submitting}>
                  {t('installed.batchImport.addMore')}
                </Button>
                {rows.length > 1 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={EyeOff}
                    onClick={() => setRows((prev) => prev.map((row) => ({ ...row, nsfw: !allNsfw })))}
                    disabled={submitting}
                  >
                    {allNsfw ? t('installed.batchImport.clearAllNsfw') : t('installed.batchImport.markAllNsfw')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setRows([]); setError(null); }}
                  disabled={submitting}
                >
                  {t('installed.batchImport.clearAll')}
                </Button>
              </div>
            </div>

            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className={`flex items-center gap-2.5 rounded-lg border p-2 transition-colors ${
                    row.status === 'failed'
                      ? 'border-state-danger/40 bg-red-500/5'
                      : 'border-border bg-bg-tertiary/40'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void pickThumbnail(row)}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; }}
                    onDrop={(e) => void dropThumbnail(row, e)}
                    disabled={submitting}
                    title={t('installed.batchImport.thumbnailHint')}
                    aria-label={t('installed.batchImport.thumbnailHint')}
                    className="flex aspect-video w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-bg-tertiary text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    {row.thumbnailDataUrl ? (
                      <img
                        src={row.thumbnailDataUrl}
                        alt={t('installed.imageField.thumbnailPreview')}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <ImagePlus className="h-4 w-4" aria-hidden />
                    )}
                  </button>

                  <div className="min-w-0 flex-1">
                    <Input
                      inputSize="sm"
                      value={row.name}
                      onChange={(e) => patchRow(row.id, { name: e.target.value, nameTouched: true })}
                      placeholder={t('installed.import.modNamePlaceholder')}
                      disabled={submitting}
                      aria-label={t('installed.batchImport.nameFor', { file: fileNameOf(row.path) })}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="truncate font-mono text-[11px] text-text-secondary" title={row.path}>
                        {fileNameOf(row.path)}
                      </span>
                      {row.recognized && (
                        <Tag tone="success" icon={Fingerprint}>
                          {t('installed.import.recognizedFromImprint')}
                        </Tag>
                      )}
                      {row.recognized?.gamebananaId && (
                        <Tag tone="neutral">
                          {t('installed.import.recognizedGameBananaId', { id: row.recognized.gamebananaId })}
                        </Tag>
                      )}
                      {row.status === 'done' && row.imported > 1 && (
                        <Tag tone="neutral">{t('installed.batchImport.importedCount', { count: row.imported })}</Tag>
                      )}
                      {row.error && (
                        <span className="text-[11px] text-state-danger">{row.error}</span>
                      )}
                    </div>
                  </div>

                  {statusIcon(row)}

                  <button
                    type="button"
                    onClick={() => patchRow(row.id, { nsfw: !row.nsfw })}
                    disabled={submitting}
                    aria-pressed={row.nsfw}
                    title={t('installed.imageField.nsfw')}
                    className={`flex-shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${
                      row.nsfw
                        ? 'border-accent/50 bg-accent/15 text-accent'
                        : 'border-border text-text-secondary hover:border-white/20 hover:text-text-primary'
                    }`}
                  >
                    {t('installed.imageField.nsfw')}
                  </button>

                  <IconButton
                    icon={X}
                    size="sm"
                    label={t('installed.batchImport.removeFile', { file: fileNameOf(row.path) })}
                    onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                    disabled={submitting}
                  />
                </li>
              ))}
            </ul>

            <div
              className={`rounded-lg border border-dashed px-3 py-2.5 text-center text-xs transition-colors ${
                dragActive ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary'
              }`}
            >
              {t('installed.batchImport.dropMoreHere')}
            </div>
          </>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-sm text-state-danger">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-center border-t border-border px-5 py-3">
        <Button
          variant="primary"
          icon={FilePlus}
          onClick={handleSubmit}
          disabled={!canSubmit}
          isLoading={submitting}
          className="!px-10 !py-1.5"
        >
          {rows.length > 1
            ? t('installed.batchImport.importCount', { count: rows.length })
            : t('profiles.actions.import')}
        </Button>
      </div>
    </Modal>
  );
}
