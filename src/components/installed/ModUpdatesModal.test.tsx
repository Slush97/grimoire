// @vitest-environment jsdom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../../types/mod';
import ModUpdatesModal from './ModUpdatesModal';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../stores/toastStore', () => ({ showToast: mocks.toast }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, options?: { name?: string; count?: number }) => `${key}${options?.name ? ` ${options.name}` : ''}${options?.count === undefined ? '' : ` ${options.count}`}`,
}) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mod = (id: string, extra: Partial<Mod> = {}): Mod => ({
  id, name: 'Example mod', gameBananaId: 10, gameBananaFileId: Number(id),
  fileName: `${id}.vpk`, path: id, metaKey: id, enabled: false,
  priority: 0, size: 1, installedAt: '2026-01-01', ...extra,
});

describe('mod update menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  let props: ComponentProps<typeof ModUpdatesModal>;
  const render = async () => { await act(async () => root.render(<ModUpdatesModal {...props} />)); };
  const rows = () => [...document.querySelectorAll('li')];
  const footerButton = (action: 'updateAll' | 'updateEnabled' | 'updateDisabled') => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => button.textContent === `installed.updateAll.${action}`)!;
  const rowButton = (index: number, action: 'update' | 'ignore') => rows()[index].querySelector<HTMLButtonElement>(`[aria-label^="installed.updateAll.${action}Mod"]`)!;

  beforeEach(() => {
    vi.clearAllMocks();
    props = {
      mods: [mod('1', { variantLabel: 'Variant A' }), mod('2', { fileDescription: 'Variant B' }), mod('3')],
      updateIds: new Set(['1', '2']),
      onUpdate: vi.fn(), onIgnore: vi.fn().mockResolvedValue(undefined), onOpen: vi.fn(), onClose: vi.fn(),
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('groups pending variants by submission and section without merging identical names', async () => {
    props.mods.push(mod('4', { gameBananaId: 11 }), mod('5', { sourceSection: 'Sound' }));
    props.updateIds = new Set(['1', '2', '4', '5']);
    await render();
    expect(rows()).toHaveLength(3);
    expect(document.querySelector('h2')?.textContent).toBe('installed.updateAll.confirmTitle 4');
    expect(document.body.textContent).toContain('installed.updateAll.receivingUpdates 3');
    expect(rows()[0].textContent).toBe('Example mod(2)');
    expect(rows()[1].textContent).toBe('Example mod(1)');
    expect(rows()[2].textContent).toBe('Example mod(1)');
    expect(rows()[0].querySelector('[title]')?.getAttribute('title')).toBe('Variant A\nVariant B');
  });

  it('uses descriptions, archive filenames, and VPK filenames when labels are absent', async () => {
    props.mods = [
      mod('1', { variantLabel: '  ', fileDescription: ' Description ' }),
      mod('2', { sourceFileName: 'archive.zip' }), mod('3'),
    ];
    props.updateIds = new Set(['1', '2', '3']);
    await render();
    expect(rows()[0].querySelector('[title]')?.getAttribute('title')).toBe('Description\narchive.zip\n3.vpk');
  });

  it('keeps the menu open and allows another mod to start while the first submission is pending', async () => {
    props.mods.push(mod('4', { gameBananaId: 11 }));
    props.updateIds = new Set(['1', '2', '4']);
    let finish!: () => void;
    props.onUpdate = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }))
      .mockResolvedValue(undefined);
    await render();
    await act(async () => rowButton(0, 'update').click());
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(['1', '2']);
    expect(props.onClose).not.toHaveBeenCalled();
    props.updateIds = new Set(['4']);
    await render();
    expect(rows()).toHaveLength(1);
    expect(rowButton(0, 'update').disabled).toBe(false);
    await act(async () => rowButton(0, 'update').click());
    expect(props.onUpdate).toHaveBeenNthCalledWith(2, ['4']);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => finish());
  });

  it('leaves an unaccepted submission available for retry when its pending IDs remain', async () => {
    // The parent handles a start failure and keeps its update IDs eligible.
    props.onUpdate = vi.fn().mockResolvedValue(undefined);
    await render();
    await act(async () => rowButton(0, 'update').click());
    expect(rows()).toHaveLength(1);
    expect(props.onClose).not.toHaveBeenCalled();
    await act(async () => rowButton(0, 'update').click());
    expect(props.onUpdate).toHaveBeenCalledTimes(2);
  });

  function LiveMenu() {
    const [ids, setIds] = useState(props.updateIds);
    return <ModUpdatesModal {...props} updateIds={ids} onUpdate={selected => {
      setIds(previous => new Set([...previous].filter(id => !selected.includes(id))));
      return props.onUpdate(selected);
    }} />;
  }

  it('removes a clicked row synchronously so an immediate second click cannot resubmit it', async () => {
    props.mods.push(mod('4', { gameBananaId: 11 }));
    props.updateIds = new Set(['1', '2', '4']);
    await act(async () => root.render(<LiveMenu />));
    const clicked = rowButton(0, 'update');
    act(() => {
      clicked.click();
      expect(document.contains(clicked)).toBe(false);
      clicked.click();
    });
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(['1', '2']);
    expect(rows()).toHaveLength(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('removes the dialog immediately on Update all without rendering an empty list', async () => {
    await act(async () => root.render(<LiveMenu />));
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'installed.updateAll.updateAll')!;
    act(() => {
      confirm.click();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(['1', '2']);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('opens the installed location of a pending variant when its name or link is clicked', async () => {
    props.mods.unshift(mod('0'));
    await render();
    const link = rows()[0].querySelector<HTMLButtonElement>('[aria-label^="installed.card.viewDetailsFor"]')!;
    await act(async () => link.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onOpen).toHaveBeenCalledExactlyOnceWith('1');
    expect(props.onUpdate).not.toHaveBeenCalled();
    expect(props.onIgnore).not.toHaveBeenCalled();
  });

  it('ignores current siblings too and disables other actions while saving', async () => {
    props.mods.push(mod('4', { gameBananaId: 11 }), mod('5', { ignoreUpdates: true }));
    let finish!: () => void;
    props.onIgnore = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await render();
    await act(async () => rowButton(0, 'ignore').click());
    expect(props.onIgnore).toHaveBeenCalledExactlyOnceWith(['1', '2', '3']);
    expect(rowButton(0, 'update').disabled).toBe(true);
    expect(rowButton(0, 'ignore').disabled).toBe(true);
    await act(async () => finish());
    expect(rowButton(0, 'update').disabled).toBe(false);
  });

  it('keeps pending work accessible after an ignore failure and closes when none remains', async () => {
    props.onIgnore = vi.fn().mockRejectedValueOnce(new Error('save failed'));
    await render();
    await act(async () => rowButton(0, 'ignore').click());
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('installed.updateAll.ignoreFailed Example mod', { tone: 'error' });
    expect(rows()).toHaveLength(1);
    expect(rowButton(0, 'update').disabled).toBe(false);
    props.mods = props.mods.map(item => ({ ...item, ignoreUpdates: true }));
    await render();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('updates all remaining variants from the footer, excluding ignored files', async () => {
    props.mods.push(mod('4', { gameBananaId: 11 }), mod('5', { ignoreUpdates: true }));
    props.updateIds = new Set(['1', '2', '4', '5']);
    await render();
    const confirm = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'installed.updateAll.updateAll')!;
    await act(async () => confirm.click());
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(['1', '2', '4']);
    expect(props.onClose).not.toHaveBeenCalled();
    props.updateIds = new Set();
    await render();
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['updateDisabled', ['1']],
    ['updateEnabled', ['2', '4']],
  ] as const)('starts only the pending files matching %s and keeps the other state available', async (action, expected) => {
    props.mods[1].enabled = true;
    props.mods.push(mod('4', { enabled: true, gameBananaId: 11 }), mod('5', { enabled: true, ignoreUpdates: true }));
    props.updateIds = new Set(['1', '2', '4', '5']);
    await act(async () => root.render(<LiveMenu />));
    await act(async () => footerButton(action).click());
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith([...expected]);
    expect(props.onClose).not.toHaveBeenCalled();
    expect(footerButton(action).disabled).toBe(true);
    expect(footerButton(action === 'updateDisabled' ? 'updateEnabled' : 'updateDisabled').disabled).toBe(false);
  });

  it('offers disabled, enabled and all actions in that order and dismisses from the header', async () => {
    await render();
    const footer = footerButton('updateAll').parentElement!;
    expect([...footer.querySelectorAll('button')].map(button => button.textContent)).toEqual([
      'installed.updateAll.updateDisabled', 'installed.updateAll.updateEnabled', 'installed.updateAll.updateAll',
    ]);
    expect(footerButton('updateEnabled').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('common.actions.cancel');
    const close = document.querySelector<HTMLButtonElement>('[aria-label="common.actions.close"]')!;
    expect(footer.contains(close)).toBe(false);
    await act(async () => close.click());
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it('submits enabled files first on Update all, even across mixed variant groups', async () => {
    props.mods = [mod('1'), mod('2', { enabled: true }), mod('3', { gameBananaId: 11 }), mod('4', { gameBananaId: 11, enabled: true })];
    props.updateIds = new Set(['1', '2', '3', '4']);
    await render(); await act(async () => footerButton('updateAll').click());
    expect(props.onUpdate).toHaveBeenCalledExactlyOnceWith(['2', '4', '1', '3']);
  });
});
