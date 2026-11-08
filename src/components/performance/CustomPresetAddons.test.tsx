// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomPresetAddons from './CustomPresetAddons';
import type { PerformancePresetSummary } from '../../types/electron';
const h = vi.hoisted(() => ({ loadMods: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../stores/appStore', () => ({ useAppStore: { getState: () => ({loadMods:h.loadMods}) } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('custom preset addon feedback', () => {
  let root: Root;
  let host: HTMLDivElement;
  const imported = vi.fn();
  const busy = vi.fn();
  const changed = vi.fn();
  const review = vi.fn();
  const preset = { id:'custom-test', upstream:{url:'https://github.com/owner/config'}, custom:{
    addons:[{path:'addons/first.vpk',size:1000},{path:'optional-addons/second.vpk',size:2000}], importedAddons:[],
  } } as unknown as PerformancePresetSummary;
  const render = async (source=preset) => act(async()=>root.render(<CustomPresetAddons preset={source} disabled={false} onBusy={busy} onChanged={changed} onReview={review} />));
  beforeEach(async()=>{
    imported.mockReset(); busy.mockReset(); changed.mockReset().mockResolvedValue(undefined); h.loadMods.mockClear(); review.mockClear();
    window.electronAPI={importPerformanceAddon:imported} as unknown as Window['electronAPI'];
    host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();
  });
  afterEach(()=>{act(()=>root.unmount());host.remove();});

  it('shows loading on the chosen file and labels persisted history honestly', async()=>{
    let finish!: (value: unknown)=>void;
    imported.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    await act(async()=>host.querySelector('button')!.click());
    expect(host.querySelectorAll('.animate-spin')).toHaveLength(1);
    expect([...host.querySelectorAll('button')].every(button=>button.disabled)).toBe(true);
    await act(async()=>finish({results:[{ok:true}]}));
    expect(imported).toHaveBeenCalledExactlyOnceWith('custom-test','addons/first.vpk');
    expect(busy).toHaveBeenLastCalledWith(false);
    expect(changed).toHaveBeenCalledOnce();
    expect(h.loadMods).toHaveBeenCalledOnce();
    await act(async()=>root.render(null));
    await render({...preset,custom:{...preset.custom!,importedAddons:['addons/first.vpk']}});
    expect(host.textContent).toContain('performance.custom.previouslyImported');
    expect(host.querySelector('button')!.textContent).toBe('performance.custom.importAgain');
    expect(host.querySelector('button')!.disabled).toBe(false);
  });

  it('keeps a failed import retryable and reports the error on its row', async()=>{
    imported.mockResolvedValue({results:[{ok:false,error:'Bad VPK'}]});
    await act(async()=>host.querySelector('button')!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('performance.custom.errors.generic');
    expect(host.textContent).toContain('Bad VPK');
    expect(host.textContent).not.toContain('performance.custom.previouslyImported');
    expect(host.querySelector('button')!.disabled).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('offers the existing review flow when the importer flags an addon', async()=>{
    imported.mockResolvedValue({results:[{ok:true,needsReview:true}]});
    await act(async()=>host.querySelector('button')!.click());
    expect(host.querySelector('[role="status"]')!.textContent).toBe('performance.custom.addonNeedsReview');
    await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent==='performance.custom.reviewAddon')!.click());
    expect(review).toHaveBeenCalledOnce();
  });
});
