import { useState, type CSSProperties, type ReactNode } from 'react';
import { getHeroChipIconPath } from '../../lib/lockerUtils';
import { BOOK, FAN, GLYPH_CELL, GLYPH_ROWS, KEY_BOXES, LAYERS, LOGO, MUG, PAGE_TOPS, SCREEN, glyphPath, nextPhrase, nextScreenProgram, typingOf, type ScreenProgram, type Typing } from './previewLoaderArt';

// The loading state of a 3D preview: the news computer from the game's hideout, whose case fan is a
// spinning pentagram, with a mug of cocoa beside it. The scene is a render of Valve's models, baked into
// still layers (see docs/viewer-backgrounds.md). What moves is drawn or placed here, on the planes the
// bake measured: the fan, the marks on the screen, the keys, the planchette, the steam and the screen's
// light. All of it moves by transform and opacity alone, which the compositor runs without the main
// thread: it keeps going while a model parses or its shaders link. Nothing is timed from script, for
// the same reason. Styles are under `.preview-loader` in index.css. The scene and what its screen shows
// are exported for the computer as a toy (LoaderToy.tsx), which is no loader and does run on script.

/** The fan's drawing reaches 1.16 times the pentagram's tips (its stroke and the miter of its points). */
const FAN_VIEW = 1.16;
const PENTAGRAM = 'M0-1 .588.809-.951-.309H.951L-.588.809z';
/** The steam's ribbon: three turns of one wave, so that sliding it up by a turn loops without a seam. */
const STEAM = 'M10 0C17 10 3 20 10 30S17 50 10 60 3 80 10 90 17 110 10 120 3 140 10 150 17 170 10 180';

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

const logoPart = (d: string) => (
  <svg key={d.slice(0, 24)} viewBox={LOGO.view}><g transform={LOGO.frame}><path d={d} /></g></svg>
);

/** The Grimoire logo as one loop (see BOOK): its leaves riffle from the right page to the left, then the
 *  whirlwind rises out of the book, spins and dies away. */
export function Book() {
  return (
    <div className="preview-loader__book">
      <style>{BOOK.css}</style>
      {logoPart(LOGO.book)}
      <svg className="preview-loader__page-tops" viewBox={LOGO.view} style={{ animation: BOOK.pageTops }}><path d={PAGE_TOPS} /></svg>
      {BOOK.leaves.map((animation, leaf) => <span key={leaf} style={BOOK.leafBox}><b style={{ animation }} /></span>)}
      <div className="preview-loader__whirl" style={{ animation: BOOK.whirl }}>{LOGO.whirl.map(logoPart)}</div>
    </div>
  );
}

/** How many strips the face is cut into, each one jolting sideways a moment after the one above. */
const FACE_STRIPS = 8;

/** The hero's face as a tube would pull it in: a ripple runs down it now and then, under static. */
export function Face({ src, onNoFace }: { src: string; onNoFace?: () => void }) {
  return (
    <>
      <div className="preview-loader__face">
        {Array.from({ length: FACE_STRIPS }, (_, strip) => (
          <img key={strip} src={src} alt="" draggable={false} onError={strip === 0 ? onNoFace : undefined}
            style={{ clipPath: `inset(${(strip * 100 / FACE_STRIPS).toFixed(2)}% 0 ${(100 - (strip + 1) * 100 / FACE_STRIPS).toFixed(2)}% 0)`, animationDelay: `${(strip * 0.09 - 2).toFixed(2)}s` }} />
        ))}
      </div>
      <div className="preview-loader__static"><i /></div>
    </>
  );
}

/** `text` in the screen's dots, in a box of `cells` characters. */
export function Glyphs({ text, cells = text.length }: { text: string; cells?: number }) {
  return <svg viewBox={`0 0 ${cells * GLYPH_CELL} ${GLYPH_ROWS}`}><path d={glyphPath(text)} /></svg>;
}

/** The phrase the keyboard is typing, as a terminal would show it: a prompt, the text a character at a
 *  time in dots, and a cursor that keeps its place after the last one. */
export function Typed({ typing }: { typing: Typing }) {
  return (
    <>
      <div className="preview-loader__type">
        {typing.lines.map((line, row) => (
          <div key={row}>
            <Glyphs text={row === 0 ? '>' : ''} cells={2} />
            <span style={{ animation: typing.line(row) }}>
              <span><em style={{ animation: typing.lineInner(row) }}><Glyphs text={line} /></em></span>
              <i style={{ animation: typing.cursor(row) }}><b /></i>
            </span>
          </div>
        ))}
      </div>
      <div className="preview-loader__static"><i /></div>
    </>
  );
}

