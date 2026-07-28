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
            options={[
              { value: 'all', label: 'All heroes' },
              { value: 'abrams', label: 'Abrams', heroName: 'Abrams' },
            ]}
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

  it('keeps the parent popover open and applies a hero selected with the mouse', () => {
    act(() => root.render(<BrowseFilterHarness />));

    const trigger = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Filter by hero"]'
    );
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());

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
});
