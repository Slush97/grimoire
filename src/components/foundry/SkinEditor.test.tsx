// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import SkinEditor from './SkinEditor';
import { useAppStore } from '../../stores/appStore';
import type { Mod } from '../../types/mod';
import type { SkinPartEdit } from '../../types/skinEditor';

vi.mock('react-i18next', () => ({ initReactI18next: { type: '3rdParty', init: () => {} }, useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../locker/HeroPoseViewer', () => ({ default: function Preview({ partEdits, onPreviewCapture }: {
  partEdits: SkinPartEdit[]; onPreviewCapture: (capture: (() => Promise<string>) | null) => void;
}) {
  useEffect(() => { onPreviewCapture(async () => 'data:image/webp;base64,UklGRg=='); return () => onPreviewCapture(null); }, [onPreviewCapture]);
  return <output data-testid="preview">{JSON.stringify(partEdits)}</output>;
} }));

const edits: SkinPartEdit[] = [{ material: 'body.vmat', hidden: false, tint: '#4080ff',
  pattern: { style: 'confetti', intensity: 0.5, phase: 0.25, scroll: 1 },
  adjustments: { hue: 25, saturation: 0.8, brightness: 1.2 }, colorize: false }];
const part = (material: string) => ({ material, label: material, drawCalls: 1, vertices: 3, tintable: true, patternable: true });
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
  } });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
async function mount() { await act(async () => { root.render(<SkinEditor heroName="Mina" />); }); }
async function choose(value: string) {
  await act(async () => { const select = host.querySelector('select')!; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
const previewEdits = () => JSON.parse(host.querySelector('[data-testid="preview"]')!.textContent!);

describe('Door Stuck skin recovery', () => {
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
