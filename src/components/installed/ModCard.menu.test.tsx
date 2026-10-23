// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModCard } from './ModCard';
import { HERO_NAMES_SORTED } from '../../lib/lockerUtils';

const translate = vi.hoisted(() => vi.fn((key: string) => key));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: translate, i18n: { language: 'en' } }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('installed card menu mounting', () => {
  let host: HTMLDivElement;
  let root: Root;
  let input: ComponentProps<typeof ModCard>;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    input = {
      mod: {
        id: 'test', name: 'Test mod', fileName: 'pak01_dir.vpk', enabled: true,
        priority: 1, size: 100, installedAt: '2026-10-10T10:00:00Z',
      },
      viewMode: 'list', hideNsfwPreviews: true, soundVolume: 0, conflicts: [], entryKey: 'test',
      onToggle: vi.fn(), onDelete: vi.fn(), onTagLocker: vi.fn(), onTagGlobal: vi.fn(),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function openMenu(kind: 'context' | 'dropdown') {
    if (kind === 'context') {
      await act(async () => host.querySelector('[data-mod-entry-key="test"]')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 }),
      ));
    } else {
      const trigger = host.querySelector<HTMLButtonElement>('[aria-label="installed.card.moreActionsFor"]')!;
      await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    }
  }

  async function openLockerTags() {
    const trigger = [...document.querySelectorAll<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')]
      .find((item) => item.textContent?.includes('installed.tag.setLockerTag'))!;
    expect(trigger).toBeDefined();
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
  }

  it.each(['context', 'dropdown'] as const)('constructs %s actions and hero choices only when their menu opens', async (kind) => {
    // Spying on roster iteration detects JSX allocation even if React never
    // mounts the resulting nodes under a closed Radix portal.
    const rosterIteration = vi.spyOn(HERO_NAMES_SORTED, 'map');
    await act(async () => root.render(<ModCard {...input} />));
    expect(rosterIteration).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalledWith('installed.tag.setLockerTag');

    // Closed menus must pick up current callbacks and tag state when opened.
    input = { ...input, mod: { ...input.mod, lockerHero: HERO_NAMES_SORTED[0] }, onTagLocker: vi.fn() };
    await act(async () => root.render(<ModCard {...input} />));
    expect(rosterIteration).not.toHaveBeenCalled();

    await openMenu(kind);
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(translate).toHaveBeenCalledWith('installed.tag.setLockerTag');
    expect(rosterIteration).not.toHaveBeenCalled();

    await openLockerTags();
    expect(rosterIteration).toHaveBeenCalled();
    const heroChoices = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
      .filter((item) => item.querySelector('img'));
    expect(heroChoices).toHaveLength(HERO_NAMES_SORTED.length);
    expect(heroChoices[0].getAttribute('aria-checked')).toBe('true');
    await act(async () => heroChoices[1].click());
    expect(input.onTagLocker).toHaveBeenCalledExactlyOnceWith(HERO_NAMES_SORTED[1]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
