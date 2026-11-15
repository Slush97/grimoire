// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledTagSelect, type InstalledTagOption } from './InstalledTagSelect';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, options?: { name?: string }) => options?.name ? `${key}:${options.name}` : key,
}) }));

describe('Installed tag dropdown', () => {
  let host: HTMLDivElement;
  let root: Root;
  const create = vi.fn(), rename = vi.fn(), remove = vi.fn(), resetOrder = vi.fn();
  const startingOptions: InstalledTagOption[] = [{ key: 'hud', label: 'HUD', count: 5 }, { key: 'custom:fav', label: 'Favorites', count: 2, custom: true }];
  function Harness({ options = startingOptions, cycleFilters = false }: { options?: InstalledTagOption[]; cycleFilters?: boolean }) {
    const [included, setIncluded] = useState<string[]>([]);
    const [excluded, setExcluded] = useState<string[]>([]);
    const [order, setOrder] = useState(options.map(option => option.key));
    return <InstalledTagSelect options={options} included={included} excluded={excluded} cycleFilters={cycleFilters}
      onInclude={key => { setIncluded(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]); setExcluded(previous => previous.filter(value => value !== key)); }}
      onExclude={key => { setExcluded(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]); setIncluded(previous => previous.filter(value => value !== key)); }}
      onCreate={create} onRename={rename} onDelete={remove} order={order} onOrderChange={setOrder} onResetOrder={resetOrder} />;
  }
  const trigger = () => host.querySelector<HTMLButtonElement>('button')!;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
  const option = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(item => item.textContent?.includes(name))!;
  const change = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  beforeEach(() => {
    vi.clearAllMocks(); create.mockReturnValue(true); rename.mockReturnValue(true);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 1; });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    act(() => root.render(<Harness />)); act(() => trigger().click());
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each([[false, false], [true, false], [true, true]])('clears an active tag (excluded=%s, right-click=%s)', (excluded, right) => {
    const click = (right: boolean) => act(() => {
      if (right) option('HUD').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      else option('HUD').click();
    });
    click(excluded);
    expect(option('HUD').getAttribute('aria-selected')).toBe('true');
    expect(option('HUD').querySelector(excluded ? '.lucide-minus' : '.lucide-plus')).not.toBeNull();
    expect(option('HUD').querySelector(excluded ? '.bg-state-danger' : '.bg-state-success')).not.toBeNull();
    expect(option('HUD').getAttribute('aria-label')).toBe('installed.tags.clearFilter:HUD');
    expect(trigger().className).toContain('border-accent/40');
    click(right);
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
    expect(option('HUD').querySelector('.lucide-plus,.lucide-minus')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('cycles left-clicks through included, excluded, and unselected when enabled', () => {
    act(() => root.render(<Harness cycleFilters />));
    act(() => option('Favorites').click());
    for (let cycle = 0; cycle < 2; cycle++) {
      act(() => option('HUD').click());
      expect(option('HUD').querySelector('.lucide-plus')).not.toBeNull();
      expect(option('HUD').getAttribute('aria-label')).toBe('installed.tags.excludeHint:HUD');
      act(() => option('HUD').click());
      expect(option('HUD').querySelector('.lucide-minus')).not.toBeNull();
      expect(option('HUD').getAttribute('aria-label')).toBe('installed.tags.clearFilter:HUD');
      act(() => option('HUD').click());
      expect(option('HUD').getAttribute('aria-selected')).toBe('false');
      expect(option('Favorites').querySelector('.lucide-plus')).not.toBeNull();
    }
  });

  it('clears either selection with right-click and leaves unselected tags alone in cycling mode', () => {
    act(() => root.render(<Harness cycleFilters />));
    const rightClick = () => act(() => option('HUD').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    rightClick();
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
    act(() => option('HUD').click());
    rightClick();
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
    act(() => option('HUD').click());
    act(() => option('HUD').click());
    expect(option('HUD').querySelector('.lucide-minus')).not.toBeNull();
    rightClick();
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
  });

  it('converts an included tag to excluded on right-click, but left-click clears an excluded tag', () => {
    act(() => { option('HUD').click(); option('Favorites').click(); });
    act(() => option('HUD').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect(option('HUD').getAttribute('aria-selected')).toBe('true');
    expect(option('HUD').querySelector('.lucide-minus')).not.toBeNull();
    expect(option('HUD').querySelector('.lucide-plus')).toBeNull();
    expect(option('Favorites').querySelector('.lucide-plus')).not.toBeNull();
    act(() => option('HUD').click());
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
    expect(option('HUD').querySelector('.lucide-plus,.lucide-minus')).toBeNull();
    expect(option('Favorites').querySelector('.lucide-plus')).not.toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
  });

  it('searches normally, then creates from the same input without hiding rows in edit mode', async () => {
    const search = document.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    await change(search, 'hud');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => button('installed.tags.edit').click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.create"]')!;
    expect(input.value).toBe('');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(input.parentElement?.querySelector('.lucide-plus')).not.toBeNull();
    expect(button('installed.tags.edit').getAttribute('aria-pressed')).toBe('true');
    expect(button('installed.tags.edit').className).toContain('text-accent!');
    await change(input, '  New tag  ');
    expect(document.body.textContent).toContain('Favorites');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(create).toHaveBeenCalledExactlyOnceWith('New tag');
    expect(input.value).toBe('');
  });

  const editRows = () => [...document.querySelectorAll('[role="group"]>div')].map(row => row.textContent);
  it('moves built-in and custom tags together using the priority arrows without selecting filters', async () => {
    await act(async () => button('installed.tags.edit').click());
    expect(editRows()).toEqual(['1.HUD', '2.Favorites']);
    expect(button('installed.tags.moveUp:HUD').disabled).toBe(true);
    expect(button('installed.tags.moveDown:Favorites').disabled).toBe(true);
    await act(async () => button('installed.tags.moveUp:Favorites').click());
    expect(editRows()).toEqual(['1.Favorites', '2.HUD']);
    expect(trigger().className).not.toContain('border-accent/40');
    await act(async () => button('installed.tags.moveDown:Favorites').click());
    expect(editRows()).toEqual(['1.HUD', '2.Favorites']);
    await act(async () => button('installed.tags.edit').click());
    expect(option('HUD').getAttribute('aria-selected')).toBe('false');
  });

  it('selects the priority number, accepts only digits, clamps positions, and cancels with Escape', async () => {
    await act(async () => button('installed.tags.edit').click());
    await act(async () => button('installed.tags.priorityInput:Favorites').click());
    let input = document.querySelector<HTMLInputElement>('input[aria-label="installed.tags.priorityInput:Favorites"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
    await change(input, '1x.-');
    expect(input.value).toBe('1');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(editRows()).toEqual(['1.Favorites', '2.HUD']);
    await act(async () => button('installed.tags.priorityInput:Favorites').click());
    input = document.querySelector<HTMLInputElement>('input[aria-label="installed.tags.priorityInput:Favorites"]')!;
    await change(input, '2');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(editRows()).toEqual(['1.Favorites', '2.HUD']);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    await act(async () => button('installed.tags.priorityInput:HUD').click());
    input = document.querySelector<HTMLInputElement>('input[aria-label="installed.tags.priorityInput:HUD"]')!;
    await change(input, '0');
    await act(async () => input.blur());
    expect(editRows()).toEqual(['1.HUD', '2.Favorites']);
  });

  it('requests an order reset only when right-clicking the active edit button', async () => {
    await act(async () => button('installed.tags.edit').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect(resetOrder).not.toHaveBeenCalled();
    await act(async () => button('installed.tags.edit').click());
    await act(async () => button('installed.tags.edit').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect(resetOrder).toHaveBeenCalledOnce();
  });

  it('saves an unfinished priority edit when the dropdown closes', async () => {
    await act(async () => button('installed.tags.edit').click());
    await act(async () => button('installed.tags.priorityInput:Favorites').click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="installed.tags.priorityInput:Favorites"]')!;
    await change(input, '1');
    await act(async () => trigger().click());
    await act(async () => trigger().click());
    expect(editRows()).toEqual(['1.Favorites', '2.HUD']);
  });

  it('applies a pending numeric edit before an arrow step and updates arrow bounds from that edit', async () => {
    act(() => root.render(<Harness options={[...startingOptions, { key: 'skins', label: 'Skins', count: 1 }]} />));
    await act(async () => button('installed.tags.edit').click());
    await act(async () => button('installed.tags.priorityInput:HUD').click());
    const input = document.querySelector<HTMLInputElement>('input[aria-label="installed.tags.priorityInput:HUD"]')!;
    await change(input, '2');
    const up = button('installed.tags.moveUp:HUD');
    const down = button('installed.tags.moveDown:HUD');
    expect(up.disabled).toBe(false);
    expect(down.disabled).toBe(false);
    await act(async () => {
      down.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      down.click();
    });
    expect(editRows()).toEqual(['1.Favorites', '2.Skins', '3.HUD']);
    expect(document.querySelector('input[aria-label="installed.tags.priorityInput:HUD"]')).toBeNull();
  });

  it('keeps built-in and custom tags in priority order and reuses the search input for rename', async () => {
    await act(async () => button('installed.tags.edit').click());
    expect(button('installed.tags.rename:HUD')).toBeUndefined();
    expect(document.querySelectorAll('[aria-label="common.actions.delete"]')).toHaveLength(1);
    expect([...document.querySelectorAll('[role="group"]>div')].map(row => row.textContent)).toEqual(['1.HUD', '2.Favorites']);
    const creator = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.create"]')!;
    expect(creator.parentElement!.parentElement).toBe(button('installed.tags.edit').parentElement);
    await act(async () => button('installed.tags.rename:Favorites').click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.renameLabel"]')!;
    expect(input).toBe(creator);
    expect(input.value).toBe('Favorites');
    expect(button('installed.tags.edit')).toBeUndefined();
    expect(document.querySelectorAll('input[type="text"]')).toHaveLength(1);
    await change(input, 'Updated favorites');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(rename).toHaveBeenCalledExactlyOnceWith('custom:fav', 'Updated favorites');
    expect(document.querySelector('[aria-label="installed.tags.renameLabel"]')).toBeNull();
    await act(async () => button('installed.tags.rename:Favorites').click());
    expect(button('common.actions.cancel').type).toBe('button');
    await act(async () => button('common.actions.cancel').click());
    expect(rename).toHaveBeenCalledTimes(1);
    expect(button('installed.tags.edit').getAttribute('aria-pressed')).toBe('true');
    expect(creator.value).toBe('');
    expect(button('common.actions.delete').className).toContain('border-state-danger/40!');
    await act(async () => button('common.actions.delete').click());
    expect(remove).toHaveBeenCalledExactlyOnceWith('custom:fav');
    expect(document.querySelector('button button')).toBeNull();
  });

  it('keeps a rejected rename available for correction and cancels it when the dropdown closes', async () => {
    await act(async () => button('installed.tags.edit').click());
    await act(async () => button('installed.tags.rename:Favorites').click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.renameLabel"]')!;
    rename.mockReturnValueOnce(false);
    await change(input, 'HUD');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(input.value).toBe('HUD');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('installed.tags.duplicateName');
    await act(async () => trigger().click());
    await act(async () => trigger().click());
    expect(document.querySelector('[aria-label="installed.tags.renameLabel"]')).toBeNull();
    expect(document.querySelector<HTMLInputElement>('[aria-label="installed.tags.create"]')!.value).toBe('');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the tag creator available for an empty library and explains rejected names', async () => {
    act(() => root.render(<Harness options={[]} />));
    create.mockReturnValue(false);
    await act(async () => button('installed.tags.edit').click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.create"]')!;
    await change(input, 'Duplicate');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(create).toHaveBeenCalledWith('Duplicate');
    expect(input.value).toBe('Duplicate');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('installed.tags.duplicateName');
  });
});
