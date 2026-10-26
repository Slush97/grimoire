// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkinPatternPicker } from './SkinPatternPicker';
import type { SkinPartPattern } from '../../types/skinEditor';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/api', () => ({ previewTrippySprite: vi.fn(async () => ({ dataUrl: '', frames: 1, size: 64 })) }));

afterEach(() => { vi.unstubAllGlobals(); });

describe.each([{ label: 'Galaxy', style: 'galaxy' }, { label: 'Moo', style: 'moo' }])('$label pattern defaults', ({ label, style }) => {
  it.each([null, { style: 'gradient', intensity: 0.6, phase: 0.2, scroll: 0, colors: ['#ff0000', '#0000ff'] } satisfies SkinPartPattern])(
    'uses style colors and 50%% speed for a new pattern, preserving existing choices', async (value) => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
      const host = document.createElement('div');
      const root = createRoot(host);
      const change = vi.fn();
      try {
        await act(async () => { root.render(<SkinPatternPicker value={value} color="#123456" disabled={false} onChange={change} />); });
        await act(async () => { host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click(); });
        expect(change).toHaveBeenCalledWith({ style, intensity: value?.intensity ?? 1,
          phase: value?.phase ?? 0, scroll: value?.scroll ?? 0.5, colors: value?.colors, scale: style === 'moo' ? 1 : undefined });
      } finally { act(() => root.unmount()); }
    },
  );
});

describe('Moo density', () => {
  it('restores density on reselection and clears it when choosing another pattern', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const host = document.createElement('div');
    const root = createRoot(host);
    const change = vi.fn();
    const value: SkinPartPattern = { style: 'moo', intensity: 1, phase: 0, scroll: .5, scale: 2.25 };
    try {
      await act(async () => { root.render(<SkinPatternPicker value={value} color="#123456" disabled={false} onChange={change} />); });
      expect(host.querySelector<HTMLInputElement>('input[aria-label="foundry.skin.scale"]')?.value).toBe('225');
      await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Moo"]')!.click(); });
      expect(change).toHaveBeenLastCalledWith({ ...value, colors: undefined });
      await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Galaxy"]')!.click(); });
      expect(change).toHaveBeenLastCalledWith({ ...value, style: 'galaxy', scale: undefined, colors: undefined });
      await act(async () => { root.render(<SkinPatternPicker value={{ ...value, style: 'galaxy' }} color="#123456" disabled={false} onChange={change} />); });
      expect(host.querySelector('input[aria-label="foundry.skin.scale"]')).toBeNull();
    } finally { act(() => root.unmount()); }
  });
});
