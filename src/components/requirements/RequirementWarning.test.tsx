// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../../types/mod';
import { RequirementWarning } from './RequirementWarning';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { useAppStore } from '../../stores/appStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const makeMod = (id: number): Mod => ({ id: String(id), gameBananaId: id, name: `Mod ${id}`, enabled: true,
  metaKey: String(id), fileName: String(id), path: String(id), size: 1, installedAt: '', priority: id });
const required = { name: 'Base', url: 'https://gamebanana.com/mods/999', importance: 'required', state: 'on' } as const;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useRequirementsStore.getState().finish(false);
  useRequirementsStore.getState().finishToggle();
  useRequirementsStore.setState({ snapshots: {} });
  useRequirementOrderStore.setState({ files: {} });
  useAppStore.setState({ mods: [] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Installed requirement warning reuse', () => {
  it('opens local skin dependencies without requiring a GameBanana snapshot', () => {
    const base = { ...makeMod(999), sha256: 'a'.repeat(64) };
    const mod = { ...makeMod(1), gameBananaId: undefined, skinEdit: { hero: 'Mina', sources: [base.sha256] } };
    useAppStore.setState({ mods: [mod, base] });
    act(() => root.render(<RequirementWarning mod={mod} />));
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('requirements.title');
    act(() => host.querySelector('button')!.click());
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({ mode: 'manage', mod, mods: [mod, base] });
    expect(useRequirementsStore.getState().snapshots).toEqual({});
  });

  it('opens the current snapshot and name after requirement and metadata refreshes', () => {
    const mod = makeMod(1);
    const target = { id: 1, section: 'Mod' };
    useAppStore.setState({ mods: [mod] });
    useRequirementsStore.getState().remember(target, { status: 'loaded', checkedAt: 1, items: [required] });
    act(() => root.render(<RequirementWarning mod={mod} />));
    act(() => useRequirementsStore.getState().remember(target, { status: 'loaded', checkedAt: 2, items: [{ ...required }] }));
    const renamed = { ...mod, name: 'Updated mod name' };
    act(() => { useAppStore.setState({ mods: [renamed] }); root.render(<RequirementWarning mod={renamed} />); });
    act(() => host.querySelector('button')!.click());
    expect(useRequirementsStore.getState().toggleReview).toMatchObject({
      mode: 'manage', mod: renamed, snapshots: { 'Mod:1': { checkedAt: 2, items: [required] } },
    });
  });

  it('does not open the manager if the mod was removed before its icon was clicked', () => {
    const mod = makeMod(1);
    useAppStore.setState({ mods: [mod] });
    useRequirementsStore.getState().remember({ id: 1, section: 'Mod' }, { status: 'loaded', checkedAt: 1, items: [required] });
    act(() => root.render(<RequirementWarning mod={mod} />));
    act(() => useAppStore.setState({ mods: [] }));
    act(() => host.querySelector('button')!.click());
    expect(useRequirementsStore.getState().toggleReview).toBeNull();
  });

  it('reuses cached calculations after virtual-card unmount and remount', () => {
    const readMod = vi.fn();
    const mod = makeMod(1);
    const mods = [new Proxy(mod, { get(target, property, receiver) { readMod(); return Reflect.get(target, property, receiver); } })];
    useAppStore.setState({ mods });
    useRequirementsStore.getState().remember({ id: 1, section: 'Mod' }, { status: 'loaded', checkedAt: 1, items: [required] });
    act(() => root.render(<RequirementWarning mod={mod} />));
    act(() => root.render(null));
    readMod.mockClear();
    act(() => root.render(<RequirementWarning mod={mod} />));
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('requirements.missing');
    expect(readMod).not.toHaveBeenCalled();
  });

  it('shows a compact yellow icon for unmet required dependencies without a text tag', () => {
    const mod = makeMod(1);
    useAppStore.setState({ mods: [mod] });
    useRequirementsStore.getState().remember({ id: 1, section: 'Mod' }, { status: 'loaded', checkedAt: 1, items: [required] });
    act(() => root.render(<RequirementWarning mod={mod} />));
    const icon = host.querySelector('button')!;
    expect(icon.className).toContain('h-[22px] w-[22px]');
    expect(icon.className).toContain('text-state-warning');
    expect(icon.title).toBe('requirements.missing');
    expect(icon.querySelector('svg')?.classList.contains('h-4')).toBe(true);
    expect(icon.textContent).toBe('');
  });

  it.each(['disabled', 'optional'] as const)('keeps %s requirement icons light gray', kind => {
    const mod = { ...makeMod(1), enabled: kind !== 'disabled' };
    useAppStore.setState({ mods: [mod] });
    useRequirementsStore.getState().remember({ id: 1, section: 'Mod' }, {
      status: 'loaded', checkedAt: 1, items: [{ ...required, importance: kind === 'optional' ? 'optional' : 'required' }],
    });
    act(() => root.render(<RequirementWarning mod={mod} />));
    const icon = host.querySelector('button')!;
    expect(icon.className).toContain('text-text-secondary');
    expect(icon.className).not.toContain('text-state-warning');
    expect(icon.title).toBe('requirements.title');
  });
});
