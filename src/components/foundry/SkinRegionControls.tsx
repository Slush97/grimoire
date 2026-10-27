import { useTranslation } from 'react-i18next';
import { Plus, SquareDashedMousePointer, Trash2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input } from '../common/forms';
import { SkinColorControls } from './SkinColorControls';
import { SkinPatternPicker } from './SkinPatternPicker';
import { hasRegionEdit } from '../../lib/skinColorAdjustments';
import { regionLabel } from '../../lib/skinRegions';
import type { SkinPartRegion } from '../../types/skinEditor';

/** The edit target: the whole part or one of its saved areas. */
export function SkinRegionTargets({ regions, active, disabled, onSelect, onAdd, onPreview }: {
  regions: SkinPartRegion[]; active: string | null; disabled: boolean;
  onSelect: (region: string | null) => void; onAdd: () => void; onPreview: (region: string | null) => void;
}) {
  const { t } = useTranslation();
  const chip = (selected: boolean) => `flex min-h-7 min-w-0 max-w-full items-center gap-1.5 rounded-sm border px-2 text-xs focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40 ${
    selected ? 'border-accent bg-accent/10 text-text-primary' : 'border-border text-text-secondary hover:bg-hl/5'}`;
  return <div role="group" aria-label={t('foundry.skin.region.target')} className="flex flex-wrap items-center gap-1">
    <button type="button" aria-pressed={active === null} disabled={disabled} className={chip(active === null)} onClick={() => onSelect(null)}>
      {t('foundry.skin.region.wholePart')}
    </button>
    {regions.map((region) => <button key={region.id} type="button" aria-pressed={active === region.id} disabled={disabled} className={chip(active === region.id)}
      onClick={() => onSelect(region.id)} onPointerEnter={() => onPreview(region.id)} onPointerLeave={() => onPreview(null)}
      onFocus={() => onPreview(region.id)} onBlur={() => onPreview(null)}>
      {region.paint && <span className="h-3 w-3 shrink-0 rounded-sm border border-hl/20" style={{ backgroundColor: region.paint }} />}
      <span className="truncate">{regionLabel(region, t)}</span>
      {!hasRegionEdit(region) && <span className="sr-only">{t('foundry.skin.region.unedited')}</span>}
    </button>)}
    <Button size="sm" variant="ghost" icon={Plus} disabled={disabled || regions.length >= 16} onClick={onAdd}>{t('foundry.skin.region.add')}</Button>
  </div>;
}

/** Replaces the appearance controls while clicks on the model change the selection. */
export function SkinRegionSelecting({ part, mode, empty, missed, onMode, onClear, onDone }: {
  part: string; mode: 'add' | 'remove'; empty: boolean; missed: boolean;
  onMode: (mode: 'add' | 'remove') => void; onClear: () => void; onDone: () => void;
}) {
  const { t } = useTranslation();
  return <div className="space-y-3">
    <div className="space-y-1">
      <h5 className="text-sm font-semibold text-text-primary">{t('foundry.skin.region.selectingTitle', { part })}</h5>
      <p className="text-xs text-text-secondary">{t('foundry.skin.region.selectingHint')}</p>
    </div>
    <SegmentedControl fill label={t('foundry.skin.region.selectionMode')} value={mode} onChange={onMode} options={[
      { value: 'add', label: t('foundry.skin.region.addPieces') },
      { value: 'remove', label: t('foundry.skin.region.removePieces') },
    ]} />
    {missed ? <p role="status" className="text-xs text-state-warning">{t('foundry.skin.region.otherPart', { part })}</p>
      : empty && <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.region.nothingSelected', { part })}</p>}
    <p className="text-2xs text-text-tertiary">{t('foundry.skin.region.sharedHint')}</p>
    <div className="flex gap-2">
      <Button size="sm" variant="ghost" disabled={empty} onClick={onClear}>{t('foundry.skin.region.clear')}</Button>
      <Button size="sm" className="flex-1" onClick={onDone}>{t('foundry.skin.region.done')}</Button>
    </div>
  </div>;
}

/** Name, selection and texture edits for one area. Only texture edits can stop at an area's edge. */
export function SkinRegionEditor({ region, color, tool, disabled, onTool, onChange, onSelect, onDelete }: {
  region: SkinPartRegion; color: string; tool: 'color' | 'pattern'; disabled: boolean;
  onTool: (tool: 'color' | 'pattern') => void; onChange: (patch: Partial<SkinPartRegion>) => void; onSelect: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const label = regionLabel(region, t);
  return <div className="space-y-3">
    <div className="flex items-center gap-1">
      <Input inputSize="sm" className="min-w-0 flex-1" value={region.name ?? ''} maxLength={60} disabled={disabled}
        placeholder={label} aria-label={t('foundry.skin.region.name')} onChange={(event) => onChange({ name: event.target.value || undefined })} />
      <IconButton size="sm" icon={SquareDashedMousePointer} disabled={disabled} label={t('foundry.skin.region.changeSelection')} onClick={onSelect} />
      <IconButton size="sm" icon={Trash2} disabled={disabled} label={t('foundry.skin.region.delete', { area: label })} onClick={onDelete} />
    </div>
    <SegmentedControl fill value={tool} onChange={onTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }]} />
    {tool === 'color'
      ? <SkinColorControls paintOnly color={region.paint ?? color} tintable adjustable disabled={disabled}
        edit={{ material: '', hidden: false, tint: region.paint ?? null, repaint: true, adjustments: region.adjustments }}
        onChange={(patch) => onChange({ ...('tint' in patch ? { paint: patch.tint ?? null } : {}), ...('adjustments' in patch ? { adjustments: patch.adjustments } : {}) })} />
      : <SkinPatternPicker still value={region.pattern ?? null} color={region.paint ?? color} disabled={disabled}
        onChange={(pattern) => onChange({ pattern: pattern && { ...pattern, scroll: 0 } })} />}
    <p className="text-2xs text-text-tertiary">{t('foundry.skin.region.wholePartOnly')}</p>
  </div>;
}
