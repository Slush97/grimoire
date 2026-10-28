// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Modal } from './Modal';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('leaves Escape to a child that consumes it, then closes on an unhandled Escape', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const onClose = vi.fn();
  try {
    await act(async () => root.render(
      <Modal onClose={onClose}>
        <button onKeyDown={(event) => {
          if (event.key === 'Escape') event.preventDefault();
        }}>Drag handle</button>
      </Modal>,
    ));
    const handle = document.querySelector('button');
    if (!handle) throw new Error('Missing drag handle');
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
