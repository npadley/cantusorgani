"""Offline pinned-baseline migration/replay proof; never writes existing data.

The fixture is data/ at BASELINE, plus M1's new source registry/schema. Both
runs use that same immutable input. Timings are printed, never tracked in JSON.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
from pathlib import Path

from pipeline.identities import build, check
from pipeline.identities.model import DATA, sha

BASELINE = 'a4c520840f0b03cf3dda1e65aef938759847eaab'
ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = ('snapshot.json', 'aliases.json', 'migration.json')


def identity_path(tree, name):
    return tree / ('data/identities' if name in ('ledger.json', 'migration.json')
                   else 'build/identities') / name


def tracked_bytes(root):
    names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    # No secrets, pipes or untracked render/source files are traversed.
    return {name: sha(root / name) for name in names if name and (root / name).is_file()}


def export_fixture(destination):
    payload = subprocess.check_output(['git', 'archive', BASELINE, 'data'], cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(payload)) as archive:
        archive.extractall(destination, filter='data')
    # Replay checks PDF checksums. Symlink only the tracked, pinned NOH scans;
    # never copy other pdf-source files or read credentials.
    scan_names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', BASELINE, 'pdf-source'], cwd=ROOT).decode().splitlines()
    for name in scan_names:
        if Path(name).name.startswith('NOH') and name.endswith('.pdf'):
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(ROOT / name)
    shutil.copytree(ROOT / 'pipeline', destination / 'pipeline',
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    (destination / 'web/public').mkdir(parents=True)
    shutil.copy(ROOT / 'web/public/_redirects', destination / 'web/public/_redirects')
    for name in ['identities/sources.json', 'schema/identities.json', 'identities/aliases.yml']:
        path = DATA / name
        if path.exists():
            dest = destination / 'data' / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(path, dest)


def run(tree, seed, locale, code):
    env = {**os.environ, 'PYTHONHASHSEED': str(seed), 'LC_ALL': locale,
           'LANG': locale, 'PYTHONPATH': str(tree), 'PYTHONDONTWRITEBYTECODE': '1'}
    subprocess.run([sys.executable, '-c', "import locale; locale.setlocale(locale.LC_ALL, '');\n" + code], cwd=tree, env=env, check=True,
                   capture_output=True)


REPLAY = '''
from pathlib import Path
from pipeline import corrections
outputs = corrections._outputs(Path('data/catalog.base.json'), Path('data/corrections.yml'), Path('data/catalog.json'))
for path, content in outputs.items():
    path.write_text(content, encoding='utf-8')
'''
MIGRATE = '''
from pathlib import Path
from pipeline.identities import bootstrap, build, check
bootstrap(Path('data'))
build(Path('data'))
check(Path('data'))
'''


def verify():
    started = time.monotonic()
    before = tracked_bytes(ROOT)
    dirty = subprocess.check_output(['git', 'diff', '--name-only', '--', 'data'], cwd=ROOT).decode().splitlines()
    if any(not (name.startswith('data/identities/') or name == 'data/schema/identities.json') for name in dirty):
        raise ValueError(f'protected tracked data differs from git: {dirty}')
    with tempfile.TemporaryDirectory(prefix='identity-migration-') as folder:
        trees = [Path(folder) / name for name in ('a', 'b')]
        timings = {}
        for tree, seed, locale in zip(trees, (1, 431), ('C', 'en_US.UTF-8'), strict=True):
            t = time.monotonic()
            export_fixture(tree)
            original = {p.relative_to(tree).as_posix(): sha(p) for p in (tree / 'data').rglob('*') if p.is_file()}
            run(tree, seed, locale, REPLAY)
            replayed = {name: sha(tree / name) for name in original}
            run(tree, seed, locale, REPLAY)
            if replayed != {name: sha(tree / name) for name in original}:
                raise ValueError('second legacy replay changed bytes')
            run(tree, seed, locale, MIGRATE)
            if replayed != {name: sha(tree / name) for name in original}:
                raise ValueError('identity migration changed legacy bytes')
            identity_before = {name: identity_path(tree, name).read_bytes()
                               for name in (*OUTPUTS, 'ledger.json')}
            run(tree, seed + 7, locale, "from pipeline.identities import build, check; build(); check()")
            if identity_before != {name: identity_path(tree, name).read_bytes()
                                    for name in identity_before}:
                raise ValueError('second identity build changed bytes')
            timings[tree.name] = round(time.monotonic() - t, 3)
        for name in (*OUTPUTS, 'ledger.json'):
            a, b = [identity_path(tree, name).read_bytes() for tree in trees]
            if a != b:
                raise ValueError(f'hash-seed/locale nondeterminism: {name}')
        # Initial deterministic allocations remain a subset of the permanent
        # ledger; later UUIDv4 allocations need not equal bootstrap seeds.
        initial = json.loads((trees[0] / 'data/identities/ledger.json').read_text())
        current = json.loads((DATA / 'identities/ledger.json').read_text())
        current_by_id = {e['id']: e for e in current['entries']}
        for entry in initial['entries']:
            now = current_by_id.get(entry['id'])
            if now is None or (now['kind'], now['birth_seed']) != (entry['kind'], entry['birth_seed']):
                raise ValueError(f'lost permanent allocation: {entry["id"]}')
        check(DATA)
        # Compare the current checkout in scratch too, including all new
        # generated sidecars. The real checkout remains read-only here.
        build(DATA, Path(folder) / 'current')
    after = tracked_bytes(ROOT)
    if before != after:
        raise ValueError(f'existing tracked bytes changed: {before.keys() ^ after.keys() or [k for k in before if before[k] != after[k]]}')
    print(json.dumps({'baseline': BASELINE, 'replay_and_migration_seconds': timings,
                          'total_seconds': round(time.monotonic() - started, 3),
                          'protected_tracked_files': len(before)}, sort_keys=True))


def main():
    try:
        verify()
    except subprocess.CalledProcessError as exc:
        sys.exit(exc.stderr.decode() if exc.stderr else str(exc))
    except ValueError as exc:
        sys.exit(str(exc))


if __name__ == '__main__':
    main()
