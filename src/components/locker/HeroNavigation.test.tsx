// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeroNavigation } from './HeroNavigation';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const previous = { id: 1, name: 'Ivy' };
const next = { id: 3, name: 'Shiv' };

describe('Locker hero arrow controls', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onNavigate = vi.fn();

  const press = (target: EventTarget, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, ...options });
    act(() => { target.dispatchEvent(event); });
    return event;
  };
  const render = (enabled = true) => act(() => root.render(
    <div data-locker-hero-view>
      <HeroNavigation previous={previous} next={next} onNavigate={onNavigate} enabled={enabled} />
      <input />
      <input type="range" />
      <canvas tabIndex={0} />
      <div contentEditable />
      <button>Skins</button>
    </div>,
  ));

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    onNavigate.mockReset();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('navigates with both buttons and with arrows from the page or a section button', () => {
    const buttons = host.querySelectorAll('button');
    act(() => { buttons[0].click(); buttons[1].click(); });
    expect(onNavigate.mock.calls).toEqual([[previous], [next]]);
    onNavigate.mockClear();
    expect(press(document.body, { key: 'ArrowLeft' }).defaultPrevented).toBe(true);
    expect(press(buttons[2]).defaultPrevented).toBe(true);
    expect(onNavigate.mock.calls).toEqual([[previous], [next]]);
  });

  it('leaves text entry, sliders, editable content and the model canvas alone', () => {
    for (const target of host.querySelectorAll('input, canvas, [contenteditable]')) {
      expect(press(target).defaultPrevented).toBe(false);
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('leaves dialogs, menus and controls outside the hero view alone', () => {
    for (const role of ['dialog', 'menu', 'listbox']) {
      const overlay = document.createElement('div');
      overlay.setAttribute('role', role);
      document.body.append(overlay);
      press(document.body);
      overlay.remove();
    }
    const sidebar = document.createElement('button');
    document.body.append(sidebar);
    press(sidebar);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('ignores modified, repeated, composing and already handled keys', () => {
    for (const options of [
      { ctrlKey: true }, { altKey: true }, { metaKey: true }, { shiftKey: true },
      { repeat: true }, { isComposing: true }, { key: 'ArrowDown' },
    ]) press(document.body, options);
    const handled = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('disables shortcuts during exit and removes its listener on unmount', () => {
    render(false);
    press(document.body);
    expect(host.querySelectorAll('button:disabled')).toHaveLength(2);
    render();
    act(() => root.render(null));
    press(document.body);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
