#!/usr/bin/env python3
"""Local benchmark history. Configuration and events are append-only through this API."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import time
import uuid

SCHEMA = 1


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec='microseconds')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_digest(path):
    sha = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            sha.update(block)
    return sha.hexdigest()


def date_filter(value):
    if len(value) == 10:
        value += 'T00:00:00+00:00'
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('timestamps require a timezone offset; dates use midnight UTC')
    return dt.astimezone(timezone.utc).isoformat(timespec='microseconds')


class Ledger:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=10)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0, SCHEMA):
            self.db.close()
            raise ValueError(f'Unsupported ledger schema {version}')
        self.db.executescript('''
            CREATE TABLE IF NOT EXISTS configurations (
                hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY, created_utc TEXT NOT NULL,
                recorded_utc TEXT, config_hash TEXT NOT NULL REFERENCES configurations(hash),
                suite TEXT NOT NULL, label TEXT NOT NULL,
                origin TEXT NOT NULL, directory TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL REFERENCES runs(id), at_utc TEXT NOT NULL,
                monotonic_ns TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS events_run ON events(run_id, sequence);
            CREATE UNIQUE INDEX IF NOT EXISTS events_finish ON events(run_id) WHERE kind='finished';
            CREATE TABLE IF NOT EXISTS artifacts (
                run_id TEXT NOT NULL REFERENCES runs(id), path TEXT NOT NULL,
                role TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
                registered_utc TEXT NOT NULL, PRIMARY KEY(run_id, path));
            PRAGMA user_version=1;
        ''')

    def close(self):
        self.db.close()

    def create(self, directory, configuration, suite='development', label='', origin='live', recorded_utc=None):
        if not isinstance(configuration, dict):
            raise ValueError('configuration must be an object')
        if origin not in ('live', 'imported'):
            raise ValueError('origin must be live or imported')
        config_json = canonical(configuration)
        config_hash = digest(configuration)
        run_id = uuid.uuid4().hex
        now = utc_now()
        recorded = date_filter(recorded_utc) if recorded_utc else (now if origin == 'live' else None)
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO configurations VALUES (?, ?)', (config_hash, config_json))
            self.db.execute('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                            (run_id, now, recorded, config_hash, suite, label, origin, str(Path(directory).resolve())))
            self._event(run_id, 'created', {'origin': origin, 'recorded_time_source':
                        'operator_provided' if recorded_utc else 'run_creation' if origin == 'live' else 'unknown'},
                        live=origin == 'live')
        return run_id

    def _event(self, run_id, kind, payload, live=True):
        self.db.execute('INSERT INTO events(run_id, at_utc, monotonic_ns, kind, payload) VALUES (?, ?, ?, ?, ?)',
                        (run_id, utc_now(), str(time.monotonic_ns()) if live else None, kind, canonical(payload)))

    def event(self, run_id, kind, payload, live=True):
        if kind in ('created', 'finished'):
            raise ValueError('use create or finish for lifecycle events')
        with self.db:
            if kind != 'note' and self._finished(run_id):
                raise ValueError('run is finished; append a note instead of changing its history')
            self._event(run_id, kind, payload, live)

    def _finished(self, run_id):
        return self.db.execute("SELECT 1 FROM events WHERE run_id=? AND kind='finished'", (run_id,)).fetchone() is not None

    def finish(self, run_id, outcome, capture, error=None):
        if outcome not in ('completed', 'failed', 'stopped', 'interrupted', 'imported'):
            raise ValueError('invalid outcome')
        with self.db:
            if self._finished(run_id):
                raise ValueError('run already finished')
            self._event(run_id, 'finished', {'outcome': outcome, 'capture': capture, 'error': error,
                        'measurement_valid': False, 'comparison_eligible': False,
                        'reasons': ['client/capture clock alignment is unverified',
                                    'frame semantics and scenario fidelity need validation']})

    def artifact(self, run_id, path, role='evidence'):
        row = self.db.execute('SELECT directory FROM runs WHERE id=?', (run_id,)).fetchone()
        if row is None:
            raise ValueError('unknown run')
        root = Path(row['directory']).resolve()
        file = Path(path).resolve(strict=True)
        relative = file.relative_to(root).as_posix()
        record = (run_id, relative, role, file_digest(file), file.stat().st_size, utc_now())
        with self.db:
            if self._finished(run_id):
                raise ValueError('register artifacts before finishing a run')
            existing = self.db.execute('SELECT sha256, bytes, role FROM artifacts WHERE run_id=? AND path=?',
                                       (run_id, relative)).fetchone()
            if existing is not None:
                if tuple(existing) == (record[3], record[4], role):
                    return
                raise ValueError(f'artifact changed after registration: {relative}')
            self.db.execute('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?)', record)

    def note(self, run_id, text, pass_index=None):
        if not text.strip():
            raise ValueError('note cannot be empty')
        if pass_index is not None and (type(pass_index) is not int or pass_index < 0):
            raise ValueError('pass must be nonnegative (0 is warm-up)')
        self.event(run_id, 'note', {'text': text, 'scope': 'pass' if pass_index is not None else 'run',
                                  'pass_index': pass_index}, live=False)

    def export(self, run_id):
        row = self.db.execute('SELECT * FROM runs WHERE id=?', (run_id,)).fetchone()
        if row is None:
            raise ValueError('unknown run')
        result = dict(row)
        result['schema_version'] = SCHEMA
        result['exported_utc'] = utc_now()
        result['configuration'] = json.loads(self.db.execute(
            'SELECT payload FROM configurations WHERE hash=?', (row['config_hash'],)).fetchone()[0])
        result['events'] = []
        for event in self.db.execute('SELECT sequence, at_utc, monotonic_ns, kind, payload FROM events WHERE run_id=? ORDER BY sequence', (run_id,)):
            item = dict(event)
            item['payload'] = json.loads(item['payload'])
            result['events'].append(item)
        result['artifacts'] = [dict(a) for a in self.db.execute(
            'SELECT path, role, sha256, bytes, registered_utc FROM artifacts WHERE run_id=? ORDER BY path', (run_id,))]
        finished = [e['payload'] for e in result['events'] if e['kind'] == 'finished']
        result['result'] = finished[-1] if finished else {'outcome': 'incomplete', 'measurement_valid': False,
                                                        'comparison_eligible': False}
        return result

    def list(self, since=None, until=None, suite=None, config=None):
        where, values = [], []
        for column, op, value in [('COALESCE(recorded_utc,created_utc)', '>=', date_filter(since) if since else None),
                                  ('COALESCE(recorded_utc,created_utc)', '<', date_filter(until) if until else None),
                                  ('suite', '=', suite), ('config_hash', '=', config)]:
            if value is not None:
                where.append(f'{column} {op} ?')
                values.append(value)
        query = 'SELECT * FROM runs' + (' WHERE '+' AND '.join(where) if where else '') + ' ORDER BY created_utc, id'
        rows = []
        for row in self.db.execute(query, values):
            item = dict(row)
            item['outcome'] = self.export(row['id'])['result']['outcome']
            rows.append(item)
        return rows

    def verify(self, run_id):
        run = self.export(run_id)
        errors = []
        if digest(run['configuration']) != run['config_hash']:
            errors.append('configuration hash mismatch')
        for item in run['artifacts']:
            path = Path(run['directory'])/item['path']
            try:
                if file_digest(path) != item['sha256'] or path.stat().st_size != item['bytes']:
                    errors.append(f"changed artifact: {item['path']}")
            except OSError:
                errors.append(f"missing artifact: {item['path']}")
        return {'run_id': run_id, 'integrity_ok': not errors, 'errors': errors,
                'measurement_valid': False, 'comparison_eligible': False}


def config_diff(left, right, prefix=''):
    changes = []
    for key in sorted(left.keys() | right.keys()):
        name = f'{prefix}.{key}' if prefix else key
        if key in left and key in right and isinstance(left[key], dict) and isinstance(right[key], dict):
            changes.extend(config_diff(left[key], right[key], name))
        elif key not in left or key not in right or left[key] != right[key]:
            changes.append({'field': name, 'before': left.get(key), 'after': right.get(key),
                            'before_present': key in left, 'after_present': key in right})
    return changes


def import_session(ledger, directory, suite, label, recorded_utc=None):
    directory = Path(directory).resolve(strict=True)
    display = json.loads((directory/'display.json').read_text())
    result_path = directory/'result.json'
    result = json.loads(result_path.read_text()) if result_path.is_file() else None
    config_path = directory/'configuration.json'
    configuration = json.loads(config_path.read_text()) if config_path.is_file() else {
        'display': display, 'historical_context': 'only saved files are known', 'hardware': None, 'capture_backend': None}
    run_id = ledger.create(directory, configuration,
                           suite, label, 'imported', recorded_utc)
    ledger.event(run_id, 'historical_result', {'source_result': result, 'original_directory': directory.name}, live=False)
    for path in sorted(directory.iterdir()):
        if path.is_file():
            ledger.artifact(run_id, path)
    for path in sorted((directory/'capture').glob('*')):
        if path.is_file():
            ledger.artifact(run_id, path, 'historical_capture')
    ledger.finish(run_id, 'imported', {'status': 'unknown', 'reason': 'No capture adapter verified this historical run'})
    return run_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    listing = sub.add_parser('list')
    for name in ('since', 'until', 'suite', 'config'):
        listing.add_argument('--'+name)
    export = sub.add_parser('export')
    export.add_argument('run_id')
    export.add_argument('--output', type=Path, required=True)
    note = sub.add_parser('note')
    note.add_argument('run_id')
    note.add_argument('text')
    note.add_argument('--pass', dest='pass_index', type=int)
    verify = sub.add_parser('verify')
    verify.add_argument('run_id')
    diff = sub.add_parser('diff')
    diff.add_argument('left')
    diff.add_argument('right')
    imp = sub.add_parser('import-session')
    imp.add_argument('directory', type=Path)
    imp.add_argument('--suite', default='historical')
    imp.add_argument('--label', default='')
    imp.add_argument('--recorded-at', help='Known session date/time with timezone offset; unknown if omitted')
    args = parser.parse_args()
    ledger = None
    try:
        ledger = Ledger(args.db)
        if args.command == 'list':
            value = ledger.list(args.since, args.until, args.suite, args.config)
        elif args.command == 'export':
            value = ledger.export(args.run_id)
            with args.output.open('x') as stream:
                json.dump(value, stream, indent=2, allow_nan=False)
                stream.write('\n')
            value = {'export': str(args.output)}
        elif args.command == 'note':
            ledger.note(args.run_id, args.text, args.pass_index)
            value = {'run_id': args.run_id, 'note_added': True}
        elif args.command == 'verify':
            value = ledger.verify(args.run_id)
        elif args.command == 'diff':
            value = config_diff(ledger.export(args.left)['configuration'], ledger.export(args.right)['configuration'])
        else:
            value = {'run_id': import_session(ledger, args.directory, args.suite, args.label, args.recorded_at)}
        print(json.dumps(value, indent=2, allow_nan=False))
        return 2 if args.command == 'verify' and not value['integrity_ok'] else 0
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    finally:
        if ledger is not None:
            ledger.close()


if __name__ == '__main__':
    raise SystemExit(main())
