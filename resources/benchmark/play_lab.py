#!/usr/bin/env python3
"""Launch or stop an isolated local Modlock particle-lab session."""
import argparse
import json
import os
import shutil
import signal
import socket
import re
import subprocess
import sys
import time
import tempfile
from datetime import datetime
from pathlib import Path
from benchmark_recording import Recording, recover

HERE = Path(__file__).resolve().parent
SCENARIO = HERE.parent / 'scenario'
DEFAULT_GAME = Path('/tmp/deadlock-benchmark-runtime-probe')
DEFAULT_MAPS = Path('/mnt/storage/csdk13-benchmark/Reduced_CSDK_13/game/citadel_addons/benchmark_0919032c9cc5475a/maps')
DEFAULT_STATE = Path.home() / '.cache/deadlock-benchmark-play'


def event(phase, recorder=None, **details):
    if recorder is not None:
        recorder.phase(phase, details)
    print('BENCHMARK_EVENT ' + json.dumps({'phase': phase, **details}), flush=True)


def supervise(server, client, run, state, repetitions, cancelled=lambda: False, recorder=None):
    """Keep ownership until completion, failure, cancellation or timeout."""
    seen = set()
    passes = []
    deadline = time.monotonic() + 480
    try:
        while time.monotonic() < deadline:
            if cancelled():
                raise KeyboardInterrupt()
            log = (run/'server-launch.log').read_text(errors='replace')
            for line in log.splitlines():
                if 'REPLAY PROBE ' not in line or line in seen:
                    continue
                seen.add(line)
                if recorder is not None:
                    recorder.marker(line)
                if 'INVALID:' in line:
                    raise RuntimeError(line.split('INVALID:', 1)[1].strip())
                if 'WARMUP:' in line:
                    event('warmup', recorder)
                if 'BENCH START' in line:
                    match = re.search(r'repetition=(\d+)/(\d+)', line)
                    event('running', recorder, repetition=int(match[1]) if match else len(passes)+1, repetitions=repetitions)
                if 'BENCH END' in line:
                    passes.append(line.strip())
                    event('running', recorder, completed=len(passes), repetitions=repetitions)
            if len(passes) >= repetitions:
                result = {'status': 'completed', 'score_eligible': False, 'passes': passes}
                (run/'result.json').write_text(json.dumps(result, indent=2)+'\n')
                return result
            if server.poll() is not None or client.poll() is not None:
                raise RuntimeError('A benchmark process exited before completion')
            time.sleep(.25)
        raise RuntimeError('Benchmark timed out')
    finally:
        stop(state)


def identity(pid):
    try:
        # The process name in parentheses can contain spaces.
        return Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (FileNotFoundError, IndexError, ProcessLookupError):
        return None


def process_record(process):
    return {'pid': process.pid, 'start': identity(process.pid)}


def alive(record):
    return bool(record and identity(record['pid']) == record['start'])


