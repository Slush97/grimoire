// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Card, Toggle } from '../common/ui';
import { ContentFilterContext, type ContentFilter } from '../common/contentFilter';
import { FilterDivider, FilterItem } from '../common/FilteredContent';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('Settings controls filtered in place', () => {
  let host: HTMLDivElement;
  let root: Root;
  const change = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    change.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(filter: ContentFilter | null) {
    act(() => root.render(
      <ContentFilterContext value={filter}>
        <Card id="preferences" title="Preferences">
          <Toggle id="backups" checked={false} onChange={change} label="Keep backups" />
          <FilterDivider />
          <FilterItem id="language"><select aria-label="Language"><option>English</option></select></FilterItem>
        </Card>
        <Card id="updates" title="Updates"><button>Check for updates</button></Card>
      </ContentFilterContext>,
    ));
  }

  it('keeps the original card and editable matching control, removing other settings and dividers', () => {
    render(null);
    const card = host.querySelector('#preferences');
    render({ matches: new Set(['backups']), visible: new Set(['backups', 'preferences']) });
    expect(host.querySelector('#preferences')).toBe(card);
    expect(host.querySelector('h3')?.textContent).toBe('Preferences');
    expect(host.querySelector('#language')).toBeNull();
    expect(host.querySelector('#updates')).toBeNull();
    expect(host.querySelector('.h-px')).toBeNull();
    expect(change).not.toHaveBeenCalled();
    const toggle = host.querySelector('input');
    expect(toggle).not.toBeNull();
    act(() => toggle?.click());
    expect(change).toHaveBeenCalledWith(true);
  });

  it('shows an entire matching group and restores every control when cleared', () => {
    render({ matches: new Set(['preferences']), visible: new Set(['preferences']) });
    expect(host.querySelector('#backups')).not.toBeNull();
    expect(host.querySelector('#language')).not.toBeNull();
    expect(host.querySelector('.h-px')).not.toBeNull();
    expect(host.querySelector('#updates')).toBeNull();
    render(null);
    expect(host.querySelector('#updates')).not.toBeNull();
    expect(host.querySelectorAll('h3')).toHaveLength(2);
  });
});
