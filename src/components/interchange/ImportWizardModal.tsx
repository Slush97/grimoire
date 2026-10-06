import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import {
  associateUnknownMod,
  detectUnknownModFilters,
  getModDetails,
  importInterchangeSelection,
  onInterchangeProgress,
  readInterchangeSource,
} from '../../lib/api';
import type {
  InterchangeImportReport,
  InterchangeMod,
  InterchangePreview,
  InterchangeProgress,
  InterchangeSourceRequest,
} from '../../lib/modInterchange';
import { getModThumbnail } from '../../types/gamebanana';
import { showToast } from '../../stores/toastStore';
import { Modal } from '../common/Modal';
import { Button, CheckboxMark, ModalHeader, Tag } from '../common/ui';
import { Input } from '../common/forms';

type Step = 'loading' | 'contents' | 'importing' | 'unrecognized' | 'done';

interface ImportWizardModalProps {
  source: InterchangeSourceRequest;
  sourceName: string;
  onClose: () => void;
  /** Called once anything changed, so the library reloads. */
  onImported: () => void;
}

interface Suggestion {
  gameBananaId: number;
  modName: string;
  fileId?: number;
  thumbnailUrl?: string;
  nsfw?: boolean;
  categoryName?: string;
  section?: 'Mod' | 'Sound';
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** A GameBanana link or bare id -> submission id and section. */
function parseReference(input: string): { id: number; section: 'Mod' | 'Sound' } | null {
  const text = input.trim();
  const bare = /^(snd-)?([1-9]\d*)$/i.exec(text);
  if (bare) return { id: Number(bare[2]), section: bare[1] ? 'Sound' : 'Mod' };
  const link = /gamebanana\.com\/(mods|sounds)\/([1-9]\d*)/i.exec(text);
  if (!link) return null;
  return { id: Number(link[2]), section: link[1].toLowerCase() === 'sounds' ? 'Sound' : 'Mod' };
}

function Check({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <>
      <input
        type="checkbox"
        className="peer sr-only"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <CheckboxMark checked={checked} disabled={disabled} />
    </>
  );
}

/**
 * Transfer from another mod manager in steps: choose what to bring over
 * (mods, profiles, crosshairs; sections the source lacks are shown but
 * disabled), watch the import, then optionally identify mods that arrived
 * without a GameBanana link.
 */
export default function ImportWizardModal({
  source,
  sourceName,
  onClose,
  onImported,
}: ImportWizardModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('loading');
  const [preview, setPreview] = useState<InterchangePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modKeys, setModKeys] = useState<Set<string>>(new Set());
  const [profileKeys, setProfileKeys] = useState<Set<string>>(new Set());
  const [crosshairKeys, setCrosshairKeys] = useState<Set<string>>(new Set());
  const [showMods, setShowMods] = useState(false);
  const [progress, setProgress] = useState<InterchangeProgress | null>(null);
  const [report, setReport] = useState<InterchangeImportReport | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion | 'none'>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await readInterchangeSource(source);
        if (cancelled) return;
        setPreview(result);
        const fresh = result.document.mods.filter((m) => result.status[m.key] === 'new');
        setModKeys(new Set(fresh.map((m) => m.key)));
        setCrosshairKeys(new Set(result.document.crosshairs.map((c) => c.key)));
        setStep('contents');
      } catch (err) {
        if (!cancelled) setError(errorText(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const document = preview?.document ?? null;
  const selectable = useMemo(
    () => document?.mods.filter((m) => preview?.status[m.key] === 'new') ?? [],
    [document, preview]
  );
  const unrecognized = useMemo(
    () => (report?.results ?? []).filter((r) => r.status === 'imported' && r.local && r.modId),
    [report]
  );

  const toggle = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  const start = async () => {
    if (!document) return;
    setStep('importing');
    setWorking(true);
    const stop = onInterchangeProgress(setProgress);
    try {
      const result = await importInterchangeSelection(document, {
        modKeys: [...modKeys],
        profileKeys: [...profileKeys],
        crosshairKeys: [...crosshairKeys],
      });
      setReport(result);
      onImported();
      const locals = result.results.filter((r) => r.status === 'imported' && r.local && r.modId);
      setStep(locals.length > 0 ? 'unrecognized' : 'done');
    } catch (err) {
      showToast(t('interchange.importFailed', { error: errorText(err) }), {
        tone: 'error',
        duration: 8000,
        dismissable: true,
      });
      setStep('contents');
    } finally {
      stop();
      setWorking(false);
    }
  };

  const analyze = async () => {
    setWorking(true);
    let found = 0;
    for (const result of unrecognized) {
      if (!result.modId || linked[result.modId]) continue;
      try {
        const guess = await detectUnknownModFilters(result.modId);
        const match = guess.crcMatch;
        if (match.status === 'found' && match.modId && match.modName) {
          found++;
          setSuggestions((s) => ({
            ...s,
            [result.modId!]: {
              gameBananaId: match.modId!,
              modName: match.modName!,
              fileId: match.fileId,
              thumbnailUrl: match.thumbnailUrl,
              nsfw: match.nsfw,
              categoryName: match.categoryName,
              section: match.section,
            },
          }));
        } else {
          setSuggestions((s) => ({ ...s, [result.modId!]: 'none' }));
        }
      } catch {
        setSuggestions((s) => ({ ...s, [result.modId!]: 'none' }));
      }
    }
    setWorking(false);
    showToast(t('interchange.analyzeResult', { count: found }), { tone: 'info' });
  };

  const link = async (modId: string, target: Suggestion) => {
    setWorking(true);
    try {
      await associateUnknownMod(modId, {
        gameBananaId: target.gameBananaId,
        modName: target.modName,
        gameBananaFileId: target.fileId,
        thumbnailUrl: target.thumbnailUrl,
        nsfw: target.nsfw,
        categoryName: target.categoryName,
        sourceSection: target.section,
      });
      setLinked((l) => ({ ...l, [modId]: target.modName }));
      onImported();
    } catch (err) {
      showToast(errorText(err), { tone: 'error', duration: 8000, dismissable: true });
    } finally {
      setWorking(false);
    }
  };

  const linkManual = async (modId: string) => {
    const reference = parseReference(manual[modId] ?? '');
    if (!reference) {
      showToast(t('interchange.invalidReference'), { tone: 'error' });
      return;
    }
    setWorking(true);
    try {
      const details = await getModDetails(reference.id, reference.section);
      await link(modId, {
        gameBananaId: reference.id,
        modName: details.name,
        thumbnailUrl: getModThumbnail(details) ?? undefined,
        nsfw: details.nsfw,
        categoryName: details.category?.name,
        section: reference.section,
      });
    } catch (err) {
      showToast(errorText(err), { tone: 'error', duration: 8000, dismissable: true });
      setWorking(false);
    }
  };

  const percent = progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const nothingSelected = modKeys.size === 0 && profileKeys.size === 0 && crosshairKeys.size === 0;
  const hasProfiles = (document?.profiles.length ?? 0) > 0;
  const hasCrosshairs = (document?.crosshairs.length ?? 0) > 0;

  const section = (
    id: string,
    checked: boolean,
    onChange: (on: boolean) => void,
    title: string,
    detail: string,
    disabled = false
  ) => (
    <label
      className={`flex items-start gap-3 rounded-sm border border-border p-3 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-hl/5'}`}
      data-testid={id}
    >
      <Check checked={checked} disabled={disabled} onChange={onChange} label={title} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        <p className="text-xs text-text-secondary">{detail}</p>
      </div>
    </label>
  );

  const modRow = (mod: InterchangeMod) => {
    const status = preview?.status[mod.key];
    const disabled = status !== 'new';
    const size = mod.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    return (
      <li key={mod.key}>
        <label className={`flex items-center gap-3 px-3 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-hl/5'}`}>
          <Check
            checked={modKeys.has(mod.key)}
            disabled={disabled}
            onChange={(on) => setModKeys((s) => toggle(s, mod.key, on))}
            label={mod.name}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-primary">{mod.name}</p>
            <p className="text-xs text-text-secondary">
              {t('interchange.fileCount', { count: mod.files.length })}
              {size > 0 ? ` · ${formatSize(size)}` : ''}
              {mod.category ? ` · ${mod.category}` : ''}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {status === 'managed' && <Tag>{t('interchange.inLibrary')}</Tag>}
            {status === 'unknown-catalog' && <Tag tone="warning">{t('interchange.unknownCatalog')}</Tag>}
            <Tag>{mod.origin.provider === 'gamebanana' ? 'GameBanana' : t('interchange.local')}</Tag>
            <Tag tone={mod.enabled ? 'accent' : 'neutral'}>
              {mod.enabled ? t('interchange.enabled') : t('interchange.disabled')}
            </Tag>
          </div>
        </label>
      </li>
    );
  };

  const busy = step === 'loading' || step === 'importing' || working;

  return (
    <Modal
      onClose={onClose}
      dismissable={!busy || !!error}
      size="xl"
      labelledBy="interchange-wizard-title"
      panelClassName="flex max-h-[85vh] flex-col"
    >
      <ModalHeader
        title={t('interchange.importTitle', { source: sourceName })}
        titleId="interchange-wizard-title"
        subtitle={t(
          step === 'contents' && source.kind === 'bundle'
            ? 'interchange.stepDescription.contentsBundle'
            : `interchange.stepDescription.${step}`,
          { source: sourceName }
        )}
        onClose={onClose}
        closeLabel={t('common.actions.close')}
        closeDisabled={busy && !error}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {step === 'loading' &&
          (error ? (
            <div className="flex items-start gap-2 whitespace-pre-line rounded-sm border border-state-danger/40 bg-state-danger/10 p-3 text-sm text-text-primary">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-state-danger" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-6 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('interchange.scanning', { source: sourceName })}
            </div>
          ))}

        {step === 'contents' && document && (
          <>
            {document.mods.length === 0 && (
              <p className="rounded-sm border border-border bg-bg-tertiary p-3 text-sm text-text-primary">
                {t('interchange.emptySource', { source: sourceName })}
              </p>
            )}
            {section(
              'interchange-section-mods',
              modKeys.size > 0,
              (on) => setModKeys(on ? new Set(selectable.map((m) => m.key)) : new Set()),
              t('interchange.sectionMods'),
              t('interchange.sectionModsDetail', { count: selectable.length, total: document.mods.length }),
              selectable.length === 0
            )}
            <button
              type="button"
              className="flex items-center gap-1 pl-3 text-xs text-text-secondary hover:text-text-primary cursor-pointer"
              onClick={() => setShowMods((v) => !v)}
            >
              {showMods ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('interchange.chooseMods')}
            </button>
            {showMods && (
              <ul className="divide-y divide-hl/5 rounded-sm border border-border">
                {document.mods.map(modRow)}
              </ul>
            )}

            {section(
              'interchange-section-profiles',
              profileKeys.size > 0,
              (on) => setProfileKeys(on ? new Set(document.profiles.map((p) => p.key)) : new Set()),
              t('interchange.sectionProfiles'),
              hasProfiles
                ? t('interchange.sectionProfilesDetail', { count: document.profiles.length })
                : t('interchange.noProfiles', { source: sourceName }),
              !hasProfiles
            )}
            {hasProfiles && (
              <ul className="space-y-1 pl-8">
                {document.profiles.map((profile) => (
                  <li key={profile.key}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-text-primary">
                      <Check
                        checked={profileKeys.has(profile.key)}
                        onChange={(on) => setProfileKeys((s) => toggle(s, profile.key, on))}
                        label={profile.name}
                      />
                      <span className="truncate">{profile.name}</span>
                      <span className="text-xs text-text-secondary">
                        {t('interchange.profileMods', { count: profile.mods.length })}
                      </span>
                      {profile.active && <Tag tone="accent">{t('interchange.active')}</Tag>}
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {section(
              'interchange-section-crosshairs',
              crosshairKeys.size > 0,
              (on) => setCrosshairKeys(on ? new Set(document.crosshairs.map((c) => c.key)) : new Set()),
              t('interchange.sectionCrosshairs'),
              hasCrosshairs
                ? t('interchange.sectionCrosshairsDetail', { count: document.crosshairs.length })
                : t('interchange.noCrosshairs', { source: sourceName }),
              !hasCrosshairs
            )}

            {document.warnings.length > 0 && (
              <details className="rounded-sm border border-border bg-bg-tertiary p-3 text-sm">
                <summary className="cursor-pointer text-text-primary">
                  {t('interchange.warnings', { count: document.warnings.length })}
                </summary>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-text-secondary">
                  {document.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {step === 'importing' && (
          <div className="space-y-3 py-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
              <div className="h-full bg-accent transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm text-text-secondary">
              {progress
                ? t(`interchange.progress.${progress.stage}`, {
                    current: Math.min(progress.current + 1, progress.total),
                    total: progress.total,
                  })
                : t('interchange.progress.starting')}
              {progress?.name ? ` · ${progress.name}` : ''}
            </p>
          </div>
        )}

        {step === 'unrecognized' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-text-secondary">
                {t('interchange.unrecognizedHint', { count: unrecognized.length })}
              </p>
              <Button variant="secondary" size="sm" icon={Search} onClick={analyze} disabled={working}>
                {t('interchange.analyze')}
              </Button>
            </div>
            <ul className="divide-y divide-hl/5 rounded-sm border border-border">
              {unrecognized.map((result) => {
                const modId = result.modId!;
                const suggestion = suggestions[modId];
                const done = linked[modId];
                return (
                  <li key={modId} className="space-y-2 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-text-primary">{result.name}</p>
                      {done && <Tag tone="success">{t('interchange.linkedBadge', { name: done })}</Tag>}
                    </div>
                    {!done && suggestion && suggestion !== 'none' && (
                      <div className="flex items-center justify-between gap-2 rounded-sm bg-hl/5 px-2 py-1 text-sm">
                        <span>{t('interchange.suggestion', { name: suggestion.modName })}</span>
                        <Button size="sm" onClick={() => link(modId, suggestion)} disabled={working}>
                          {t('interchange.useSuggestion')}
                        </Button>
                      </div>
                    )}
                    {!done && suggestion === 'none' && (
                      <p className="text-xs text-text-secondary">{t('interchange.noMatch')}</p>
                    )}
                    {!done && (
                      <div className="flex gap-2">
                        <Input
                          inputSize="sm"
                          value={manual[modId] ?? ''}
                          placeholder={t('interchange.linkPlaceholder')}
                          onChange={(e) => setManual((m) => ({ ...m, [modId]: e.target.value }))}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={working || !manual[modId]?.trim()}
                          onClick={() => linkManual(modId)}
                        >
                          {t('interchange.link')}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {step === 'done' && report && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium text-text-primary">
              <CheckCircle2 className="h-5 w-5 text-state-success" />
              {t('interchange.summary', {
                imported: report.results.filter((r) => r.status === 'imported').length,
                skipped: report.results.filter((r) => r.status !== 'imported').length,
              })}
            </div>
            <ul className="space-y-1 text-text-secondary">
              {report.profiles.map((p) => (
                <li key={p.name}>
                  {p.updated
                    ? t('interchange.profileUpdated', { name: p.name, count: p.mods })
                    : p.created
                      ? t('interchange.profileCreated', { name: p.name, count: p.mods })
                      : t('interchange.profileFailed', { name: p.name, error: p.reason ?? '' })}
                  {p.created && p.reason ? ` (${p.reason})` : ''}
                </li>
              ))}
              {report.crosshairs > 0 && <li>{t('interchange.crosshairsAdded', { count: report.crosshairs })}</li>}
              {Object.keys(linked).length > 0 && (
                <li>{t('interchange.linkedCount', { count: Object.keys(linked).length })}</li>
              )}
              {report.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <ul className="max-h-48 space-y-1 overflow-y-auto">
              {report.results
                .filter((r) => r.reason)
                .map((r) => (
                  <li key={r.key}>
                    <span className="font-medium text-text-primary">{r.name}</span>
                    <span className="text-text-secondary"> · {r.reason}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
        {step === 'contents' && (
          <Button onClick={start} disabled={nothingSelected}>
            {t('interchange.startImport')}
          </Button>
        )}
        {step === 'unrecognized' && (
          <Button onClick={() => setStep('done')} disabled={working}>
            {unrecognized.every((r) => linked[r.modId!])
              ? t('interchange.continue')
              : t('interchange.skipIdentification')}
          </Button>
        )}
        {(step === 'done' || error) && <Button onClick={onClose}>{t('common.actions.close')}</Button>}
      </div>
    </Modal>
  );
}
