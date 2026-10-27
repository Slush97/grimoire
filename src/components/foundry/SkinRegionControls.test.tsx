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
const button = (text: string) => [...host.querySelectorAll('button')].find((element) => element.textContent === text) as HTMLButtonElement;
const tab = (text: string) => [...host.querySelectorAll('[role="tab"]')].find((element) => element.textContent === text) as HTMLButtonElement;
const region: SkinPartRegion = { id: 'r3', seeds: [{ u: 0.5, v: 0.5 }], paint: '#ef4444' };

describe('SkinPaintPanel', () => {
  const props = (patch: Partial<ComponentProps<typeof SkinPaintPanel>> = {}): ComponentProps<typeof SkinPaintPanel> => ({
    part: 'Dress', color: '#2dd4bf', tool: 'fill', brushSize: 16, tolerance: 8, areas: [], missed: false, canUndo: false, disabled: false,
    onColor: vi.fn(), onTool: vi.fn(), onBrushSize: vi.fn(), onTolerance: vi.fn(), onUndo: vi.fn(), onStartOver: vi.fn(), onDone: vi.fn(),
    onEditArea: vi.fn(), onPreviewArea: vi.fn(), ...patch,
  });
  it('explains the chosen tool and shows only its setting', () => {
    act(() => root.render(<SkinPaintPanel {...props()} />));
    expect(host.textContent).toContain('foundry.skin.paint.fillHint');
    expect(host.querySelector('input[aria-label="foundry.skin.paint.fillRange"]')).not.toBeNull();
    expect(host.textContent).toContain('foundry.skin.paint.nothingYet');
    act(() => root.render(<SkinPaintPanel {...props({ tool: 'eraser' })} />));
    expect(host.textContent).toContain('foundry.skin.paint.eraserHint');
    expect(host.querySelector('input[aria-label="foundry.skin.paint.size"]')).not.toBeNull();
    // Erasing needs no color.
    expect(host.querySelector('button[aria-label="#ef4444"]')).toBeNull();
  });
  it('reuses a painted color and opens its details', () => {
    const value = props({ areas: [region], missed: 'Jacket', canUndo: true });
    act(() => root.render(<SkinPaintPanel {...value} />));
    expect(host.textContent).toContain('foundry.skin.region.otherPart');
    act(() => button('foundry.skin.region.areaName:3').click());
    expect(value.onColor).toHaveBeenCalledWith('#ef4444');
    expect(value.onTool).toHaveBeenCalledWith('fill');
    act(() => (host.querySelector('button[aria-label="foundry.skin.paint.more"]') as HTMLButtonElement).click());
    expect(value.onEditArea).toHaveBeenCalledWith('r3');
    act(() => button('common.actions.undo').click());
    expect(value.onUndo).toHaveBeenCalled();
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
