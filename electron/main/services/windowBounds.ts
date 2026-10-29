import type { Rectangle } from 'electron';
import type { AppSettings } from '../../../src/types/mod';

export const DEFAULT_WINDOW_WIDTH = 1280;
export const DEFAULT_WINDOW_HEIGHT = 800;
export const MIN_WINDOW_WIDTH = 900;
export const MIN_WINDOW_HEIGHT = 600;

/** Height of the strip at the top of the window the user drags it by. */
const TITLE_BAR_HEIGHT = 32;
/** Slack for the invisible resize borders Windows puts around the frame. */
const FRAME_TOLERANCE = 8;
/** How much of the title bar must be on a display for it to be grabbable. */
const MIN_GRAB_WIDTH = 120;

export interface InitialWindowBounds {
    width: number;
    height: number;
    x?: number;
    y?: number;
    isMaximized: boolean;
}

/**
 * The first work area on which the window's title bar is fully within reach
 * vertically and at least MIN_GRAB_WIDTH (or the whole window, if narrower) of
 * it is on screen horizontally. A rectangle that merely overlaps a display by a
 * pixel or two does not count: there is nothing there for the user to grab.
 */
export function findTitleBarWorkArea(rect: Rectangle, workAreas: readonly Rectangle[]): Rectangle | undefined {
    const minGrab = Math.min(MIN_GRAB_WIDTH, rect.width);
    return workAreas.find((wa) => {
        const fitsVertically =
            rect.y >= wa.y - FRAME_TOLERANCE &&
            rect.y + TITLE_BAR_HEIGHT <= wa.y + wa.height + FRAME_TOLERANCE;
        const overlap = Math.min(rect.x + rect.width, wa.x + wa.width) - Math.max(rect.x, wa.x);
        return fitsVertically && overlap >= minGrab;
    });
}

export function isTitleBarReachable(rect: Rectangle, workAreas: readonly Rectangle[]): boolean {
    return findTitleBarWorkArea(rect, workAreas) !== undefined;
}

/**
 * Resolve the saved window rectangle into safe constructor bounds. The saved
 * position is only honoured when the title bar lands somewhere the user can
 * grab it: a stale x/y from an unplugged or rearranged monitor would otherwise
 * strand the window offscreen, and on some multi-monitor Linux/Wayland setups
 * the OS placed it on the wrong screen at the wrong size. When the saved spot
 * is gone (or nothing was saved yet) x/y are omitted so Electron centres the
 * window on the primary display.
 */
export function resolveInitialBounds(
    saved: AppSettings['windowBounds'],
    workAreas: readonly Rectangle[]
): InitialWindowBounds {
    if (!saved) {
        return { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT, isMaximized: false };
    }

    let width = Math.max(MIN_WINDOW_WIDTH, Math.round(saved.width) || DEFAULT_WINDOW_WIDTH);
    let height = Math.max(MIN_WINDOW_HEIGHT, Math.round(saved.height) || DEFAULT_WINDOW_HEIGHT);
    const isMaximized = !!saved.isMaximized;

    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
        return { width, height, isMaximized };
    }

    const x = Math.round(saved.x);
    const y = Math.round(saved.y);
    const target = findTitleBarWorkArea({ x, y, width, height }, workAreas);
    if (!target) return { width, height, isMaximized };

    // A window saved on a big monitor must not come back bigger than a smaller
    // one. The minimum size still wins, as BrowserWindow enforces it anyway.
    width = Math.max(MIN_WINDOW_WIDTH, Math.min(width, target.width));
    height = Math.max(MIN_WINDOW_HEIGHT, Math.min(height, target.height));
    return { width, height, x, y, isMaximized };
}

/** Centre a window of the given size in a work area, shrinking it to fit. */
export function centerInWorkArea(current: Rectangle, workArea: Rectangle): Rectangle {
    const width = Math.min(current.width, workArea.width);
    const height = Math.min(current.height, workArea.height);
    return {
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
        width,
        height,
    };
}
