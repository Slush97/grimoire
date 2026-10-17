import { useEffect, useRef } from 'react';
import type { TrippySpriteResult } from '../../types/mod';

interface TrippySpriteSwatchProps {
  /** The sprite strip to play, or null while it loads (renders a pulse). */
  sprite: TrippySpriteResult | null;
  /** Playback speed. The strip already encodes the scroll speed in how far the
   *  pattern advances per frame, so a constant fps keeps loop speeds honest
   *  relative to each other. */
  fps?: number;
  className?: string;
}

/**
 * Plays a trippy preview sprite (PNG strip of frames, left to right) as a
 * looping flipbook on a canvas. The strip comes from `vpkmerge trippy-preview`
 * via previewTrippySprite; one canvas + source-offset draws keeps the loop
 * allocation-free, instead of swapping N <img> elements.
 */
export default function TrippySpriteSwatch({
  sprite,
  fps = 12,
  className = '',
}: TrippySpriteSwatchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprite) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = sprite.size;
    canvas.height = sprite.size;

    const img = new Image();
    let raf = 0;
    let start: number | null = null;
    let cancelled = false;
    let lastFrame = -1;

    const draw = (now: number) => {
      if (cancelled) return;
      if (start === null) start = now;
      const frame = Math.floor(((now - start) / 1000) * fps) % sprite.frames;
      if (frame !== lastFrame) {
        lastFrame = frame;
        ctx.drawImage(
          img,
          frame * sprite.size,
          0,
          sprite.size,
          sprite.size,
          0,
          0,
          sprite.size,
          sprite.size,
        );
      }
      raf = requestAnimationFrame(draw);
    };

    img.onload = () => {
      if (!cancelled) raf = requestAnimationFrame(draw);
    };
    img.src = sprite.dataUrl;

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [sprite, fps]);

  if (!sprite) {
    return <div className={`skeleton ${className}`} aria-hidden />;
  }
  return <canvas ref={canvasRef} className={className} />;
}
