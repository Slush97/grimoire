import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getAssetPath } from '../../lib/assetPath';
import './sex-mode.css';

// The stinger in bee-cursor.svg ends at (24, 29), relative to the (15, 15) hotspot.
const stinger = { x: 9, y: 14 };

function emitParticle(
  layer: HTMLDivElement, x: number, y: number, driftX: number, driftY: number,
  { size, fall, duration, opacity = 1 }: { size: number; fall: number; duration: number; opacity?: number },
) {
  const dot = document.createElement('span');
  dot.className = 'sex-bee-particle';
  layer.append(dot);
  const frames = [0, 1 / 3, 2 / 3, 1].map((t) => ({
    transform: `translate(${x + driftX * t}px, ${y + driftY * t + fall * t * t}px) scale(${size * (1 - 0.45 * t)})`,
    opacity: opacity * (1 - t ** 2),
  }));
  dot.animate(frames, { duration }).onfinish = () => dot.remove();
}

export default function BeeEffects() {
  const particles = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = particles.current;
    if (!layer) return;

    const root = document.documentElement;
    const cursorUrl = new URL(getAssetPath('/bee-cursor.svg'), document.baseURI);
    root.style.setProperty('--sex-bee-cursor', `url("${cursorUrl.href}") 15 15, auto`);
    root.classList.add('sex-bee-active');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const puff = (event: MouseEvent) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const bloom = event.detail === 0 && target instanceof HTMLButtonElement
        ? target.querySelector('[data-flower-bloom]')
        : target.closest('[data-flower-bloom]');
      if (!bloom) return;

      const bounds = event.detail === 0 ? bloom.getBoundingClientRect() : undefined;
      const x = bounds ? bounds.x + bounds.width / 2 : event.clientX + stinger.x;
      const y = bounds ? bounds.y + bounds.height / 2 : event.clientY + stinger.y;
      const count = 12;
      const still = reducedMotion.matches;

      for (let index = 0; index < count; index += 1) {
        const angle = (index + Math.random() * 0.7) / count * 2 * Math.PI;
        const distance = 32 * (0.55 + Math.random() * 0.45);
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 10;
        emitParticle(layer, x + (still ? dx * 0.4 : 0), y + (still ? dy * 0.4 : 0), still ? 0 : dx, still ? 0 : dy, {
          size: 0.8 + Math.random() * 0.65,
          fall: still ? 0 : 28,
          duration: still ? 180 : 380 + Math.random() * 100,
        });
      }
    };

    let lastTrail = { x: 0, y: 0, time: -Infinity };
    const trail = ({ clientX: x, clientY: y, timeStamp: time, pointerType }: PointerEvent) => {
      if (pointerType === 'touch' || reducedMotion.matches) return;
      if (time - lastTrail.time < 28 || Math.hypot(x - lastTrail.x, y - lastTrail.y) < 5) return;
      lastTrail = { x, y, time };
      emitParticle(layer, x + stinger.x, y + stinger.y, (Math.random() - 0.5) * 8, -3, {
        size: 0.65 + Math.random() * 0.3,
        fall: 13,
        duration: 310,
        opacity: 0.8,
      });
    };

    document.addEventListener('click', puff, true);
    document.addEventListener('pointermove', trail, { capture: true, passive: true });
    return () => {
      document.removeEventListener('click', puff, true);
      document.removeEventListener('pointermove', trail, true);
      root.classList.remove('sex-bee-active');
      root.style.removeProperty('--sex-bee-cursor');
    };
  }, []);

  return createPortal(
    <div ref={particles} className="pointer-events-none fixed inset-0 z-80 overflow-hidden" aria-hidden="true" />,
    document.body,
  );
}