function Screen({ program, hero, typing, onNoFace }: { program: ScreenProgram; hero?: string; typing: Typing; onNoFace: () => void }) {
  if (program === 'type') return <Typed typing={typing} />;
  if (program === 'hero' && hero) return <Face src={getHeroChipIconPath(hero)} onNoFace={onNoFace} />;
  return <Book />;
}

/** Every key, each a window on the keys layer over its own cap, so that one can dip without the rest,
 *  and on the screen's light on the keys, so that a cap takes its light down with it. */
function Keys({ keyStyle }: { keyStyle?: (key: number) => CSSProperties | undefined }) {
  return (
    <div className="preview-loader__keys">
      {KEY_BOXES.map(([left, top, width, height], key) => (
        <i key={key} style={{ left: percent(left), top: percent(top), width: percent(width), height: percent(height), ...keyStyle?.(key) }}>
          {[LAYERS.keys, LAYERS.keyLight].map((src) => (
            <img key={src} src={src} alt="" draggable={false} className={src === LAYERS.keyLight ? 'preview-loader__keylight' : undefined}
              style={{ width: percent(1 / width), height: percent(1 / height), transform: `translate(${percent(-left)}, ${percent(-top)})` }} />
          ))}
        </i>
      ))}
    </div>
  );
}

/** The mug's steam: a ribbon rising from its opening. With a `className`, a puff of it. */
export function LoaderSteam({ className = '', onAnimationEnd }: { className?: string; onAnimationEnd?: () => void }) {
  return (
    <div className={className ? `preview-loader__steam ${className}` : 'preview-loader__steam'} style={{ left: percent(MUG.left), top: percent(MUG.top) }}
      onAnimationEnd={onAnimationEnd && ((event) => { if (event.target === event.currentTarget) onAnimationEnd(); })}>
      <svg viewBox="0 0 20 180" preserveAspectRatio="none"><path d={STEAM} /></svg>
    </div>
  );
}

/** The computer itself: its layers, with `screen` on its glass and each key styled by `keyStyle`. `children` are drawn over it. */
export function LoaderScene({ screen, keyStyle, children }: { screen: ReactNode; keyStyle?: (key: number) => CSSProperties | undefined; children?: ReactNode }) {
  return (
    <div className="preview-loader__pc">
      <img className="preview-loader__layer" src={LAYERS.back} alt="" draggable={false} />
      <img className="preview-loader__layer preview-loader__screenlight" src={LAYERS.screenLight} alt="" draggable={false} />
      {/* Over the screen's light, which was rendered without the caps and lights what is under them. */}
      <Keys keyStyle={keyStyle} />
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
        {screen}
      </div>
      <LoaderSteam />
      {children}
    </div>
  );
}

/**
 * Fills its positioned parent with the loader. `progress` (0 to 1) fills the line under the scene;
 * without it the line sweeps. The screen shows the face of `hero` when the load is a hero's and the
 * Grimoire's book when it is not, and every sixth loader types a phrase on it instead. The keyboard
 * types a phrase all the while. `program` and `phrase` pick those, for the lab. A box too small for the
 * scene shows the fan alone. It fades in after a moment, so a load that is over at once never flashes it.
 */
export function PreviewLoader({ progress, label, hero, program, phrase, className = '' }: {
  progress?: number | null; label?: string; hero?: string; program?: ScreenProgram; phrase?: number; className?: string;
}) {
  const known = typeof progress === 'number';
  const amount = known ? Math.min(1, Math.max(0, progress)) : 0;
  const [turn] = useState(() => nextScreenProgram(!!hero));
  const [ownPhrase] = useState(nextPhrase);
  const typing = typingOf(phrase ?? ownPhrase);
  // A hero without an icon (a new one) leaves the screen to the book.
  const [noFace, setNoFace] = useState(false);
  return (
    <div role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={`preview-loader ${className}`}>
      <style>{typing.css}</style>
      <LoaderScene keyStyle={(key) => { const animation = typing.key(key); return animation ? { animation } : undefined; }}
        screen={<Screen program={program ?? turn} hero={noFace ? undefined : hero} typing={typing} onNoFace={() => setNoFace(true)} />} />
      <div className={`preview-loader__status ${known ? '' : 'preview-loader__status--sweep'}`}>
        <span style={known ? { transform: `scaleX(${amount})` } : undefined} />
      </div>
      <FanSpinner className="preview-loader__mini" />
    </div>
  );
}
