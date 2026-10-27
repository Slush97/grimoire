// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SkinRegionEditor, SkinRegionSelecting, SkinRegionTargets } from './SkinRegionControls';
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
const region: SkinPartRegion = { id: 'r3', seeds: [{ u: 0.5, v: 0.5 }] };

describe('SkinRegionTargets', () => {
  it('names unnamed areas by their id and targets the whole part with null', () => {
    const onSelect = vi.fn();
    act(() => root.render(<SkinRegionTargets part="Dress" regions={[region, { ...region, id: 'r4', name: 'Trim' }]} active="r3" disabled={false}
      onSelect={onSelect} onAdd={vi.fn()} onPreview={vi.fn()} />));
    expect(button('foundry.skin.region.areaName:3foundry.skin.region.unedited').getAttribute('aria-pressed')).toBe('true');
    expect(button('Trimfoundry.skin.region.unedited')).toBeTruthy();
    act(() => button('foundry.skin.region.wholePart').click());
    expect(onSelect).toHaveBeenCalledWith(null);
  });
});

describe('SkinRegionTargets without areas', () => {
  it('explains what an area is and offers to start one', () => {
    const onAdd = vi.fn();
    act(() => root.render(<SkinRegionTargets part="Dress" regions={[]} active={null} disabled={false} onSelect={vi.fn()} onAdd={onAdd} onPreview={vi.fn()} />));
    expect(host.textContent).toContain('foundry.skin.region.intro');
    act(() => button('foundry.skin.region.add').click());
    expect(onAdd).toHaveBeenCalled();
  });
});

describe('SkinRegionEditor', () => {
  it('paints without a tint mode and keeps area patterns still', () => {
    const onChange = vi.fn();
    const render = (value: SkinPartRegion, tool: 'color' | 'pattern') => act(() => root.render(<SkinRegionEditor region={value} color="#336699" tool={tool} disabled={false}
      onTool={vi.fn()} onChange={onChange} onSelect={vi.fn()} onDelete={vi.fn()} />));
    render(region, 'color');
    expect(tab('foundry.skin.tint')).toBeUndefined();
    act(() => (host.querySelector('button[aria-label="#ef4444"]') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ paint: '#ef4444' });
    render({ ...region, pattern: { style: 'camo', intensity: 1, phase: 0, scroll: 0 } }, 'pattern');
    expect(host.querySelector('input[aria-label="foundry.skin.scroll"]')).toBeNull();
    act(() => (host.querySelector(`button[aria-label="${TRIPPY_STYLE_LABELS.holo}"]`) as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ pattern: expect.objectContaining({ style: 'holo', scroll: 0 }) });
  });
});

describe('SkinRegionSelecting', () => {
  it('shows the setting for the chosen tool', () => {
    const render = (by: 'piece' | 'color' | 'brush') => act(() => root.render(<SkinRegionSelecting part="Dress" mode="add" by={by} tolerance={8} brushSize={16}
      empty missed="Jacket" onMode={vi.fn()} onBy={vi.fn()} onTolerance={vi.fn()} onBrushSize={vi.fn()} onClear={vi.fn()} onDone={vi.fn()} />));
    render('piece');
    expect(host.querySelectorAll('input[type="range"]')).toHaveLength(0);
    render('color');
    expect(host.querySelector('input[aria-label="foundry.skin.region.colorRange"]')).not.toBeNull();
    render('brush');
    expect(host.querySelector('input[aria-label="foundry.skin.region.brushSize"]')).not.toBeNull();
    expect(host.textContent).toContain('foundry.skin.region.brushHint');
    expect(host.textContent).toContain('foundry.skin.region.otherPart');
  });
});
