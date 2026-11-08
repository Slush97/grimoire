#!/usr/bin/env python3
"""Capture adapter scaffold. Raw collection is separate from measurement validation."""
import argparse
import csv
import io
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess

from benchmark_ledger import file_digest
from benchmark_metrics import METRIC_VERSION, metrics

ADAPTER_VERSION = '0.1.0'
# 0.8.4 skips its autostart check when no_display is true and logging is inactive.
# Keep the HUD loop enabled but transparent, so automatic collection can start.
MANGOHUD_SETTINGS = ('no_display=0', 'alpha=0', 'background_alpha=0',
                    'autostart_log=1', 'log_interval=0', 'permit_upload=0',
                    'cpu_stats', 'gpu_stats', 'cpu_temp', 'gpu_temp', 'cpu_power', 'gpu_power',
                    'cpu_mhz', 'gpu_core_clock', 'gpu_mem_clock', 'ram', 'vram', 'swap', 'procmem')
BACKENDS = {
    'none': {'platform': None, 'implemented': True},
    'mangohud': {'platform': 'Linux', 'implemented': True, 'tested_version': 'v0.8.4'},
    'presentmon': {'platform': 'Windows', 'implemented': False,
                   'contract': 'isolate game PID and main swapchain; retain raw present timestamps and frame type'},
    'metal': {'platform': 'Darwin', 'implemented': False,
              'contract': 'retain per-frame intervals and frame IDs in Metal HUD batches; calibrate clock mapping'},
}


def probe(backend='auto', system=None):
    system = system or platform.system()
    if backend == 'auto':
        backend = {'Linux': 'mangohud', 'Windows': 'presentmon', 'Darwin': 'metal'}.get(system, 'none')
    if backend not in BACKENDS:
        raise ValueError('unknown capture backend')
    result = {'backend': backend, 'adapter_version': ADAPTER_VERSION, 'platform': system,
              'available': False, 'version': None, 'reason': None, **BACKENDS[backend]}
    result['platform'] = system
    if backend == 'none':
        result.update(available=True, reason='frame capture disabled')
    elif system != BACKENDS[backend]['platform']:
        result['reason'] = 'capture backend does not support this OS'
    elif not result['implemented']:
        result['reason'] = 'adapter scaffold only; live capture has not been implemented or validated'
    else:
        result['settings'] = list(MANGOHUD_SETTINGS)
        executable = shutil.which('mangohud')
        if executable:
            try:
                version = subprocess.run([executable, '--version'], capture_output=True, text=True,
                                         check=True, timeout=5).stdout.strip()
                result.update(version=version, executable=executable, available=version == 'v0.8.4')
                if not result['available']:
                    result['reason'] = 'MangoHud adapter currently pins the observed v0.8.4 CSV format'
            except (OSError, subprocess.SubprocessError) as exc:
                result['reason'] = f'MangoHud version probe failed: {exc}'
        else:
            result['reason'] = 'MangoHud is not installed'
    return result


def inventory():
    """Best-effort facts only; do not collect usernames, hostnames or environment dumps."""
    result = {'os': platform.system(), 'os_release': platform.release(), 'architecture': platform.machine(),
              'cpu': platform.processor() or None, 'logical_cpus': os.cpu_count(),
              'memory_bytes': None, 'gpus': [], 'display_session': os.environ.get('XDG_SESSION_TYPE')}
    if platform.system() == 'Linux':
        try:
            for line in Path('/proc/cpuinfo').read_text().splitlines():
                if line.startswith('model name'):
                    result['cpu'] = line.split(':', 1)[1].strip()
                    break
            for line in Path('/proc/meminfo').read_text().splitlines():
                if line.startswith('MemTotal:'):
                    result['memory_bytes'] = int(line.split()[1])*1024
        except (OSError, ValueError):
            pass
        for card in sorted(Path('/sys/class/drm').glob('card[0-9]*')):
            if '-' in card.name:
                continue
            device = card/'device'
            if not device.exists():
                continue
            gpu = {'card': card.name}
            for name in ('vendor', 'device'):
                try:
                    gpu[name] = (device/name).read_text().strip()
                except OSError:
                    gpu[name] = None
            gpu['driver'] = (device/'driver').resolve().name if (device/'driver').exists() else None
            try:
                gpu['driver_version'] = (device/'driver/module/version').read_text().strip()
            except OSError:
                gpu['driver_version'] = None
            result['gpus'].append(gpu)
    return result


