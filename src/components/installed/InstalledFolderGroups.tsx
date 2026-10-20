import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InstalledSection } from './InstalledSection';
import { installedFolderEntryKey, installedFolderKey, type InstalledFolder, type InstalledFolderSection } from '../../lib/installedFolders';
import type { ModEntry } from '../../lib/modEntries';

export function InstalledFolderGroups({ folders, section, collapsed, showEmpty, onToggle, gridClassName, gridStyle, renderEntry }: {
  folders: readonly InstalledFolder[];
  section: InstalledFolderSection;
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  onToggle: (key: string) => void;
  gridClassName: string;
  gridStyle?: CSSProperties;
  renderEntry: (entry: ModEntry, occurrenceKey: string) => ReactNode;
}) {
  const { t } = useTranslation();
  return <div className="space-y-6">
    {folders.filter((folder) => showEmpty || folder.entries.length > 0).map((folder) => {
      const key = installedFolderKey(section, folder.id);
      const isCollapsed = collapsed.has(key);
      return <InstalledSection
        key={key}
        title={folder.id === null ? t('installed.folders.unfiled') : folder.name}
        count={folder.entries.length}
        collapsed={isCollapsed}
        onToggle={() => onToggle(key)}
      >
        {!isCollapsed && (folder.entries.length ? <div className={gridClassName} style={gridStyle}>
          {folder.entries.map((entry) => {
            const occurrence = installedFolderEntryKey(section, folder, entry);
            return <div key={occurrence}>{renderEntry(entry, occurrence)}</div>;
          })}
        </div> : <p className="text-xs text-text-tertiary">{t('installed.folders.empty')}</p>)}
      </InstalledSection>;
    })}
  </div>;
}
