import { useState } from 'react';
import { ChevronRight, EyeOff, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Tx from '../translation/Tx';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuLabel } from '../common/menu';

// Each row carries its own context menu, so a pair sharing thousands of
// sound or model paths would stall the page if rendered in one go.
const RENDER_STEP = 200;

interface ConflictFileListProps {
  /** Overlapping paths still flagged for this pair. */
  files: string[];
  /** Opens the list when it turns true and closes it when it turns false. */
  autoOpen?: boolean;
  /** True while an ignore/unignore for this pair is in flight. */
  busy: boolean;
  /** Dismiss a single overlapping file for this pair only. */
  onIgnoreFile: (filePath: string) => void;
  /** Silence a file for every mod pair (never flag it as a conflict again). */
  onIgnoreFileEverywhere: (filePath: string) => void;
}

/**
 * Collapsible list of the files a `file` conflict shares. A row's Ignore button
 * dismisses that file for this pair; right-clicking opens a menu that adds the
 * "ignore in all mods" scope. Collapsed by default.
 */
export default function ConflictFileList({
  files,
  autoOpen = false,
  busy,
  onIgnoreFile,
  onIgnoreFileEverywhere,
}: ConflictFileListProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(autoOpen);
  const [lastAutoOpen, setLastAutoOpen] = useState(autoOpen);
  const [limit, setLimit] = useState(RENDER_STEP);
  if (autoOpen !== lastAutoOpen) {
    setLastAutoOpen(autoOpen);
    setOpen(autoOpen);
  }

  if (files.length === 0) return null;
  const hidden = files.length - limit;

  return (
    <div className="border-t border-border/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary cursor-pointer"
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Tx
          k="conflicts.files.heading"
          values={{ count: files.length }}
          fallback={`Shared files (${files.length})`}
        />
      </button>
      {open && (
        <ul className="max-h-44 space-y-1 overflow-auto px-4 pb-3">
          {files.slice(0, limit).map((file) => (
            <MenuRoot key={file}>
              <MenuTrigger asChild>
                <li className="flex items-center gap-2 rounded data-[state=open]:bg-bg-tertiary/60">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-2xs text-text-tertiary"
                    title={file}
                  >
                    {file}
                  </span>
                  <button
                    type="button"
                    onClick={() => onIgnoreFile(file)}
                    disabled={busy}
                    title={t('conflicts.files.ignoreFileTitle')}
                    aria-label={t('conflicts.files.ignoreFileTitle')}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                  >
                    <EyeOff className="h-3 w-3" />
                    <Tx k="conflicts.files.ignoreFile" fallback="Ignore" />
                  </button>
                </li>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>{file}</MenuLabel>
                <MenuItem icon={EyeOff} disabled={busy} onSelect={() => onIgnoreFile(file)}>
                  <Tx k="conflicts.files.ignoreForPair" fallback="Ignore for this pair" />
                </MenuItem>
                <MenuItem icon={Globe} disabled={busy} onSelect={() => onIgnoreFileEverywhere(file)}>
                  <Tx k="conflicts.files.ignoreEverywhere" fallback="Ignore in all mods" />
                </MenuItem>
              </MenuContent>
            </MenuRoot>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setLimit((current) => current + RENDER_STEP)}
                className="rounded px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary cursor-pointer"
              >
                {t('conflicts.files.showMore', { count: Math.min(hidden, RENDER_STEP) })}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
