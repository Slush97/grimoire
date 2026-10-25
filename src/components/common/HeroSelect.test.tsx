// @vitest-environment jsdom

import { act, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroSelect } from './HeroSelect';
import { DropdownSelect } from './forms';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function BrowseFilterHarness() {
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [hero, setHero] = useState('all');
  const filtersRef = useRef<HTMLDivElement>(null);

  // Mirrors Browse's outside-click behavior. HeroSelect's listbox is portaled
  // to document.body, so a mouse selection must not look outside this popover.
  useEffect(() => {
    if (!filtersOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target as Node)) {
        setFiltersOpen(false);
      }
    };
    // Mirrors AnchoredPopover's dismiss-on-Escape. One Escape has to back out
    // of the hero listbox without taking the popover hosting it down too.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFiltersOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [filtersOpen]);

  return (
    <div>
      <output data-testid="selected-hero">{hero}</output>
      {filtersOpen && (
        <div ref={filtersRef} data-testid="filter-popover">
          <HeroSelect
            ariaLabel="Filter by hero"
            value={hero}
            onChange={setHero}
            placeholder="All heroes"
            options={[
              { value: 'abrams', label: 'Abrams', heroName: 'Abrams' },
              { value: 'haze', label: 'Haze', heroName: 'Haze' },
              { value: 'shiv', label: 'Shiv', heroName: 'Shiv' },
            ]}
            search={{
              ariaLabel: 'Search heroes',
              placeholder: 'Filter...',
              getEmptyMessage: (query) => `No matches for “${query}”`,
              clearLabel: 'Clear',
            }}
          />
        </div>
      )}
    </div>
  );
}

