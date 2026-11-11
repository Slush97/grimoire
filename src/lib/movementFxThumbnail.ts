import { PARRY_PARTS, type MovementFxChoice, type MovementPalette } from './movementFx';

const thumbnails = new Map<string, Promise<string>>();

/** Small, bounded swatches also cover effects saved before thumbnails existed. */
export function movementFxThumbnail(choice: MovementFxChoice): Promise<string> {
  const key = JSON.stringify(choice);
  const cached = thumbnails.get(key);
  if (cached) {
    thumbnails.delete(key);
    thumbnails.set(key, cached);
    return cached;
  }
  const image = drawThumbnail(choice);
  thumbnails.set(key, image);
  while (thumbnails.size > 24) {
    const oldest = thumbnails.keys().next();
    if (!oldest.done) thumbnails.delete(oldest.value);
  }
  void image.catch(() => { if (thumbnails.get(key) === image) thumbnails.delete(key); });
  return image;
}

/** The game's own parry blue, drawn for a part that keeps its original colors. */
const ORIGINAL_PARRY = '#3684d8';

/** A parry's parts as drawn: null when every part follows the effect's color. */
function splitParts(choice: MovementFxChoice): { color: string; palette: MovementPalette }[] | null {
  const parts = choice.parts;
  if (choice.kind !== 'parry' || !parts || (parts.linked && PARRY_PARTS.every((part) => !parts[part].original))) return null;
  return PARRY_PARTS.map((part) => parts[part].original ? { color: ORIGINAL_PARRY, palette: { mode: 'solid' } }
    : parts.linked ? { color: choice.color, palette: choice.palette } : { color: parts[part].color, palette: parts[part].palette });
}

function colorAt(choice: { color: string; palette: MovementPalette }, t: number): string {
  if (choice.palette.mode === 'rainbow') return `hsl(${t * 300}, 90%, 65%)`;
  if (choice.palette.mode === 'solid') return choice.color;
  const from = choice.palette.end, to = choice.color;
  const channels = [1, 3, 5].map(i => Math.round(
    parseInt(from.slice(i, i + 2), 16) * (1 - t) + parseInt(to.slice(i, i + 2), 16) * t,
  ));
  return `rgb(${channels.join(',')})`;
}

async function drawThumbnail(choice: MovementFxChoice): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 288;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create an effect thumbnail.');
  ctx.fillStyle = 'rgb(20,20,23)'; ctx.fillRect(0, 0, 512, 288);
  const light = ctx.createRadialGradient(300, 120, 0, 280, 140, 300);
  light.addColorStop(0, 'rgb(43,43,48)'); light.addColorStop(1, 'rgb(20,20,23)');
  ctx.fillStyle = light; ctx.fillRect(0, 0, 512, 288);
  const point = (t: number) => choice.kind === 'dash'
    ? { x: 50 + t * 368, y: 190 - Math.sin(t * Math.PI * .78) * 100 }
    : choice.kind === 'parry'
      // A closed ring around the shield
      ? { x: 256 + Math.cos(-Math.PI / 2 + t * Math.PI * 2) * 104, y: 133 + Math.sin(-Math.PI / 2 + t * Math.PI * 2) * 92 }
      : { x: 256 + Math.cos(2.6 + t * 4.4) * 128, y: 133 + Math.sin(2.6 + t * 4.4) * 82 };
  const parts = splitParts(choice);
  // A split parry's ring is its shield's colors
  const ring = parts?.[0] ?? choice;
  ctx.lineCap = 'round';
  for (let i = 1; i <= 100; i++) {
    const t = i / 100, a = point((i - 1) / 100), b = point(t);
    ctx.globalAlpha = (.15 + t * .7) * Math.min(1, choice.brightness);
    ctx.strokeStyle = colorAt(ring, t);
    ctx.lineWidth = (choice.image ? 9 : 26) * (.15 + t * .85);
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = choice.illuminated ? 20 : 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (choice.kind === 'heavy-melee' || (choice.kind === 'parry' && !choice.image)) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = '116px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = ring.color; ctx.shadowBlur = 24;
    ctx.fillText(choice.kind === 'parry' ? '🛡️' : '👊', 256, 137);
    ctx.restore();
  }
  if (choice.image) {
    const image = new Image(); image.src = choice.image;
    await image.decode();
    // The parry shows its shield once, in the ring; a dash trail repeats its stamp along the path
    const stamps = choice.kind === 'parry' ? [{ t: 1, p: { x: 256, y: 133 }, size: 120 }]
      : [0, 1, 2, 3, 4].map((i) => { const t = .15 + i * .2; return { t, p: point(t), size: 30 + t * 76 }; });
    for (const { t, p, size } of stamps) {
      // Keep the source image legible. The trajectory and strip identify its palette.
      ctx.globalAlpha = .2 + t * .8;
      if (choice.outline) {
        ctx.shadowColor = choice.outlineColor; ctx.shadowBlur = 2;
        for (const [x, y] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
          ctx.shadowOffsetX = x; ctx.shadowOffsetY = y;
          ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
        }
      }
      ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      ctx.shadowColor = colorAt(ring, t); ctx.shadowBlur = choice.illuminated ? 22 : 0;
      ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
    }
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  if (parts) {
    // One dot per part: shield, catch, stun
    parts.forEach((part, index) => {
      const x = 216 + index * 40;
      const dot = ctx.createLinearGradient(x - 12, 0, x + 12, 0);
      for (let i = 0; i <= 6; i++) dot.addColorStop(i / 6, colorAt(part, i / 6));
      ctx.fillStyle = dot; ctx.beginPath(); ctx.arc(x, 252, 12, 0, Math.PI * 2); ctx.fill();
    });
  } else {
    const palette = ctx.createLinearGradient(48, 0, 464, 0);
    for (let i = 0; i <= 12; i++) palette.addColorStop(i / 12, colorAt(choice, i / 12));
    ctx.fillStyle = palette; ctx.beginPath(); ctx.roundRect(48, 249, 416, 7, 3.5); ctx.fill();
  }
  return canvas.toDataURL('image/png');
}
