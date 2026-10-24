// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mod } from '../../types/mod';
import { RequirementWarning } from './RequirementWarning';
import { useRequirementsStore } from '../../stores/requirementsStore';
import { useRequirementOrderStore } from '../../stores/requirementOrderStore';
import { useAppStore } from '../../stores/appStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key }, applyLanguagePreference: vi.fn() }));
vi.mock('../common/ui', () => ({ Tag: ({ children }: { children: ReactNode }) => <span>{children}</span> }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const makeMod = (id: number): Mod => ({ id: String(id), gameBananaId: id, name: `Mod ${id}`, enabled: true,
  metaKey: String(id), fileName: String(id), path: String(id), size: 1, installedAt: '', priority: id });
const required = { name: 'Base', url: 'https://gamebanana.com/mods/999', importance: 'required', state: 'on' } as const;
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  useRequirementsStore.getState().finish(false);
  useRequirementsStore.setState({ snapshots: {} });
  useRequirementOrderStore.setState({ files: {} });
  useAppStore.setState({ mods: [] });
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('Installed requirement warning reuse', () => {
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
    expect(useRequirementsStore.getState().review?.source).toMatchObject({ name: renamed.name, requirements: { checkedAt: 2, items: [required] } });
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
    expect(host.textContent).toBe('requirements.missing');
    expect(readMod).not.toHaveBeenCalled();
  });
});
