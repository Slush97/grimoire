import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Loader2, AlertTriangle, FilePlus, X, Search, Check, RotateCcw, Beaker, Link2, Banana } from 'lucide-react';
import { getModDetails, browseMods } from '../../../lib/api';
import type { Mod, UnknownModDetectionProgress, UnknownModFilterGuess, AssociateUnknownModArgs } from '../../../types/mod';
import type { GameBananaMod } from '../../../types/gamebanana';
import { getModThumbnail } from '../../../types/gamebanana';
import ModThumbnail from '../../ModThumbnail';
import { GLOBAL_MOD_TYPE_LABELS } from '../../../lib/lockerUtils';
import { formatBytes } from '../../../lib/formatBytes';
import { Button } from '../../common/ui';
import { Select } from '../../common/forms';
import { HeroTagLabel } from '../chips';
import { type FoundUnknownMatch, isFoundUnknownMatch } from './foundMatch';
import { UnknownEmbeddedCard, UnknownMatchCard } from './UnknownMatchCards';
import { type GameBananaModFileChoice, UnknownFileList } from './UnknownFileList';

export function UnknownMatchPanel({
  state,
  hideNsfwPreviews,
  autoMatchEnabled,
  onApplyMatch,
  onAssociate,
  onViewMatch,
  onMakeCustom,
  onFind,
  onRetry,
  onCancel,
}: {
  state: {
    mod: Mod;
    loading: boolean;
    result?: UnknownModFilterGuess;
    error?: string;
    cancelled?: boolean;
    progress?: UnknownModDetectionProgress;
  };
  hideNsfwPreviews: boolean;
  autoMatchEnabled: boolean;
  onApplyMatch: (mod: Mod, match: FoundUnknownMatch) => Promise<void>;
  onAssociate: (mod: Mod, args: AssociateUnknownModArgs) => Promise<void>;
  onViewMatch: (mod: Mod, match: FoundUnknownMatch) => void;
  onMakeCustom: (mod: Mod) => void;
  onFind: (mod: Mod) => void;
  onRetry: (mod: Mod) => void;
  onCancel: (mod: Mod) => void;
}) {
  const { t } = useTranslation();
  const { mod, loading, result, error, cancelled, progress } = state;
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const match = result?.crcMatch;
  // An embedded-provenance result is self-reported by the VPK's own imprint
  // (offline, ungated): surface it prominently at the top via its own card, and
  // keep it out of the gated CRC auto-matcher card below (which is reserved for
  // verified upstream CRC-32 hits). The union values stay 'embedded-*' on the
  // wire even though the card renders "imprint" to the user.
  const isEmbedProvenance =
    match?.provenance === 'embedded-metadata' || match?.provenance === 'embedded-merge';
  const embeddedMatch = isEmbedProvenance && isFoundUnknownMatch(match) ? match : null;
  const foundMatch = isFoundUnknownMatch(match) && !isEmbedProvenance ? match : null;

  const handleApply = async (matchToApply: FoundUnknownMatch) => {
    if (applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      await onApplyMatch(mod, matchToApply);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  const handleRetry = () => {
    if (applying) return;
    setApplyError(null);
    onRetry(mod);
  };

  const handleFind = () => {
    if (applying) return;
    setApplyError(null);
    onFind(mod);
  };

  const handleCancel = () => {
    if (applying) return;
    setApplyError(null);
    onCancel(mod);
  };

  return (
    <div className="p-5 overflow-y-auto space-y-4">
      {/* Self-identifying VPK: identity read offline from the file's own imprint
          (addoninfo.txt / grimoire_meta.json), never gated behind the network
          matcher. Shown ahead of everything else. */}
      {embeddedMatch && (
        <UnknownEmbeddedCard
          mod={mod}
          match={embeddedMatch}
          hideNsfwPreviews={hideNsfwPreviews}
          onAssociate={onAssociate}
          onView={() => onViewMatch(mod, embeddedMatch)}
        />
      )}

      {/* Primary path: find the mod on GameBanana and link this local file to
          it. Light on the API (one search, optional file list) versus the CRC
          auto-matcher below, which downloads candidate archives. */}
      <UnknownManualSearch
        mod={mod}
        defaultSection={result?.section ?? 'Mod'}
        disabled={applying}
        onAssociate={onAssociate}
      />

      {/* Let the user eyeball what the VPK actually contains. Pure local read. */}
      <UnknownFileList
        mod={mod}
        initialPaths={result?.samplePaths}
        initialCount={result?.fileCount}
      />

      {applyError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{applyError}</span>
        </div>
      )}

      {/* Fallback: keep the file but give it a custom name/thumbnail. */}
      <div className="rounded-md bg-bg-tertiary/40 border border-hl/5 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-text-secondary">
          {t('installed.unknown.cantFindHint')}
        </span>
        <Button variant="secondary" size="sm" icon={FilePlus} onClick={() => onMakeCustom(mod)}>
          {t('installed.import.makeCustomTitle')}
        </Button>
      </div>

      {/* Advanced, demoted: the heavy CRC auto-matcher. Carries an explicit
          rate-limit warning and never runs without a click. */}
      <details className="rounded-md bg-bg-tertiary/40 border border-hl/5 overflow-hidden">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-text-secondary hover:text-text-primary flex items-center gap-2">
          <Beaker className="w-4 h-4 text-accent flex-shrink-0" />
          {t('installed.unknown.autoDetectSummary')}
        </summary>
        <div className="px-4 pb-4 space-y-3 border-t border-hl/5 pt-3">
          <div className="flex items-start gap-2 text-xs text-yellow-200/90 bg-yellow-500/10 border border-yellow-500/25 rounded-md p-2.5">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-yellow-400" />
            <span>
              {t('installed.unknown.autoDetectWarning')}
            </span>
          </div>

          {loading && (
            <div className="rounded-md bg-bg-tertiary/50 border border-hl/5 px-4 py-4 text-sm text-text-secondary flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Loader2 className="w-4 h-4 animate-spin text-accent flex-shrink-0" />
                <div className="min-w-0">
                  <div className="truncate">{progress?.message ?? t('installed.unknown.findingMatch')}</div>
                  {typeof progress?.checkedFiles === 'number' && typeof progress.totalFiles === 'number' && (
                    <div className="text-xs text-text-tertiary mt-0.5">
                      {t('installed.unknown.progressFiles', { checked: progress.checkedFiles, total: progress.totalFiles })}
                      {typeof progress.indexedEntries === 'number' ? t('installed.unknown.progressEntries', { count: progress.indexedEntries }) : ''}
                      {typeof progress.bytesFetched === 'number' ? t('installed.unknown.progressFetched', { bytes: formatBytes(progress.bytesFetched) }) : ''}
                    </div>
                  )}
                </div>
              </div>
              <Button variant="secondary" size="sm" icon={X} onClick={handleCancel}>
                {t('common.actions.cancel')}
              </Button>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 text-sm text-state-danger flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {foundMatch && (
            <UnknownMatchCard
              match={foundMatch}
              hideNsfwPreviews={hideNsfwPreviews}
              applying={applying}
              onApply={() => void handleApply(foundMatch)}
              onView={() => onViewMatch(mod, foundMatch)}
              onRetry={autoMatchEnabled ? handleRetry : undefined}
            />
          )}

          {result && match && !foundMatch && (
            <div className="rounded-md bg-bg-tertiary/50 border border-hl/5 overflow-hidden">
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-text-tertiary flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
                      {match.status === 'error' ? t('installed.unknown.matchCheckFailed') : t('installed.unknown.noMatchFound')}
                    </div>
                    <p className="text-sm text-text-secondary mt-1">
                      {match.reason ?? t('installed.unknown.noArchiveMatched')}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-3 text-2xs text-text-tertiary">
                      <span>{t('installed.unknown.modsChecked', { count: match.checkedMods })}</span>
                      <span>{t('installed.unknown.filesChecked', { count: match.checkedFiles })}</span>
                      <span>{t('installed.unknown.bytesFetched', { bytes: match.bytesFetched.toLocaleString() })}</span>
                    </div>
                  </div>
                </div>
              </div>
              {autoMatchEnabled && (
                <div className="border-t border-hl/5 px-4 py-3 bg-black/10 flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" size="sm" icon={RotateCcw} onClick={handleRetry}>
                    {t('common.actions.retry')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {!loading && !error && !result && autoMatchEnabled && (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
              <span>{cancelled ? t('installed.unknown.autoDetectCancelled') : t('installed.unknown.autoDetectPrompt')}</span>
              <Button variant="secondary" size="sm" icon={Search} onClick={handleFind}>
                {cancelled ? t('common.actions.tryAgain') : t('settings.gamePath.autoDetect')}
              </Button>
            </div>
          )}

          {!loading && !error && !result && !autoMatchEnabled && (
            <p className="text-sm text-text-secondary">
              {t('installed.unknown.autoDetectOff')}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

// Manual GameBanana search inside the Fix Unknown modal. Leads with side-by-side
// guidance, then a search box + selectable results. Linking tags the existing
// local VPK in place (no download), so it costs at most one search plus an
// optional file-list lookup.
// Map a locally-cached catalog row to the GameBananaMod shape the result cards
// expect. Mirrors the conversion the Browse tab does so the unknown-mod search
// reuses the same instant local index instead of the slower GameBanana API.
function cachedModToGameBananaMod(m: import('../../../types/electron').CachedMod): GameBananaMod {
  let images: { baseUrl: string; file: string; file530: string }[] | undefined;
  if (m.thumbnailUrl) {
    const lastSlash = m.thumbnailUrl.lastIndexOf('/');
    if (lastSlash !== -1) {
      const baseUrl = m.thumbnailUrl.substring(0, lastSlash);
      const file = m.thumbnailUrl.substring(lastSlash + 1);
      if (baseUrl && file) images = [{ baseUrl, file, file530: file }];
    }
  }
  const metadata = m.audioUrl ? { audioUrl: m.audioUrl } : undefined;
  return {
    id: m.id,
    name: m.name,
    profileUrl: m.profileUrl,
    dateAdded: m.dateAdded,
    dateModified: m.dateModified,
    hasFiles: m.hasFiles,
    likeCount: m.likeCount,
    viewCount: m.viewCount,
    nsfw: m.isNsfw,
    rootCategory: m.categoryId ? { id: m.categoryId, name: m.categoryName || '' } : undefined,
    submitter: m.submitterName ? { id: m.submitterId || 0, name: m.submitterName } : undefined,
    previewMedia: images || metadata ? { images, metadata } : undefined,
  };
}

function UnknownManualSearch({
  mod,
  defaultSection,
  disabled,
  onAssociate,
}: {
  mod: Mod;
  defaultSection: 'Mod' | 'Sound';
  disabled: boolean;
  onAssociate: (mod: Mod, args: AssociateUnknownModArgs) => Promise<void>;
}) {
  const { t } = useTranslation();
  // Seed the box with the hero inferred from the VPK tree (when confident), so
  // a skin search is one keystroke away. enrichMod tags Sound mods as 'Sound',
  // everything else defaults to 'Mod'.
  const [query, setQuery] = useState(mod.lockerHero ?? '');
  const [section, setSection] = useState<'Mod' | 'Sound'>(defaultSection);
  const [results, setResults] = useState<GameBananaMod[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<GameBananaMod | null>(null);
  const [files, setFiles] = useState<GameBananaModFileChoice[] | null>(null);
  const [fileId, setFileId] = useState<number | undefined>(undefined);
  const [linking, setLinking] = useState(false);
  const reqRef = useRef(0);
  // Whether the local catalog mirror is populated. When it is, search hits the
  // instant FTS index (like the Browse tab) and trusts an empty result; when
  // it isn't (fresh install, never synced), we fall back to the GameBanana API
  // so we never show a false "no results".
  const hasLocalCacheRef = useRef<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      .getLocalModCount()
      .then((count) => {
        if (!cancelled) hasLocalCacheRef.current = count > 100;
      })
      .catch(() => {
        if (!cancelled) hasLocalCacheRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live search. Stable (no changing deps) so the debounce effect can depend on
  // it without re-arming every render. Empty query clears the list. Prefers the
  // local FTS catalog for snappy, in-game-like results; the GameBanana API is
  // only used as a fallback when there's no local mirror.
  const search = useCallback(async (rawQuery: string, sec: 'Mod' | 'Sound') => {
    const q = rawQuery.trim();
    const reqId = ++reqRef.current;
    setSelected(null);
    setFiles(null);
    setFileId(undefined);
    if (!q) {
      setResults([]);
      setHasSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    setHasSearched(true);
    try {
      let records: GameBananaMod[] = [];
      let servedLocally = false;
      try {
        const local = await window.electronAPI.searchLocalMods({
          query: q,
          section: sec,
          sortBy: 'relevance',
          nsfw: 'all',
          addedWithin: 'all',
          limit: 20,
          offset: 0,
        });
        if (reqRef.current !== reqId) return;
        records = local.mods.map(cachedModToGameBananaMod);
        servedLocally = true;
      } catch {
        servedLocally = false;
      }
      // Hit the API only when local couldn't serve it: it errored, or it came
      // back empty while we're not sure the mirror is actually populated.
      if (!servedLocally || (records.length === 0 && hasLocalCacheRef.current !== true)) {
        const res = await browseMods(1, 20, q, sec);
        if (reqRef.current !== reqId) return;
        records = res.records;
      }
      setResults(records);
    } catch (err) {
      if (reqRef.current !== reqId) return;
      setSearchError(err instanceof Error ? err.message : String(err));
      setResults([]);
    } finally {
      if (reqRef.current === reqId) setSearching(false);
    }
  }, []);

  // Debounced live results: re-run as the user types or flips the section.
  // Also fires once on mount when the box was prefilled from the inferred hero.
  // 250ms matches the Browse tab's search feel.
  useEffect(() => {
    const timer = setTimeout(() => void search(query, section), 250);
    return () => clearTimeout(timer);
  }, [query, section, search]);

  // Lazy-load the candidate's files so the user can optionally pin the exact
  // file. Skippable: linking works without a fileId.
  const selectMod = async (gbMod: GameBananaMod) => {
    setSelected(gbMod);
    setFiles(null);
    setFileId(undefined);
    if (!gbMod.hasFiles) return;
    try {
      const details = await getModDetails(gbMod.id, section);
      const choices = (details.files ?? []).map((f) => ({ id: f.id, fileName: f.fileName }));
      setFiles(choices);
    } catch {
      // A missing file list just means no file pin; the link still works.
      setFiles([]);
    }
  };

  const handleLink = async () => {
    if (!selected || linking || disabled) return;
    setLinking(true);
    setSearchError(null);
    try {
      await onAssociate(mod, {
        gameBananaId: selected.id,
        modName: selected.name,
        gameBananaFileId: fileId,
        thumbnailUrl: getModThumbnail(selected),
        nsfw: selected.nsfw,
        categoryName: selected.rootCategory?.name,
        sourceSection: section,
      });
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  };

  return (
    <div className="rounded-md bg-bg-tertiary/50 border border-hl/5 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <Link2 className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
        <div className="text-sm text-text-secondary">
          <Trans
            i18nKey="installed.unknown.manualSearchIntro"
            components={{
              lead: <span className="font-medium text-text-primary" />,
              banana: <Banana className="inline-block w-3.5 h-3.5 -mt-0.5 text-yellow-400" />,
            }}
          />
        </div>
      </div>

      {(mod.lockerHero || mod.globalType) && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
          <span className="text-text-tertiary">{t('installed.unknown.fromFileTree')}</span>
          {mod.lockerHero && (
            <span className="inline-flex items-center rounded-full bg-bg-primary/60 border border-hl/10 px-2 py-0.5">
              <HeroTagLabel heroName={mod.lockerHero} iconClassName="h-4 w-4" />
            </span>
          )}
          {mod.globalType && (
            <span className="rounded-full bg-bg-primary/60 border border-hl/10 px-2 py-0.5 text-text-secondary">
              {GLOBAL_MOD_TYPE_LABELS[mod.globalType] ?? mod.globalType}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex rounded-md overflow-hidden border border-hl/10 text-xs flex-shrink-0">
          {(['Mod', 'Sound'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSection(s)}
              className={`px-2.5 py-2 transition-colors cursor-pointer ${
                section === s ? 'bg-accent text-accent-foreground' : 'text-text-secondary hover:bg-hl/5'
              }`}
            >
              {s === 'Mod' ? t('installed.unknown.sectionMods') : t('installed.unknown.sectionSounds')}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('installed.unknown.searchPlaceholder')}
            className="w-full bg-bg-primary border border-hl/10 rounded-md pl-9 pr-9 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
          />
          {searching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-accent" />
          )}
        </div>
      </div>

      {searchError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-md p-2.5 text-xs text-state-danger flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{searchError}</span>
        </div>
      )}

      {hasSearched && !searching && results.length === 0 && !searchError && (
        <p className="text-sm text-text-tertiary">{t('installed.unknown.noResults')}</p>
      )}

      {results.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
          {results.map((gbMod) => {
            const isSel = selected?.id === gbMod.id;
            // Direct GameBanana page so the user can download it there (often
            // faster than Grimoire's queue) while still linking it here. Prefer
            // the record's own URL; fall back to one built from the id/section.
            const gbUrl =
              gbMod.profileUrl ||
              `https://gamebanana.com/${section === 'Sound' ? 'sounds' : 'mods'}/${gbMod.id}`;
            return (
              <div
                key={gbMod.id}
                className={`rounded-md border transition-colors ${
                  isSel ? 'bg-accent/10 border-accent/40' : 'bg-bg-primary/40 border-hl/5 hover:border-hl/15'
                }`}
              >
                <div className="flex items-center pr-2">
                  <button
                    type="button"
                    onClick={() => void selectMod(gbMod)}
                    className="min-w-0 flex-1 text-left flex items-center gap-3 p-2 cursor-pointer"
                  >
                    <ModThumbnail
                      src={getModThumbnail(gbMod)}
                      alt={gbMod.name}
                      nsfw={gbMod.nsfw}
                      hideNsfw
                      className="w-16 h-11 rounded bg-bg-primary border border-hl/10 flex-shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-text-primary truncate" title={gbMod.name}>
                        {gbMod.name}
                      </div>
                      <div className="text-2xs text-text-tertiary truncate">
                        {gbMod.rootCategory?.name ?? (section === 'Mod' ? t('installed.unknown.sectionMods') : t('installed.unknown.sectionSounds'))} · #{gbMod.id}
                      </div>
                    </div>
                    {isSel && <Check className="w-4 h-4 text-accent flex-shrink-0" />}
                  </button>

                  <a
                    href={gbUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Open ${gbMod.name} on GameBanana to download it directly`}
                    aria-label={`Open ${gbMod.name} on GameBanana`}
                    className="flex-shrink-0 ml-1 inline-flex items-center justify-center w-9 h-9 rounded-md border border-hl/10 bg-bg-primary/60 text-text-tertiary transition-colors hover:border-yellow-400/50 hover:text-yellow-400 hover:bg-yellow-400/5"
                  >
                    <Banana className="w-4 h-4" />
                  </a>
                </div>

                {isSel && (
                  <div className="border-t border-hl/5 px-2.5 py-2.5 space-y-2">
                    {files && files.length > 0 && (
                      <label className="block text-xs text-text-secondary">
                        {t('installed.unknown.pinExactFile')}
                        <div className="mt-1">
                          <Select
                            inputSize="sm"
                            value={fileId ?? ''}
                            onChange={(e) => setFileId(e.target.value ? Number(e.target.value) : undefined)}
                          >
                            <option value="">{t('installed.unknown.dontPinFile')}</option>
                            {files.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.fileName}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </label>
                    )}
                    <div className="flex justify-end">
                      <Button
                        variant="success"
                        size="sm"
                        icon={Link2}
                        isLoading={linking}
                        disabled={disabled}
                        onClick={() => void handleLink()}
                      >
                        {t('installed.unknown.linkThisMod')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
