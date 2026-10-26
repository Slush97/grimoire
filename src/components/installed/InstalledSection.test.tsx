// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstalledSection } from './InstalledSection';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('collapsed Installed sections', () => {
  it('does not construct or mount cards while collapsed, retaining the header actions', () => {
    const buildCards = vi.fn(() => <div data-card>Mod card</div>);
    const toggle = vi.fn();
    act(() => root.render(
      <InstalledSection title="Enabled" count={500} collapsed onToggle={toggle}
        actions={<button>Profiles</button>}>
        {buildCards}
      </InstalledSection>
    ));
    expect(buildCards).not.toHaveBeenCalled();
    expect(host.querySelector('[data-card]')).toBeNull();
    expect(host.textContent).toContain('Enabled (500)');
    expect(host.textContent).toContain('Profiles');
    const heading = host.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    expect(document.getElementById(heading.getAttribute('aria-controls')!)?.hidden).toBe(true);
    act(() => heading.click());
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('releases card subscriptions on collapse and mounts current content when reopened', () => {
    const mount = vi.fn();
    const unmount = vi.fn();
    function Card({ name }: { name: string }) {
      useEffect(() => { mount(); return unmount; }, []);
      return <div data-card>{name}</div>;
    }
    const render = (collapsed: boolean, name: string) => act(() => root.render(
      <InstalledSection title="Disabled" count={1} collapsed={collapsed} onToggle={() => {}}>
        {() => <Card name={name} />}
      </InstalledSection>
    ));
    render(false, 'First');
    expect(mount).toHaveBeenCalledOnce();
    render(true, 'Second');
    expect(unmount).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-card]')).toBeNull();
    render(false, 'Second');
    expect(mount).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-card]')?.textContent).toBe('Second');
  });
});
