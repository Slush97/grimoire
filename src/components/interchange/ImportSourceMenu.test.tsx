// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImportSourceMenu from './ImportSourceMenu';
import { listInterchangeSources, showOpenDialog } from '../../lib/api';
import type { InterchangeSourceInfo, InterchangeSourceRequest } from '../../lib/modInterchange';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/api', () => ({ listInterchangeSources: vi.fn(), showOpenDialog: vi.fn() }));
vi.mock('./ImportWizardModal', () => ({ default: ({ source, onClose, onImported }: {
  source: InterchangeSourceRequest; onClose: () => void; onImported: () => void;
}) => <div data-import-preview>{JSON.stringify(source)}<button onClick={onClose}>Close import</button>
  <button onClick={onImported}>Complete import</button></div> }));

const manager: InterchangeSourceInfo = {
  id: 'deadlock-mod-manager', name: 'Deadlock Mod Manager', found: true, location: '/auto', sections: ['mods'], searched: ['/auto'],
};

describe('mod manager import launcher', () => {
  let host: HTMLDivElement;
  let root: Root;
  const imported = vi.fn();
  const exported = vi.fn();
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find(item => item.getAttribute('aria-label') === label || item.textContent === label)!;
  const preview = () => document.querySelector('[data-import-preview]');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.mocked(listInterchangeSources).mockResolvedValue([manager]);
    vi.mocked(showOpenDialog).mockResolvedValue(null);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const open = async (withExport = false) => {
    await act(async () => root.render(<ImportSourceMenu onImported={imported} onExport={withExport ? exported : undefined} />));
    expect(listInterchangeSources).not.toHaveBeenCalled();
    await act(async () => button(withExport ? 'interchange.transferButton' : 'interchange.importButton').click());
  };

  it('uses automatic detection and keeps the wizard alive after closing the launcher', async () => {
    await open();
    expect(document.querySelector('button button')).toBeNull();
    await act(async () => button(manager.name).click());
    expect(button('interchange.importButton').getAttribute('aria-expanded')).toBe('false');
    expect(preview()?.textContent).toContain('"kind":"manager","id":"deadlock-mod-manager"');
    expect(preview()?.textContent).not.toContain('"location"');
    expect(showOpenDialog).not.toHaveBeenCalled();
    await act(async () => button('Complete import').click());
    expect(imported).toHaveBeenCalledOnce();
    await act(async () => button('Close import').click());
    expect(preview()).toBeNull();
  });

  it('uses the folder icon as a separate override without starting the automatic import', async () => {
    vi.mocked(showOpenDialog).mockResolvedValue('/chosen-dmm');
    await open();
    await act(async () => button('interchange.chooseDmmFolder').click());
    expect(showOpenDialog).toHaveBeenCalledExactlyOnceWith({ directory: true, title: 'interchange.pickManagerFolder' });
    expect(preview()?.textContent).toContain('"location":"/chosen-dmm"');
  });

  it('also opens the picker from the main row when the manager is not detected', async () => {
    vi.mocked(listInterchangeSources).mockResolvedValue([{ ...manager, found: false }]);
    vi.mocked(showOpenDialog).mockResolvedValue('/manual');
    await open();
    expect(button('interchange.chooseDmmFolder')).toBeUndefined();
    await act(async () => button(manager.name).click());
    expect(showOpenDialog).toHaveBeenCalledOnce();
    expect(preview()?.textContent).toContain('"location":"/manual"');
  });

  it('does not open an import when the folder picker is canceled', async () => {
    await open();
    await act(async () => button('interchange.chooseDmmFolder').click());
    expect(preview()).toBeNull();
    expect(imported).not.toHaveBeenCalled();
  });

  it('uses DMM when the full manager name cannot fit and restores it when space returns', async () => {
    let notifyResize = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    });
    await open();
    const managerButton = button(manager.name);
    const probe = managerButton.querySelector<HTMLSpanElement>('span[aria-hidden]')!;
    const label = probe.parentElement!;
    let available = 90;
    vi.spyOn(label, 'getBoundingClientRect').mockImplementation(() => ({ width: available } as DOMRect));
    vi.spyOn(probe, 'getBoundingClientRect').mockReturnValue({ width: 150 } as DOMRect);
    await act(async () => notifyResize());
    expect(label.lastChild?.textContent).toBe('interchange.dmmShortName');
    expect(managerButton.title).toBe(manager.name);
    expect(managerButton.getAttribute('aria-label')).toBe(manager.name);
    available = 180;
    await act(async () => notifyResize());
    expect(label.lastChild?.textContent).toBe(manager.name);
  });

  it('keeps file import and export independent and reuses the detected sources', async () => {
    await open(true);
    expect(button('interchange.openBundle').title).toBe('interchange.pickBundle');
    await act(async () => button('interchange.exportMenu').click());
    expect(exported).toHaveBeenCalledOnce();
    expect(preview()).toBeNull();
    expect(button('interchange.transferButton').getAttribute('aria-expanded')).toBe('false');
    await act(async () => button('interchange.transferButton').click());
    expect(listInterchangeSources).toHaveBeenCalledOnce();
    vi.mocked(showOpenDialog).mockResolvedValue('/export/mod-interchange.json');
    await act(async () => button('interchange.openBundle').click());
    expect(showOpenDialog).toHaveBeenCalledExactlyOnceWith({ title: 'interchange.pickBundle', filters: [{ name: 'mod-interchange.json', extensions: ['json'] }] });
    expect(preview()?.textContent).toContain('"kind":"bundle","path":"/export/mod-interchange.json"');
  });
});
