// The art of the 3D previews' loader (PreviewLoader.tsx): its baked layers, where the moving parts sit
// in them, and what its screen can show. The layers are renders of Valve's models, see
// docs/viewer-backgrounds.md.

export const LAYERS = {
  /** The computer and the mug, without the fan and the planchette. */
  back: new URL('../../assets/preview-loader/news-computer-back.webp', import.meta.url).href,
  /** What the screen alone lights, to flicker over the scene. */
  screenLight: new URL('../../assets/preview-loader/news-computer-screenlight.webp', import.meta.url).href,
  /** The planchette, the computer's mouse, which wanders once a load runs long. */
  planchette: new URL('../../assets/preview-loader/news-computer-planchette.webp', import.meta.url).href,
  /** What the scene emits, blurred: the chamber, the screen and the candle. */
  glow: new URL('../../assets/preview-loader/news-computer-glow.webp', import.meta.url).href,
  /** The parts nearer than the fan (the window's frame), drawn over the fan. */
  front: new URL('../../assets/preview-loader/news-computer-front.webp', import.meta.url).href,
};

// Where things sit in the render, as fractions of its box, and the 2D matrix that lays a flat element
// on a plane of the scene. From the bake; they change only with the render.
export const FAN = { left: 0.3248, top: 0.324, width: 0.1245, matrix: [0.964, 0.0401, 0.0669, 0.9978] };
export const SCREEN = { left: 0.5285, top: 0.4313, width: 0.1567, aspect: 1.232, matrix: [0.9983, 0.0589, -0.0283, 0.9977] };
/** The middle of the mug's opening, where its steam rises from. */
export const MUG = { left: 0.176, top: 0.672 };

/** What the screen shows while a load reports no position. Each loader takes the next one. */
export const SCREEN_PROGRAMS = ['type', 'eye', 'pong'] as const;
export type ScreenProgram = typeof SCREEN_PROGRAMS[number] | 'bar';
let shown = 0;
export const nextScreenProgram = (): ScreenProgram => SCREEN_PROGRAMS[shown++ % SCREEN_PROGRAMS.length];

let preloaded: HTMLImageElement[] | null = null;
/** Fetches and decodes the loader's layers ahead of the first preview, and keeps them. */
export function preloadPreviewLoader(): void {
  if (preloaded || typeof Image === 'undefined') return;
  preloaded = Object.values(LAYERS).map((src) => {
    const image = new Image();
    image.src = src;
    void image.decode?.().catch(() => {});
    return image;
  });
}
