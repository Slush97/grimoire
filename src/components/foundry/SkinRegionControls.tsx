import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { ArrowLeft, Brush, Eraser, Palette, PaintBucket, RotateCcw, SlidersHorizontal, Trash2, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input } from '../common/forms';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { SkinColorControls } from './SkinColorControls';
import { SkinPatternPicker } from './SkinPatternPicker';
import { SkinFinishControls } from './SkinFinishControls';
import { finishBall, PAINT_FINISHES, sameFinish } from '../../lib/skinFinishes';
import { isFinishRegion, regionLabel } from '../../lib/skinRegions';
import { useTrippySwatches } from '../../lib/useTrippySwatches';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import TrippySpriteSwatch from '../locker/TrippySpriteSwatch';
import { TRIPPY_STYLES, type TrippyStyleName } from '../../types/mod';
import type { SkinPartFinish, SkinPartRegion } from '../../types/skinEditor';

export type PaintTool = 'fill' | 'brush' | 'eraser';

const SWATCHES = ['#ef4444', '#f97316', '#facc15', '#84cc16', '#2dd4bf', '#3b82f6', '#a855f7', '#eeeeee', '#252525'];
/** The custom color swatch: a color wheel, so it reads as "any color" without a label. */
const WHEEL = 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';

/**
 * Coloring-book painting: pick a color, then fill or brush it onto the model. Each color is one area
 * underneath, so there is nothing to select first and nothing to name. The hover preview does the
 * teaching; words stay in tooltips, plus one line until the part has paint.
 */