describe('DropdownSelect and hero selectors', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  const openHeroSelect = () => {
    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter by hero"]'
    );
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());
    return trigger!;
  };

  const enterSearch = (query: string, label = 'Search heroes') => {
    const input = document.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`
    );
    expect(input).not.toBeNull();
    act(() => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      valueSetter?.call(input, query);
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return input!;
  };

  it('keeps the parent popover open and applies a hero selected with the mouse', () => {
    act(() => root.render(<BrowseFilterHarness />));

    openHeroSelect();

    const abrams = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="option"]')
    ).find((option) => option.textContent?.includes('Abrams'));
    expect(abrams).toBeDefined();

    act(() => {
      abrams!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      abrams!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      abrams!.click();
    });

    expect(document.querySelector('[data-testid="filter-popover"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="selected-hero"]')?.textContent).toBe('abrams');
  });

  it('closes only the listbox on Escape, leaving the parent popover open', () => {
    act(() => root.render(<BrowseFilterHarness />));

    openHeroSelect();
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    // Focus lands on the search box when the listbox opens, so that is where a
    // real Escape originates.
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.querySelector('[data-testid="filter-popover"]')).not.toBeNull();

    // A second Escape, now that the listbox is gone, belongs to the popover.
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(document.querySelector('[data-testid="filter-popover"]')).toBeNull();
  });

  it('closes only the listbox on Escape from an option, not the parent popover', () => {
    act(() => root.render(<BrowseFilterHarness />));

    openHeroSelect();
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Search heroes"]');
    act(() => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.getAttribute('role')).toBe('option');

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.querySelector('[data-testid="filter-popover"]')).not.toBeNull();
  });

  it('filters heroes as the user types and offers a useful empty state', () => {
    act(() => root.render(<BrowseFilterHarness />));

    openHeroSelect();
    const input = enterSearch('shi');
    expect(document.activeElement).toBe(input);
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)
    ).toEqual(['Shiv']);

    enterSearch('nobody');
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)
    ).toEqual([]);
    expect(document.body.textContent).toContain('No matches for “nobody”');

    const clearSearch = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Clear'
    );
    expect(clearSearch).toBeDefined();
    act(() => clearSearch!.click());

    expect(input.value).toBe('');
    expect(
      Array.from(document.querySelectorAll('[role="option"]')).map((option) => option.textContent)
    ).toEqual(['Abrams', 'Haze', 'Shiv']);
    expect(document.activeElement).toBe(input);
  });

  it('supports keyboard selection in filtered results and clears search on close', () => {
    act(() => root.render(<BrowseFilterHarness />));

    const trigger = openHeroSelect();
    const input = enterSearch('sh');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Shiv');
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'i', bubbles: true })
      );
    });
    expect(input.value).toBe('shi');
    expect(document.activeElement).toBe(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    expect(document.activeElement?.textContent).toBe('Shiv');
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });

    expect(document.querySelector('[data-testid="selected-hero"]')?.textContent).toBe('shiv');
    expect(document.querySelector('[role="listbox"]')).toBeNull();

    act(() => trigger.click());
    const reopenedInput = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search heroes"]'
    );
    expect(reopenedInput?.value).toBe('');
    expect(document.activeElement).toBe(reopenedInput);
  });

  it('filters category labels and selects a result without hero icons', () => {
    const change = vi.fn();
    act(() => root.render(<DropdownSelect
      ariaLabel="Category" value="all" onChange={change}
      options={[{ value: 'all', label: 'All categories' }, { value: 'skins', label: 'Skins' }, { value: 'hud', label: 'HUD' }]}
      search={{ ariaLabel: 'Search categories', placeholder: 'Filter...', getEmptyMessage: query => `No matches for ${query}`, clearLabel: 'Clear' }}
    />));
    act(() => host.querySelector('button')!.click());
    const input = enterSearch('HUD', 'Search categories');
    expect([...document.querySelectorAll('[role="option"]')].map(option => option.textContent)).toEqual(['HUD']);
    expect(document.querySelector('[role="listbox"] img')).toBeNull();
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(change).toHaveBeenCalledExactlyOnceWith('hud');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('keeps Added free of a search field and supports keyboard selection', () => {
    const change = vi.fn();
    act(() => root.render(<DropdownSelect
      ariaLabel="Added" value="all" onChange={change}
      options={[{ value: 'all', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: 'week', label: 'This week' }]}
    />));
    act(() => host.querySelector('button')!.click());
    expect(document.querySelector('[role="searchbox"]')).toBeNull();
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('This week');
    act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(change).toHaveBeenCalledExactlyOnceWith('week');
  });

  it('closes a disabled picker and leaves it closed when re-enabled', () => {
    const render = (disabled: boolean) => act(() => root.render(<DropdownSelect
      ariaLabel="Category" value="all" onChange={vi.fn()} disabled={disabled}
      options={[{ value: 'all', label: 'All categories' }]}
    />));
    render(true);
    act(() => host.querySelector('button')!.click());
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    render(false);
    act(() => host.querySelector('button')!.click());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    render(true);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    render(false);
    expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('skips unavailable sort options for mouse, arrow keys and typeahead', () => {
    const change = vi.fn();
    act(() => root.render(<DropdownSelect
      ariaLabel="Sort" variant="toolbar" value="default" onChange={change}
      options={[
        { value: 'name', label: 'A-Z', disabled: true },
        { value: 'default', label: 'Default' },
        { value: 'updated', label: 'Updated' },
        { value: 'views', label: 'Views', disabled: true },
      ]}
    />));
    act(() => host.querySelector('button')!.click());
    expect(document.activeElement?.textContent).toBe('Default');
    const press = (key: string) => act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    press('a');
    expect(document.activeElement?.textContent).toBe('Default');
    press('End');
    expect(document.activeElement?.textContent).toBe('Updated');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Default');
    press('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Updated');
    press('Home');
    expect(document.activeElement?.textContent).toBe('Default');
    act(() => document.querySelector<HTMLButtonElement>('[role="option"][disabled]')!.click());
    expect(change).not.toHaveBeenCalled();
    press('ArrowDown');
    press('Enter');
    expect(change).toHaveBeenCalledExactlyOnceWith('updated');
  });
});
