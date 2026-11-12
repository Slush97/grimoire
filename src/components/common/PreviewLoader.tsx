// The loading state of a 3D preview: a desk computer whose case fan is a spinning pentagram, after
// the one in the game's hideout. Styles are under `.preview-loader` in index.css. The fan and the
// screen's bar are elements of their own that only animate transform and opacity, which the
// compositor runs without the main thread: they keep moving while a model parses or its shaders link.

const PENTAGRAM = 'M0-14 8.23 11.33-13.31-4.33H13.31L-8.23 11.33z';

/** The fan alone: the spinner for a change inside a preview that is already showing. Colored by `currentColor`. */
export function FanSpinner({ className = '', label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="-16 -16 32 32" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}
      className={`fan-spinner ${className}`}>
      <circle r="14" />
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
        <svg className="preview-loader__art" viewBox="-3 0 160 138" aria-hidden>
          {/* Candle */}
          <path className="preview-loader__flame" d="M44 3.5c2 2.4 3 4 3 5.6a3 3 0 0 1-6 0c0-1.6 1-3.2 3-5.6z" />
          <path className="preview-loader__case" d="M42 12h4v10h-4z" />
          <path className="preview-loader__line" d="M38 22h12" />
          {/* Case: pediment, cornice, body, plinth */}
          <path className="preview-loader__case" d="M14 34c9 0 11-11 30-11s21 11 30 11z" />
          <path className="preview-loader__case" d="M10 34h68v5H10z" />
          <path className="preview-loader__case" d="M13 39h62v77H13z" />
          <path className="preview-loader__case" d="M10 116h68v5H10z" />
          {/* Door */}
          <path className="preview-loader__line" d="M18 45h7v65h-7z" />
          <circle className="preview-loader__dot" cx="21.5" cy="80" r="1.4" />
          {/* Fan window */}
          <path className="preview-loader__glow" d="M29 110V62a17 17 0 0 1 34 0v48z" />
          <path className="preview-loader__line" d="M29 86h34M29 98h34" />
          {/* Monitor */}
          <path className="preview-loader__case" d="M74 119l3-6h62l3 6z" />
          <rect className="preview-loader__case" x="72" y="56" width="72" height="58" rx="7" />
          <rect className="preview-loader__glow" x="80" y="62" width="52" height="32" rx="6" />
          <path className="preview-loader__line" d="M82 101h30M82 104.5h30M82 108h30" />
          <circle className="preview-loader__dot" cx="121" cy="104.5" r="2.2" />
          <circle className="preview-loader__dot" cx="129" cy="104.5" r="2.2" />
          <circle className="preview-loader__dot" cx="137" cy="104.5" r="2.2" />
          <path className="preview-loader__line" d="M136 66v24M139 66v24" />
          {/* Keyboard */}
          <path className="preview-loader__case" d="M82 125h56l6 10H76z" />
          <path className="preview-loader__keys" d="M84 128.5h52M82 131.5h56" />
        </svg>
        <FanSpinner className="preview-loader__fan" />
        <div className="preview-loader__screen">
          {known
            ? <div className="preview-loader__bar"><span style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }} /></div>
            : <div className="preview-loader__cursor" />}
        </div>
      </div>
      <FanSpinner className="preview-loader__mini" />
    </div>
  );
}
