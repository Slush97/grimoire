import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Loader2,
  Download,
  CheckCircle2,
  AlertTriangle,
  ArrowUpCircle,
  FileText,
  Terminal,
} from 'lucide-react';
import { Button } from '../common/ui';
import ModThumbnail from '../ModThumbnail';
import {
  parsePortableProfile,
  resolvePortableProfile,
  finalizePortableImport,
  downloadMod,
} from '../../lib/api';
import type {
  PortableProfile,
  PortableResolutionReport,
  PortableResolvedMod,
} from '../../types/portableProfile';

interface ImportProfileDialogProps {
  activeDeadlockPath: string | null;
  hideNsfwPreviews: boolean;
  onClose: () => void;
  onImported: () => void;
  // When provided, the dialog skips the paste-and-click step: the input is
  // prefilled and parsed automatically. Used by the Discover flow to hand a
  // share code straight from a profile card into resolution.
  initialInput?: string;
}

type RowStatus =
  | 'pending'
  | 'queued'
  | 'downloading'
  | 'installed'
  | 'failed'
  | 'skipped';

interface RowState {
  mod: PortableResolvedMod;
  selected: boolean;
  status: RowStatus;
  statusMessage?: string;
  progress?: { downloaded: number; total: number };
}

function gbId(mod: PortableResolvedMod): number | null {
  if (mod.entry.source !== 'gamebanana') return null;
  const ref = mod.entry.ref as { submissionId?: number };
  return ref.submissionId ?? null;
}

