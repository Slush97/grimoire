import { useState } from 'react';
import { FAN, LAYERS, MUG, SCREEN, nextScreenProgram, type ScreenProgram } from './previewLoaderArt';

// The loading state of a 3D preview: the news computer from the game's hideout, whose case fan is a
// spinning pentagram, with a mug of cocoa beside it. The scene is a render of Valve's models, baked into
// still layers (see docs/viewer-backgrounds.md). What moves is drawn or placed here, on the planes the
// bake measured: the fan, the marks on the screen, the planchette, the steam and the screen's light.
// All of it moves by transform and opacity alone, which the compositor runs without the main thread:
// it keeps going while a model parses or its shaders link. Nothing is timed from script, for the same
// reason. Styles are under `.preview-loader` in index.css.

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

function Screen({ program, progress }: { program: ScreenProgram; progress: number }) {
  if (program === 'bar') return <div className="preview-loader__bar"><span style={{ transform: `scaleX(${progress})` }} /></div>;
  if (program === 'type') return <div className="preview-loader__type"><i /><i /><i /></div>;
  if (program === 'eye') return <div className="preview-loader__eye"><i /></div>;
  return <div className="preview-loader__pong"><i /><i /><b><em /></b></div>;
}

/**
 * Fills its positioned parent with the loader. `progress` (0 to 1) fills the line under the scene and
 * a bar on the screen; without it the line sweeps and the screen runs one of its programs (`program`
 * picks which, for the lab). A box too small for the scene shows the fan alone. It fades in after a
 * moment, so a load that is over at once never flashes it.
 */
export function PreviewLoader({ progress, label, program, className = '' }: {
  progress?: number | null; label?: string; program?: ScreenProgram; className?: string;
}) {
  const known = typeof progress === 'number';
  const amount = known ? Math.min(1, Math.max(0, progress)) : 0;
  const [idle] = useState(nextScreenProgram);
  return (
    <div role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`preview-loader ${className}`}>
      <div className="preview-loader__pc">
        <img className="preview-loader__layer" src={LAYERS.back} alt="" draggable={false} />
        <img className="preview-loader__layer preview-loader__screenlight" src={LAYERS.screenLight} alt="" draggable={false} />
        <img className="preview-loader__layer preview-loader__planchette" src={LAYERS.planchette} alt="" draggable={false} />
        <img className="preview-loader__layer preview-loader__glow" src={LAYERS.glow} alt="" draggable={false} />
        <div className="preview-loader__seat"
          style={{ left: percent(FAN.left), top: percent(FAN.top), width: percent(FAN.width * FAN_VIEW), transform: matrix(FAN.matrix) }}>
          <FanSpinner className="preview-loader__fan" />
        </div>
        <img className="preview-loader__layer" src={LAYERS.front} alt="" draggable={false} />
        <div className="preview-loader__rays" style={{ left: percent(SCREEN.left), top: percent(SCREEN.top) }} />
        <div className="preview-loader__screen"
          style={{ left: percent(SCREEN.left), top: percent(SCREEN.top), width: percent(SCREEN.width), aspectRatio: SCREEN.aspect, transform: matrix(SCREEN.matrix) }}>
          <Screen program={program ?? (known ? 'bar' : idle)} progress={amount} />
        </div>
        <div className="preview-loader__steam" style={{ left: percent(MUG.left), top: percent(MUG.top) }}><i /><i /><i /></div>
      </div>
      <div className={`preview-loader__status ${known ? '' : 'preview-loader__status--sweep'}`}>
        <span style={known ? { transform: `scaleX(${amount})` } : undefined} />
      </div>
      <FanSpinner className="preview-loader__mini" />
    </div>
  );
}
