// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ViewerGifTimeline } from './ViewerGifTimeline';
vi.mock('react-i18next', () => ({ useTranslation: () => ({t: (key: string) => key}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const capture = {width:1,height:1,frames:Array.from({length:48},()=>new Uint8ClampedArray(4))};
let root: Root;
let host: HTMLDivElement;
const captured = new Set<number>();
const take = vi.fn((id: number) => { captured.add(id); });
const release = vi.fn((id: number) => { captured.delete(id); });
function Harness({disabled=false}: {disabled?:boolean}) {
  const [trim,setTrim] = useState<[number,number]>([0,48]);
  const [frame,setFrame] = useState(0);
  return <ViewerGifTimeline capture={capture} start={trim[0]} end={trim[1]} position={Math.max(trim[0],Math.min(trim[1]-1,frame))} disabled={disabled} onTrim={(start,end)=>setTrim([start,end])} onSeek={setFrame} />;
}
const slider = (name: string) => host.querySelector<HTMLElement>(`[aria-label="locker.pose.${name}"]`)!;
const value = (name: string) => Number(slider(name).getAttribute('aria-valuenow'));
function key(name: string, key: string, shiftKey=false) { act(()=>slider(name).dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true}))); }
function pointer(name: string, type: string, x: number) {
  const event = new MouseEvent(type,{bubbles:true,button:0,clientX:x});
  Object.defineProperty(event,'pointerId',{value:7});
  act(()=>slider(name).dispatchEvent(event));
}
beforeEach(()=>{
  vi.stubGlobal('ImageData',class {});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(()=>({putImageData:vi.fn(),drawImage:vi.fn()}) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({left:0,width:240,right:240,top:0,bottom:40,height:40,x:0,y:0,toJSON:()=>({})});
  Object.defineProperties(HTMLElement.prototype,{setPointerCapture:{configurable:true,value:take},hasPointerCapture:{configurable:true,value:(id:number)=>captured.has(id)},releasePointerCapture:{configurable:true,value:release}});
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<Harness />));
});
afterEach(()=>{act(()=>root.unmount());host.remove();captured.clear();vi.clearAllMocks();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps trim handles noncrossing with a one-frame selection and keyboard bounds',()=>{
  key('gifStart','End');expect(value('gifStart')).toBe(47);
  key('gifStart','ArrowRight');expect(value('gifStart')).toBe(47);
  key('gifEnd','Home');expect(value('gifEnd')).toBe(48);
  key('gifEnd','ArrowLeft');expect(value('gifEnd')).toBe(48);
  key('gifStart','Home');expect(value('gifStart')).toBe(0);
  key('gifEnd','Home');expect(value('gifEnd')).toBe(1);
});
it('moves the independent playhead without changing trim and supports large keyboard steps',()=>{
  key('gifPosition','ArrowRight',true);expect(value('gifPosition')).toBe(12);
  expect(value('gifStart')).toBe(0);expect(value('gifEnd')).toBe(48);
  key('gifPosition','End');expect(value('gifPosition')).toBe(47);
  key('gifPosition','Home');expect(value('gifPosition')).toBe(0);
});
it('scrubs inside the selection and clamps scrubbing to trimmed bounds',()=>{
  key('gifStart','ArrowRight',true);key('gifEnd','ArrowLeft',true);
  pointer('gifPosition','pointerdown',120);expect(value('gifPosition')).toBe(24);
  pointer('gifPosition','pointermove',240);expect(value('gifPosition')).toBe(35);
  pointer('gifPosition','pointermove',-20);expect(value('gifPosition')).toBe(12);
  pointer('gifPosition','pointerup',-20);expect(release).toHaveBeenCalledWith(7);
});
it('captures handle drags without jumping on grab and releases on pointer cancel',()=>{
  pointer('gifStart','pointerdown',-6);expect(value('gifStart')).toBe(0);
  expect(take).toHaveBeenCalledWith(7);
  pointer('gifStart','pointermove',44);expect(value('gifStart')).toBe(10);
  pointer('gifStart','pointercancel',44);expect(release).toHaveBeenCalledWith(7);
  pointer('gifStart','pointermove',100);expect(value('gifStart')).toBe(10);
});
it('releases active capture on unmount',()=>{
  pointer('gifEnd','pointerdown',246);
  act(()=>root.unmount());expect(release).toHaveBeenCalledWith(7);
});
it('disables all positions during encoding',()=>{
  act(()=>root.render(<Harness disabled />));
  key('gifStart','End');pointer('gifPosition','pointerdown',120);
  expect(value('gifStart')).toBe(0);expect(value('gifPosition')).toBe(0);
  for(const node of host.querySelectorAll('[role=slider]')){expect(node.getAttribute('aria-disabled')).toBe('true');expect(node.getAttribute('tabindex')).toBe('-1');}
});
