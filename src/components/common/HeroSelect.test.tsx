// @vitest-environment jsdom

import { act, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroSelect } from './HeroSelect';

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
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
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

describe('HeroSelect inside a dismissable popover', () => {
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

  const enterSearch = (query: string) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Search heroes"]'
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
});
