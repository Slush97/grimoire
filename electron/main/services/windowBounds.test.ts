import { describe, it, expect } from 'vitest';
import {
    DEFAULT_WINDOW_HEIGHT,
    DEFAULT_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
    MIN_WINDOW_WIDTH,
    centerInWorkArea,
    isTitleBarReachable,
    resolveInitialBounds,
} from './windowBounds';

// 1080p primary with a 40px taskbar, plus a 1440p monitor to its left.
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const LEFT_1440P = { x: -2560, y: 0, width: 2560, height: 1400 };

describe('resolveInitialBounds', () => {
    it('uses the defaults and no position when nothing was saved', () => {
        expect(resolveInitialBounds(undefined, [PRIMARY])).toEqual({
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            isMaximized: false,
        });
    });

    it('restores a window fully on the primary display as-is', () => {
        const saved = { x: 100, y: 80, width: 1280, height: 800 };
        expect(resolveInitialBounds(saved, [PRIMARY])).toEqual({ ...saved, isMaximized: false });
    });

    it('restores a window on a secondary display at negative x', () => {
        const saved = { x: -2000, y: 200, width: 1400, height: 900 };
        expect(resolveInitialBounds(saved, [PRIMARY, LEFT_1440P])).toEqual({ ...saved, isMaximized: false });
    });

    it('drops the position when the saved display is gone', () => {
        const saved = { x: -2000, y: 200, width: 1400, height: 900 };
        const result = resolveInitialBounds(saved, [PRIMARY]);
        expect(result.x).toBeUndefined();
        expect(result.y).toBeUndefined();
        expect(result).toMatchObject({ width: 1400, height: 900 });
    });

    it('drops the position when only 1px overlaps the right edge', () => {
        const result = resolveInitialBounds({ x: 1919, y: 100, width: 1280, height: 800 }, [PRIMARY]);
        expect(result.x).toBeUndefined();
        expect(result.y).toBeUndefined();
    });

    it('drops the position when the title bar is above the work area', () => {
        const result = resolveInitialBounds({ x: 100, y: -300, width: 1280, height: 800 }, [PRIMARY]);
        expect(result.x).toBeUndefined();
        expect(result.y).toBeUndefined();
    });

    it('allows the invisible frame border just outside the work area', () => {
        // Windows reports a maximized or snapped window ~8px past the edges.
        const result = resolveInitialBounds({ x: -8, y: -8, width: 1936, height: 1056 }, [PRIMARY]);
        expect(result).toMatchObject({ x: -8, y: -8 });
    });

    it('clamps a window larger than the target work area', () => {
        const result = resolveInitialBounds({ x: 0, y: 0, width: 2560, height: 1400 }, [PRIMARY]);
        expect(result).toEqual({ x: 0, y: 0, width: 1920, height: 1040, isMaximized: false });
    });

    it('carries isMaximized through', () => {
        expect(resolveInitialBounds({ x: 10, y: 10, width: 1280, height: 800, isMaximized: true }, [PRIMARY]).isMaximized).toBe(true);
        expect(resolveInitialBounds({ width: 1280, height: 800, isMaximized: true }, [PRIMARY]).isMaximized).toBe(true);
    });

    it('bumps a window below the minimum size', () => {
        expect(resolveInitialBounds({ x: 10, y: 10, width: 400, height: 300 }, [PRIMARY])).toMatchObject({
            width: MIN_WINDOW_WIDTH,
            height: MIN_WINDOW_HEIGHT,
        });
    });
});

describe('isTitleBarReachable', () => {
    it('needs enough of the title bar on one display', () => {
        expect(isTitleBarReachable({ x: 1800, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBe(true);
        expect(isTitleBarReachable({ x: 1850, y: 100, width: 1280, height: 800 }, [PRIMARY])).toBe(false);
    });

    it('rejects a title bar below the bottom of the work area', () => {
        expect(isTitleBarReachable({ x: 100, y: 1030, width: 1280, height: 800 }, [PRIMARY])).toBe(false);
    });

    it('is false with no displays', () => {
        expect(isTitleBarReachable({ x: 0, y: 0, width: 1280, height: 800 }, [])).toBe(false);
    });
});

describe('centerInWorkArea', () => {
    it('centres the window in the target work area', () => {
        expect(centerInWorkArea({ x: 5000, y: -900, width: 1280, height: 800 }, PRIMARY)).toEqual({
            x: 320,
            y: 120,
            width: 1280,
            height: 800,
        });
    });

    it('centres on a display at negative coordinates', () => {
        expect(centerInWorkArea({ x: 0, y: 0, width: 1280, height: 800 }, LEFT_1440P)).toEqual({
            x: -1920,
            y: 300,
            width: 1280,
            height: 800,
        });
    });

    it('shrinks a window larger than the work area to fit', () => {
        expect(centerInWorkArea({ x: 0, y: 0, width: 2560, height: 1400 }, PRIMARY)).toEqual(PRIMARY);
    });
});
