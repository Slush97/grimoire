// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseSectionPicker } from './BrowseSectionPicker';
import type { BrowseSections } from '../../lib/browseSections';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('Browse section selection', () => {
  let host: HTMLDivElement;
  let root: Root;
  const changed = vi.fn();
  const sections = ['Mod', 'Sound', 'Wip'].map(modelName => ({
    modelName, pluralTitle: modelName, categoryModelName: `${modelName}Category`, itemCount: 1,
  }));
  function Harness({ canCombine = true }: { canCombine?: boolean }) {
    const [selected, setSelected] = useState<BrowseSections>(['Mod']);
    return <BrowseSectionPicker sections={sections} selected={selected} canCombine={canCombine}
      onChange={next => { changed(next); setSelected(next); }} />;
  }
  const tab = (name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="sync.sections.${name}"]`)!;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it('keeps combining, the last selected section and right-click exclusive selection', () => {
    act(() => root.render(<Harness />));
    act(() => tab('Sound').click());
    expect(changed).toHaveBeenLastCalledWith(['Mod', 'Sound']);
    act(() => tab('Mod').click());
    act(() => tab('Sound').click());
    expect(changed).toHaveBeenLastCalledWith(['Sound']);
    const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => tab('Wip').dispatchEvent(rightClick));
    expect(rightClick.defaultPrevented).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(['Wip']);
    expect(tab('Wip').getAttribute('aria-selected')).toBe('true');
  });

  it('moves keyboard focus independently of selection, including wrapping, Home and End', () => {
    act(() => root.render(<Harness />));
    act(() => {
      tab('Mod').focus();
      tab('Mod').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(tab('Wip'));
    act(() => tab('Wip').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement).toBe(tab('Mod'));
    act(() => tab('Mod').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement).toBe(tab('Wip'));
    expect(tab('Wip').tabIndex).toBe(0);
    expect(tab('Mod').getAttribute('aria-selected')).toBe('true');
    expect(changed).not.toHaveBeenCalled();
  });

  it('keeps single-section behavior before every catalog is synced', () => {
    act(() => root.render(<Harness canCombine={false} />));
    act(() => tab('Sound').click());
    expect(changed).toHaveBeenLastCalledWith(['Sound']);
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-multiselectable')).toBe('false');
    act(() => tab('Sound').click());
    expect(changed).toHaveBeenLastCalledWith(['Sound']);
  });
});
