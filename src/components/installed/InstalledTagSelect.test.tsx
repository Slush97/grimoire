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
  const create = vi.fn(), rename = vi.fn(), remove = vi.fn();
  const startingOptions: InstalledTagOption[] = [{ key: 'hud', label: 'HUD', count: 5 }, { key: 'custom:fav', label: 'Favorites', count: 2, custom: true }];
  function Harness({ options = startingOptions }: { options?: InstalledTagOption[] }) {
    const [included, setIncluded] = useState<string[]>([]);
    const [excluded, setExcluded] = useState<string[]>([]);
    return <InstalledTagSelect options={options} included={included} excluded={excluded}
      onInclude={key => { setIncluded(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]); setExcluded(previous => previous.filter(value => value !== key)); }}
      onExclude={key => { setExcluded(previous => previous.includes(key) ? previous.filter(value => value !== key) : [...previous, key]); setIncluded(previous => previous.filter(value => value !== key)); }}
      onCreate={create} onRename={rename} onDelete={remove} />;
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

  it.each([false, true])('clears an active tag with either click (excluded=%s)', excluded => {
    const click = (right: boolean) => act(() => {
      if (right) option('HUD').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      else option('HUD').click();
    });
    for (const right of [false, true]) {
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
    }
  });

  it('searches normally, then creates from the same input without hiding rows in edit mode', async () => {
    const search = document.querySelector<HTMLInputElement>('[role="searchbox"]')!;
    await change(search, 'hud');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    await act(async () => button('installed.tags.edit').click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="installed.tags.create"]')!;
    expect(input.value).toBe('');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(document.querySelectorAll('.lucide-plus')).toHaveLength(0);
    expect(button('installed.tags.edit').getAttribute('aria-pressed')).toBe('true');
    expect(button('installed.tags.edit').className).toContain('text-accent!');
    await change(input, '  New tag  ');
    expect(document.body.textContent).toContain('Favorites');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(create).toHaveBeenCalledExactlyOnceWith('New tag');
    expect(input.value).toBe('');
  });

  it('edits custom tags first, reuses the search input for rename, and cancels back to creation', async () => {
    await act(async () => button('installed.tags.edit').click());
    expect(button('installed.tags.rename:HUD')).toBeUndefined();
    expect(document.querySelectorAll('[aria-label="common.actions.delete"]')).toHaveLength(1);
    expect([...document.querySelectorAll('[role="group"]>div')].map(row => row.textContent)).toEqual(['Favorites', 'HUD']);
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
