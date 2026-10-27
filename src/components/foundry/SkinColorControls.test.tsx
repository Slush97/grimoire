// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SkinColorControls } from './SkinColorControls';
import type { SkinPartEdit } from '../../types/skinEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const edit = (patch: Partial<SkinPartEdit>): SkinPartEdit => ({ material: 'body.vmat', hidden: false, tint: null, pattern: null, ...patch });
let root: Root, host: HTMLDivElement;
const onChange = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  onChange.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const render = (value: SkinPartEdit, adjustable = true) => act(() => root.render(
  <SkinColorControls color={value.tint ?? '#ffffff'} edit={value} tintable adjustable={adjustable} disabled={false} onChange={onChange} />));
const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find((element) => element.textContent === name) as HTMLButtonElement;
const nudge = () => host.querySelector('[role="status"]');
const blendRow = () => [...host.querySelectorAll('label')].find((element) => element.textContent?.includes('foundry.skin.blendOriginal'))!.parentElement!;
const blend = () => blendRow().querySelector('input')!;

describe('SkinColorControls', () => {
  it('switches between tint and paint with one control, showing blending only for tint', () => {
    render(edit({ tint: '#ef4444' }));
    expect(tab('foundry.skin.tint').getAttribute('aria-selected')).toBe('true');
    expect(tab('foundry.skin.tint').title).toBe('foundry.skin.tintHint');
    expect(tab('foundry.skin.repaint').title).toBe('foundry.skin.repaintHint');
    expect(blendRow().className).not.toContain('invisible');
    expect(blend().checked).toBe(false);
    act(() => blend().click());
    expect(onChange).toHaveBeenLastCalledWith({ colorize: false, tint: '#ef4444' });
    act(() => tab('foundry.skin.repaint').click());
    expect(onChange).toHaveBeenCalledWith({ repaint: true, tint: '#ef4444' });

    render(edit({ tint: '#ef4444', repaint: true }));
    expect(tab('foundry.skin.repaint').getAttribute('aria-selected')).toBe('true');
    expect(blendRow().className).toContain('invisible');
  });

  it('starts new edits in Paint and keeps older tint edits as Tint', () => {
    render(edit({ tint: null }));
    expect(tab('foundry.skin.repaint').getAttribute('aria-selected')).toBe('true');
    act(() => (host.querySelector('[aria-label="#ef4444"]') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ tint: '#ef4444', repaint: true });

    render(edit({ tint: '#ef4444' }));
    expect(tab('foundry.skin.tint').getAttribute('aria-selected')).toBe('true');
    act(() => (host.querySelector('[aria-label="#3b82f6"]') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ tint: '#3b82f6', repaint: false });

    render(edit({ tint: '#ef4444', repaint: true }));
    act(() => (host.querySelector('[aria-label="#3b82f6"]') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenLastCalledWith({ tint: '#3b82f6' });
  });

  it('points tint users who pick white at Paint', () => {
    render(edit({ tint: null }));
    expect(nudge()).toBeNull();
    render(edit({ tint: '#ef4444' }));
    expect(nudge()).toBeNull();
    render(edit({ tint: '#eeeeee' }));
    expect(nudge()?.textContent).toContain('foundry.skin.tintNoWhite');
    act(() => (nudge()!.querySelector('button') as HTMLButtonElement).click());
    expect(onChange).toHaveBeenCalledWith({ repaint: true, tint: '#eeeeee' });

    render(edit({ tint: '#ffffff', repaint: true }));
    expect(nudge()).toBeNull();
  });

  it('keeps tint-only parts without the mode switch or a Paint link', () => {
    render(edit({ tint: '#ffffff' }), false);
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(nudge()?.querySelector('button')).toBeNull();
  });
});
