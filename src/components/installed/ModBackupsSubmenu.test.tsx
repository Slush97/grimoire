// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MenuContent, MenuRoot, MenuTrigger } from '../common/menu';
import { ModBackupDeletePrompt, ModBackupsSubmenu } from './ModBackupsSubmenu';
import { useModBackupsStore } from '../../stores/modBackupsStore';
import * as api from '../../lib/api';
import type { ModBackupSummary } from '../../types/modBackup';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  Trans: ({ i18nKey, values }: { i18nKey: string; values: { name?: string } }) => `${i18nKey} ${values.name ?? ''}`,
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => `${key}${options?.name ? ` ${options.name}` : ''}`,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const backup = {
  id: 'backup', fileName: 'old_variant_dir.vpk', description: 'Original variant',
  modName: 'Test mod', identityKey: 'gamebanana:Mod:1', createdAt: 1, expiresAt: 2,
} as ModBackupSummary;

describe('installed backup menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  const onRestore = vi.fn();
  const onDelete = vi.fn();
  const pointerDown = vi.fn();
  const mouseDown = vi.fn();

  function Fixture({ backups = [backup], busy = false }: { backups?: ModBackupSummary[]; busy?: boolean }) {
    const setDeleteTarget = useModBackupsStore((state) => state.setDeleteTarget);
    return (
      <>
        <div data-sortable-card onPointerDown={pointerDown} onMouseDown={mouseDown}>
          <MenuRoot kind="dropdown" defaultOpen>
            <MenuTrigger><span>Open</span></MenuTrigger>
            <MenuContent>
              <ModBackupsSubmenu backups={backups} busy={busy} onRestore={onRestore} onDelete={setDeleteTarget} />
            </MenuContent>
          </MenuRoot>
        </div>
        <ModBackupDeletePrompt />
      </>
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    useModBackupsStore.setState({ backups: [], deleteTarget: null });
    vi.spyOn(api, 'deleteModBackup').mockImplementation(async (backupId) => { onDelete(backupId); });
    vi.spyOn(api, 'listModBackups').mockResolvedValue([]);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  async function openSubmenu() {
    const trigger = document.querySelector<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')!;
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
  }

  it('only offers the submenu when backups exist', async () => {
    await act(async () => root.render(<Fixture backups={[]} />));
    expect(document.body.textContent).not.toContain('installed.backups.menuTrigger');
  });

  it('shows old filenames and uses descriptions as tooltips, falling back to filenames', async () => {
    const unnamed = { ...backup, id: 'unnamed', fileName: 'other_dir.vpk', description: undefined };
    await act(async () => root.render(<Fixture backups={[backup, unnamed]} />));
    await openSubmenu();
    expect(document.querySelector('[role="menuitem"][title="Original variant"]')?.textContent).toContain(backup.fileName);
    expect(document.querySelector('[role="menuitem"][title="other_dir.vpk"]')?.textContent).toContain(unnamed.fileName);
  });

  it('restores a selected backup and closes the menu', async () => {
    await act(async () => root.render(<Fixture />));
    await openSubmenu();
    await act(async () => document.querySelector<HTMLElement>('[role="menuitem"][title="Original variant"]')!.click());
    expect(onRestore).toHaveBeenCalledExactlyOnceWith(backup.id);
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('uses the source filename instead of a generic installed name for labels and confirmation', async () => {
    const sourceNamed = { ...backup, fileName: 'pak50_dir.vpk', displayFileName: 'original_skin_dir.vpk', description: undefined };
    await act(async () => root.render(<Fixture backups={[sourceNamed]} />));
    await openSubmenu();
    const item = document.querySelector<HTMLElement>('[role="menuitem"][title="original_skin_dir.vpk"]')!;
    expect(item.textContent).toContain(sourceNamed.displayFileName);
    const trash = item.querySelector<HTMLButtonElement>('button')!;
    expect(trash.getAttribute('aria-label')).toBe(`installed.backups.deleteNamed ${sourceNamed.displayFileName}`);
    await act(async () => trash.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(sourceNamed.displayFileName);
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain(sourceNamed.fileName);
  });

  it('closes the menu and requires confirmation before deleting, without restoring', async () => {
    await act(async () => root.render(<Fixture />));
    await openSubmenu();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="installed.backups.deleteNamed"]')!.click());
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(backup.fileName);
    expect(dialog?.textContent).toContain('installed.delete.title');
    expect(dialog?.textContent).toContain('installed.delete.confirmMessage');
    const confirm = [...dialog!.querySelectorAll('button')].find(button => button.textContent === 'common.actions.delete')!;
    await act(async () => confirm.click());
    expect(onDelete).toHaveBeenCalledExactlyOnceWith(backup.id);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('cancels deletion without changing a backup', async () => {
    await act(async () => root.render(<Fixture />));
    await openSubmenu();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="installed.backups.deleteNamed"]')!.click());
    const cancel = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === 'common.actions.cancel') as HTMLButtonElement;
    await act(async () => cancel.click());
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('keeps prompt text selection outside the card drag handlers and preserves Escape dismissal', async () => {
    await act(async () => root.render(<Fixture />));
    await openSubmenu();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="installed.backups.deleteNamed"]')!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const text = dialog.querySelector('.text-text-secondary')!;
    const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    const mouse = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => {
      text.dispatchEvent(pointer);
      text.dispatchEvent(mouse);
      dialog.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    expect(pointerDown).not.toHaveBeenCalled();
    expect(mouseDown).not.toHaveBeenCalled();
    expect(pointer.defaultPrevented).toBe(false);
    expect(mouse.defaultPrevented).toBe(false);
    expect(useModBackupsStore.getState().deleteTarget).toBe(backup);

    await act(async () => text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(useModBackupsStore.getState().deleteTarget).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('opens delete confirmation with Delete on a focused backup, without restoring', async () => {
    await act(async () => root.render(<Fixture />));
    await openSubmenu();
    const item = document.querySelector<HTMLElement>('[role="menuitem"][title="Original variant"]')!;
    await act(async () => {
      item.focus();
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(backup.fileName);
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('disables both actions during a mutation', async () => {
    await act(async () => root.render(<Fixture busy />));
    await openSubmenu();
    const item = document.querySelector<HTMLElement>('[role="menuitem"][title="Original variant"]')!;
    expect(item.hasAttribute('data-disabled')).toBe(true);
    expect(item.querySelector('button')!.disabled).toBe(true);
    await act(async () => item.click());
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
