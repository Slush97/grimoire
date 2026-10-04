// User-requested Valve promotional artwork, bundled for offline previews.
// Source and ownership are documented in docs/viewer-backgrounds.md.
export const VIEWER_BACKGROUNDS = {
  broadway: new URL('../assets/viewer/broadway_01.jpg', import.meta.url).href,
  uptown: new URL('../assets/viewer/uptown_01.jpg', import.meta.url).href,
  timesSquare: new URL('../assets/viewer/times_square_05.jpg', import.meta.url).href,
};
export type ViewerBackground = keyof typeof VIEWER_BACKGROUNDS | 'none' | 'custom';
