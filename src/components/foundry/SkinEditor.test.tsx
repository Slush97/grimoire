// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import SkinEditor, { SkinEditorSession } from './SkinEditor';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';
import type { SkinEditProgress, SkinPartEdit } from '../../types/skinEditor';
import { SILVER_TRANSFORMED_MODEL } from '../../lib/skinModelForms';

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../locker/HeroPoseViewer', () => ({ default: function Preview({ heroName, partEdits, highlightedPart, onPreviewCapture }: {
  heroName: string; partEdits: SkinPartEdit[]; highlightedPart: string | null; onPreviewCapture: (capture: (() => Promise<string>) | null) => void;
}) {
  useEffect(() => { onPreviewCapture(async () => 'data:image/webp;base64,UklGRg=='); return () => onPreviewCapture(null); }, [onPreviewCapture]);
  return <output data-testid="preview" data-hero={heroName} data-highlight={highlightedPart ?? ''}>{JSON.stringify(partEdits)}</output>;
} }));

const edits: SkinPartEdit[] = [{ material: 'body.vmat', hidden: false, tint: '#4080ff',
  pattern: { style: 'confetti', intensity: 0.5, phase: 0.25, scroll: 1 },
  adjustments: { hue: 25, saturation: 0.8, brightness: 1.2 }, colorize: false }];
const part = (material: string) => ({ material, label: material, drawCalls: 1, vertices: 3, tintable: true, patternable: true, finishable: true, surfaceable: true });
function mod(metaKey: string, name: string, skinEdit?: Mod['skinEdit']): Mod {
  return { id: metaKey, metaKey, path: metaKey, fileName: metaKey, name, enabled: true,
    priority: 1, size: 100, installedAt: '2026-10-24', lockerHero: 'Mina', lockerHeroSource: 'manual',
    sha256: (skinEdit ? 'a' : 'b').repeat(64), skinEdit };
}
let root: Root, host: HTMLDivElement;
const resume = vi.fn(), save = vi.fn(), reload = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useAppStore.setState({ mods: [mod('saved.vpk', 'Mina custom', { hero: 'Mina', sources: [], edits }), mod('other.vpk', 'Other Mina')], loadMods: reload });
  resume.mockResolvedValue({ skinSources: [], edits, name: 'Mina custom', overlay: { metaKey: 'saved.vpk', priority: 1 }, missing: 0 });
  save.mockResolvedValue({ renamed: {}, overlay: { metaKey: 'saved.vpk', priority: 1 } });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: {
    getSkinEditInfo: vi.fn().mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'mina.vmdl_c', parts: [part('body.vmat'), part('head.vmat')] }),
    resumeSkinEdit: resume, saveSkinEdits: save,
    onSkinEditProgress: vi.fn(() => () => {}),
  } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function mount() { await act(async () => { root.render(<SkinEditor heroName="Mina" />); }); }
async function choose(value: string) {
  await act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
const previewEdits = () => JSON.parse(host.querySelector('[data-testid="preview"]')!.textContent!);
async function historyKey(redo = false, target: Element = host.querySelector('section')!) {
  const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: redo, bubbles: true, cancelable: true });
  await act(async () => target.dispatchEvent(event));
  return event;
}

