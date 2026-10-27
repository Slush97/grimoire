import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { ArrowLeft, Brush, Eraser, PaintBucket, RotateCcw, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input } from '../common/forms';
import { SkinColorControls } from './SkinColorControls';
import { SkinPatternPicker } from './SkinPatternPicker';
import { hasRegionEdit } from '../../lib/skinColorAdjustments';
import { regionLabel } from '../../lib/skinRegions';
import type { SkinPartRegion } from '../../types/skinEditor';

export type PaintTool = 'fill' | 'brush' | 'eraser';

const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#84cc16', '#2dd4bf', '#3b82f6', '#a855f7', '#ec4899', '#eeeeee', '#252525'];

/**
 * Coloring-book painting: pick a color, then fill or brush it onto the model. Each color is one area
 * underneath, so there is nothing to select first and nothing to name.
 */
export function SkinPaintPanel({ part, color, tool, brushSize, tolerance, areas, missed, canUndo, disabled,
  onColor, onTool, onBrushSize, onTolerance, onUndo, onStartOver, onDone, onEditArea, onPreviewArea }: {
  part: string; color: string; tool: PaintTool; brushSize: number; tolerance: number; areas: SkinPartRegion[];
  /** The part a stroke or click landed on instead, '' when unknown, false when none. */
  missed: string | false;
  canUndo: boolean; disabled: boolean;
  onColor: (color: string) => void; onTool: (tool: PaintTool) => void; onBrushSize: (size: number) => void; onTolerance: (tolerance: number) => void;
  onUndo: () => void; onStartOver: () => void; onDone: () => void; onEditArea: (id: string) => void; onPreviewArea: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const toolIcon = { fill: PaintBucket, brush: Brush, eraser: Eraser } satisfies Record<PaintTool, unknown>;
  return <div className="space-y-3">
    <p className="text-xs text-text-secondary">{tool === 'fill' ? t('foundry.skin.paint.fillHint', { part })
      : tool === 'brush' ? t('foundry.skin.paint.brushHint', { part }) : t('foundry.skin.paint.eraserHint', { part })}</p>
    <SegmentedControl fill label={t('foundry.skin.paint.tool')} value={tool} onChange={onTool} options={(['fill', 'brush', 'eraser'] as const).map((value) => {
      const Icon = toolIcon[value];
      const label = value === 'fill' ? t('foundry.skin.paint.fill') : value === 'brush' ? t('foundry.skin.paint.brush') : t('foundry.skin.paint.eraser');
      return { value, label: <span className="flex items-center justify-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span> };
    })} />
    {tool !== 'eraser' && <fieldset disabled={disabled} className="space-y-2">
      <legend className="sr-only">{t('foundry.skin.paint.color')}</legend>
      <div className="flex justify-between gap-1">
        {SWATCHES.map((swatch) => <button key={swatch} type="button" aria-label={swatch} title={swatch} aria-pressed={color.toLowerCase() === swatch}
          onClick={() => onColor(swatch)} style={{ backgroundColor: swatch }}
          className="h-6 w-6 rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-accent" />)}
      </div>
      <div className="px-2 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={onColor} style={{ width: '100%', height: 72 }} />
      </div>
    </fieldset>}
    {tool === 'fill' ? <label className="block space-y-1 text-xs text-text-secondary">
      <span>{t('foundry.skin.paint.fillRange')}</span>
      <input type="range" min={1} max={40} value={tolerance} aria-label={t('foundry.skin.paint.fillRange')} disabled={disabled}
        className="h-7 w-full accent-accent" onChange={(event) => onTolerance(Number(event.target.value))} />
      <span aria-hidden className="flex justify-between text-2xs text-text-tertiary">
        <span>{t('foundry.skin.paint.rangeClose')}</span><span>{t('foundry.skin.paint.rangeLoose')}</span>
      </span>
    </label> : <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="shrink-0">{t('foundry.skin.paint.size')}</span>
      <input type="range" min={2} max={120} value={brushSize} aria-label={t('foundry.skin.paint.size')} disabled={disabled}
        className="h-7 min-w-0 flex-1 accent-accent" onChange={(event) => onBrushSize(Number(event.target.value))} />
    </label>}
    {missed !== false && <p role="status" className="text-xs text-state-warning">
      {missed ? t('foundry.skin.region.otherPart', { other: missed, part }) : t('foundry.skin.region.otherPartUnknown', { part })}</p>}
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" icon={Undo2} disabled={disabled || !canUndo} aria-keyshortcuts="Control+Z" onClick={onUndo}>{t('common.actions.undo')}</Button>
      <Button size="sm" variant="ghost" icon={RotateCcw} disabled={disabled || !areas.length} onClick={onStartOver}>{t('foundry.skin.paint.startOver')}</Button>
      <Button size="sm" className="ml-auto" aria-keyshortcuts="Escape" title={t('foundry.skin.paint.doneShortcut')} onClick={onDone}>{t('foundry.skin.paint.done')}</Button>
    </div>
    <div className="space-y-1 border-t border-border pt-3">
      <h5 className="text-xs font-semibold text-text-primary">{t('foundry.skin.paint.yourColors')}</h5>
      {!areas.length ? <p className="text-xs text-text-tertiary">{t('foundry.skin.paint.nothingYet')}</p>
        : <ul className="space-y-1">{areas.map((area) => <li key={area.id} className="flex items-center gap-1"
          onPointerEnter={() => onPreviewArea(area.id)} onPointerLeave={() => onPreviewArea(null)}>
          <button type="button" disabled={disabled || !area.paint} onClick={() => { if (area.paint) { onColor(area.paint); onTool('fill'); } }}
            className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-1 text-left text-xs text-text-primary hover:bg-hl/5 focus-visible:outline-2 focus-visible:outline-accent">
            <span className="h-4 w-4 shrink-0 rounded-sm border border-hl/20" style={{ backgroundColor: area.paint ?? 'transparent' }} />
            <span className="min-w-0 truncate">{regionLabel(area, t)}</span>
            {area.pattern && <span className="text-2xs text-text-tertiary">{t('foundry.skin.pattern')}</span>}
          </button>
          <IconButton size="sm" icon={SlidersHorizontal} disabled={disabled} label={t('foundry.skin.paint.more', { area: regionLabel(area, t) })} onClick={() => onEditArea(area.id)} />
        </li>)}</ul>}
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
    {!stale && !hasRegionEdit(region) && <p role="status" className="text-xs text-text-secondary">{t('foundry.skin.region.uneditedHint')}</p>}
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