export default function ImportProfileDialog({
  activeDeadlockPath,
  hideNsfwPreviews,
  onClose,
  onImported,
  initialInput,
}: ImportProfileDialogProps) {
  const [input, setInput] = useState(initialInput ?? '');
  const [parsed, setParsed] = useState<PortableProfile | null>(null);
  const [report, setReport] = useState<PortableResolutionReport | null>(null);
  const [rows, setRows] = useState<RowState[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [importedProfileName, setImportedProfileName] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [includeAutoexec, setIncludeAutoexec] = useState(true);

  const rowsRef = useRef<RowState[]>([]);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Mirror the editable name so the finalize effect can read it without
  // depending on profileName: depending on it would re-trigger the finalize
  // on every keystroke, racing the importedProfileName guard.
  const profileNameRef = useRef('');
  useEffect(() => { profileNameRef.current = profileName; }, [profileName]);

  const includeAutoexecRef = useRef(true);
  useEffect(() => { includeAutoexecRef.current = includeAutoexec; }, [includeAutoexec]);

  const trackedIds = useMemo(() => {
    const s = new Set<number>();
    for (const r of rows) {
      const id = gbId(r.mod);
      if (id !== null) s.add(id);
    }
    return s;
  }, [rows]);
  const trackedIdsRef = useRef(trackedIds);
  useEffect(() => { trackedIdsRef.current = trackedIds; }, [trackedIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !importing) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, importing]);

  // Listen for download events to drive row status during import.
  useEffect(() => {
    const updateRowByGb = (id: number, patch: Partial<RowState>) => {
      setRows((prev) => prev.map((r) => (gbId(r.mod) === id ? { ...r, ...patch } : r)));
    };

    const unsubQueue = window.electronAPI.onDownloadQueueUpdated((data) => {
      const queuedSet = new Set(data.queue.map((q) => q.modId));
      const currentId = data.currentDownload?.modId;
      setRows((prev) =>
        prev.map((r) => {
          const id = gbId(r.mod);
          if (id === null || !trackedIdsRef.current.has(id)) return r;
          if (r.status === 'installed' || r.status === 'failed' || r.status === 'skipped') return r;
          if (currentId === id) return r.status === 'downloading' ? r : { ...r, status: 'downloading' };
          if (queuedSet.has(id)) return r.status === 'queued' ? r : { ...r, status: 'queued' };
          return r;
        })
      );
    });

    const unsubComplete = window.electronAPI.onDownloadComplete(({ modId }) => {
      if (!trackedIdsRef.current.has(modId)) return;
      updateRowByGb(modId, { status: 'installed', statusMessage: undefined });
    });

    const unsubError = window.electronAPI.onDownloadError(({ modId, message }) => {
      if (!trackedIdsRef.current.has(modId)) return;
      updateRowByGb(modId, { status: 'failed', statusMessage: message });
    });

    const unsubProgress = window.electronAPI.onDownloadProgress(({ modId, downloaded, total }) => {
      if (!trackedIdsRef.current.has(modId)) return;
      setRows((prev) =>
        prev.map((r) =>
          gbId(r.mod) === modId
            ? { ...r, progress: { downloaded, total } }
            : r
        )
      );
    });

    return () => { unsubQueue(); unsubComplete(); unsubError(); unsubProgress(); };
  }, []);

  const handleParse = useCallback(async () => {
    setParseError(null);
    setFinalizeError(null);
    setReport(null);
    setRows([]);
    setParsed(null);
    if (!input.trim()) {
      setParseError('Paste a share code or JSON profile first.');
      return;
    }
    setResolving(true);
    try {
      const profile = await parsePortableProfile(input.trim());
      setParsed(profile);
      setProfileName(profile.profile.name);
      const r = await resolvePortableProfile(profile);
      setReport(r);
      setRows(
        r.resolved.map((mod) => ({
          mod,
          selected: mod.status !== 'unresolvable',
          status: 'pending',
        }))
      );
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }, [input]);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    setInput(text);
  }, []);

  // Auto-parse when invoked with a prefilled share code (Discover → Import).
  const didAutoParseRef = useRef(false);
  useEffect(() => {
    if (didAutoParseRef.current) return;
    if (!initialInput || !initialInput.trim()) return;
    didAutoParseRef.current = true;
    void handleParse();
    // handleParse is stable for the lifetime of `input`; we only want this to
    // run once for the prefilled value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleRow = useCallback((idx: number) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, selected: !r.selected } : r)));
  }, []);

  const toggleAll = useCallback(() => {
    setRows((prev) => {
      const selectable = prev.filter((r) => r.mod.status !== 'unresolvable');
      const allOn = selectable.every((r) => r.selected);
      return prev.map((r) =>
        r.mod.status === 'unresolvable' ? r : { ...r, selected: !allOn }
      );
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!parsed || !report || !activeDeadlockPath) return;
    setImporting(true);
    setFinalizeError(null);

    const accepted: PortableResolvedMod[] = [];
    const startingRows = rowsRef.current.map((r) => {
      if (!r.selected || r.mod.status === 'unresolvable') {
        return { ...r, status: 'skipped' as RowStatus };
      }
      accepted.push(r.mod);
      return { ...r, status: 'queued' as RowStatus };
    });
    setRows(startingRows);

    for (const mod of accepted) {
      if (mod.entry.source !== 'gamebanana') continue;
      if (mod.resolvedFileId === undefined || !mod.resolvedFileName) continue;
      const ref = mod.entry.ref as { submissionId: number; section?: string };
      void downloadMod(
        ref.submissionId,
        mod.resolvedFileId,
        mod.resolvedFileName,
        ref.section || 'Mod'
      ).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setRows((prev) =>
          prev.map((r) =>
            gbId(r.mod) === ref.submissionId && r.status !== 'installed'
              ? { ...r, status: 'failed', statusMessage: message }
              : r
          )
        );
      });
    }
  }, [parsed, report, activeDeadlockPath]);

  const downloadsSettled = useMemo(() => {
    if (!importing) return false;
    return rows.every(
      (r) => r.status === 'installed' || r.status === 'failed' || r.status === 'skipped'
    );
  }, [rows, importing]);

  // Once every accepted download has settled, finalize: build the local
  // profile from the entries that successfully installed.
  useEffect(() => {
    if (!downloadsSettled || !parsed || !report) return;
    if (importedProfileName) return;

    (async () => {
      const installedEntries: PortableResolvedMod[] = [];
      for (const r of rowsRef.current) {
        if (r.status === 'installed') installedEntries.push(r.mod);
      }
      try {
        const finalName = profileNameRef.current.trim() || parsed.profile.name;
        const hasAutoexec = !!parsed.extensions?.grimoire?.autoexecCommands?.length;
        const dropAutoexec = hasAutoexec && !includeAutoexecRef.current;
        const finalProfile = dropAutoexec
          ? {
              ...parsed,
              profile: { ...parsed.profile, name: finalName },
              extensions: {
                ...parsed.extensions,
                grimoire: {
                  ...parsed.extensions?.grimoire,
                  autoexecCommands: undefined,
                },
              },
            }
          : { ...parsed, profile: { ...parsed.profile, name: finalName } };
        const created = await finalizePortableImport({
          profile: finalProfile,
          resolved: installedEntries,
        });
        setImportedProfileName(created.name);
        onImported();
      } catch (err) {
        setFinalizeError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [downloadsSettled, parsed, report, importedProfileName, onImported]);

  const counts = useMemo(() => {
    const c = { queued: 0, downloading: 0, installed: 0, failed: 0, skipped: 0 };
    for (const r of rows) {
      if (r.status === 'queued') c.queued++;
      else if (r.status === 'downloading') c.downloading++;
      else if (r.status === 'installed') c.installed++;
      else if (r.status === 'failed') c.failed++;
      else if (r.status === 'skipped') c.skipped++;
    }
    return c;
  }, [rows]);

  const selectableCount = rows.filter((r) => r.mod.status !== 'unresolvable').length;
  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-profile-title"
      onClick={importing ? undefined : onClose}
    >
      <div
        className="bg-bg-secondary border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-4 sm:p-6 border-b border-white/10">
          <div className="min-w-0">
            <h2 id="import-profile-title" className="text-lg sm:text-xl font-bold text-text-primary">
              Import Profile
            </h2>
            <p className="hidden sm:block text-sm text-text-secondary mt-1">
              Paste a share code or load a .modprofile.json file exported from Grimoire's Profiles tab. This format is Grimoire-only and not compatible with other mod managers.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 transition-colors cursor-pointer text-text-secondary hover:text-text-primary flex-shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!parsed && (
          <div className="p-4 sm:p-6 border-b border-white/10 space-y-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste share code (mp1:...) or full JSON here"
              rows={4}
              className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-md text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent font-mono"
            />
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-text-secondary inline-flex items-center gap-2 cursor-pointer hover:text-text-primary">
                <FileText className="w-4 h-4" />
                <span>Or load from file</span>
                <input
                  type="file"
                  accept=".json,.modprofile.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </label>
              <Button onClick={handleParse} disabled={resolving || !input.trim()} isLoading={resolving}>
                Parse & resolve
              </Button>
            </div>
            {parseError && (
              <div className="text-xs text-red-400 flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}
          </div>
        )}

        {parsed && report && (
          <>
            <div className="px-4 sm:px-6 py-4 border-b border-white/10">
              <label className="block text-[11px] uppercase tracking-wider text-text-secondary mb-1">
                Save as
              </label>
              <input
                type="text"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                disabled={importing || !!importedProfileName}
                placeholder={parsed.profile.name}
                aria-label="Profile name"
                className="w-full px-3 py-2 bg-bg-tertiary border border-white/10 rounded-md text-base font-semibold text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-60"
              />
              {parsed.profile.author && (
                <p className="text-xs text-text-secondary mt-1.5">originally by {parsed.profile.author}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 rounded-sm bg-green-500/10 text-green-300 border border-green-500/20">
                  {report.exactCount} exact
                </span>
                {report.upgradedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-sm bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {report.upgradedCount} upgraded
                  </span>
                )}
                {report.unresolvableCount > 0 && (
                  <span className="px-2 py-0.5 rounded-sm bg-red-500/10 text-red-300 border border-red-500/20">
                    {report.unresolvableCount} unresolvable
                  </span>
                )}
                {parsed.extensions?.grimoire?.crosshair && (
                  <span className="px-2 py-0.5 rounded-sm bg-white/5 text-text-secondary border border-white/10">
                    crosshair
                  </span>
                )}
                {parsed.extensions?.grimoire?.autoexecCommands?.length ? (
                  <span className="px-2 py-0.5 rounded-sm bg-white/5 text-text-secondary border border-white/10 inline-flex items-center gap-1">
                    <Terminal className="w-3 h-3" /> {parsed.extensions.grimoire.autoexecCommands.length} autoexec
                  </span>
                ) : null}
              </div>
            </div>

            <div className="px-4 sm:px-6 py-3 sticky top-0 bg-bg-secondary/95 backdrop-blur border-b border-white/5 z-10">
              <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={selectableCount > 0 && selectedCount === selectableCount}
                  onChange={toggleAll}
                  disabled={selectableCount === 0 || importing}
                  className="accent-accent cursor-pointer"
                />
                <span>
                  {selectedCount === selectableCount && selectableCount > 0
                    ? 'Deselect all'
                    : `Select all (${selectableCount})`}
                </span>
              </label>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <ul className="divide-y divide-white/5">
                {rows.map((r, idx) => {
                  const mod = r.mod;
                  const hint = mod.entry.hint;
                  const isUnresolvable = mod.status === 'unresolvable';
                  const progressPct =
                    r.status === 'downloading' && r.progress && r.progress.total > 0
                      ? Math.min(100, (r.progress.downloaded / r.progress.total) * 100)
                      : null;
                  return (
                    <li key={idx} className="relative px-4 sm:px-6 py-4">
                      {r.status === 'downloading' && (
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-white/5 overflow-hidden">
                          {progressPct === null ? (
                            <div className="h-full w-1/3 bg-accent/70 animate-pulse" />
                          ) : (
                            <div
                              className="h-full bg-accent transition-[width] duration-150 ease-out"
                              style={{ width: `${progressPct}%` }}
                            />
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-3 sm:gap-4">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={() => toggleRow(idx)}
                          disabled={isUnresolvable || importing}
                          className="w-4 h-4 accent-accent cursor-pointer disabled:cursor-not-allowed flex-shrink-0"
                          aria-label={`Toggle ${hint?.name ?? 'mod'}`}
                        />
                        <ModThumbnail
                          src={hint?.thumbnailUrl}
                          alt={hint?.name ?? 'Mod'}
                          nsfw={hint?.nsfw}
                          hideNsfw={hideNsfwPreviews}
                          className="w-14 h-10 sm:w-20 sm:h-14 flex-shrink-0 rounded-sm bg-bg-tertiary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-text-primary truncate">
                            {hint?.name ?? `Submission #${gbId(mod) ?? '?'}`}
                          </div>
                          <div className="text-xs text-text-secondary flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {hint?.category && <span className="truncate max-w-[12rem]">{hint.category}</span>}
                            {hint?.fileLabel && <span className="hidden sm:inline">· {hint.fileLabel}</span>}
                            <span>· p{mod.entry.priority}</span>
                            {!mod.entry.enabled && <span className="text-text-tertiary">· disabled</span>}
                          </div>
                          {mod.status === 'upgraded' && (
                            <div className="text-xs text-blue-300 mt-1 inline-flex items-center gap-1">
                              <ArrowUpCircle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">Original file no longer available, will use newest version</span>
                            </div>
                          )}
                          {mod.status === 'unresolvable' && (
                            <div className="text-xs text-red-400 mt-1 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="truncate">{mod.reason ?? 'Not available on GameBanana'}</span>
                            </div>
                          )}
                          {r.status === 'downloading' && progressPct !== null && (
                            <div className="text-[10px] text-text-tertiary mt-0.5 sm:hidden font-mono">
                              {Math.round(progressPct)}%
                            </div>
                          )}
                        </div>
                        <div className="text-sm flex-shrink-0 text-right sm:min-w-[100px]">
                          {r.status === 'pending' && !isUnresolvable && (
                            <span className="text-text-tertiary text-xs">Ready</span>
                          )}
                          {r.status === 'queued' && (
                            <span className="text-accent inline-flex items-center gap-1.5 justify-end text-xs" title="Queued">
                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                              <span className="hidden sm:inline">Queued</span>
                            </span>
                          )}
                          {r.status === 'downloading' && (
                            <span className="text-accent inline-flex items-center gap-1.5 justify-end text-xs" title="Downloading">
                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                              <span className="hidden sm:inline">
                                {progressPct !== null ? `${Math.round(progressPct)}%` : 'Downloading'}
                              </span>
                            </span>
                          )}
                          {r.status === 'installed' && (
                            <span className="text-green-400 inline-flex items-center gap-1.5 justify-end text-xs" title="Installed">
                              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="hidden sm:inline">Installed</span>
                            </span>
                          )}
                          {r.status === 'failed' && (
                            <span
                              className="text-red-400 inline-flex items-center gap-1.5 justify-end text-xs"
                              title={r.statusMessage ?? 'Failed'}
                            >
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span className="hidden sm:inline">Failed</span>
                            </span>
                          )}
                          {r.status === 'skipped' && (
                            <span className="text-text-tertiary text-xs">Skipped</span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {parsed.extensions?.grimoire?.autoexecCommands?.length ? (
              <div className="px-4 sm:px-6 py-3 border-t border-white/5 bg-yellow-500/5">
                <div className="text-xs text-yellow-200 flex items-start gap-2">
                  <Terminal className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <label className="flex items-center gap-2 cursor-pointer w-fit">
                      <input
                        type="checkbox"
                        checked={includeAutoexec}
                        onChange={(e) => setIncludeAutoexec(e.target.checked)}
                        disabled={importing || !!importedProfileName}
                        className="accent-accent cursor-pointer disabled:cursor-not-allowed"
                        aria-label="Include autoexec commands from this profile"
                      />
                      <span className="font-medium">Include autoexec commands from this profile</span>
                    </label>
                    <div className={`mt-1 space-y-0.5 max-h-24 overflow-y-auto font-mono text-[11px] text-text-secondary ${includeAutoexec ? '' : 'opacity-50 line-through'}`}>
                      {parsed.extensions.grimoire.autoexecCommands.map((cmd, i) => (
                        <div key={i} className="truncate" title={cmd}>{cmd}</div>
                      ))}
                    </div>
                    <div className="text-xs text-text-secondary mt-1">
                      {includeAutoexec
                        ? 'These will be written to autoexec.cfg when you apply the imported profile.'
                        : 'These will be discarded. Your autoexec.cfg will not be modified by this profile.'}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="border-t border-white/10 p-3 sm:p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-text-secondary min-w-0 flex-1">
                {importedProfileName ? (
                  <span className="text-green-400 inline-flex items-center gap-1.5 min-w-0">
                    <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">Imported as "{importedProfileName}"</span>
                  </span>
                ) : importing ? (
                  <span className="truncate inline-block max-w-full">
                    {counts.downloading}↓ · {counts.queued} queued · {counts.installed} done{counts.failed > 0 ? ` · ${counts.failed} failed` : ''}
                  </span>
                ) : (
                  `${selectedCount} of ${selectableCount} selected`
                )}
                {finalizeError && (
                  <div className="text-red-400 mt-1 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {finalizeError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={onClose} disabled={importing && !downloadsSettled}>
                  {importedProfileName ? 'Done' : 'Cancel'}
                </Button>
                {!importedProfileName && (
                  <Button
                    icon={Download}
                    onClick={handleConfirm}
                    disabled={importing || selectedCount === 0 || !activeDeadlockPath || profileName.trim() === ''}
                    isLoading={importing && counts.queued + counts.downloading === 0 && !downloadsSettled}
                  >
                    Import {selectedCount > 0 ? selectedCount : ''}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
