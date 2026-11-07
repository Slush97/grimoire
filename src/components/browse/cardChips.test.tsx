// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseReadableChipRow } from './cardChips';

let host: HTMLDivElement;
let root: Root;
const openCard = vi.fn();

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  openCard.mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(
    <div onClick={openCard} style={{ overflow: 'hidden' }}>
      <BrowseReadableChipRow
        chips={[{ label: 'Skins' }, { label: 'Faithful/Vanilla+' }, { label: 'Custom effects' }]}
        availableWidth={220}
        maxVisible={1}
        onImage
      />
    </div>,
  ));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('overflow category tags', () => {
  it('opens outside the clipped card on keyboard focus and closes with Escape', async () => {
    const trigger = host.querySelector('button')!;
    expect(trigger.title).toBe('Faithful/Vanilla+, Custom effects');
    await act(async () => trigger.focus());
    const panel = document.querySelector('[role="dialog"]')!;
    expect(panel.textContent).toContain('Faithful/Vanilla+');
    expect(panel.textContent).toContain('Custom effects');
    expect(host.contains(panel)).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps trigger and portaled tag clicks from opening the parent card', async () => {
    await act(async () => host.querySelector('button')!.click());
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    await act(async () => panel.querySelector<HTMLElement>('span')!.click());
    expect(openCard).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
