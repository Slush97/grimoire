import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { ArrowLeft, Brush, Eraser, Palette, PaintBucket, RotateCcw, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input } from '../common/forms';
import { SkinColorControls } from './SkinColorControls';
import { SkinPatternPicker } from './SkinPatternPicker';
import { regionLabel } from '../../lib/skinRegions';
import type { SkinPartRegion } from '../../types/skinEditor';

export type PaintTool = 'fill' | 'brush' | 'eraser';

const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#84cc16', '#2dd4bf', '#3b82f6', '#a855f7', '#ec4899', '#eeeeee', '#252525'];

/**
 * Coloring-book painting: pick a color, then fill or brush it onto the model. Each color is one area
 * underneath, so there is nothing to select first and nothing to name. The hover preview does the
 * teaching; words stay in tooltips, plus one line until the part has paint.
 */
export function SkinPaintPanel({ part, color, tool, brushSize, tolerance, areas, missed, notice = null, isStale = () => false, canUndo, disabled,
  onColor, onTool, onBrushSize, onTolerance, onUndo, onStartOver, onDone, onEditArea, onPreviewArea }: {
  part: string; color: string; tool: PaintTool; brushSize: number; tolerance: number; areas: SkinPartRegion[];
  /** The part a stroke or click landed on instead, '' when unknown, false when none. */
  missed: string | false;
  /** Why the last paint did nothing. */
  notice?: string | null;
  /** Areas painted on an older texture layout, which need painting again. */
  isStale?: (area: SkinPartRegion) => boolean;
  canUndo: boolean; disabled: boolean;
  onColor: (color: string) => void; onTool: (tool: PaintTool) => void; onBrushSize: (size: number) => void; onTolerance: (tolerance: number) => void;
  onUndo: () => void; onStartOver: () => void; onDone: () => void; onEditArea: (id: string) => void; onPreviewArea: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const tools = [
    { value: 'fill' as const, icon: PaintBucket, label: t('foundry.skin.paint.fill'), hint: t('foundry.skin.paint.fillHint', { part }) },
    { value: 'brush' as const, icon: Brush, label: t('foundry.skin.paint.brush'), hint: t('foundry.skin.paint.brushHint', { part }) },
    { value: 'eraser' as const, icon: Eraser, label: t('foundry.skin.paint.eraser'), hint: t('foundry.skin.paint.eraserHint', { part }) },
  ];
  const current = areas.find((area) => area.paint?.toLowerCase() === color.toLowerCase() && !area.pattern);
  const swatch = (value: string, label: string, pressed: boolean, size = 'h-5 w-5') => <button key={value} type="button" aria-label={label} title={label} aria-pressed={pressed}
    onClick={() => { onColor(value); if (tool === 'eraser') onTool('fill'); }} style={{ backgroundColor: value }}
    className={`${size} shrink-0 rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-accent`} />;
  return <div className="space-y-3">
    <SegmentedControl fill label={t('foundry.skin.paint.tool')} value={tool} onChange={onTool} options={tools.map(({ value, icon: Icon, label, hint }) => ({
      value, title: hint, label: <span className="flex items-center justify-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>,
    }))} />
    {!areas.length && <p className="text-xs text-text-secondary">{tools.find((item) => item.value === tool)?.hint}</p>}
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="sr-only">{t('foundry.skin.paint.color')}</legend>
      <div className="flex justify-between gap-1">{SWATCHES.map((value) => swatch(value, value, tool !== 'eraser' && color.toLowerCase() === value))}</div>
      {tool !== 'eraser' && <div className="px-2 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={onColor} style={{ width: '100%', height: 64 }} />
      </div>}
    </fieldset>
    <label className="flex items-center gap-2 text-xs text-text-secondary" title={tool === 'fill' ? t('foundry.skin.paint.fillRangeHint') : undefined}>
      <span className="shrink-0">{tool === 'fill' ? t('foundry.skin.paint.fillRange') : t('foundry.skin.paint.size')}</span>
      {tool === 'fill'
        ? <input type="range" min={1} max={40} value={tolerance} aria-label={t('foundry.skin.paint.fillRange')} disabled={disabled}
          className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onTolerance(Number(event.target.value))} />
        : <input type="range" min={2} max={120} value={brushSize} aria-label={t('foundry.skin.paint.size')} disabled={disabled}
          className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onBrushSize(Number(event.target.value))} />}
    </label>
    {notice && <p role="status" className="text-xs text-state-warning">{notice}</p>}
    {missed !== false && <p role="status" className="text-xs text-state-warning">
      {missed ? t('foundry.skin.region.otherPart', { other: missed, part }) : t('foundry.skin.region.otherPartUnknown', { part })}</p>}
    {areas.length > 0 && <div className="flex items-center gap-1.5" role="group" aria-label={t('foundry.skin.paint.yourColors')}>
      <span title={t('foundry.skin.paint.yourColors')}><Palette className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {areas.map((area) => <span key={area.id} className="relative" onPointerEnter={() => onPreviewArea(area.id)} onPointerLeave={() => onPreviewArea(null)}>
          {area.paint ? swatch(area.paint, regionLabel(area, t), tool !== 'eraser' && area === current, 'h-6 w-6')
            : <button type="button" aria-label={regionLabel(area, t)} title={regionLabel(area, t)} onClick={() => onEditArea(area.id)}
              className="h-6 w-6 rounded-sm border border-dashed border-hl/30" />}
          {isStale(area) && <span role="img" aria-label={t('foundry.skin.paint.stale')} title={t('foundry.skin.paint.stale')}
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-state-warning" />}
        </span>)}
      </div>
      <IconButton size="sm" icon={SlidersHorizontal} disabled={disabled || !current}
        label={current ? t('foundry.skin.paint.more', { area: regionLabel(current, t) }) : t('foundry.skin.paint.moreNone')}
        onClick={() => { if (current) onEditArea(current.id); }} />
    </div>}
    <div className="flex items-center gap-1">
      <IconButton size="sm" icon={Undo2} disabled={disabled || !canUndo} aria-keyshortcuts="Control+Z" label={t('common.actions.undo')} onClick={onUndo} />
      <IconButton size="sm" icon={RotateCcw} disabled={disabled || !areas.length} label={t('foundry.skin.paint.startOver')} onClick={onStartOver} />
      <Button size="sm" className="ml-auto" aria-keyshortcuts="Escape" title={t('foundry.skin.paint.doneShortcut')} onClick={onDone}>{t('foundry.skin.paint.done')}</Button>
    </div>
  </div>;
}

