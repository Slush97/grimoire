import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HexColorInput, HexColorPicker } from 'react-colorful';
import { ArrowLeft, Brush, Eraser, Layers, Palette, PaintBucket, RotateCcw, SlidersHorizontal, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from '../common/ui';
import { Input } from '../common/forms';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { SkinColorControls } from './SkinColorControls';
import { SkinPatternPicker } from './SkinPatternPicker';
import { SkinFinishControls } from './SkinFinishControls';
import { finishBall, PAINT_FINISHES, sameFinish } from '../../lib/skinFinishes';
import { colorFamily, PAINT_SWATCHES } from '../../lib/colorNames';
import { areaName, isFinishRegion } from '../../lib/skinRegions';
import { useTrippySwatches } from '../../lib/useTrippySwatches';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import TrippySpriteSwatch from '../locker/TrippySpriteSwatch';
import { TRIPPY_STYLES, type TrippyStyleName } from '../../types/mod';
import type { SkinPartFinish, SkinPartRegion } from '../../types/skinEditor';

export type PaintTool = 'fill' | 'brush' | 'eraser';

const SWATCHES = PAINT_SWATCHES;
/** The custom color swatch: a color wheel, so it reads as "any color" without a label. */
const WHEEL = 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)';

/**
 * Coloring-book painting. Three plain steps, top to bottom: pick what to paint with (paint, or a shine
 * that goes over the paint), paint it on the model, and see what is on the part in the list below.
 * Each thing in the list is one area underneath, so there is nothing to select first and nothing to
 * name. The hover preview does the teaching; words stay in tooltips and short labels.
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
  const tools = [
    { value: 'fill' as const, icon: PaintBucket, label: t('foundry.skin.paint.fill'), hint: t('foundry.skin.paint.fillHint', { part }) },
    { value: 'brush' as const, icon: Brush, label: t('foundry.skin.paint.brush'), hint: t('foundry.skin.paint.brushHint', { part }) },
    { value: 'eraser' as const, icon: Eraser, label: t('foundry.skin.paint.eraser'), hint: t('foundry.skin.paint.eraserHint', { part }) },
  ];
  const painting = tool !== 'eraser';
  // The area the current color, pattern or shine paints into, if it is already on the part.
  const current = painting ? areas.find((area) => finish ? isFinishRegion(area) && sameFinish(area.finish, finish)
    : pattern ? area.pattern?.style === pattern && !area.paint : area.paint?.toLowerCase() === color.toLowerCase() && !area.pattern) : undefined;
  const pick = (next: { color: string } | { pattern: TrippyStyleName } | { finish: SkinPartFinish }) => {
    if ('finish' in next) { onPattern(null); onFinish({ roughness: next.finish.roughness, metalness: next.finish.metalness }); }
    else {
      onFinish(null);
      if ('pattern' in next) onPattern(next.pattern); else { onPattern(null); onColor(next.color); }
    }
    if (!painting) onTool('fill');
  };
  const pickArea = (area: SkinPartRegion) => {
    if (area.pattern) pick({ pattern: area.pattern.style });
    else if (area.paint) pick({ color: area.paint });
    else if (area.finish) pick({ finish: area.finish });
    else onEditArea(area.id);
  };
  const custom = !pattern && !finish && !SWATCHES.includes(color.toLowerCase());
  const chip = 'shrink-0 overflow-hidden rounded-sm border border-hl/20 outline-offset-2 aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-accent';
  // The look of an area or ink, without the button around it.
  const look = (area: Pick<SkinPartRegion, 'paint' | 'pattern' | 'finish'>, className: string) => area.pattern
    ? <span className={`${className} overflow-hidden`}><TrippySpriteSwatch sprite={sprites[area.pattern.style] ?? null} className="h-full w-full" /></span>
    : area.paint ? <span className={className} style={{ backgroundColor: area.paint }} />
    : area.finish ? <span className={`${className} rounded-full`} style={{ background: finishBall(area.finish) }} />
    : <span className={`${className} border-dashed`} />;
  // Ordered like the model shows them: paint first, shine over it.
  const listed = [...areas.filter((area) => !isFinishRegion(area)), ...areas.filter(isFinishRegion)];
  return <div className="space-y-3">
    <SegmentedControl fill label={t('foundry.skin.paint.tool')} value={tool} onChange={onTool} options={tools.map(({ value, icon: Icon, label, hint }) => ({
      value, title: hint, label: <span className="flex items-center justify-center gap-1.5"><Icon className="h-3.5 w-3.5" aria-hidden />{label}</span>,
    }))} />
    {!areas.length && <p className="text-xs text-text-secondary">{tools.find((item) => item.value === tool)?.hint}</p>}
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="mb-1.5 flex items-center gap-1.5 text-xs text-text-secondary"><Palette className="h-3.5 w-3.5" aria-hidden />{t('foundry.skin.paint.paint')}</legend>
      {/* Fixed grids: switching between colors, patterns, shine and the eraser never moves anything. */}
      <div className="flex justify-between gap-1">
        {SWATCHES.map((value) => <button key={value} type="button" aria-label={t(`foundry.skin.paint.colors.${colorFamily(value)}`)} title={t(`foundry.skin.paint.colors.${colorFamily(value)}`)}
          aria-pressed={painting && !pattern && !finish && color.toLowerCase() === value} onClick={() => pick({ color: value })}
          style={{ backgroundColor: value }} className={`h-5 w-5 ${chip}`} />)}
        <button ref={customRef} type="button" aria-label={t('foundry.skin.paint.customColor')} title={t('foundry.skin.paint.customColor')}
          aria-pressed={painting && custom} aria-expanded={customOpen} onClick={() => setCustomOpen(!customOpen)}
          className={`relative h-5 w-5 ${chip}`} style={{ background: WHEEL }}>
          {custom && <span className="absolute inset-1 rounded-sm border border-hl/30" style={{ backgroundColor: color }} />}
        </button>
      </div>
      <div className="grid grid-cols-8 justify-items-center gap-1" role="group" aria-label={t('foundry.skin.paint.patterns')}>
        {TRIPPY_STYLES.map((style) => <button key={style} type="button" aria-label={TRIPPY_STYLE_LABELS[style]} title={TRIPPY_STYLE_LABELS[style]}
          aria-pressed={painting && pattern === style} onClick={() => pick({ pattern: style })} className={`h-5 w-5 ${chip}`}>
          <TrippySpriteSwatch sprite={sprites[style] ?? null} className="h-full w-full" />
        </button>)}
      </div>
      <AnchoredPopover open={customOpen} onClose={() => setCustomOpen(false)} anchorRef={customRef} width={224} ariaLabel={t('foundry.skin.paint.customColor')}
        className="space-y-2 p-3 [&_.react-colorful__saturation]:rounded-t-sm [&_.react-colorful__hue]:rounded-b-sm">
        <HexColorPicker color={color} onChange={(value) => pick({ color: value })} style={{ width: '100%', height: 140 }} />
        <HexColorInput color={color} onChange={(value) => { if (/^#?[0-9a-f]{6}$/i.test(value)) pick({ color: value.startsWith('#') ? value : `#${value}` }); }} prefixed
          aria-label={t('foundry.skin.hex')} className="h-8 w-full rounded-sm border border-border bg-bg-tertiary px-2 text-sm uppercase tabular-nums text-text-primary focus-visible:outline-2 focus-visible:outline-accent" />
      </AnchoredPopover>
    </fieldset>
    {/* Shine is a coat over the paint, not another color, so it gets its own row of lit balls with names. */}
    <fieldset disabled={disabled || !finishable} title={finishable ? undefined : t('foundry.skin.finishUnsupported')} className="disabled:opacity-40">
      <legend className="mb-1.5 flex items-center gap-1.5 text-xs text-text-secondary"><Sparkles className="h-3.5 w-3.5" aria-hidden />{t('foundry.skin.paint.shine')}
        <span className="text-text-tertiary">{t('foundry.skin.paint.shineOver')}</span></legend>
      <div className="grid grid-cols-3 gap-1">
        {PAINT_FINISHES.map((value) => <button key={value.name} type="button" aria-pressed={painting && sameFinish(finish, value)} onClick={() => pick({ finish: value })}
          className="flex items-center gap-2 rounded-sm border border-transparent px-1.5 py-1 text-xs text-text-secondary hover:bg-hl/5 hover:text-text-primary aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-text-primary">
          {look({ finish: value }, 'h-5 w-5 shrink-0 border border-hl/20')}
          <span className="truncate">{t(`foundry.skin.paint.shines.${value.name}`)}</span>
        </button>)}
      </div>
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
    {/* What is on the part: a list, so it never reads as more colors to pick. */}
    {listed.length > 0 && <section className="border-t border-border pt-3" aria-label={t('foundry.skin.paint.onPart', { part })}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-text-secondary">
        <Layers className="h-3.5 w-3.5" aria-hidden /><span className="min-w-0 flex-1 truncate">{t('foundry.skin.paint.onPart', { part })}</span>
        <IconButton size="sm" icon={RotateCcw} disabled={disabled} label={t('foundry.skin.paint.startOver')} onClick={onStartOver} />
      </div>
      <ul className="space-y-0.5">
        {listed.map((area) => {
          const name = areaName(area, t);
          return <li key={area.id} className="group flex items-center gap-0.5" onPointerEnter={() => onPreviewArea(area.id)} onPointerLeave={() => onPreviewArea(null)}>
            <button type="button" aria-pressed={area === current} disabled={disabled} onClick={() => pickArea(area)} title={t('foundry.skin.paint.paintMore', { area: name })}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1.5 py-1 text-left text-xs text-text-primary hover:bg-hl/5 aria-pressed:bg-accent/15">
              {look(area, 'h-5 w-5 shrink-0 rounded-sm border border-hl/20')}
              <span className="min-w-0 flex-1 truncate">{name}</span>
              {isStale(area) && <span role="img" aria-label={t('foundry.skin.paint.stale')} title={t('foundry.skin.paint.stale')} className="h-2 w-2 shrink-0 rounded-full bg-state-warning" />}
            </button>
            <IconButton size="sm" icon={SlidersHorizontal} disabled={disabled} label={t('foundry.skin.paint.more', { area: name })} onClick={() => onEditArea(area.id)} />
            <IconButton size="sm" icon={Trash2} disabled={disabled} label={t('foundry.skin.paint.remove', { area: name })} onClick={() => onRemoveArea(area.id)} />
          </li>;
        })}
      </ul>
    </section>}
    <div className="flex items-center gap-1">
      <IconButton size="sm" icon={Undo2} disabled={disabled || !canUndo} aria-keyshortcuts="Control+Z" label={t('common.actions.undo')} onClick={onUndo} />
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
  const label = areaName(region, t);
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
