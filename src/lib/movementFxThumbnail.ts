import type { MovementFxChoice } from './movementFx';

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

function colorAt(choice: MovementFxChoice, t: number): string {
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
    : { x: 256 + Math.cos(2.6 + t * 4.4) * 128, y: 133 + Math.sin(2.6 + t * 4.4) * 82 };
  ctx.lineCap = 'round';
  for (let i = 1; i <= 100; i++) {
    const t = i / 100, a = point((i - 1) / 100), b = point(t);
    ctx.globalAlpha = (.15 + t * .7) * Math.min(1, choice.brightness);
    ctx.strokeStyle = colorAt(choice, t);
    ctx.lineWidth = (choice.image ? 9 : 26) * (.15 + t * .85);
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = choice.illuminated ? 20 : 5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  if (choice.kind === 'heavy-melee') {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = '116px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = choice.color; ctx.shadowBlur = 24;
    ctx.fillText('👊', 256, 137);
    ctx.restore();
  }
  if (choice.image) {
    const image = new Image(); image.src = choice.image;
    await image.decode();
    for (let i = 0; i < 5; i++) {
      const t = .15 + i * .2, p = point(t), size = 30 + t * 76;
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
      ctx.shadowColor = colorAt(choice, t); ctx.shadowBlur = choice.illuminated ? 22 : 0;
      ctx.drawImage(image, p.x - size / 2, p.y - size / 2, size, size);
    }
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  const palette = ctx.createLinearGradient(48, 0, 464, 0);
  for (let i = 0; i <= 12; i++) palette.addColorStop(i / 12, colorAt(choice, i / 12));
  ctx.fillStyle = palette; ctx.beginPath(); ctx.roundRect(48, 249, 416, 7, 3.5); ctx.fill();
  return canvas.toDataURL('image/png');
}