def normalize_mangohud(source, output):
    """Preserve raw evidence. Normalize observed 0.8.4 rows, without inventing clock alignment."""
    raw = source.read_bytes()
    reader = csv.reader(io.StringIO(raw.decode('utf-8-sig'), newline=''))
    metadata_fields, metadata_values, fields = next(reader, []), next(reader, []), next(reader, [])
    if metadata_fields[:3] != ['os', 'cpu', 'gpu'] or not metadata_values:
        raise ValueError('unsupported MangoHud metadata format')
    if len(set(fields)) != len(fields) or not {'elapsed', 'frametime'} <= set(fields):
        raise ValueError('unsupported MangoHud frame columns')
    frames, telemetry = [], []
    previous = None
    max_interval_error_ms = 0
    for line, values in enumerate(reader, 4):
        if len(values) != len(fields):
            raise ValueError(f'incomplete MangoHud row {line}')
        row = dict(zip(fields, values))
        timestamp_ns, duration = int(row['elapsed']), float(row['frametime'])
        if timestamp_ns < 0 or not math.isfinite(duration) or duration <= 0:
            raise ValueError(f'invalid frame at row {line}')
        if previous is not None:
            error = abs((timestamp_ns-previous)/1_000_000-duration)
            max_interval_error_ms = max(max_interval_error_ms, error)
            if timestamp_ns <= previous or error > 1:
                raise ValueError(f'non-monotonic or missing/inconsistent frame at row {line}')
        frames.append((timestamp_ns/1_000_000_000, duration))
        telemetry.append([row['elapsed']] + [row[key] for key in fields if key not in ('elapsed', 'fps', 'frametime')])
        previous = timestamp_ns
    if len(frames) < 2:
        raise ValueError('capture needs at least two frames')
    with (output/'frames.csv').open('x', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['timestamp_seconds', 'frame_time_ms'])
        writer.writerows(frames)
    with (output/'telemetry.csv').open('x', newline='') as stream:
        writer = csv.writer(stream)
        writer.writerow(['elapsed_ns'] + [key for key in fields if key not in ('elapsed', 'fps', 'frametime')])
        writer.writerows(telemetry)
    telemetry_fields = [key for key in fields if key not in ('elapsed', 'fps', 'frametime')]
    telemetry_summary = {}
    for index, name in enumerate(telemetry_fields, 1):
        values = []
        for row in telemetry:
            try:
                value = float(row[index])
                if math.isfinite(value):
                    values.append(value)
            except ValueError:
                pass
        telemetry_summary[name] = {'minimum_reported': min(values) if values else None,
                                   'maximum_reported': max(values) if values else None,
                                   'availability': 'reported_nonzero' if any(values) else 'zero_only_or_unavailable',
                                   'units': 'MangoHud source format; retain original column name'}
    return {'frame_count': len(frames), 'first_timestamp_seconds': frames[0][0],
            'last_timestamp_seconds': frames[-1][0], 'max_interval_error_ms': max_interval_error_ms,
            'raw_sha256': file_digest(source), 'raw_system_metadata': dict(zip(metadata_fields, metadata_values)),
            'frame_semantics': 'unverified', 'clock': 'MangoHud elapsed since logging started',
            'clock_alignment': 'unverified', 'measurement_valid': False,
            'diagnostic_metrics': metrics(frames[1:], frames[-1][0]-frames[0][0]),
            'metric_version': METRIC_VERSION,
            'metric_scope': 'entire capture after first event, INCLUDING loading, setup and warm-up; NOT measured passes',
            'telemetry_summary': telemetry_summary,
            'telemetry_note': 'sensor values may repeat across frames; rows are not independent sensor samples'}


class Capture:
    def __init__(self, run, backend):
        self.run = Path(run)
        self.plan = probe(backend)
        if backend != 'auto' and not self.plan['available']:
            raise ValueError(self.plan['reason'])
        self.enabled = self.plan['backend'] != 'none' and self.plan['available']
        self.directory = self.run/'capture'
        self.directory.mkdir()
        (self.directory/'plan.json').write_text(json.dumps(self.plan, indent=2)+'\n')

    def environment(self, inherited):
        env = inherited.copy()
        if self.enabled:
            # A private config prevents inherited hotkeys, limits and uploads from changing the run.
            config = self.directory/'MangoHud.conf'
            config.write_text('\n'.join(MANGOHUD_SETTINGS)+f'\noutput_folder={self.directory.resolve()}\n')
            env.pop('MANGOHUD_CONFIG', None)
            env['MANGOHUD_CONFIGFILE'] = str(config.resolve())
            env['MANGOHUD'] = '1'
        else:
            env['MANGOHUD'] = '0'
        return env

    def finish(self):
        result = {'backend': self.plan['backend'], 'status': 'disabled', 'measurement_valid': False,
                  'comparison_eligible': False, 'reason': self.plan['reason']}
        if self.enabled:
            # Select the game, never the host or unrelated Vulkan applications.
            files = sorted(self.directory.glob('deadlock*.csv'))
            files = [p for p in files if not p.name.endswith('_summary.csv')]
            if len(files) != 1:
                result.update(status='failed', reason=f'expected one game frame stream, found {len(files)}')
            else:
                try:
                    result.update(normalize_mangohud(files[0], self.directory))
                    result.update(status='captured', reason='raw frames collected; alignment and semantics remain unverified',
                                  raw_file=files[0].name)
                except (OSError, ValueError, csv.Error) as exc:
                    result.update(status='failed', reason=str(exc))
        (self.directory/'result.json').write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', choices=('auto', *BACKENDS), default='auto')
    args = parser.parse_args()
    print(json.dumps(probe(args.backend), indent=2))


if __name__ == '__main__':
    main()