describe('Door Stuck skin recovery', () => {
  it('combines finish and transparency and resets both with undo support', async () => {
    await mount();
    const click = async (text: string) => {
      await act(async () => {
        const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === text);
        if (!button) throw new Error(`Missing button ${text}`);
        button.click();
      });
    };
    await click('foundry.skin.surface');
    await click('foundry.skin.finish.glossy');
    await click('foundry.skin.translucent');
    expect(previewEdits()[0]).toMatchObject({ finish: { roughness: 0.12, metalness: 0 }, surface: { mode: 'translucent', opacity: 0.35 } });
    await act(async () => {
      const slider = host.querySelector<HTMLInputElement>('input[aria-label="foundry.skin.opacity"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '0.6');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('foundry.skin.finish.polished');
    expect(previewEdits()[0]).toMatchObject({ finish: { roughness: 0.04, metalness: 1 }, surface: { mode: 'translucent', opacity: 0.6 } });
    await historyKey();
    expect(previewEdits()[0]).toMatchObject({ finish: { roughness: 0.12, metalness: 0 }, surface: { mode: 'translucent', opacity: 0.6 } });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="foundry.skin.resetPart"]')!.click(); });
    expect(previewEdits()).toEqual([]);
    await historyKey();
    expect(previewEdits()[0].surface).toEqual({ mode: 'translucent', opacity: 0.6 });
  });
  it('keeps a saved Ghost draft but requires choosing a supported surface before saving', async () => {
    const ghost = [{ material: 'body.vmat', hidden: false, tint: null, surface: { mode: 'ghost', opacity: 0.6 } }] satisfies SkinPartEdit[];
    await act(async () => { root.render(<SkinEditorSession heroName="Mina" sources={[]} initialEdits={ghost} />); });
    const submit = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    expect(previewEdits()).toEqual(ghost);
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'foundry.skin.surface')!.click(); });
    expect(host.querySelector('button[role="tab"][aria-label="foundry.skin.ghost"]')).toBeNull();
    expect(host.textContent).toContain('foundry.skin.ghostUnsupported');
    await act(async () => { [...host.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === 'foundry.skin.translucent')!.click(); });
    expect(previewEdits()[0].surface).toEqual({ mode: 'translucent', opacity: 0.6 });
    expect(submit.disabled).toBe(false);
  });
  it('undoes and redoes a skin edit with the requested shortcuts', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    const changed = previewEdits();
    expect(changed[0].tint).toBe('#ef4444');
    expect((await historyKey()).defaultPrevented).toBe(true);
    expect(previewEdits()).toEqual([]);
    await historyKey(true);
    expect(previewEdits()).toEqual(changed);
  });
  it('preserves restored drafts as the undo baseline and clears redo on a new edit', async () => {
    await mount(); await choose('saved.vpk');
    expect((await historyKey()).defaultPrevented).toBe(false);
    expect(previewEdits()).toEqual(edits);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    await historyKey();
    expect(previewEdits()).toEqual(edits);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#3b82f6"]')!.click(); });
    expect((await historyKey(true)).defaultPrevented).toBe(false);
    expect(previewEdits()[0].tint).toBe('#3b82f6');
  });
  it('undoes an entire slider drag in one step, including the persisted draft', async () => {
    await mount();
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => slider.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    for (const value of ['20', '40', '60']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    expect(previewEdits()[0].adjustments.hue).toBe(60);
    await act(async () => window.dispatchEvent(new Event('pointerup')));
    await historyKey();
    expect(previewEdits()).toEqual([]);
    expect((await historyKey()).defaultPrevented).toBe(false);
    const draft = [...Array(localStorage.length).keys()].map((i) => localStorage.key(i)).find((key) => key?.endsWith(':edits"]'))!;
    expect(JSON.parse(localStorage.getItem(draft)!)).toEqual([]);
  });
  it('leaves text and number editing undo to the focused input', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    const changed = previewEdits();
    for (const input of host.querySelectorAll('input[type="text"], input[type="number"]')) {
      expect((await historyKey(false, input)).defaultPrevented).toBe(false);
      expect(previewEdits()).toEqual(changed);
    }
    const outside = document.createElement('button'); document.body.append(outside);
    expect((await historyKey(false, outside)).defaultPrevented).toBe(false);
    outside.remove();
    expect(previewEdits()).toEqual(changed);
  });
  it('supports platform Meta shortcuts and does not keep undo across a source switch', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    await act(async () => host.querySelector('section')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })));
    expect(previewEdits()).toEqual([]);
    await historyKey(true);
    await choose('other.vpk');
    expect((await historyKey()).defaultPrevented).toBe(false);
    expect(previewEdits()).toEqual([]);
    await choose('vanilla');
    expect(previewEdits()[0].tint).toBe('#ef4444');
    expect((await historyKey()).defaultPrevented).toBe(false);
  });
  it('supports the physical Z key on non-English keyboard layouts', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    const event = new KeyboardEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => host.querySelector('section')!.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(previewEdits()).toEqual([]);
  });
  it('undoes changes across forms and a reset as one edit', async () => {
    vi.mocked(window.electronAPI.getSkinEditInfo).mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'base.vmdl_c', parts: [
      { ...part('body.vmat'), formIds: ['default'] }, { ...part('cat.vmat'), formIds: ['cat'] },
    ] });
    await act(async () => root.render(<SkinEditorSession heroName="Calico" sources={[]} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('foundry.skin.forms.cat'))!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#3b82f6"]')!.click(); });
    expect(previewEdits()).toHaveLength(2);
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="foundry.skin.reset"]')!.click(); });
    expect(previewEdits()).toEqual([]);
    await historyKey();
    expect(previewEdits()).toHaveLength(2);
    await historyKey();
    expect(previewEdits()).toEqual([{ material: 'body.vmat', hidden: false, tint: '#ef4444', pattern: null, repaint: true }]);
  });
  it('locks history during export and compares undo/redo with the most recently saved edits', async () => {
    const dirty = vi.fn();
    await act(async () => root.render(<SkinEditorSession heroName="Mina" sources={[]} onDirtyChange={dirty} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="#ef4444"]')!.click(); });
    let finish = () => {};
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ renamed: {}, overlay: { metaKey: 'saved.vpk', priority: 1 } }); }));
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect((await historyKey()).defaultPrevented).toBe(false);
    expect(previewEdits()[0].tint).toBe('#ef4444');
    expect(host.querySelector<HTMLButtonElement>('button[aria-label="common.actions.undo"]')?.disabled).toBe(true);
    await act(async () => finish());
    expect(dirty).toHaveBeenLastCalledWith(false);
    await historyKey();
    expect(previewEdits()).toEqual([]);
    expect(dirty).toHaveBeenLastCalledWith(true);
    await historyKey(true);
    expect(previewEdits()[0].tint).toBe('#ef4444');
    expect(dirty).toHaveBeenLastCalledWith(false);
  });
  it('previews transformed materials separately while retaining both forms in the same edit set', async () => {
    vi.mocked(window.electronAPI.getSkinEditInfo).mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'base.vmdl_c', parts: [
      { ...part('body.vmat'), modelEntries: ['base.vmdl_c'] },
      { ...part('wolf.vmat'), modelEntries: [SILVER_TRANSFORMED_MODEL] },
    ] });
    await act(async () => { root.render(<SkinEditor heroName="Silver" />); });
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute('data-hero')).toBe('Silver');
    const transformed = [...host.querySelectorAll('button')].find((button) => button.textContent === 'foundry.skin.forms.werewolf')!;
    await act(async () => transformed.click());
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute('data-hero')).toBe('Silver (transformed)');
    expect(host.querySelector('h4')?.textContent).toBe('Wolf.vmat');
  });
  it('switches Calico forms without losing edits and saves all forms together', async () => {
    const allEdits = [edits[0], { material: 'cat.vmat', hidden: false, tint: '#ff0000' }];
    vi.mocked(window.electronAPI.getSkinEditInfo).mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'calico.vmdl_c', parts: [
      { ...part('body.vmat'), formIds: ['default'] }, { ...part('cat.vmat'), formIds: ['cat'] },
    ] });
    await act(async () => root.render(<SkinEditorSession heroName="Calico" sources={[]} initialEdits={allEdits} />));
    const cat = [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('foundry.skin.forms.cat'))!;
    await act(async () => cat.click());
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute('data-hero')).toBe('Calico (cat)');
    expect(host.querySelector('h4')?.textContent).toBe('Cat.vmat');
    expect(previewEdits()).toEqual(allEdits);
    expect(host.textContent).toContain('foundry.skin.changedAcrossForms');
    const original = [...host.querySelectorAll('button')].find((button) => button.textContent === 'foundry.skin.original')!;
    await act(async () => original.click());
    expect(previewEdits()).toEqual([]);
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(save.mock.calls[0][0].edits).toEqual(allEdits);
  });
  it('shows an unavailable form without substituting a normal model or dropping edits', async () => {
    vi.mocked(window.electronAPI.getSkinEditInfo).mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'calico.vmdl_c', parts: [part('body.vmat')],
      forms: [{ id: 'default', available: true }, { id: 'cat', available: false }] });
    await act(async () => root.render(<SkinEditorSession heroName="Calico" sources={[]} initialEdits={edits} />));
    const cat = [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('foundry.skin.forms.cat'))!;
    await act(async () => cat.click());
    expect(host.textContent).toContain('foundry.skin.formUnavailable');
    expect(host.querySelector('[data-testid="preview"]')).toBeNull();
    const normal = [...host.querySelectorAll('button')].find((button) => button.textContent?.startsWith('foundry.skin.defaultForm'))!;
    await act(async () => normal.click());
    expect(previewEdits()).toEqual(edits);
  });
  it('shows measured build progress until saving and refreshing finish', async () => {
    let report: ((progress: SkinEditProgress) => void) | undefined;
    vi.mocked(window.electronAPI.onSkinEditProgress).mockImplementation((callback) => { report = callback; return () => {}; });
    let finish = () => {};
    save.mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ renamed: {}, overlay: { metaKey: 'saved.vpk', priority: 1 } }); }));
    await mount(); await choose('saved.vpk');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(host.textContent).toContain('foundry.skin.preparing');
    await act(async () => report?.({ stage: 'build', completed: 2, total: 5 }));
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('2');
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuemax')).toBe('5');
    expect(host.textContent).not.toContain('foundry.skin.enabled');
    await act(async () => finish());
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.textContent).toContain('foundry.skin.enabled');
  });
  it('clears the hover tint when selecting a part collapses the part picker', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(); });
    const pick = host.querySelector<HTMLButtonElement>('button[title="Head.vmat"]')!;
    await act(async () => { pick.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); });
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute('data-highlight')).toBe('head.vmat');
    await act(async () => { pick.click(); });
    expect(host.querySelector('[data-testid="preview"]')?.getAttribute('data-highlight')).toBe('');
  });
  it('lists saved skins and restores every recorded edit and the saved name', async () => {
    await mount();
    expect(host.querySelector('select')?.textContent).toContain('Mina custom');
    await choose('saved.vpk');
    expect(resume).toHaveBeenCalledWith({ heroName: 'Mina', skinSources: [{ metaKey: 'saved.vpk', priority: 1 }] });
    expect(previewEdits()).toEqual(edits);
    expect(host.querySelector<HTMLInputElement>('input[maxlength="120"]')?.value).toBe('Mina custom');
  });
  it('keeps edits across a skin switch and a full unmount', async () => {
    await mount();
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="foundry.skin.hidePart"]')!.click(); });
    const pending = previewEdits(); expect(pending).toHaveLength(1);
    await choose('other.vpk'); expect(previewEdits()).toEqual([]);
    await choose('vanilla'); expect(previewEdits()).toEqual(pending);
    act(() => root.unmount()); root = createRoot(host);
    await mount(); expect(previewEdits()).toEqual(pending);
  });
  it('remembers a linked skin and follows its content identity after its slot changes', async () => {
    await act(async () => root.render(<SkinEditor heroName="Mina" initialSkinSources={[{ metaKey: 'other.vpk', priority: 1 }]} />));
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="foundry.skin.hidePart"]')!.click(); });
    const pending = previewEdits();
    act(() => root.unmount()); root = createRoot(host);
    useAppStore.setState({ mods: [mod('moved.vpk', 'Other Mina')] });
    await mount();
    expect(host.querySelector('select')?.value).toBe('moved.vpk');
    expect(previewEdits()).toEqual(pending);
  });
  it('sends a rendered thumbnail and original edit values when resaving a custom skin', async () => {
    await mount(); await choose('saved.vpk');
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mina custom', edits,
      skinSources: [{ metaKey: 'saved.vpk', priority: 1 }], thumbnailDataUrl: 'data:image/webp;base64,UklGRg==' }));
  });
  it('ignores malformed persisted input without breaking the editor', async () => {
    localStorage.setItem('grimoire.foundry.draft.v1:["","skin:Mina:[]:edits"]', '{bad json');
    await mount(); expect(previewEdits()).toEqual([]);
  });
  it('keeps edits for missing parts and blocks saving until they are explicitly removed', async () => {
    vi.mocked(window.electronAPI.getSkinEditInfo).mockResolvedValue({ fingerprint: 'f'.repeat(64), entry: 'mina.vmdl_c', parts: [part('head.vmat')] });
    await mount(); await choose('saved.vpk');
    expect(previewEdits()).toEqual(edits);
    expect(host.textContent).toContain('foundry.draft.unknownParts');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });
  it('lets a failed skin resume return to the default skin', async () => {
    resume.mockRejectedValueOnce(new Error('Missing skin'));
    await mount(); await choose('saved.vpk');
    expect(host.textContent).toContain('Missing skin');
    await choose('vanilla'); expect(previewEdits()).toEqual([]);
  });
});
