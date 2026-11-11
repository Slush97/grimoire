/**
 * Tier-1 dynamic-expression evaluator for scalar material params (NPR plan A4).
 *
 * vpkmerge decompiles a material's dynamic-expression bytecode to readable source
 * (e.g. inferno body's `g_flSelfIllumScale1 = "0.5 * sin(3 * time()) + 0.5"`); this
 * compiles that source into a per-frame `(t) => number` so the preview can drive a
 * uniform instead of freezing it to the static fallback (10, in inferno's case).
 *
 * Scope is deliberately Tier 1 only: float literals, `time()` (the elapsed seconds,
 * also accepted bare as `time`), the math builtins
 * (sin/cos/frac/abs/floor/saturate, min/max, clamp, smoothstep), `+ - * /`, unary
 * minus, and parentheses. A `$attribute` read resolves only through the table the
 * caller passes: the engine sets those per entity, so a caller has to say what the
 * previewed entity would report. Anything else - an attribute outside the table,
 * vector constructors (`float2/3/4`), comparisons, ternaries - returns null so the
 * caller falls back to the static value. No `eval()`; a tiny recursive-descent parser.
 */

type Fn = (t: number) => number;

const BUILTINS1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  abs: Math.abs,
  floor: Math.floor,
  frac: (x) => x - Math.floor(x),
  saturate: (x) => Math.max(0, Math.min(1, x)),
};

/** Builtins with a fixed argument count above one, in the engine's argument order. */
const BUILTINS_N: Record<string, { arity: number; fn: (...args: number[]) => number }> = {
  min: { arity: 2, fn: Math.min },
  max: { arity: 2, fn: Math.max },
  clamp: { arity: 3, fn: (x, lo, hi) => Math.max(lo, Math.min(hi, x)) },
  smoothstep: {
    arity: 3,
    fn: (edge0, edge1, x) => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    },
  },
};

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if ('+-*/(),'.includes(c)) {
      out.push(c);
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push(src.slice(i, j));
      i = j;
    } else if (/[a-zA-Z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      out.push(src.slice(i, j));
      i = j;
    } else {
      throw new Error(`bad char ${c}`);
    }
  }
  return out;
}

/** Compile a Tier-1 scalar source string into `(t) => number`, or null if it uses
 *  anything outside the supported grammar. `attributes` maps `$name` reads to the
 *  value the previewed entity reports; a read outside it is unsupported. */
export function compileScalarExpr(source: string, attributes?: Readonly<Record<string, number>>): Fn | null {
  let toks: string[];
  try {
    toks = tokenize(source);
  } catch {
    return null;
  }
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];
  const expect = (s: string) => {
    if (eat() !== s) throw new Error(`expected ${s}`);
  };

  function parseExpr(): Fn {
    let left = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = eat();
      const r = parseTerm();
      const l = left;
      left = op === '+' ? (t) => l(t) + r(t) : (t) => l(t) - r(t);
    }
    return left;
  }
  function parseTerm(): Fn {
    let left = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = eat();
      const r = parseUnary();
      const l = left;
      left = op === '*' ? (t) => l(t) * r(t) : (t) => l(t) / r(t);
    }
    return left;
  }
  function parseUnary(): Fn {
    if (peek() === '-') {
      eat();
      const u = parseUnary();
      return (t) => -u(t);
    }
    if (peek() === '+') {
      eat();
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): Fn {
    const tok = peek();
    if (tok === undefined) throw new Error('unexpected end');
    if (tok === '(') {
      eat();
      const e = parseExpr();
      expect(')');
      return e;
    }
    if (/^[0-9.]/.test(tok)) {
      eat();
      const n = Number(tok);
      if (!Number.isFinite(n)) throw new Error(`bad number ${tok}`);
      return () => n;
    }
    if (tok.startsWith('$')) {
      eat();
      const value = attributes && Object.hasOwn(attributes, tok) ? attributes[tok] : undefined;
      if (value === undefined) throw new Error(`unsupported attribute ${tok}`);
      return () => value;
    }
    if (/^[a-zA-Z_]/.test(tok)) {
      eat();
      if (tok === 'time') {
        if (peek() === '(') {
          eat();
          expect(')');
        }
        return (t) => t;
      }
      const fn1 = BUILTINS1[tok];
      if (fn1 && peek() === '(') {
        eat();
        const arg = parseExpr();
        expect(')');
        return (t) => fn1(arg(t));
      }
      const fnN = BUILTINS_N[tok];
      if (fnN && peek() === '(') {
        eat();
        const args = [parseExpr()];
        while (peek() === ',') {
          eat();
          args.push(parseExpr());
        }
        expect(')');
        if (args.length !== fnN.arity) throw new Error(`${tok} takes ${fnN.arity} arguments`);
        return (t) => fnN.fn(...args.map((arg) => arg(t)));
      }
      throw new Error(`unsupported identifier ${tok}`);
    }
    throw new Error(`unexpected token ${tok}`);
  }

  try {
    const fn = parseExpr();
    if (pos !== toks.length) throw new Error('trailing tokens');
    if (!Number.isFinite(fn(0))) return null;
    return fn;
  } catch {
    return null;
  }
}

/** Max of `fn` sampled over [0, span] seconds - used to gate "is this glow ever
 *  bright enough to enable" on a pulsing scale. */
export function peakScalar(fn: Fn, span = 12, steps = 240): number {
  let peak = fn(0);
  for (let i = 1; i <= steps; i++) {
    const v = fn((i / steps) * span);
    if (v > peak) peak = v;
  }
  return peak;
}
