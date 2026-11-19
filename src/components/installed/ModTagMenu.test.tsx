// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MenuRoot, MenuContent } from '../common/menu';
import { ModTagMenuItems } from './ModTagMenu';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import type { Mod } from '../../types/mod';

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('fills mixed hero tags before removing them, preserves other heroes and keeps the menu open', async () => {
  const before = useAppStore.getState();
  const previousToasts = useToastStore.getState().toasts;
  const apply = vi.fn(async () => {});
  const busy = vi.fn();
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const mods: Mod[] = ['Haze', 'Ivy'].map((hero, index) => ({ id: String(index), metaKey: String(index), name: hero,
    fileName: hero, path: '/test/' + hero, enabled: true, priority: index, size: 100, installedAt: '2026-11-19',
    sourceSection: 'Mod', lockerHeroes: [hero], categoryName: 'Skins' }));
  const write = vi.fn(async (id: string, tags: Mod['tagOverrides'] | null) => {
    useAppStore.setState(state => ({ mods: state.mods.map(mod => mod.id === id ? { ...mod, tagOverrides: { ...mod.tagOverrides, ...tags } } : mod) }));
  });
  useAppStore.setState({ mods, setModTags: write });
  function Harness() {
    const selected = useAppStore(state => state.mods);
    return <MenuRoot kind="dropdown" open><MenuContent><ModTagMenuItems bulk mod={selected[0]} variants={selected} onApply={apply} onBusyChange={busy} /></MenuContent></MenuRoot>;
  }
  const choice = () => [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')].find(item => item.textContent === 'Haze')!;
  try {
    await act(async () => root.render(<Harness />));
    expect(choice().getAttribute('aria-checked')).toBe('mixed');
    expect(choice().querySelector('.lucide-minus')).not.toBeNull();
    expect(document.querySelector('.lucide-pin')).toBeNull();
    await act(async () => choice().click());
    expect(choice().getAttribute('aria-checked')).toBe('true');
    expect(write).toHaveBeenNthCalledWith(2, '1', { heroes: ['Ivy', 'Haze'] });
    await act(async () => choice().click());
    expect(choice().getAttribute('aria-checked')).toBe('false');
    expect(write).toHaveBeenLastCalledWith('1', { heroes: ['Ivy'] });
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    write.mockRejectedValueOnce(new Error('tag-write-failed'));
    await act(async () => choice().click());
    expect(choice().getAttribute('aria-checked')).toBe('false');
    expect(choice().getAttribute('aria-disabled')).not.toBe('true');
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ tone: 'error', message: expect.stringContaining('tag-write-failed') });
    for (const action of ['clear', 'reset']) {
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(node => node.textContent === `common.actions.${action}`)!;
      await act(async () => item.click());
      expect(document.querySelector('[role="menu"]')).not.toBeNull();
    }
    expect(apply).toHaveBeenNthCalledWith(1, { base: [], heroes: [] }, true);
    expect(apply).toHaveBeenNthCalledWith(2, null, false);
  } finally {
    act(() => root.unmount()); host.remove(); useAppStore.setState(before); useToastStore.setState({ toasts: previousToasts }); vi.restoreAllMocks();
  }
});
