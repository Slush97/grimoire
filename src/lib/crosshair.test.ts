import { describe, expect, it } from 'vitest';
import { computeCrosshairLayout } from './crosshair';

// Every expected value below comes from docs/crosshair-geometry.md, which was
// measured against the shipped game (1440p screenshots + client.dll). If one
// of these fails after an edit, the preview no longer matches the game.

const SCALE_1440 = 1440 / 1080;

describe('computeCrosshairLayout', () => {
    it('keeps a 1px pip exactly one device pixel at 1440p', () => {
        const layout = computeCrosshairLayout({ pipWidth: 1, pipHeight: 6 }, SCALE_1440);
        expect(layout.pips[0].w).toBe(1);
    });

    it('composes sizes in layout units and snaps once (3px outline box -> 4 device px)', () => {
        // Snapping the parts first would give 1 + 2 = 3; the game rounds the
        // composed 3 * 4/3 = 4.
        const layout = computeCrosshairLayout(
            { pipWidth: 1, pipHeight: 6, pipOutlineGap: 0, pipOutlineBorder: 1 },
            SCALE_1440
        );
        expect(layout.pipOutlines[0].w).toBe(4);
    });

    it('truncates float convars toward zero before use', () => {
        // citadel_crosshair_dot_size "8.301266" is a real persisted value and
        // renders as an 8px dot.
        const layout = computeCrosshairLayout({ dotSize: 8.301266 }, 1);
        expect(layout.dotSize).toBe(8);
    });

    it('places pip centres at D = 4 + pip_gap from the screen centre', () => {
        // Game defaults: gap 4 -> D 8; a 16-tall pip at scale 1 spans -16..0.
        const layout = computeCrosshairLayout({ pipGap: 4, pipWidth: 2, pipHeight: 16 }, 1);
        expect(layout.pips[0].y).toBe(-16);
        expect(layout.pips[0].h).toBe(16);
    });

    it('rounds the unsnapped leading edge half-up (11px outline box caps at -12/+12)', () => {
        // The doc's 1440p asymmetry example: D = 5, outline box 8 layout px
        // tall -> 11 device px; the top box's far cap lands 12 above centre
        // and the bottom box's 12 below, though the box height is odd.
        const layout = computeCrosshairLayout(
            { pipGap: 1, pipWidth: 1, pipHeight: 6, pipOutlineGap: 0, pipOutlineBorder: 1 },
            SCALE_1440
        );
        const top = layout.pipOutlines[0];
        const bottom = layout.pipOutlines[1];
        expect(top.h).toBe(11);
        expect(top.y).toBe(-12);
        expect(bottom.y + bottom.h).toBe(12);
    });

    it('swaps width and height for the left/right pair', () => {
        const layout = computeCrosshairLayout({ pipWidth: 2, pipHeight: 16 }, 1);
        const [, , left] = layout.pips;
        expect(left.w).toBe(16);
        expect(left.h).toBe(2);
    });

    it('hides the pips entirely when a dimension truncates to zero', () => {
        const layout = computeCrosshairLayout({ pipWidth: 0.9, pipHeight: 16 }, 1);
        expect(layout.pips).toHaveLength(0);
        expect(layout.pipOutlines).toHaveLength(0);
    });
});
