// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SkinPaintPanel, SkinRegionEditor } from './SkinRegionControls';
import { TRIPPY_STYLE_LABELS } from '../../lib/trippy';
import type { SkinPartRegion } from '../../types/skinEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => options?.index ? `${key}:${String(options.index)}` : key }) }));
vi.mock('../../lib/api', () => ({ previewTrippySprite: vi.fn(() => new Promise(() => {})) }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const tab = (text: string) => [...host.querySelectorAll('[role="tab"]')].find((element) => element.textContent === text) as HTMLButtonElement;
const region: SkinPartRegion = { id: 'r3', seeds: [{ u: 0.5, v: 0.5 }], paint: '#ef4444' };

const button = (text: string) => [...host.querySelectorAll('button')].find((element) => element.textContent === text || element.getAttribute('aria-label') === text) as HTMLButtonElement;

describe('SkinPaintPanel', () => {
  const props = (patch: Partial<ComponentProps<typeof SkinPaintPanel>> = {}): ComponentProps<typeof SkinPaintPanel> => ({
    part: 'Dress', color: '#2dd4bf', tool: 'fill', brushSize: 16, tolerance: 8, areas: [], missed: false, canUndo: false, disabled: false,
    onColor: vi.fn(), onPattern: vi.fn(), onFinish: vi.fn(), onGlow: vi.fn(), onTool: vi.fn(), onBrushSize: vi.fn(), onTolerance: vi.fn(), onUndo: vi.fn(), onStartOver: vi.fn(), onDone: vi.fn(),
    onEditArea: vi.fn(), onRemoveArea: vi.fn(), onPreviewArea: vi.fn(), ...patch,
  });
  it('explains the chosen tool and shows only its setting', () => {
    act(() => root.render(<SkinPaintPanel {...props()} />));
    // One line of help until the part has paint; after that the tool's hint is only a tooltip.
    expect(host.textContent).toContain('foundry.skin.paint.fillHint');
    expect(host.querySelector('input[aria-label="foundry.skin.paint.fillRange"]')).not.toBeNull();
    act(() => root.render(<SkinPaintPanel {...props({ areas: [region] })} />));
    expect(host.textContent).not.toContain('foundry.skin.paint.fillHint');
    expect(tab('foundry.skin.paint.fill').title).toBe('foundry.skin.paint.fillHint');
    act(() => root.render(<SkinPaintPanel {...props({ tool: 'eraser' })} />));
    expect(host.textContent).toContain('foundry.skin.paint.eraserHint');
    expect(host.querySelector('input[aria-label="foundry.skin.paint.size"]')).not.toBeNull();
    expect(host.querySelector('.react-colorful')).toBeNull();
  });
  it('lists what is on the part by name, with its own change and remove buttons', () => {
    const value = props({ areas: [region], missed: 'Jacket', canUndo: true });
    act(() => root.render(<SkinPaintPanel {...value} />));
    expect(host.textContent).toContain('foundry.skin.region.otherPart');
    expect(host.textContent).toContain('foundry.skin.paint.onPart');
    // The row names the color in words and picks it to paint more.
    act(() => [...host.querySelectorAll('li button')][0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(value.onColor).toHaveBeenCalledWith('#ef4444');
    act(() => button('foundry.skin.paint.more').click());
    expect(value.onEditArea).toHaveBeenCalledWith('r3');
    act(() => button('foundry.skin.paint.remove').click());
    expect(value.onRemoveArea).toHaveBeenCalledWith('r3');
    act(() => button('common.actions.undo').click());
    expect(value.onUndo).toHaveBeenCalled();
  });
  it('paints with a pattern or a shine in one click and keeps shine below the paint', () => {
    const value = props({ areas: [{ id: 'r5', seeds: [{ u: 0.5, v: 0.5 }], finish: { roughness: 0.18, metalness: 1 } }, region,
      { id: 'r4', seeds: [{ u: 0.5, v: 0.5 }], pattern: { style: 'camo', intensity: 1, phase: 0, scroll: 0 } }] });
    act(() => root.render(<SkinPaintPanel {...value} />));
    act(() => button(TRIPPY_STYLE_LABELS.holo).click());
    expect(value.onPattern).toHaveBeenLastCalledWith('holo');
    expect(value.onFinish).toHaveBeenLastCalledWith(null);
    act(() => button('foundry.skin.paint.shines.metal').click());
    // Only the finish values: a preset name would fail the strict export schema.
    expect(value.onFinish).toHaveBeenLastCalledWith({ roughness: 0.18, metalness: 1 });
    expect(value.onPattern).toHaveBeenLastCalledWith(null);
    act(() => button('foundry.skin.paint.colors.blue').click());
    expect(value.onColor).toHaveBeenLastCalledWith('#3b82f6');
    const rows = [...host.querySelectorAll('li')].map((row) => row.textContent);
    expect(rows).toEqual(['foundry.skin.paint.colors.red', TRIPPY_STYLE_LABELS.camo, 'foundry.skin.paint.shines.metal']);
  });
  it('glows in the picked color and lists glow after shine', () => {
    const value = props({ color: '#3b82f6', areas: [{ id: 'r6', seeds: [{ u: 0.5, v: 0.5 }], glow: { color: '#ff00aa', animation: 'rainbow' } }, region] });
    act(() => root.render(<SkinPaintPanel {...value} />));
    act(() => button('foundry.skin.paint.glows.pulse').click());
    expect(value.onGlow).toHaveBeenLastCalledWith({ color: '#3b82f6', animation: 'pulse' });
    expect(value.onFinish).toHaveBeenLastCalledWith(null);
    expect([...host.querySelectorAll('li')].map((row) => row.textContent)).toEqual(['foundry.skin.paint.colors.red', 'foundry.skin.paint.glows.rainbow']);
    act(() => root.render(<SkinPaintPanel {...props({ glowable: false })} />));
    expect(button('foundry.skin.paint.glows.steady').closest('fieldset')?.disabled).toBe(true);
  });
  it('greys out shine on parts without a finish', () => {
    act(() => root.render(<SkinPaintPanel {...props({ finishable: false })} />));
    expect(button('foundry.skin.paint.shines.metal').closest('fieldset')?.disabled).toBe(true);
  });
});

describe('SkinRegionEditor', () => {
  it('paints without a tint mode and keeps area patterns still', () => {
    const onChange = vi.fn();
    const render = (value: SkinPartRegion, tool: 'color' | 'pattern') => act(() => root.render(<SkinRegionEditor region={value} color="#336699" tool={tool} disabled={false}
      onTool={vi.fn()} onChange={onChange} onBack={vi.fn()} onDelete={vi.fn()} />));
    render(region, 'color');
    expect(tab('foundry.skin.tint')).toBeUndefined();
    act(() => (host.querySelector('button[aria-label="#3b82f6"]') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ paint: '#3b82f6' });
    render({ ...region, pattern: { style: 'camo', intensity: 1, phase: 0, scroll: 0 } }, 'pattern');
    expect(host.querySelector('input[aria-label="foundry.skin.scroll"]')).toBeNull();
    act(() => (host.querySelector(`button[aria-label="${TRIPPY_STYLE_LABELS.holo}"]`) as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ pattern: expect.objectContaining({ style: 'holo', scroll: 0 }) });
  });
});
