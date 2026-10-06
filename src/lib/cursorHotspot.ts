import type { CursorHotspot } from '../types/electron';

interface Point {
  x: number;
  y: number;
}

const ALPHA_MIN = 128;
// No hull corner sharper than this means round art (a paw, a blob): aim with its middle.
const BLUNT_DEG = 130;
// Penalty for a corner at the far bottom-right against one at the top-left.
// Pointers aim up-left, and a sharp corner elsewhere is usually a tail cut off
// by the image edge (a paw's arm) or an accessory (the ping bubble), so this
// outweighs sharpness: it only decides between corners near the top-left.
const TOP_LEFT_BIAS_DEG = 180;

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (pts: Point[]) => {
    const out: Point[] = [];
    for (const p of pts) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** The point `dist` along the hull outline from vertex `i`, walking in `dir`. */
function alongHull(hull: Point[], i: number, dir: 1 | -1, dist: number): Point {
  let cur = hull[i];
  let j = i;
  let left = dist;
  for (let step = 0; step < hull.length; step++) {
    j = (j + dir + hull.length) % hull.length;
    const next = hull[j];
    const len = Math.hypot(next.x - cur.x, next.y - cur.y);
    if (len >= left) return { x: cur.x + ((next.x - cur.x) * left) / len, y: cur.y + ((next.y - cur.y) * left) / len };
    left -= len;
    cur = next;
  }
  return cur;
}

/**
 * Guess where a cursor image clicks: the sharpest corner of its outline,
 * leaning top-left like the stock pointers, or the middle of a reticle
 * (crosshair, ring) or of art with no corner at all. Corners are
 * measured over a stretch of outline rather than per pixel, so a rounded
 * fingertip still reads as a tip. Art with no transparency gets the stock 0, 0.
 */
export function detectCursorHotspot(width: number, height: number, rgba: ArrayLike<number>): CursorHotspot {
  const mask = new Uint8Array(width * height);
  const edges: Point[] = [];
  let opaque = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < ALPHA_MIN) continue;
      mask[y * width + x] = 1;
      opaque++;
      if (left < 0) left = x;
      right = x;
    }
    if (left < 0) continue;
    edges.push({ x: left, y }, { x: right, y });
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, y);
    maxY = y;
  }
  if (opaque === 0 || opaque === width * height) return { x: 0, y: 0 };

  // Reticles look the same turned a quarter. A half turn is not enough: a
  // straight wand or sword survives that too.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const center = { x: Math.round(cx), y: Math.round(cy) };
  let symmetric = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!mask[y * width + x]) continue;
      const rx = Math.round(cx - (y - cy));
      const ry = Math.round(cy + (x - cx));
      if (rx >= 0 && rx < width && ry >= 0 && ry < height && mask[ry * width + rx]) symmetric++;
    }
  }
  if (symmetric / opaque >= 0.85) return center;

  const hull = convexHull(edges);
  if (hull.length < 3) return center;
  const reach = Math.max(2, 0.15 * Math.max(maxX - minX, maxY - minY));
  const span = maxX - minX + (maxY - minY) || 1;
  let best = center;
  let bestScore = Infinity;
  let sharpest = 180;
  for (let i = 0; i < hull.length; i++) {
    const v = hull[i];
    const a = alongHull(hull, i, -1, reach);
    const b = alongHull(hull, i, 1, reach);
    const cos =
      ((a.x - v.x) * (b.x - v.x) + (a.y - v.y) * (b.y - v.y)) /
      (Math.hypot(a.x - v.x, a.y - v.y) * Math.hypot(b.x - v.x, b.y - v.y));
    const angle = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    sharpest = Math.min(sharpest, angle);
    const score = angle + (TOP_LEFT_BIAS_DEG * (v.x - minX + (v.y - minY))) / span;
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return sharpest <= BLUNT_DEG ? best : center;
}
