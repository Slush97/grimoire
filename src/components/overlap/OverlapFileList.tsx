import { useState } from 'react';
import { EyeOff, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent, MenuItem, MenuLabel } from '../common/menu';

// Each row carries its own context menu, so a pair sharing thousands of
// sound or model paths would stall the page if rendered in one go.
const RENDER_STEP = 200;

interface OverlapFileListProps {
  files: string[];
  /** True while an action for this pair is in flight. */
  busy: boolean;
  onIgnoreFile: (filePath: string) => void;
  onIgnoreFileEverywhere: (filePath: string) => void;
}

/**
 * The files a pair both ship. The row button ignores a file for this pair;
 * right-click adds "ignore in every mod".
 */
export default function OverlapFileList({ files, busy, onIgnoreFile, onIgnoreFileEverywhere }: OverlapFileListProps) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(RENDER_STEP);
  const hidden = files.length - limit;

  return (
    <ul className="max-h-64 overflow-auto border-t border-hl/5 bg-bg-sunken px-2 py-1.5">
      {files.slice(0, limit).map((file) => {
        const slash = file.lastIndexOf('/');
        return (
          <MenuRoot key={file}>
            <MenuTrigger asChild>
              <li className="group flex h-7 items-center gap-2 rounded-sm pl-2 hover:bg-hl/5 data-[state=open]:bg-hl/5">
                <span className="flex min-w-0 flex-1 font-mono text-2xs" title={file}>
                  <span className="min-w-0 shrink-[9999] truncate text-text-tertiary">{file.slice(0, slash + 1)}</span>
                  <span className="min-w-0 truncate text-text-primary">{file.slice(slash + 1)}</span>
                </span>
                <IconButton
                  icon={EyeOff}
                  size="sm"
                  label={t('overlap.files.ignoreForPair')}
                  onClick={() => onIgnoreFile(file)}
                  disabled={busy}
                  className="border-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                />
              </li>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{file}</MenuLabel>
              <MenuItem icon={EyeOff} disabled={busy} onSelect={() => onIgnoreFile(file)}>
                {t('overlap.files.ignoreForPair')}
              </MenuItem>
              <MenuItem icon={Globe} disabled={busy} onSelect={() => onIgnoreFileEverywhere(file)}>
                {t('overlap.files.ignoreEverywhere')}
              </MenuItem>
            </MenuContent>
          </MenuRoot>
        );
      })}
      {hidden > 0 && (
        <li className="pt-1">
          <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + RENDER_STEP)}>
            {t('overlap.files.showMore', { count: Math.min(hidden, RENDER_STEP) })}
          </Button>
        </li>
      )}
    </ul>
  );
}
