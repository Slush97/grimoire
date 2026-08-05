import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCrosshairStore } from '../../stores/crosshairStore';
import { SegmentedControl, Slider, Toggle } from '../common/ui';
import Tx from '../translation/Tx';

type ControlTab = 'lines' | 'dot' | 'color' | 'game';

/** The six colors that actually read well against Deadlock's scene palette. */
const QUICK_COLORS = [
  { key: 'white', r: 255, g: 255, b: 255 },
  { key: 'green', r: 0, g: 255, b: 0 },
  { key: 'cyan', r: 0, g: 255, b: 255 },
  { key: 'yellow', r: 255, g: 255, b: 0 },
  { key: 'red', r: 255, g: 0, b: 0 },
  { key: 'magenta', r: 255, g: 0, b: 255 },
] as const;

const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');

const hexToRgb = (hex: string) => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
};

/** Groups a set of sliders under a quiet sub-heading, so "Outline" reads as a
 *  refinement of the thing above it rather than a fifth top-level tab. */
function SubGroup({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border-t border-hl/5 pt-4">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary/70">{title}</h4>
      {children}
    </div>
  );
}

/**
 * The crosshair editor's control surface.
 *
 * Every setting used to stack into one ~1200px column that had to be scrolled
 * past the preview to reach. Splitting it into four tabs keeps each pane short
 * enough to scan at a glance and puts the preview and the control you're
 * dragging on screen at the same time.
 */