/** Name, color, pattern and adjustments for one painted area. Only texture edits can stop at an area's edge. */
export function SkinRegionEditor({ region, stale = false, color, tool, disabled, onTool, onChange, onBack, onDelete }: {
  region: SkinPartRegion; stale?: boolean; color: string; tool: 'color' | 'pattern'; disabled: boolean;
  onTool: (tool: 'color' | 'pattern') => void; onChange: (patch: Partial<SkinPartRegion>) => void; onBack: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const label = regionLabel(region, t);
  return <div className="space-y-3">
    <div className="flex items-center gap-1">
      <IconButton size="sm" icon={ArrowLeft} label={t('foundry.skin.paint.back')} onClick={onBack} />
      <Input inputSize="sm" className="min-w-0 flex-1" value={region.name ?? ''} maxLength={60} disabled={disabled}
        placeholder={label} aria-label={t('foundry.skin.region.name')} onChange={(event) => onChange({ name: event.target.value || undefined })} />
      <IconButton size="sm" icon={Trash2} disabled={disabled} label={t('foundry.skin.region.delete', { area: label })} onClick={onDelete} />
    </div>
    {stale && <p role="status" className="text-xs text-state-warning">{t('foundry.skin.region.staleHint')}</p>}
    <SegmentedControl fill value={tool} onChange={onTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }]} />
    {tool === 'color'
      ? <SkinColorControls paintOnly color={region.paint ?? color} tintable adjustable disabled={disabled}
        edit={{ material: '', hidden: false, tint: region.paint ?? null, repaint: true, adjustments: region.adjustments }}
        onChange={(patch) => onChange({ ...('tint' in patch ? { paint: patch.tint ?? null } : {}), ...('adjustments' in patch ? { adjustments: patch.adjustments } : {}) })} />
      : <SkinPatternPicker still value={region.pattern ?? null} color={region.paint ?? color} disabled={disabled}
        onChange={(pattern) => onChange({ pattern: pattern && { ...pattern, scroll: 0 } })} />}
  </div>;
}
