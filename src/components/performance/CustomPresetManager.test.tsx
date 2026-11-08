// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomPresetManager from './CustomPresetManager';
import type { PerformanceRepositoryInspection } from '../../types/performanceCustom';
import type { PerformancePresetSummary } from '../../types/electron';

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('custom preset flow', () => {
  let root: Root;
  let host: HTMLDivElement;
  let inspection: PerformanceRepositoryInspection;
  let preset: PerformancePresetSummary;
  const inspect = vi.fn();
  const importPreset = vi.fn();
  const deletePreset = vi.fn();
  const saveToggles = vi.fn();
  const changed = vi.fn();

  beforeEach(async () => {
    inspection = {
      repository: 'owner/configs', commit: 'a'.repeat(40), date: '2026-11-07',
      configPaths: ['Balanced/gameinfo.gi', 'Ultra/gameinfo.gi'],
      videoPaths: ['Balanced/cfg/video.txt', 'Ultra/video(No Shadows).txt', 'Ultra/video(Shadows).txt'],
      addons: [], unsupportedPaths: [],
    };
    preset = {
      id: 'custom-new', name: 'My preset', tier: 'balanced', author: 'owner', version: 'snapshot', settingCount: 1,
      unstable: false, isDefault: false, upstream: { repo: 'owner/configs', url: 'https://github.com/owner/configs', commit: inspection.commit },
      versions: [], optIn: [], custom: { configPath: 'Balanced/gameinfo.gi', videoPath: 'Balanced/cfg/video.txt', toggles: [],
        availableConvars: [{key:'first',value:'1'},{key:'second',value:'2'}], addons: [], withheldCount: 0 },
    } as unknown as PerformancePresetSummary;
    inspect.mockReset().mockImplementation(async () => inspection);
    importPreset.mockReset().mockImplementation(async (input) => ({...preset, name: input.name}));
    deletePreset.mockReset().mockResolvedValue(undefined);
    saveToggles.mockReset().mockResolvedValue(undefined);
    changed.mockReset().mockResolvedValue(undefined);
    window.electronAPI = { inspectPerformanceRepository: inspect, importPerformancePreset: importPreset,
      deletePerformancePreset: deletePreset, savePerformancePresetToggles: saveToggles } as unknown as Window['electronAPI'];
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    await render();
  });

  afterEach(() => { act(() => root.unmount()); host.remove(); });
  async function render(presets: PerformancePresetSummary[] = [], activeId: string | null = null) {
    await act(async () => root.render(<CustomPresetManager presets={presets} activeId={activeId} onChanged={changed} onClose={() => {}} />));
  }
  function button(key: string) {
    return [...document.querySelectorAll('button')].find((node) => node.textContent === key)!;
  }
  function field(key: string) {
    const label = [...document.querySelectorAll('label')].find((node) => node.textContent === key)!;
    return document.getElementById(label.htmlFor) as HTMLInputElement;
  }
  async function change(key: string, value: string) {
    await act(async () => {
      const element = field(key);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  async function click(key: string) { await act(async () => button(key).click()); }
  async function choose(path: string) {
    const radio = [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((input) => input.value === path)!;
    await act(async () => radio.click());
  }
  async function discover() {
    await change('performance.custom.repository', 'owner/configs');
    await act(async () => document.querySelector('form')!.requestSubmit());
  }
  async function openSaved() {
    await render([preset]);
    await click('common.actions.cancel');
    await act(async () => [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('My preset'))!.click());
  }

  it('submits the repository form, pairs nearby video, and imports the inspected commit', async () => {
    await discover();
    expect(inspect).toHaveBeenCalledWith('owner/configs');
    expect(button('performance.custom.import').disabled).toBe(true);
    await choose('Balanced/gameinfo.gi');
    expect(document.querySelector<HTMLInputElement>('input[value="Balanced/cfg/video.txt"]')!.checked).toBe(true);
    expect(field('performance.custom.name').value).toBe('Balanced');
    await click('performance.custom.import');
    expect(importPreset).toHaveBeenCalledWith({ repository: 'owner/configs', commit: inspection.commit, name: 'Balanced', configPath: 'Balanced/gameinfo.gi', videoPath: 'Balanced/cfg/video.txt' });
    expect(changed).toHaveBeenCalledWith('custom-new');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('performance.custom.added');
    expect(button('performance.custom.editToggles')).toBeDefined();
  });

  it('explains an ambiguous video choice and preserves a manually entered name', async () => {
    await discover(); await choose('Ultra/gameinfo.gi');
    expect(button('performance.custom.import').disabled).toBe(true);
    expect(document.body.textContent).toContain('performance.custom.chooseVideo');
    await choose('Ultra/video(No Shadows).txt');
    expect(field('performance.custom.name').value).toBe('Ultra · No Shadows');
    await change('performance.custom.name', 'My choice');
    await choose('Balanced/gameinfo.gi');
    expect(field('performance.custom.name').value).toBe('My choice');
    await change('performance.custom.name', '');
    expect(button('performance.custom.import').disabled).toBe(true);
  });

  it('inspects an example on one click and lets Change return to the source form', async () => {
    inspection.repository = 'haloshiroe/complock-mirror';
    expect(inspect).not.toHaveBeenCalled();
    await act(async () => document.querySelector('summary')!.click());
    await click('haloshiroe/complock-mirror');
    expect(inspect).toHaveBeenCalledExactlyOnceWith('haloshiroe/complock-mirror');
    expect(document.body.textContent).toContain('performance.custom.mirrorExample');
    await click('performance.custom.changeSource');
    expect(button('performance.custom.import')).toBeUndefined();
    expect(field('performance.custom.repository').value).toBe('haloshiroe/complock-mirror');
  });

  it('imports video-only sources and reuses an inspection when adding another preset', async () => {
    inspection.configPaths = []; inspection.videoPaths = ['video.txt'];
    await discover(); await click('performance.custom.import');
    expect(importPreset.mock.calls[0][0].configPath).toBeNull();
    await click('performance.custom.addAnother');
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(field('performance.custom.name').value).toBe('configs');
    expect(button('performance.custom.import').disabled).toBe(false);
    await click('common.actions.cancel');
    expect(button('performance.custom.editToggles')).toBeDefined();
    expect(button('performance.custom.addAnother')).toBeDefined();
  });

  it('shows a recoverable empty result instead of an unusable import button', async () => {
    inspection.configPaths = []; inspection.videoPaths = [];
    await discover();
    expect(document.body.textContent).toContain('performance.custom.noConfigs');
    expect(button('performance.custom.import')).toBeUndefined();
    await click('performance.custom.changeSource');
    expect(button('performance.custom.inspect')).toBeDefined();
  });

  it('shows a translated source error and clears it when the repository is corrected', async () => {
    inspect.mockRejectedValue(new Error("Error invoking remote method 'inspect-performance-repository': Error: GitHub request failed (404)."));
    await discover();
    expect(document.querySelector('[role="alert"]')!.textContent).toBe('performance.custom.errors.notFound');
    await change('performance.custom.repository', 'different/repo');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('cancels optional-setting edits without changing the saved schema', async () => {
    await openSaved(); await click('performance.custom.editToggles'); await click('performance.custom.addToggle');
    expect(button('common.actions.save').disabled).toBe(true);
    await change('performance.custom.toggleLabel', 'First setting');
    expect(button('common.actions.save').disabled).toBe(false);
    await click('common.actions.cancel');
    expect(saveToggles).not.toHaveBeenCalled();
    await click('performance.custom.editToggles');
    expect(document.querySelector('input')).toBeNull();
  });

  it('requires confirmation before deleting a saved snapshot', async () => {
    await openSaved(); await click('performance.custom.delete');
    expect(deletePreset).not.toHaveBeenCalled();
    await click('common.actions.cancel');
    expect(deletePreset).not.toHaveBeenCalled();
    await click('performance.custom.delete');
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    await act(async () => [...dialogs.at(-1)!.querySelectorAll('button')].find((node) => node.textContent === 'performance.custom.delete')!.click());
    expect(deletePreset).toHaveBeenCalledExactlyOnceWith(preset.id);
    expect(changed).toHaveBeenCalled();
  });
});
