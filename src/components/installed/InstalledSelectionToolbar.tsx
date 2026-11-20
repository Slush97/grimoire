import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { GripVertical, Layers, Files, Tag, Trash2, X, Loader2 } from 'lucide-react';
import { Button, IconButton } from '../common/ui';
import { MenuRoot, MenuTrigger, MenuContent } from '../common/menu';
import { useFloatingPanel } from '../common/useFloatingPanel';
import { validPanelPosition } from '../../lib/floatingPanelGeometry';
import { InstalledListSelectionMenu } from './InstalledListControls';
import { ModTagMenuItems } from './ModTagMenu';
import { useAppStore } from '../../stores/appStore';
import { useInstalledTagsStore } from '../../stores/installedTagsStore';
import { getInstallationScope } from '../../lib/appSettings';
import { modPreferenceKey } from '../../lib/disabledModPrefs';
import type { Mod } from '../../types/mod';
import type { ModList } from '../../lib/modLists';

interface Props {
  groupHint?: string;
  onBusyChange: (busy: boolean) => void;
  selectedMods: Mod[]; lists: readonly ModList[]; canGroup: boolean;
  progress: { verb: 'Enabling' | 'Disabling' | 'Tagging'; done: number; total: number } | null;
  onSelectAll: () => void; onClear: () => void; onExit: () => void;
  onEnable: () => void; onDisable: () => void; onMerge: () => void; onGroup: () => void; onDelete: () => void;
  onSetList: (id: string, assigned: boolean) => void; onCreateList: () => void;
}
const STORAGE_KEY = 'installedSelectBarPos';

export function InstalledSelectionToolbar(props: Props) {
  const { t } = useTranslation();
  const { selectedMods, progress } = props;
  const panel = useFloatingPanel({ placement: 'top-center', initial: () => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
      return validPanelPosition(stored) ? stored : null;
    } catch { return null; }
  }, onCommit: ({ x, y }) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y })); } catch { /* storage may be unavailable */ }
  } });
  const applyTags = async (tags: Mod['tagOverrides'] | null, clearCustom = false) => {
    const targets = [...selectedMods];
    for (const mod of targets) await useAppStore.getState().setModTags(mod.id, tags);
    const scope = getInstallationScope(useAppStore.getState().settings);
    if (clearCustom && scope) useInstalledTagsStore.getState().clearForMods(scope, targets);
  };
  const [tagBusy, setTagBusy] = useState(false);
  const onTagBusy = (value: boolean) => { setTagBusy(value); props.onBusyChange(value); };
  const empty = selectedMods.length === 0;
  const busy = !!progress || tagBusy;
  return createPortal(<div ref={panel.ref} style={panel.style}
    className="floating-panel fixed z-40 flex w-max max-w-full flex-wrap items-center gap-2 overflow-y-auto rounded-xl border border-border bg-bg-secondary px-3 py-2 shadow-xl">
    <span onPointerDown={panel.onDragStart} title={t('installed.select.dragHint')} aria-hidden
      className="flex self-stretch cursor-grab touch-none items-center px-0.5 text-text-secondary select-none active:cursor-grabbing"><GripVertical className="h-4 w-4" /></span>
    <span className="px-2 text-sm text-text-primary tabular-nums">{empty ? t('installed.select.noneSelected') : t('installed.select.countSelected', { count: selectedMods.length })}</span>
    {progress && <span role="status" className="flex items-center gap-2 text-sm text-text-secondary"><Loader2 className="h-4 w-4 animate-spin" />{t(progress.verb === 'Enabling' ? 'installed.status.bulkEnabling' : progress.verb === 'Disabling' ? 'installed.status.bulkDisabling' : 'installed.status.bulkTagging', { done: progress.done, total: progress.total })}</span>}
    <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
    <Button variant="ghost" size="sm" disabled={busy} onClick={props.onSelectAll}>{t('installed.select.selectAll')}</Button>
    {!empty && <Button variant="ghost" size="sm" disabled={busy} onClick={props.onClear}>{t('common.actions.clear')}</Button>}
    <span aria-hidden className="h-5 w-px shrink-0 bg-border" />

    <Button variant="secondary" size="sm" disabled={busy || !selectedMods.some(mod => !mod.enabled)} onClick={props.onEnable}>{t('installed.select.enable')}</Button>
    <Button variant="secondary" size="sm" disabled={busy || !selectedMods.some(mod => mod.enabled)} onClick={props.onDisable}>{t('common.actions.disable')}</Button>
    <Button variant="secondary" size="sm" icon={Layers} disabled={busy || selectedMods.length < 2} onClick={props.onMerge}>{t('installed.select.merge')}</Button>
    <Button variant="secondary" size="sm" icon={Files} disabled={busy || !props.canGroup} title={props.groupHint} onClick={props.onGroup}>{t('installed.select.groupVariants')}</Button>
    <InstalledListSelectionMenu lists={props.lists} selectedKeys={[...new Set(selectedMods.map(modPreferenceKey))]} disabled={empty || busy}
      onAdd={id => props.onSetList(id, true)} onRemove={id => props.onSetList(id, false)} onCreate={props.onCreateList} />
    <MenuRoot kind="dropdown"><MenuTrigger asChild><Button variant="secondary" size="sm" icon={Tag} disabled={empty || busy}>{t('installed.select.tag')}</Button></MenuTrigger>
      <MenuContent className="max-h-72 max-w-72 overflow-y-auto">{!empty && <ModTagMenuItems bulk mod={selectedMods[0]} variants={selectedMods} disabled={!!progress} onBusyChange={onTagBusy} onApply={applyTags} />}</MenuContent>
    </MenuRoot>
    <Button variant="danger" size="sm" icon={Trash2} disabled={empty || busy} onClick={props.onDelete}>{t('common.actions.delete')}</Button>
    <IconButton icon={X} size="sm" disabled={busy} label={t('installed.actions.exitSelectionMode')} onClick={props.onExit} />
  </div>, document.body);
}
