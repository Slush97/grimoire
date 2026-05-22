// Event-loop lag monitor for the main process.
//
// Bug reports that say "the app stutters" or "window dragging is laggy" are
// hard to triage without knowing whether the main-process event loop is
// actually being blocked. Node's perf_hooks histogram samples loop delay in
// native code (no JS overhead per sample), and we log a one-line summary
// every WINDOW_MS but only when something noticeable happened. That keeps
// the rolling log readable when the app is idle and surfaces real freezes
// when they occur.

import { monitorEventLoopDelay, IntervalHistogram } from 'perf_hooks';

const SAMPLE_RESOLUTION_MS = 20;
const WINDOW_MS = 10_000;
// Only log when the worst sample in the window crossed this threshold. A
// healthy loop sits well under 50ms; 100ms+ is where users start to feel it.
const REPORT_THRESHOLD_MS = 100;

let histogram: IntervalHistogram | null = null;
let timer: NodeJS.Timeout | null = null;

export function initEventLoopMonitor(): void {
    if (histogram) return;
    histogram = monitorEventLoopDelay({ resolution: SAMPLE_RESOLUTION_MS });
    histogram.enable();

    timer = setInterval(() => {
        if (!histogram) return;
        const maxMs = histogram.max / 1e6;
        if (maxMs >= REPORT_THRESHOLD_MS) {
            const p99Ms = histogram.percentile(99) / 1e6;
            const meanMs = histogram.mean / 1e6;
            console.warn(
                `[event-loop] blocked max=${maxMs.toFixed(0)}ms ` +
                `p99=${p99Ms.toFixed(0)}ms mean=${meanMs.toFixed(1)}ms ` +
                `over last ${WINDOW_MS / 1000}s`
            );
        }
        histogram.reset();
    }, WINDOW_MS);
    // Don't keep the process alive just for the monitor — app quit should
    // close the loop normally even with the interval pending.
    timer.unref();
}
