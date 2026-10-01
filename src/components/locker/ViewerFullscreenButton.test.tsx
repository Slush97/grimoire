// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ViewerFullscreenButton } from './ViewerFullscreenButton';
vi.mock('react-i18next', () => ({ useTranslation: () => ({t:(key:string)=>key}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let fullscreen: Element | null;
const request = vi.fn();
const button = () => host.querySelector('button')!;
beforeEach(()=>{
  fullscreen=null;
  Object.defineProperty(document,'fullscreenElement',{configurable:true,get:()=>fullscreen});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  act(()=>root.render(<ViewerFullscreenButton onRequest={request} />));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.clearAllMocks();vi.restoreAllMocks();});
it('shows enter arrows and label before fullscreen and requests without an optimistic icon change',()=>{
  expect(button().getAttribute('aria-label')).toBe('locker.pose.fullscreen');
  expect(button().getAttribute('aria-pressed')).toBe('false');
  expect(button().querySelector('svg')?.classList.contains('lucide-expand')).toBe(true);
  act(()=>button().click());expect(request).toHaveBeenCalledOnce();
  expect(button().getAttribute('aria-pressed')).toBe('false');
});
it('follows actual entry and external exit including Escape fullscreenchange',()=>{
  act(()=>{fullscreen=host;document.dispatchEvent(new Event('fullscreenchange'));});
  expect(button().getAttribute('aria-label')).toBe('locker.pose.exitFullscreen');
  expect(button().getAttribute('title')).toBe('locker.pose.exitFullscreen');
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(button().querySelector('svg')?.classList.contains('lucide-shrink')).toBe(true);
  act(()=>{fullscreen=null;document.dispatchEvent(new Event('fullscreenchange'));});
  expect(button().getAttribute('aria-label')).toBe('locker.pose.fullscreen');
  expect(button().querySelector('svg')?.classList.contains('lucide-expand')).toBe(true);
});
it('keeps the actual exit state if an exit request fails',()=>{
  act(()=>{fullscreen=host;document.dispatchEvent(new Event('fullscreenchange'));});
  request.mockImplementationOnce(()=>{void Promise.reject(new Error('Denied')).catch(()=>{});});
  act(()=>button().click());
  expect(button().getAttribute('aria-label')).toBe('locker.pose.exitFullscreen');
  expect(button().getAttribute('aria-pressed')).toBe('true');
});
it('unsubscribes on unmount',()=>{
  const remove=vi.spyOn(document,'removeEventListener');
  act(()=>root.unmount());expect(remove).toHaveBeenCalledWith('fullscreenchange',expect.any(Function));
});