export function SkinPaintPanel({ part, color, pattern = null, finish = null, finishable = true, tool, brushSize, tolerance, areas, missed, notice = null, isStale = () => false, canUndo, disabled,
  onColor, onPattern, onFinish = () => {}, onTool, onBrushSize, onTolerance, onUndo, onStartOver, onDone, onEditArea, onRemoveArea, onPreviewArea }: {
  part: string; color: string;
  /** Painting with a pattern instead of a color. */
  pattern?: TrippyStyleName | null;
  /** Painting shine instead of a color: it keeps the colors under it. */
  finish?: SkinPartFinish | null;
  /** Whether the part's material can take a shine. */
  finishable?: boolean;
  tool: PaintTool; brushSize: number; tolerance: number; areas: SkinPartRegion[];
  /** The part a stroke or click landed on instead, '' when unknown, false when none. */
  missed: string | false;
  /** Why the last paint did nothing. */
  notice?: string | null;
  /** Areas painted on an older texture layout, which need painting again. */
  isStale?: (area: SkinPartRegion) => boolean;
  canUndo: boolean; disabled: boolean;
  onColor: (color: string) => void; onPattern: (pattern: TrippyStyleName | null) => void; onFinish?: (finish: SkinPartFinish | null) => void;
  onTool: (tool: PaintTool) => void; onBrushSize: (size: number) => void; onTolerance: (tolerance: number) => void;
  onUndo: () => void; onStartOver: () => void; onDone: () => void; onEditArea: (id: string) => void; onRemoveArea: (id: string) => void;
  onPreviewArea: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const sprites = useTrippySwatches();
  const [customOpen, setCustomOpen] = useState(false);
  const customRef = useRef<HTMLButtonElement>(null);
  // The chip last clicked in Your colors, which the details and remove buttons act on.
  const [chosen, setChosen] = useState<string | null>(null);
  const tools = [
    { value: 'fill' as const, icon: PaintBucket, label: t('foundry.skin.paint.fill'), hint: t('foundry.skin.paint.fillHint', { part }) },
    { value: 'brush' as const, icon: Brush, label: t('foundry.skin.paint.brush'), hint: t('foundry.skin.paint.brushHint', { part }) },
    { value: 'eraser' as const, icon: Eraser, label: t('foundry.skin.paint.eraser'), hint: t('foundry.skin.paint.eraserHint', { part }) },
  ];
  const current = areas.find((area) => area.id === chosen)
    ?? areas.find((area) => finish ? isFinishRegion(area) && sameFinish(area.finish, finish)
      : pattern ? area.pattern?.style === pattern && !area.paint : area.paint?.toLowerCase() === color.toLowerCase() && !area.pattern);
  const pick = (next: { color: string } | { pattern: TrippyStyleName } | { finish: SkinPartFinish }, area: string | null = null) => {
    if ('finish' in next) { onPattern(null); onFinish(next.finish); }
    else {
      onFinish(null);
      if ('pattern' in next) onPattern(next.pattern); else { onPattern(null); onColor(next.color); }
    }
    setChosen(area);
    if (tool === 'eraser') onTool('fill');
  };
  const painting = tool !== 'eraser';
  const custom = !pattern && !finish && !SWATCHES.includes(color.toLowerCase());
  const chip = 'shrink-0 overflow-hidden rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-accent';
  const swatch = (value: string, label: string, pressed: boolean, size = 'h-5 w-5', area: string | null = null) => <button key={area ?? value} type="button" aria-label={label} title={label}
    aria-pressed={pressed} onClick={() => pick({ color: value }, area)} style={{ backgroundColor: value }} className={`${size} ${chip}`} />;
  const patternSwatch = (style: TrippyStyleName, label: string, pressed: boolean, size = 'h-5 w-5', area: string | null = null) => <button key={area ?? style} type="button" aria-label={label}
    title={label} aria-pressed={pressed} onClick={() => pick({ pattern: style }, area)} className={`${size} ${chip}`}>
    <TrippySpriteSwatch sprite={sprites[style] ?? null} className="h-full w-full" />
  </button>;
  const finishSwatch = (value: SkinPartFinish, label: string, pressed: boolean, size = 'h-5 w-5', area: string | null = null) => <button key={area ?? label} type="button"
    aria-label={label} title={finishable ? label : t('foundry.skin.finishUnsupported')} aria-pressed={pressed} disabled={!finishable}
    onClick={() => pick({ finish: { roughness: value.roughness, metalness: value.metalness } }, area)} style={{ background: finishBall(value) }} className={`${size} ${chip} rounded-full disabled:opacity-40`} />;
  return <div className="space-y-3">
    <SegmentedControl fill label={t('foundry.skin.paint.tool')} value={tool} onChange={onTool} options={tools.map(({ value, icon: Icon, label, hint }) => ({
      value, title: hint, label: <span className="flex items-center justify-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>,
    }))} />
    {!areas.length && <p className="text-xs text-text-secondary">{tools.find((item) => item.value === tool)?.hint}</p>}
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="sr-only">{t('foundry.skin.paint.color')}</legend>
      {/* Fixed grids: switching between colors, patterns and the eraser never moves anything. */}
      <div className="flex justify-between gap-1">
        {SWATCHES.map((value) => swatch(value, value, painting && !pattern && !finish && color.toLowerCase() === value))}
        <button ref={customRef} type="button" aria-label={t('foundry.skin.paint.customColor')} title={t('foundry.skin.paint.customColor')}
          aria-pressed={painting && custom} aria-expanded={customOpen} onClick={() => setCustomOpen(!customOpen)}
          className={`relative h-5 w-5 ${chip}`} style={{ background: WHEEL }}>
          {custom && <span className="absolute inset-1 rounded-sm border border-hl/30" style={{ backgroundColor: color }} />}
        </button>
      </div>
      <div className="grid grid-cols-8 justify-items-center gap-1" role="group" aria-label={t('foundry.skin.paint.patterns')}>
        {TRIPPY_STYLES.map((style) => patternSwatch(style, TRIPPY_STYLE_LABELS[style], painting && pattern === style))}
      </div>
      <div className="flex gap-1.5" role="group" aria-label={t('foundry.skin.paint.shine')}>
        {PAINT_FINISHES.map((value) => finishSwatch(value, t(`foundry.skin.finish.${value.name}`), painting && sameFinish(finish, value)))}
      </div>
      <AnchoredPopover open={customOpen} onClose={() => setCustomOpen(false)} anchorRef={customRef} width={224} ariaLabel={t('foundry.skin.paint.customColor')}
        className="space-y-2 p-3 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={(value) => pick({ color: value })} style={{ width: '100%', height: 140 }} />
        <HexColorInput color={color} onChange={(value) => { if (/^#?[0-9a-f]{6}$/i.test(value)) pick({ color: value.startsWith('#') ? value : `#${value}` }); }} prefixed
          aria-label={t('foundry.skin.hex')} className="h-8 w-full rounded-sm border border-border bg-bg-tertiary px-2 text-sm uppercase tabular-nums text-text-primary focus-visible:outline-2 focus-visible:outline-accent" />
      </AnchoredPopover>
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
          {/* An area painted with a pattern shows the pattern, so two areas of one color still look different. */}
          {area.pattern ? patternSwatch(area.pattern.style, regionLabel(area, t), painting && area === current, 'h-6 w-6', area.id)
            : area.paint ? swatch(area.paint, regionLabel(area, t), painting && area === current, 'h-6 w-6', area.id)
            : area.finish ? finishSwatch(area.finish, regionLabel(area, t), painting && area === current, 'h-6 w-6', area.id)
            : <button type="button" aria-label={regionLabel(area, t)} title={regionLabel(area, t)} onClick={() => onEditArea(area.id)}
              className="h-6 w-6 rounded-sm border border-dashed border-hl/30" />}
          {isStale(area) && <span role="img" aria-label={t('foundry.skin.paint.stale')} title={t('foundry.skin.paint.stale')}
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-state-warning" />}
        </span>)}
      </div>
      <div className="flex shrink-0 gap-1 self-start">
        <IconButton size="sm" icon={SlidersHorizontal} disabled={disabled || !current}
          label={current ? t('foundry.skin.paint.more', { area: regionLabel(current, t) }) : t('foundry.skin.paint.moreNone')}
          onClick={() => { if (current) onEditArea(current.id); }} />
        <IconButton size="sm" icon={Trash2} disabled={disabled || !current}
          label={current ? t('foundry.skin.paint.remove', { area: regionLabel(current, t) }) : t('foundry.skin.paint.moreNone')}
          onClick={() => { if (current) { onRemoveArea(current.id); setChosen(null); } }} />
      </div>
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
    {isFinishRegion(region) ? <SkinFinishControls value={region.finish} disabled={disabled} onChange={(finish) => onChange({ finish })} /> : <>
    <SegmentedControl fill value={tool} onChange={onTool} options={[{ value: 'color', label: t('foundry.skin.color') }, { value: 'pattern', label: t('foundry.skin.pattern') }]} />
    {tool === 'color'
      ? <SkinColorControls paintOnly color={region.paint ?? color} tintable adjustable disabled={disabled}
        edit={{ material: '', hidden: false, tint: region.paint ?? null, repaint: true, adjustments: region.adjustments }}
        onChange={(patch) => onChange({ ...('tint' in patch ? { paint: patch.tint ?? null } : {}), ...('adjustments' in patch ? { adjustments: patch.adjustments } : {}) })} />
      : <SkinPatternPicker still value={region.pattern ?? null} color={region.paint ?? color} disabled={disabled}
        onChange={(pattern) => onChange({ pattern: pattern && { ...pattern, scroll: 0 } })} />}
    </>}
  </div>;
}
