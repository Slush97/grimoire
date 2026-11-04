import { useState } from 'react';
import { ChevronRight, Eye, ImageOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import type { OverlapMod } from './OverlapCard';

export type IgnoredTab = 'pairs' | 'files' | 'mods';

interface IgnoredOverlapsProps {
  /** Ignored pair keys ("identityA::identityB"). */
  pairs: string[];
  /** Pair key -> files ignored for just that pair. */
  filesByPair: Record<string, string[]>;
  /** Files ignored for every pair. */
  globalFiles: string[];
  /** Mod identities ignored against every other mod. */
  mods: string[];
  /** Entries left behind by mods that are no longer installed. Not listed. */
  staleCount: number;
  lookup: (key: string) => OverlapMod | undefined;
  /** Key, path or identity whose restore is in flight. */
  pending: string | null;
  defaultOpen: boolean;
  onRestorePair: (key: string) => void;
  /** `filePath` null restores every file ignored for the pair. */
  onRestoreFile: (key: string, filePath: string | null) => void;
  onRestoreGlobalFile: (filePath: string) => void;
  onRestoreMod: (identity: string) => void;
  onRestoreAll: (tab: IgnoredTab) => void;
  onForgetStale: () => void;
}

function FileRow({ path, busy, onRestore }: { path: string; busy: boolean; onRestore: () => void }) {
  const { t } = useTranslation();
  return (
    <li className="group flex h-7 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-2xs text-text-tertiary" title={path}>
        {path}
      </span>
      <IconButton
        icon={Eye}
        size="sm"
        label={t('overlap.ignored.restoreFile')}
        onClick={onRestore}
        disabled={busy}
        className="border-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </li>
  );
}

export default function IgnoredOverlaps({
  pairs,
  filesByPair,
  globalFiles,
  mods,
  staleCount,
  lookup,
  pending,
  defaultOpen,
  onRestorePair,
  onRestoreFile,
  onRestoreGlobalFile,
  onRestoreMod,
  onRestoreAll,
  onForgetStale,
}: IgnoredOverlapsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<IgnoredTab>('pairs');

  const filePairKeys = Object.keys(filesByPair);
  const fileCount = filePairKeys.reduce((sum, key) => sum + filesByPair[key].length, 0) + globalFiles.length;
  const counts: Record<IgnoredTab, number> = { pairs: pairs.length, files: fileCount, mods: mods.length };
  const tabs = (['pairs', 'files', 'mods'] as const).filter((value) => counts[value] > 0);
  const total = counts.pairs + counts.files + counts.mods;
  if (total === 0 && staleCount === 0) return null;
  const activeTab = tabs.includes(tab) ? tab : tabs[0];

  const pairLabel = (key: string) => {
    const [a, b] = key.split('::').map((part) => lookup(part)?.name ?? part);
    return t('overlap.ignored.pair', { a, b });
  };

  return (
    <section className="max-w-4xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-7 items-center gap-1.5 rounded-sm text-sm font-medium text-text-secondary transition-colors hover:text-text-primary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {t('overlap.ignored.title')}
        <span className="tabular-nums text-text-tertiary">{total}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {activeTab && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {tabs.length > 1 ? (
                  <SegmentedControl
                    label={t('overlap.ignored.title')}
                    value={activeTab}
                    onChange={setTab}
                    options={tabs.map((value) => ({
                      value,
                      label: (
                        <>
                          {t(`overlap.ignored.tabs.${value}`)}
                          <span className="tabular-nums text-text-tertiary">{counts[value]}</span>
                        </>
                      ),
                    }))}
                  />
                ) : (
                  <p className="text-xs text-text-secondary">{t(`overlap.ignored.tabs.${activeTab}`)}</p>
                )}
                <Button variant="ghost" size="sm" onClick={() => onRestoreAll(activeTab)}>
                  {t('overlap.ignored.restoreAll')}
                </Button>
              </div>

              <ul className="divide-y divide-hl/5 rounded-sm border border-border bg-bg-secondary">
                {activeTab === 'pairs' &&
                  pairs.map((key) => (
                    <li key={key} className="flex items-center gap-3 py-1.5 pl-4 pr-2">
                      <p className="min-w-0 flex-1 truncate text-sm text-text-primary" title={pairLabel(key)}>
                        {pairLabel(key)}
                      </p>
                      <Button variant="ghost" size="sm" icon={Eye} disabled={pending === key} onClick={() => onRestorePair(key)}>
                        {t('overlap.ignored.restore')}
                      </Button>
                    </li>
                  ))}

                {activeTab === 'files' && (
                  <>
                    {filePairKeys.map((key) => (
                      <li key={key} className="py-1.5 pl-4 pr-2">
                        <div className="flex items-center gap-3">
                          <p className="min-w-0 flex-1 truncate text-sm text-text-primary" title={pairLabel(key)}>
                            {pairLabel(key)}
                          </p>
                          <Button variant="ghost" size="sm" icon={Eye} disabled={pending === key} onClick={() => onRestoreFile(key, null)}>
                            {t('overlap.ignored.restore')}
                          </Button>
                        </div>
                        <ul>
                          {filesByPair[key].map((path) => (
                            <FileRow key={path} path={path} busy={pending === key} onRestore={() => onRestoreFile(key, path)} />
                          ))}
                        </ul>
                      </li>
                    ))}
                    {globalFiles.length > 0 && (
                      <li className="py-1.5 pl-4 pr-2">
                        <p className="flex h-7 items-center text-sm text-text-primary">{t('overlap.ignored.everyMod')}</p>
                        <ul>
                          {globalFiles.map((path) => (
                            <FileRow key={path} path={path} busy={pending === path} onRestore={() => onRestoreGlobalFile(path)} />
                          ))}
                        </ul>
                      </li>
                    )}
                  </>
                )}

                {activeTab === 'mods' &&
                  mods.map((identity) => {
                    const mod = lookup(identity);
                    return (
                      <li key={identity} className="flex items-center gap-3 py-2 pl-4 pr-2">
                        <div className="flex h-9 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
                          {mod?.thumbnailUrl ? (
                            <img src={mod.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff className="h-4 w-4 text-text-tertiary" aria-hidden />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mod-title text-sm text-text-primary" title={mod?.name}>
                            {mod?.name ?? identity}
                          </p>
                          {mod?.variant && <p className="truncate text-2xs text-text-tertiary">{mod.variant}</p>}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={Eye}
                          disabled={pending === identity}
                          onClick={() => onRestoreMod(identity)}
                        >
                          {t('overlap.ignored.restore')}
                        </Button>
                      </li>
                    );
                  })}
              </ul>
            </>
          )}

          {staleCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
              {t('overlap.ignored.stale', { count: staleCount })}
              <Button variant="ghost" size="sm" onClick={onForgetStale}>
                {t('overlap.ignored.forgetStale')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
