"""Connect local run provenance, capture collection and the append-only ledger."""
import json
import os
from pathlib import Path
import re
import subprocess

from benchmark_capture import Capture, inventory
from benchmark_ledger import Ledger, file_digest


def tool_version(executable):
    try:
        return subprocess.run([str(executable), '--version'], text=True, capture_output=True,
                              timeout=5, check=True, env={**os.environ, 'MODLOCK_NO_UPDATE_CHECK': '1'}).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def register_artifacts(ledger, run_id, run):
    # Only evidence, never the copied game, Proton prefixes or SDK caches.
    paths = [p for p in run.iterdir() if p.is_file() and p.name != 'run-ledger.json']
    paths.extend(p for p in (run/'capture').glob('*') if p.is_file())
    for path in sorted(paths):
        ledger.artifact(run_id, path, 'capture' if path.parent.name == 'capture' else 'session')


class Recording:
    def __init__(self, run, args, game, project):
        self.run = run
        self.capture = Capture(run, args.capture)
        source_files = {p.relative_to(project).as_posix(): file_digest(p) for p in sorted(project.rglob('*'))
                        if p.is_file()}
        proton_version = args.proton.parent/'version'
        map_name = json.loads((project/'mod.json').read_text())['map']
        configuration = {
            'schema_version': 1, 'workload': 'modlock-reconstruction',
            'scenario_files': source_files, 'display': json.loads((run/'display.json').read_text()),
            'effective_display': None, 'inventory': inventory(), 'capture': self.capture.plan,
            'game': {'steam_inf': (game/'game/citadel/steam.inf').read_text(),
                     'gameinfo_sha256': file_digest(game/'game/citadel/gameinfo.gi'),
                     'map': map_name, 'map_sha256': file_digest(game/'game/citadel/maps'/(map_name+'.vpk'))},
            'runtime': {'modlock': tool_version(args.modlock), 'host_sha256': file_digest(args.host),
                        'proton': proton_version.read_text().strip() if proton_version.is_file() else None,
                        'launcher_sources': {name: file_digest(Path(__file__).parent/name) for name in
                            ('play_lab.py', 'benchmark_recording.py', 'benchmark_capture.py', 'benchmark_ledger.py', 'benchmark_metrics.py')}},
            'server': {'location': 'local', 'tick_rate': 64},
            'graphics_environment': {key: os.environ.get(key) for key in
                ('DXVK_CONFIG', 'VKD3D_CONFIG', 'PROTON_USE_WINED3D', 'PROTON_ENABLE_NVAPI',
                 'MESA_VK_WSI_PRESENT_MODE', '__GL_SYNC_TO_VBLANK')},
            'unverified': ['effective render resolution', 'frame generation', 'driver overrides',
                           'client/capture clock mapping', 'frame semantics', 'scenario fidelity'],
        }
        self.ledger = Ledger(args.state_dir/'ledger.sqlite3')
        self.run_id = self.ledger.create(run, configuration, args.suite, args.label)
        (run/'configuration.json').write_text(json.dumps(configuration, indent=2)+'\n')
        self.export()

    def phase(self, phase, details):
        self.ledger.event(self.run_id, 'phase', {'phase': phase, **details})

    def marker(self, line):
        if not any(marker in line for marker in ('WARMUP:', 'WARMUP END', 'BENCH START', 'BENCH END', 'INVALID:')):
            return
        match = re.search(r'game_time=([\d.]+).*repetition=(\d+)/(\d+)', line)
        self.ledger.event(self.run_id, 'scenario_marker', {
            'line': line.strip(), 'scenario_seconds': float(match[1]) if match else None,
            'pass_index': int(match[2]) if match else None,
            'clock_source': 'supervisor log receipt; NOT client-rendered time',
            'poll_interval_ms': 250, 'alignment_verified': False, 'alignment_uncertainty_ms': None})

    def export(self):
        temporary = self.run/'run-ledger.json.tmp'
        temporary.write_text(json.dumps(self.ledger.export(self.run_id), indent=2)+'\n')
        temporary.replace(self.run/'run-ledger.json')

    def finish(self, outcome, error=None):
        capture = self.capture.finish()
        self.ledger.event(self.run_id, 'capture_finished', capture)
        result_path = self.run/'result.json'
        result = json.loads(result_path.read_text()) if result_path.is_file() else {'status': outcome}
        result.update(run_id=self.run_id, capture=capture, score_eligible=False)
        result_path.write_text(json.dumps(result, indent=2)+'\n')
        register_artifacts(self.ledger, self.run_id, self.run)
        self.ledger.finish(self.run_id, outcome, capture, error)
        self.export()
        return capture

    def close(self):
        self.ledger.close()


def recover(data):
    """External cleanup cannot assert that a killed recorder flushed complete data."""
    if not data.get('ledger_run_id'):
        return
    run = Path(data['logs'])
    ledger = Ledger(run.parent/'ledger.sqlite3')
    try:
        run_id = data['ledger_run_id']
        if ledger.export(run_id)['result']['outcome'] == 'incomplete':
            register_artifacts(ledger, run_id, run)
            ledger.finish(run_id, 'interrupted', {'status': 'unverified', 'reason': 'external cleanup after recorder exit'})
            (run/'run-ledger.json').write_text(json.dumps(ledger.export(run_id), indent=2)+'\n')
    finally:
        ledger.close()
