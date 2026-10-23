"""The outer writers refresh identities only after legacy output is complete."""
from pathlib import Path

import pytest
import yaml

from pipeline.cli import build_parser, main

ROOT = Path(__file__).resolve().parents[1]


def test_regenerate_identity_refresh_follows_final_writer():
    text = (ROOT / 'scripts/regenerate.sh').read_text()
    assert text.rindex('uv run noh corrections --lapsed') < text.index('uv run noh identities allocate')
    assert text.index('uv run noh identities allocate') < text.index('uv run noh identities build')
    assert text.index('uv run noh identities build') < text.index('uv run noh identities check')


@pytest.mark.parametrize('name', ['corrections-batch', 'catalog-rebuild', 'publish'])
def test_workflow_final_catalogue_write_refreshes_and_stages_identities(name):
    text = (ROOT / f'.github/workflows/{name}.yml').read_text()
    final_write = text.rindex('uv run noh ordinary-form')
    allocate = text.index('uv run noh identities allocate')
    check = text.index('uv run noh identities check')
    build = text.index('uv run noh identities build')
    assert final_write < allocate < build < check
    stages = [line for line in text.splitlines() if 'git add ' in line]
    for path in ['data/identities/ledger.json', 'data/identities/migration.json']:
        assert any(path in line and text.index(line) > check for line in stages)


def test_cli_identity_check_dispatches_read_only(monkeypatch, capsys, tmp_path):
    from pipeline import identities

    calls = []
    monkeypatch.setattr(identities, 'check', lambda data: calls.append(data) or {'entity_counts': {}})
    assert main(['identities', '--data', str(tmp_path), 'check']) == 0
    assert calls == [tmp_path]
    assert capsys.readouterr().out.strip() == '{}'


@pytest.mark.parametrize('command', ['bootstrap', 'allocate', 'build', 'check', 'resolve'])
def test_cli_identity_group_mirrors_module_commands(command):
    argv = ['identities', command] + (['piece:example'] if command == 'resolve' else [])
    args = build_parser().parse_args(argv)
    assert args.identity_command == command


def test_cli_where_accepts_ids():
    assert build_parser().parse_args(['where', '--ids', 'dominica-i-adventus']).ids


def test_site_python_job_runs_identity_checks():
    workflow = yaml.safe_load((ROOT / '.github/workflows/site.yml').read_text())
    runs = '\n'.join(str(step.get('run', '')) for step in workflow['jobs']['python']['steps'])
    assert 'uv run noh identities check' in runs
    assert 'uv run python -m tools.check_identity_migration' in runs


def test_quick_checks_include_identities_and_available_dist_addresses():
    text = (ROOT / 'scripts/check.sh').read_text()
    quick = text[:text.index('if ! $QUICK; then')]
    assert 'uv run noh identities check' in quick
    assert 'uv run python -m tools.check_identity_migration' in quick
    assert 'uv run python -m tools.check_legacy_addresses' in text
    assert 'tools.compare_identity_dist' not in text


def test_where_ids_preserves_edit_targets_and_writes_nothing(tmp_path):
    import json
    import shutil

    from pipeline.identities import bootstrap
    from pipeline.where import where

    (tmp_path / 'identities').mkdir()
    (tmp_path / 'schema').mkdir()
    registry = next(path for path in ('identities/sources.json', 'identities/sources.yml')
                    if (ROOT / 'data' / path).exists())
    for name in (registry, 'schema/identities.json', 'volumes.yml'):
        shutil.copy(ROOT / 'data' / name, tmp_path / name)
    catalog = json.loads((ROOT / 'data/catalog.json').read_text())
    catalog['pieces'] = [piece for piece in catalog['pieces']
                         if piece['slug'] == 'dominica-i-adventus']
    (tmp_path / 'catalog.json').write_text(json.dumps(catalog))
    bootstrap(tmp_path)
    before = {path: path.read_bytes() for path in tmp_path.rglob('*') if path.is_file()}
    plain = where('dominica-i-adventus', catalog, tmp_path)[0]
    diagnostic = where('dominica-i-adventus', catalog, tmp_path, ids=True)[0]
    assert (diagnostic.target, diagnostic.more, diagnostic.command) == (
        plain.target, plain.more, plain.command)
    assert any('part:dominica-i-adventus/introit: itm_614a61a9-f6a0-50aa-9d7d-6e4d02d6e7b8'
               in line for line in diagnostic.identities)
    assert {path: path.read_bytes() for path in tmp_path.rglob('*') if path.is_file()} == before
