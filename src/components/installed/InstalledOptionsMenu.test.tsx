// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledOptionsMenu, type InstalledOptionsMenuProps } from './InstalledOptionsMenu';
import { listInterchangeSources, showOpenDialog } from '../../lib/api';
import type { InterchangeSourceRequest } from '../../lib/modInterchange';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/api', () => ({ listInterchangeSources: vi.fn(), showOpenDialog: vi.fn() }));
vi.mock('../interchange/ImportWizardModal', () => ({ default: ({ source }: { source: InterchangeSourceRequest }) =>
  <div data-import-preview>{JSON.stringify(source)}</div> }));

describe('Installed options menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: InstalledOptionsMenuProps;
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
  const open = async () => { await act(async () => button('installed.options.title').click()); };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(listInterchangeSources).mockResolvedValue([{ id: 'deadlock-mod-manager', name: 'Deadlock Mod Manager', found: true,
      location: '/dmm', sections: ['mods'], searched: [] }]);
    vi.mocked(showOpenDialog).mockResolvedValue(null);
    props = {
      layout: 'grid', onLayoutChange: vi.fn(), cardSizeMultiplier: 1, cardSizeRange: { min: 0.8, max: 2, step: 0.1 },
      onCardSizeChange: vi.fn(), lockerOverrideCount: 2, onLockerOverrides: vi.fn(), showImprint: true, onImprint: vi.fn(),
      canFixOrder: true, onFixOrder: vi.fn(), canCopyEnabled: true, onCopyEnabled: vi.fn(), onImported: vi.fn(), onExport: vi.fn(),
    };
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const render = async () => { await act(async () => root.render(<InstalledOptionsMenu {...props} />)); };

  it('keeps view controls open and respects the caller’s card size range and list mode', async () => {
    await render(); await open();
    await act(async () => button('browse.viewOptions.list').click());
    expect(props.onLayoutChange).toHaveBeenCalledExactlyOnceWith('list');
    expect(button('installed.options.title').getAttribute('aria-expanded')).toBe('true');
    const slider = document.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect([slider.min, slider.max, slider.step]).toEqual(['0.8', '2', '0.1']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '1.4');
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(props.onCardSizeChange).toHaveBeenCalledWith(1.4);
    props = { ...props, layout: 'list' }; await render();
    expect(slider.disabled).toBe(true);
  });

  it('closes for library actions while preserving disabled and experimental gates', async () => {
    props = { ...props, showImprint: false, canFixOrder: false, canCopyEnabled: false };
    await render(); await open();
    expect(button('installed.actions.imprintInstalledMods')).toBeUndefined();
    expect(button('installed.actions.fixOrder').disabled).toBe(true);
    expect(button('installed.actions.copyEnabled').disabled).toBe(true);
    const overrides = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(item => item.textContent === 'installed.actions.lockerOverrides2')!;
    await act(async () => overrides.click());
    expect(props.onLockerOverrides).toHaveBeenCalledOnce();
    expect(button('installed.options.title').getAttribute('aria-expanded')).toBe('false');
    props = { ...props, showImprint: true, canFixOrder: true, canCopyEnabled: true }; await render(); await open();
    await act(async () => button('installed.actions.imprintInstalledMods').click());
    expect(props.onImprint).toHaveBeenCalledOnce();
    await open(); await act(async () => button('installed.actions.fixOrder').click());
    expect(props.onFixOrder).toHaveBeenCalledOnce();
    await open(); await act(async () => button('installed.actions.copyEnabled').click());
    expect(props.onCopyEnabled).toHaveBeenCalledOnce();
  });

  it('keeps transfer dialogs alive after dismissing options and supports folder overrides', async () => {
    await render(); await open();
    vi.mocked(showOpenDialog).mockResolvedValue('/other-dmm');
    await act(async () => button('interchange.chooseDmmFolder').click());
    expect(button('installed.options.title').getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-import-preview]')?.textContent).toContain('"location":"/other-dmm"');
    expect(document.querySelector('button button')).toBeNull();
  });

  it('dismisses options before launching export and on Escape', async () => {
    await render(); await open();
    await act(async () => button('interchange.exportMenu').click());
    expect(props.onExport).toHaveBeenCalledOnce();
    expect(button('installed.options.title').getAttribute('aria-expanded')).toBe('false');
    await open();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(button('installed.options.title').getAttribute('aria-expanded')).toBe('false');
  });
});