def stop(state):
    if not state.is_file():
        print('No saved lab session.')
        return
    data = json.loads(state.read_text())
    for label in ('client', 'server'):
        rec = data.get(label)
        if alive(rec):
            try:
                os.killpg(rec['pid'], signal.SIGTERM)
            except ProcessLookupError:
                pass
    for _ in range(30):
        if not any(alive(data.get(label)) for label in ('client', 'server')):
            break
        time.sleep(.1)
    for label in ('client', 'server'):
        rec = data.get(label)
        if alive(rec):
            try:
                os.killpg(rec['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
    # Prefixes are created solely for this session; never address a shared prefix.
    wine = Path(data['proton']).parent / 'files/bin/wineserver'
    for key in ('server_prefix', 'client_prefix'):
        prefix = Path(data[key]) / 'pfx'
        if wine.is_file() and prefix.is_dir():
            env = os.environ.copy()
            env['WINEPREFIX'] = str(prefix)
            try:
                subprocess.run([str(wine), '-k'], env=env, timeout=5, check=False,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except (OSError, subprocess.TimeoutExpired):
                print(f'Could not stop isolated prefix {prefix}', file=sys.stderr)
    state.unlink()
    print('Stopped the saved lab session.')


def prepare_game(game, retail):
    """Create a fresh writable game tree; retail VPK assets remain read-only links."""
    if game.exists():
        return
    if not shutil.which('rsync'):
        raise RuntimeError('rsync is required to create the isolated game copy')
    source = retail/'game'
    if not (source/'citadel/steam.inf').is_file():
        raise RuntimeError(f'Deadlock game not found: {source}')
    game.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.benchmark-prepare-', dir=game.parent) as staging:
        ready = Path(staging)/'ready'
        dest = ready/'game'
        dest.mkdir(parents=True)
        print(f'Creating isolated game copy at {game} (about 1 GB)...', flush=True)
        excluded = ('addons*', 'grimoire', 'deadworks_addons', 'replays', 'modlock_dev')
        cmd = ['rsync', '-a', '--no-links', '--exclude=*.vpk', '--exclude=*.mdmp', '--exclude=*.dmp',
               '--exclude=console.log', '--exclude=/citadel/cfg/autoexec.cfg',
               *[f'--exclude=/citadel/{name}/' for name in excluded], str(source)+'/', str(dest)+'/']
        subprocess.run(cmd, check=True)
        for current, dirs, files in os.walk(source, followlinks=False):
            current = Path(current)
            rel = current.relative_to(source)
            if rel == Path('citadel'):
                dirs[:] = [d for d in dirs if not d.startswith('addons') and d not in excluded]
            dirs[:] = [d for d in dirs if not (current/d).is_symlink()]
            for name in files:
                asset = current/name
                if not name.endswith('.vpk') or not asset.is_file():
                    continue
                target = dest/rel/name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(asset.resolve(strict=True))
        info = dest/'citadel/gameinfo.gi'
        backup = dest/'citadel/gameinfo.gi.grimoire-bak'
        if backup.is_file():
            shutil.copy2(backup, info)
        # Keep Valve mounts, exclude locally installed mod roots in this copy.
        info.write_text('\n'.join(line for line in info.read_text().splitlines()
                        if not re.search(r'(?i)^\s*(?:Game|Mod|Write)\s+"?citadel/(?:addons\d*|grimoire|deadworks_addons|modlock_dev)(?:[/"\s]|$)', line))+'\n')
        ready.rename(game)


def check_port(port, kind):
    with socket.socket(socket.AF_INET, kind) as s:
        s.bind(('127.0.0.1', port))


def configure_video(citadel, retail, run, resolution):
    """Refresh isolated video settings each run; never modify the retail file."""
    source = retail/'game/citadel/cfg/video.txt'
    target = citadel/'cfg/video.txt'
    if target.is_symlink() or target.parent.is_symlink():
        raise RuntimeError('isolated video settings must not be a symlink')
    video = source.read_text() if source.is_file() else '"video.cfg"\n{\n}\n'
    flags = []
    if resolution != 'game':
        if resolution not in ('1280x720', '1920x1080', '2560x1440'):
            raise ValueError('Unsupported benchmark resolution')
        width, height = resolution.split('x')
        overrides = {'setting.defaultres': width, 'setting.defaultresheight': height,
                     'setting.fullscreen': '0', 'setting.coop_fullscreen': '0',
                     'setting.nowindowborder': '0'}
        for key, value in overrides.items():
            pattern = r'("' + re.escape(key) + r'"\s*")[^"]*(")'
            video, count = re.subn(pattern, lambda m: m[1]+value+m[2], video)
            if not count:
                end = video.rfind('}')
                if end < 0:
                    raise RuntimeError('Invalid video configuration')
                video = video[:end] + f'\t"{key}"\t"{value}"\n' + video[end:]
        flags = ['-windowed', '-w', width, '-h', height]
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(video)
    (run/'video-settings.txt').write_text(video)
    settings = dict(re.findall(r'"(setting\.[^"]+)"\s*"([^"]*)"', video))
    (run/'display.json').write_text(json.dumps({'requested': resolution, 'settings': settings,
                                               'client_flags': flags}, indent=2)+'\n')
    return flags


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=('start', 'restart', 'stop', 'status'), nargs='?', default='start')
    p.add_argument('--map', choices=('midtown', '0', '16'), default='midtown')
    p.add_argument('--scenario', type=Path, help='Modlock project directory; defaults to teamfight for Midtown and lab scenario for 0/16')
    p.add_argument('--demo', action='store_true', help='automatically start the Midtown teamfight after the player joins')
    p.add_argument('--supervise', action='store_true', help='emit progress and stop both processes when the replay test ends')
    p.add_argument('--game', type=Path, default=DEFAULT_GAME, help='isolated game root (containing game/)')
    p.add_argument('--maps', type=Path, default=DEFAULT_MAPS, help='directory containing both compiled lab VPKs')
    p.add_argument('--retail', type=Path, default=Path('/mnt/storage/SteamLibrary/steamapps/common/Deadlock'))
    p.add_argument('--modlock', type=Path, default=Path.home()/'.local/bin/modlock')
    p.add_argument('--host', type=Path, default=Path.home()/'.cache/modlock/host/v0.1.17/modlock-host.exe')
    p.add_argument('--proton', type=Path, default=Path.home()/'.cache/modlock/escort-proton/proton')
    p.add_argument('--types', type=Path, default=Path.home()/'deadlock-escort/node_modules/modlock')
    p.add_argument('--steam', type=Path, default=Path.home()/'.local/share/Steam')
    p.add_argument('--state-dir', type=Path, default=DEFAULT_STATE)
    p.add_argument('--port', type=int, default=27183)
    p.add_argument('--ui-port', type=int, default=43180)
    p.add_argument('--resolution', choices=('game', '1280x720', '1920x1080', '2560x1440'), default='game')
    p.add_argument('--capture', choices=('none', 'auto', 'mangohud', 'presentmon', 'metal'), default='none')
    p.add_argument('--suite', default='development', help='ledger group for comparable experiments')
    p.add_argument('--label', default='', help='human-readable run description')
    args = p.parse_args()
    cancel_requested = False
    def interrupted(_signum, _frame):
        nonlocal cancel_requested
        cancel_requested = True
    def check_cancel():
        if cancel_requested:
            raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    args.state_dir.mkdir(parents=True, exist_ok=True)
    state = args.state_dir / 'active.json'
    if args.action == 'stop':
        saved = json.loads(state.read_text()) if state.is_file() else None
        stop(state)
        if saved:
            recover(saved)
        return 0
    if args.action == 'restart':
        saved = json.loads(state.read_text()) if state.is_file() else None
        stop(state)
        if saved:
            recover(saved)
    if args.action == 'status':
        if not state.is_file():
            print('No saved lab session.')
            return 1
        data = json.loads(state.read_text())
        print(json.dumps({'map': data['map'], 'server_running': alive(data.get('server')),
                          'client_launcher_running': alive(data.get('client')), 'logs': data['logs']}, indent=2))
        return 0
    if state.exists():
        data = json.loads(state.read_text())
        if any(alive(data.get(key)) for key in ('server', 'client')):
            p.error(f'a lab session is already active; stop it with {Path(__file__).name} stop')
        p.error(f'stale session record {state}; run the stop command to clean its own prefixes')
    if args.capture != 'none' and not args.supervise:
        p.error('automatic capture requires --supervise so files are finalized after the game exits')
    for cmdline in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            if b'deadlock.exe' in cmdline.read_bytes().lower():
                p.error('a Deadlock client is already running; close it before starting a lab session')
        except (OSError, ProcessLookupError):
            continue
    retail = args.retail.resolve(strict=True)
    requested_game = args.game.resolve(strict=False)
    if requested_game == retail or requested_game in retail.parents or retail in requested_game.parents:
        p.error('game must be an isolated copy outside the retail installation')
    try:
        prepare_game(requested_game, retail)
    except (OSError, RuntimeError, subprocess.CalledProcessError) as e:
        p.error(f'could not prepare isolated game: {e}')
    game = requested_game.resolve(strict=True)
    if game == retail or game in retail.parents or retail in game.parents:
        p.error('game must be an isolated copy outside the retail installation')
    citadel = game / 'game/citadel'
    for target in (game/'game', citadel, citadel/'maps', citadel/'gameinfo.gi'):
        if target.is_symlink():
            p.error(f'isolated game write path is a symlink: {target}')
    modlock_dir = citadel/'modlock_dev'
    if modlock_dir.is_symlink():
        p.error('isolated modlock_dev directory must not be a symlink')
    if modlock_dir.is_dir():
        for item in modlock_dir.iterdir():
            if item.is_symlink():
                p.error(f'isolated Modlock session file is a symlink: {item}; replace it with a local copy')
    if not (game/'game/bin/win64/deadlock.exe').is_file():
        p.error(f'isolated game executable missing under {game}')
    if (citadel/'steam.inf').read_bytes() != (retail/'game/citadel/steam.inf').read_bytes():
        p.error('isolated game build differs from installed game; rebuild the isolated game copy')
    for path in (args.modlock, args.host, args.proton, args.steam):
        if not path.exists():
            p.error(f'missing prerequisite: {path}')
    name = 'dl_midtown' if args.map == 'midtown' else 'dl_benchmark_lab_' + args.map
    project_source = args.scenario or (HERE.parent/'teamfight' if args.map == 'midtown' else SCENARIO)
    if not (project_source/'mod.json').is_file():
        p.error(f'scenario project missing: {project_source}')
    source = None if args.map == 'midtown' else args.maps / (name + '.vpk')
    if source is not None and not source.is_file():
        p.error(f'compiled map missing: {source}')
    if source is None and not (citadel/'maps/dl_midtown.vpk').is_file():
        p.error('isolated game lacks maps/dl_midtown.vpk')
    try:
        check_port(args.port, socket.SOCK_DGRAM)
        check_port(args.ui_port, socket.SOCK_STREAM)
    except OSError as e:
        p.error(f'game or interface port unavailable: {e}')
    if not os.environ.get('DISPLAY') and not os.environ.get('WAYLAND_DISPLAY'):
        p.error('a visible desktop session is required')
    run = args.state_dir / ('session-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    run.mkdir()
    video_flags = configure_video(citadel, retail, run, args.resolution)
    project = run/'scenario'
    shutil.copytree(project_source, project, ignore=shutil.ignore_patterns('node_modules', 'build', '.git', '__pycache__'))
    meta = json.loads((project/'mod.json').read_text())
    meta['map'] = name
    (project/'mod.json').write_text(json.dumps(meta)+'\n')
    # Modlock resolves its own pinned SDK. No workspace node_modules required.
    if source is not None:
        dest = citadel/'maps'/source.name
        temporary = citadel/'maps'/(source.name + '.tmp-' + str(os.getpid()))
        try:
            with temporary.open('xb') as f, source.open('rb') as src:
                shutil.copyfileobj(src, f)
            os.replace(temporary, dest)
        finally:
            temporary.unlink(missing_ok=True)
    cache, config, client_prefix = run/'cache', run/'config', run/'client-prefix'
    cache.mkdir(); config.mkdir(); client_prefix.mkdir()
    env = os.environ.copy()
    env.update(DEADLOCK_DIR=str(game), MODLOCK_HOST=str(args.host), MODLOCK_PROTON=str(args.proton.parent),
               MODLOCK_NO_UPDATE_CHECK='1', XDG_CACHE_HOME=str(cache), XDG_CONFIG_HOME=str(config))
    serverlog = run/'server-launch.log'
    server_command = [str(args.modlock), 'dev', '--no-game', '--port', str(args.port),
                      '--ui-port', str(args.ui_port), '--preview-port', '0']
    if args.demo and args.map == 'midtown':
        server_command.extend(['--arg', 'demo'])
    server_command.append(str(project))
    recording = Recording(run, args, game, project)
    outcome, failure = 'failed', None
    try:
        check_cancel()
        server = subprocess.Popen(server_command,
                                  env=env, stdin=subprocess.DEVNULL, stdout=serverlog.open('w'),
                                  stderr=subprocess.STDOUT, start_new_session=True)
        data = {'map': name, 'proton': str(args.proton), 'server': process_record(server), 'client': None,
                'server_prefix': str(cache/'modlock/proton'), 'client_prefix': str(client_prefix), 'logs': str(run),
                'ledger_run_id': recording.run_id}
        state.write_text(json.dumps(data, indent=2))
        check_cancel()
        event('starting_server', recording, logs=str(run), run_id=recording.run_id)
        deadline = time.monotonic()+75
        while time.monotonic() < deadline:
            check_cancel()
            log = serverlog.read_text(errors='replace')
            if 'the build failed' in log:
                raise RuntimeError(f'benchmark build failed; see {serverlog}')
            if f'server ready on {name}' in log:
                break
            if server.poll() is not None:
                raise RuntimeError(f'server stopped; see {serverlog}')
            time.sleep(.5)
        else:
            raise RuntimeError(f'server did not become ready; see {serverlog}')
        client_env = os.environ.copy()
        client_env.update(STEAM_COMPAT_DATA_PATH=str(client_prefix), STEAM_COMPAT_CLIENT_INSTALL_PATH=str(args.steam),
                          SteamAppId='1422450', SteamGameId='1422450', WINEDEBUG='-all')
        client_env = recording.capture.environment(client_env)
        exe = 'Z:' + str((game/'game/bin/win64/deadlock.exe')).replace('/', '\\')
        event('starting_client', recording, logs=str(run))
        client = subprocess.Popen([str(args.proton), 'run', exe, '-game', 'citadel', '-insecure', '-novid',
                                   *video_flags, '-condebug', '+connect', f'127.0.0.1:{args.port}'],
                                  cwd=game/'game/bin/win64', env=client_env, stdin=subprocess.DEVNULL,
                                  stdout=(run/'client.log').open('w'), stderr=subprocess.STDOUT, start_new_session=True)
        data['client'] = process_record(client)
        state.write_text(json.dumps(data, indent=2))
        joined = False
        deadline = time.monotonic()+30
        while time.monotonic() < deadline:
            check_cancel()
            if any('→' in line and ' joined' in line for line in serverlog.read_text(errors='replace').splitlines()):
                joined = True
                break
            if client.poll() is not None or server.poll() is not None:
                break
            time.sleep(.5)
        print(f'Server ready on {name}; '+('client joined.' if joined else 'client opened; connection not confirmed.')+f' Logs: {run}')
        print('Use the scenario instructions to start the test. Stop with: python3 tools/deadlock-benchmark/runtime/play_lab.py stop --state-dir ' + str(args.state_dir))
        if args.supervise:
            repetitions = json.loads((project/'data/clip.json').read_text()).get('repetitions', 1)
            result = supervise(server, client, run, state, repetitions, lambda: cancel_requested, recording)
            outcome = 'completed'
            event('completed', recording, logs=str(run), result=result)
        else:
            outcome = 'detached'
        return 0
    except KeyboardInterrupt:
        outcome = 'stopped'
        stop(state)
        event('stopped', recording, logs=str(run))
        return 130
    except Exception as e:
        failure = str(e)
        print(str(e), file=sys.stderr)
        stop(state)
        event('failed', recording, error=str(e), logs=str(run))
        return 1
    finally:
        try:
            if outcome != 'detached':
                recording.finish(outcome, failure)
        finally:
            recording.close()


if __name__ == '__main__':
    raise SystemExit(main())