export default function CrosshairControls() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ControlTab>('lines');

  const {
    pipGap,
    pipGapStatic,
    pipHeight,
    pipWidth,
    pipOpacity,
    pipOutlineBorder,
    pipOutlineGap,
    pipOutlineOpacity,
    dotOpacity,
    dotSize,
    dotOutlineBorder,
    dotOutlineGap,
    dotOutlineOpacity,
    colorR,
    colorG,
    colorB,
    outlineColorR,
    outlineColorG,
    outlineColorB,
    disableHeroSpecificCrosshairs,
    setPipGap,
    setPipGapStatic,
    setPipHeight,
    setPipWidth,
    setPipOpacity,
    setPipOutlineBorder,
    setPipOutlineGap,
    setPipOutlineOpacity,
    setDotOpacity,
    setDotSize,
    setDotOutlineBorder,
    setDotOutlineGap,
    setDotOutlineOpacity,
    setColor,
    setColorR,
    setColorG,
    setColorB,
    setOutlineColor,
    setDisableHeroSpecificCrosshairs,
  } = useCrosshairStore();

  const tabs = [
    { value: 'lines' as const, label: t('crosshair.tabs.lines') },
    { value: 'dot' as const, label: t('crosshair.tabs.dot') },
    { value: 'color' as const, label: t('crosshair.tabs.color') },
    { value: 'game' as const, label: t('crosshair.tabs.game') },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col rounded-sm border border-hl/5 bg-bg-secondary/50 backdrop-blur-sm">
      <div className="border-b border-hl/5 p-3">
        <SegmentedControl
          fill
          options={tabs}
          value={tab}
          onChange={setTab}
          label={t('crosshair.tabs.label')}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === 'lines' && (
          <div className="space-y-5">
            <Slider editable label={<Tx k="crosshair.controls.gap" fallback="Gap" />} value={pipGap} min={-10} max={50} onChange={setPipGap} />
            <Slider editable label={<Tx k="crosshair.controls.height" fallback="Height" />} value={pipHeight} min={0} max={50} onChange={setPipHeight} />
            <Slider editable label={<Tx k="crosshair.controls.width" fallback="Width" />} value={pipWidth} min={0} max={10} step={0.5} onChange={setPipWidth} />
            <Slider editable label={<Tx k="crosshair.controls.opacity" fallback="Opacity" />} value={pipOpacity} min={0} max={1} step={0.05} onChange={setPipOpacity} />
            <SubGroup title={<Tx k="crosshair.sections.outline" fallback="Outline" />}>
              <Slider editable label={<Tx k="crosshair.controls.outlineWidth" fallback="Outline Width" />} value={pipOutlineBorder} min={0} max={5} onChange={setPipOutlineBorder} />
              <Slider editable label={<Tx k="crosshair.controls.outlineGap" fallback="Outline Gap" />} value={pipOutlineGap} min={0} max={10} step={0.5} onChange={setPipOutlineGap} />
              <Slider editable label={<Tx k="crosshair.controls.outlineOpacity" fallback="Outline Opacity" />} value={pipOutlineOpacity} min={0} max={1} step={0.05} onChange={setPipOutlineOpacity} />
            </SubGroup>
          </div>
        )}

        {tab === 'dot' && (
          <div className="space-y-5">
            <Slider editable label={<Tx k="crosshair.controls.size" fallback="Size" />} value={dotSize} min={0} max={20} step={0.5} onChange={setDotSize} />
            <Slider editable label={<Tx k="crosshair.controls.opacity" fallback="Opacity" />} value={dotOpacity} min={0} max={1} step={0.05} onChange={setDotOpacity} />
            {dotOpacity === 0 && (
              <p className="rounded-sm border border-hl/5 bg-bg-sunken/40 px-3 py-2 text-xs text-text-secondary">
                <Tx k="crosshair.hints.dotHidden" fallback="The dot is fully transparent. Raise Opacity to see it." />
              </p>
            )}
            <SubGroup title={<Tx k="crosshair.sections.outline" fallback="Outline" />}>
              <Slider editable label={<Tx k="crosshair.controls.outlineWidth" fallback="Outline Width" />} value={dotOutlineBorder} min={0} max={5} onChange={setDotOutlineBorder} />
              <Slider editable label={<Tx k="crosshair.controls.outlineGap" fallback="Outline Gap" />} value={dotOutlineGap} min={0} max={10} step={0.5} onChange={setDotOutlineGap} />
              <Slider editable label={<Tx k="crosshair.controls.outlineOpacity" fallback="Outline Opacity" />} value={dotOutlineOpacity} min={0} max={1} step={0.05} onChange={setDotOutlineOpacity} />
            </SubGroup>
          </div>
        )}

        {tab === 'color' && (
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-text-secondary">
                <Tx k="crosshair.controls.color" fallback="Crosshair color" />
              </label>
              <div className="flex items-center gap-3 rounded-sm border border-hl/5 bg-bg-sunken/40 p-3">
                <input
                  type="color"
                  value={rgbToHex(colorR, colorG, colorB)}
                  onChange={(e) => {
                    const rgb = hexToRgb(e.target.value);
                    if (rgb) setColor(rgb.r, rgb.g, rgb.b);
                  }}
                  className="h-8 w-8 cursor-pointer rounded border-none bg-transparent"
                  aria-label={t('crosshair.controls.color')}
                />
                <span className="font-mono text-xs text-text-secondary">
                  {t('crosshair.controls.rgb', { r: colorR, g: colorG, b: colorB })}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_COLORS.map((c) => {
                  const active = colorR === c.r && colorG === c.g && colorB === c.b;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setColor(c.r, c.g, c.b)}
                      title={t(`crosshair.colors.${c.key}`)}
                      aria-label={t(`crosshair.colors.${c.key}`)}
                      aria-pressed={active}
                      className={`h-7 w-7 cursor-pointer rounded-sm border transition-colors ${
                        active ? 'border-accent ring-1 ring-accent' : 'border-hl/20 hover:border-hl/50'
                      }`}
                      style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-4 border-t border-hl/5 pt-4">
              <Slider editable label={<Tx k="crosshair.colors.red" fallback="Red" />} value={colorR} min={0} max={255} onChange={setColorR} />
              <Slider editable label={<Tx k="crosshair.colors.green" fallback="Green" />} value={colorG} min={0} max={255} onChange={setColorG} />
              <Slider editable label={<Tx k="crosshair.colors.blue" fallback="Blue" />} value={colorB} min={0} max={255} onChange={setColorB} />
            </div>

            <SubGroup title={<Tx k="crosshair.controls.outlineColor" fallback="Outline color" />}>
              <div className="flex items-center gap-3 rounded-sm border border-hl/5 bg-bg-sunken/40 p-3">
                <input
                  type="color"
                  value={rgbToHex(outlineColorR, outlineColorG, outlineColorB)}
                  onChange={(e) => {
                    const rgb = hexToRgb(e.target.value);
                    if (rgb) setOutlineColor(rgb.r, rgb.g, rgb.b);
                  }}
                  className="h-8 w-8 cursor-pointer rounded border-none bg-transparent"
                  aria-label={t('crosshair.controls.outlineColor')}
                />
                <span className="font-mono text-xs text-text-secondary">
                  {t('crosshair.controls.rgb', { r: outlineColorR, g: outlineColorG, b: outlineColorB })}
                </span>
              </div>
            </SubGroup>
          </div>
        )}

        {tab === 'game' && (
          <div className="space-y-5">
            <Toggle
              label={<Tx k="crosshair.toggles.staticGapLabel" fallback="Static Gap" />}
              description={<Tx k="crosshair.toggles.staticGap" fallback="Keep the gap fixed. Off lets it expand with weapon spread (not shown in preview)." />}
              checked={pipGapStatic}
              onChange={setPipGapStatic}
            />
            <Toggle
              label={<Tx k="crosshair.toggles.disableHeroCrosshairsLabel" fallback="Disable Hero Crosshairs" />}
              description={<Tx k="crosshair.toggles.disableHeroCrosshairs" fallback="Force your custom crosshair on heroes that override it." />}
              checked={disableHeroSpecificCrosshairs}
              onChange={setDisableHeroSpecificCrosshairs}
            />
            <p className="border-t border-hl/5 pt-4 text-xs leading-relaxed text-text-secondary">
              <Tx
                k="crosshair.hints.applyExplainer"
                fallback="Copy Code pastes the whole crosshair into the in-game console (press F7). Applying a saved preset writes it to autoexec.cfg instead, so it survives a restart."
              />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
