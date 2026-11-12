// The loading state of a 3D preview: the news computer from the game's hideout, whose case fan is a
// spinning pentagram. The computer is a render of Valve's model, baked into still layers (see
// docs/viewer-backgrounds.md); the fan and the marks on the screen are drawn here, on the planes the
// bake measured. Only they move, by transform and opacity alone, which the compositor runs without the
// main thread: they keep going while a model parses or its shaders link. Styles are under
// `.preview-loader` in index.css.

const LAYERS = {
  /** The computer, without its fan. */
  back: new URL('../../assets/preview-loader/news-computer-back.webp', import.meta.url).href,
  /** The parts of it nearer than the fan (the window's frame), drawn over the fan. */
  front: new URL('../../assets/preview-loader/news-computer-front.webp', import.meta.url).href,
  /** What it emits, blurred: the chamber, the screen and the candle. */
  glow: new URL('../../assets/preview-loader/news-computer-glow.webp', import.meta.url).href,
};

// Where the fan and the screen sit in the render, as fractions of its box, and the 2D matrix that lays
// a flat element on each one's plane. From the bake; they change only with the render.
const FAN = { left: 0.3248, top: 0.3241, width: 0.1245, matrix: [0.964, 0.0401, 0.0669, 0.9978] };
const SCREEN = { left: 0.5285, top: 0.4314, width: 0.1567, aspect: 1.232, matrix: [0.9983, 0.0589, -0.0283, 0.9977] };

/** The fan's drawing reaches 1.16 times the pentagram's tips (its stroke and the miter of its points). */
const FAN_VIEW = 1.16;
const PENTAGRAM = 'M0-1 .588.809-.951-.309H.951L-.588.809z';

const percent = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;
const matrix = ([a, b, c, d]: number[]) => `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`;

/** The fan alone: the spinner for a change inside a preview that is already showing. Colored by `currentColor`. */
export function FanSpinner({ className = '', label }: { className?: string; label?: string }) {
  return (
    <svg viewBox={`${-FAN_VIEW} ${-FAN_VIEW} ${2 * FAN_VIEW} ${2 * FAN_VIEW}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      className={`fan-spinner ${className}`}>
      <circle r="0.745" />
      <path d={PENTAGRAM} />
    </svg>
  );
}

/**
 * Fills its positioned parent with the loader. `progress` (0 to 1) fills the bar on the screen; without
 * it the screen shows a cursor. A box too small for the computer shows the fan alone. It fades in after
 * a moment, so a load that is over at once never flashes it.
 */
export function PreviewLoader({ progress, label, className = '' }: { progress?: number | null; label?: string; className?: string }) {
  const known = typeof progress === 'number';
  return (
    <div role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`preview-loader ${className}`}>
      <div className="preview-loader__pc">
        <img className="preview-loader__layer" src={LAYERS.back} alt="" draggable={false} />
        <img className="preview-loader__layer preview-loader__glow" src={LAYERS.glow} alt="" draggable={false} />
        <div className="preview-loader__seat"
          style={{ left: percent(FAN.left), top: percent(FAN.top), width: percent(FAN.width * FAN_VIEW), transform: matrix(FAN.matrix) }}>
          <FanSpinner className="preview-loader__fan" />
        </div>
        <img className="preview-loader__layer" src={LAYERS.front} alt="" draggable={false} />
        <div className="preview-loader__screen"
          style={{ left: percent(SCREEN.left), top: percent(SCREEN.top), width: percent(SCREEN.width), aspectRatio: SCREEN.aspect, transform: matrix(SCREEN.matrix) }}>
          {known
            ? <div className="preview-loader__bar"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} /></div>
            : <div className="preview-loader__cursor" />}
        </div>
      </div>
      <FanSpinner className="preview-loader__mini" />
    </div>
  );
}
