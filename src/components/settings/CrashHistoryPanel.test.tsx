// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CrashHistoryPanel from './CrashHistoryPanel';
import SupportSection from './sections/SupportSection';
import type { CrashReportDetail, CrashReportSummary, CrashHistoryPage } from '../../types/crashHistory';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const report: CrashReportSummary = { id: 'a'.repeat(64), crashedAt: 1700000000000, kind: 'access-violation', copies: 1 };
const detail: CrashReportDetail = { ...report, diagnostics: 'Readable game diagnostic', files: [{ name: 'deadlock_test.mdmp', size: 100, source: 'game' }] };
let host: HTMLDivElement, root: Root;
let api: {
  listCrashes: ReturnType<typeof vi.fn<() => Promise<CrashHistoryPage>>>;
  crashDetail: ReturnType<typeof vi.fn<() => Promise<CrashReportDetail>>>;
  revealCrash: ReturnType<typeof vi.fn<() => Promise<void>>>;
  saveCrashDump: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  buildReport: ReturnType<typeof vi.fn<() => Promise<string>>>;
};
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api = { listCrashes: vi.fn(async () => ({ reports: [report], total: 1 })), crashDetail: vi.fn(async () => detail),
    revealCrash: vi.fn(async () => {}), saveCrashDump: vi.fn(async () => false), buildReport: vi.fn(async () => 'Generated report') };
  window.electronAPI = { diagnostics: api } as unknown as Window['electronAPI'];
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find(item => item.textContent === label);
const render = async (selectedIds: string[] = [], onToggle = vi.fn()) => { await act(async () => root.render(<CrashHistoryPanel selectedIds={selectedIds} onToggle={onToggle} />)); };

describe('crash history in Support', () => {
  it('lists unknown causes without automatically opening a dialog or exporting anything', async () => {
    await render();
    expect(host.textContent).toContain('crashHistory.accessViolation');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(api.crashDetail).not.toHaveBeenCalled(); expect(api.saveCrashDump).not.toHaveBeenCalled();
  });

  it('opens details, reveals files and saves dumps only after explicit clicks', async () => {
    await render();
    await act(async () => [...host.querySelectorAll('button')].find(item => item.textContent?.includes('crashHistory.accessViolation'))!.click());
    expect(api.crashDetail).toHaveBeenCalledWith(report.id);
    expect(document.body.textContent).toContain('Readable game diagnostic');
    await act(async () => button('crashHistory.showFile')!.click());
    expect(api.revealCrash).toHaveBeenCalledWith(report.id);
    await act(async () => button('crashHistory.saveDump')!.click());
    expect(document.body.textContent).not.toContain('crashHistory.saved');
    api.saveCrashDump.mockResolvedValue(true);
    await act(async () => button('crashHistory.saveDump')!.click());
    expect(document.body.textContent).toContain('crashHistory.saved');
  });

  it('passes selected crash ids into the existing bug report flow', async () => {
    await act(async () => root.render(<SupportSection />));
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="crashHistory.include"]')!.click());
    await act(async () => button('settings.support.generateReport')!.click());
    expect(api.buildReport).toHaveBeenCalledWith('', { includeFullLog: false, crashReportIds: [report.id] });
    expect(host.querySelector('textarea[readonly]')?.textContent).toBe('Generated report');
    await act(async () => host.querySelector<HTMLInputElement>('[aria-label="crashHistory.include"]')!.click());
    expect(host.querySelector('textarea[readonly]')).toBeNull();
  });

  it('preserves selections across pagination and caps new selections', async () => {
    api.listCrashes.mockResolvedValueOnce({ reports: [report], total: 2 })
      .mockResolvedValueOnce({ reports: [{ ...report, id: 'b'.repeat(64) }], total: 2 });
    const selected = [report.id, ...Array.from({ length: 9 }, (_, index) => String(index))];
    await render(selected);
    await act(async () => button('crashHistory.more')!.click());
    expect(api.listCrashes).toHaveBeenLastCalledWith(1);
    const boxes = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes[0].checked).toBe(true); expect(boxes[0].disabled).toBe(false);
    expect(boxes[1].disabled).toBe(true);
  });

  it('does not replace a fresh focus refresh with an older response', async () => {
    let finish: (page: CrashHistoryPage) => void = () => {};
    api.listCrashes.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ reports: [{ ...report, error: 'New crash' }], total: 1 });
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    await act(async () => finish({ reports: [{ ...report, error: 'Old crash' }], total: 1 }));
    expect(host.textContent).toContain('New crash'); expect(host.textContent).not.toContain('Old crash');
  });

  it('shows report-reading failures without opening a dialog or disabling report generation', async () => {
    api.listCrashes.mockRejectedValue(new Error('Folder unavailable'));
    await act(async () => root.render(<SupportSection />));
    expect(host.textContent).toContain('crashHistory.failed');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => button('settings.support.generateReport')!.click());
    expect(api.buildReport).toHaveBeenCalledOnce();
  });
});
