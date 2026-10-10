import { useEffect, useState } from 'react';

export function useShiftKey() {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]');
      setHeld(!typing && event.shiftKey);
    };
    // Covers returning to the window with Shift already held.
    const pointer = (event: PointerEvent) => setHeld(event.shiftKey);
    const reset = () => setHeld(false);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('keyup', keyboard);
    window.addEventListener('pointermove', pointer);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('keyup', keyboard);
      window.removeEventListener('pointermove', pointer);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return held;
}
