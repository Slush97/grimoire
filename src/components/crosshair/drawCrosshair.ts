// Single canvas renderer for the crosshair: the live preview, the preset
// gallery tiles, and saved thumbnails all draw through here, so they can
// never drift apart (the old DOM preview and SVG thumbnail disagreed on dot
// size and outline z-order).
//
// Geometry comes from computeCrosshairLayout in src/lib/crosshair.ts, which
// reproduces the game's rasterization: sizes composed in 1080p layout units,
// snapped once to whole device px at `scale` (display height / 1080), centres
// unsnapped. Drawing on that grid is what keeps a 1px pip one crisp pixel at
// 1440p instead of two antialiased ones; see docs/crosshair-geometry.md.

import type { CrosshairSettings } from '../../types/electron';
import {
    computeCrosshairLayout,
    normalizeCrosshairSettings,
    type CrosshairRect,
} from '../../lib/crosshair';

export interface DrawCrosshairOptions {
    /** Canvas logical (CSS) size in px; the crosshair is centered in it. */
    size: number;
    /** 1080p-layout-px to display-px multiplier (resolution / 1080). This is
     *  the device grid the crosshair is snapped to. */
    scale: number;
    /** CSS px one snapped device px occupies (default 1). Applied AFTER
     *  snapping, so magnifying shows the same whole device pixels bigger
     *  instead of re-rasterizing finer. The stage also uses this to draw a
     *  coarser grid's pixels physically fatter (1080p) or finer (4K). */
    zoom?: number;
    /** Background fill; null/undefined leaves the canvas transparent. */
    background?: string | null;
}

export function drawCrosshair(
    ctx: CanvasRenderingContext2D,
    raw: Partial<CrosshairSettings>,
    opts: DrawCrosshairOptions
): void {
    const s = normalizeCrosshairSettings(raw);
    const { size, scale } = opts;
    const zoom = opts.zoom ?? 1;

    ctx.clearRect(0, 0, size, size);
    if (opts.background) {
        ctx.fillStyle = opts.background;
        ctx.fillRect(0, 0, size, size);
    }

    const cx = size / 2;
    const cy = size / 2;
    const layout = computeCrosshairLayout(s, scale);

    // Device px -> canvas px; snapping already happened in device space.
    const rect = (r: CrosshairRect) =>
        [cx + r.x * zoom, cy + r.y * zoom, r.w * zoom, r.h * zoom] as const;

    // Opacity is a panel property in the game (SetOpacity); multiplying it
    // into the fill colour is equivalent for these flat draws.
    const fillColor = `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, ${s.pipOpacity})`;
    const dotColor = `rgba(${s.colorR}, ${s.colorG}, ${s.colorB}, ${s.dotOpacity})`;
    const outlineColor = (opacity: number) =>
        `rgba(${s.outlineColorR}, ${s.outlineColorG}, ${s.outlineColorB}, ${opacity})`;

    // 1. Pip outlines: the outer box with a punched-out hole, because the
    //    game's border paints inward from the outer box edge.
    if (layout.pipOutlineBorder > 0 && s.pipOutlineOpacity > 0) {
        ctx.fillStyle = outlineColor(s.pipOutlineOpacity);
        const b = layout.pipOutlineBorder * zoom;
        for (const o of layout.pipOutlines) {
            const [x, y, w, h] = rect(o);
            ctx.beginPath();
            ctx.rect(x, y, w, h);
            if (w > 2 * b && h > 2 * b) ctx.rect(x + b, y + b, w - 2 * b, h - 2 * b);
            ctx.fill('evenodd');
        }
    }

    // 2. Dot outline: an annulus, border likewise inward from the outer circle
    if (layout.dotOutlineBorder > 0 && s.dotOutlineOpacity > 0 && layout.dotOutlineSize > 0) {
        const outer = layout.dotOutlineSize / 2;
        const inner = Math.max(0, outer - layout.dotOutlineBorder);
        ctx.fillStyle = outlineColor(s.dotOutlineOpacity);
        ctx.beginPath();
        ctx.arc(cx, cy, outer * zoom, 0, Math.PI * 2);
        if (inner > 0) ctx.arc(cx, cy, inner * zoom, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
    }

    // 3. Pips
    if (s.pipOpacity > 0) {
        ctx.fillStyle = fillColor;
        for (const p of layout.pips) {
            ctx.fillRect(...rect(p));
        }
    }

    // 4. Center dot (top layer)
    if (s.dotOpacity > 0 && layout.dotSize > 0) {
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(cx, cy, (layout.dotSize / 2) * zoom, 0, Math.PI * 2);
        ctx.fill();
    }
}

/** Render a preset thumbnail PNG (data URL) with the same renderer the live
 *  preview uses. 1.333 scale = 1440p, the gallery's reference look. */
export function renderCrosshairThumbnail(
    settings: Partial<CrosshairSettings>,
    size = 100,
    scale = 1440 / 1080
): string {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    drawCrosshair(ctx, settings, { size, scale, background: '#555' });
    return canvas.toDataURL('image/png');
}
