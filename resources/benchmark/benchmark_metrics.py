"""Shared frame statistics. Callers separately establish window and capture validity."""
import math
import statistics

METRIC_VERSION = '1.1'


def metrics(frames, duration):
    if not frames or not math.isfinite(duration) or duration <= 0:
        raise ValueError('metrics require frames and a positive finite duration')
    times = sorted(frame[1] for frame in frames)
    if any(not math.isfinite(t) or t <= 0 for t in times):
        raise ValueError('frame intervals must be positive and finite')
    n = len(times)
    count = math.ceil(n*.01)
    return {'frame_count': n, 'duration_seconds': duration, 'average_fps': n/duration,
            'one_percent_low_fps': 1000/statistics.mean(times[-count:]),
            'one_percent_sample_count': count, 'p95_frame_time_ms': times[math.ceil(.95*n)-1],
            'p99_frame_time_ms': times[math.ceil(.99*n)-1], 'maximum_frame_time_ms': times[-1]}
