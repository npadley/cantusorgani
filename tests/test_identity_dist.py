"""Byte parity, bundle exceptions and identity leak mutation proofs."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURE = Path(__file__).parent / "fixtures/identities/addresses/base"


@pytest.fixture
def trees(tmp_path):
    before, after = tmp_path / "before", tmp_path / "after"
    shutil.copytree(FIXTURE, before)
    shutil.copytree(FIXTURE, after)
    return before, after, tmp_path / "report"


def compare(trees, allow=None):
    before, after, out = trees
    args = [sys.executable, "-m", "tools.compare_identity_dist", "--before", str(before),
            "--after", str(after), "--out", str(out)]
    if allow is not None:
        path = out.parent / "allow.json"
        path.write_text(json.dumps(allow))
        args += ["--allow", str(path)]
    return subprocess.run(args, check=False, capture_output=True, text=True)


def test_identical_trees_pass(trees):
    result = compare(trees)
    assert result.returncode == 0, result.stderr
    assert json.loads((trees[2] / "report.json").read_text())["passed"]
    assert (trees[2] / "report.md").exists()


@pytest.mark.parametrize("mutation", ["page", "json", "whitespace", "leak", "graph",
                                      "sitemap", "headers", "redirects", "bundle"])
def test_unexplained_changes_fail(trees, mutation):
    after = trees[1]
    if mutation == "page":
        (after / "about/index.html").unlink()
    elif mutation == "json":
        (after / "payload.json").write_text('{"music": [2, 1]}')
    elif mutation == "whitespace":
        page = after / "index.html"
        page.write_text(page.read_text().replace("<body", "\n<body"))
    elif mutation == "leak":
        (after / "leak.js").write_text('"wrk_12345678-1234-1234-1234-123456789abc"')
    elif mutation == "graph":
        (after / "data/identities").mkdir(parents=True)
        (after / "data/identities/empty.json").write_text('{}')
    elif mutation == "bundle":
        (after / "_astro/export.abc123.js").rename(after / "_astro/export.def456.js")
    else:
        path = after / {"sitemap": "sitemap.xml", "headers": "_headers",
                        "redirects": "_redirects"}[mutation]
        path.write_text(path.read_text() + "\n")
    assert compare(trees).returncode == 1


def test_bundle_change_requires_reason(trees):
    path = "_astro/export.def456.js"
    (trees[1] / "_astro/export.abc123.js").rename(trees[1] / path)
    assert compare(trees).returncode == 1
    assert compare(trees, [{"path": path, "reason": "Reviewed dependency change"}]).returncode == 0


@pytest.mark.parametrize("path", ["index.html", "payload.json", "sitemap.xml"])
def test_nonbundle_allow_refused(trees, path):
    assert compare(trees, [{"path": path, "reason": "Do not permit"}]).returncode == 1


def test_json_format_difference_is_reported(trees):
    (trees[1] / "payload.json").write_text('{"music":[1,2]}')
    assert compare(trees).returncode == 1
    report = json.loads((trees[2] / "report.json").read_text())
    assert report["json_byte_changes"] == ["payload.json"]
    assert report["json_value_changes"] == []


def test_unlinked_anchor_change_fails_byte_comparison(trees):
    page = trees[1] / 'about/index.html'
    page.write_text(page.read_text().replace('name="old"', 'name="unlinked-changed"'))
    assert compare(trees).returncode == 1
    report = json.loads((trees[2] / 'report.json').read_text())
    assert report['html_changes'] == ['about/index.html']


def test_resolve_rev_pins_commit_and_rejects_invalid_output(monkeypatch, tmp_path):
    from tools import compare_identity_dist as tool

    calls = []

    def run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 0, 'a' * 40 + '\n', '')

    monkeypatch.setattr(subprocess, 'run', run)
    assert tool.resolve_rev(tmp_path, 'origin/main') == 'a' * 40
    assert calls == [['git', 'rev-parse', '--verify', '--end-of-options',
                      'origin/main^{commit}']]
    monkeypatch.setattr(subprocess, 'run', lambda *a, **kw:
                        subprocess.CompletedProcess(a[0], 0, 'not-a-sha', ''))
    with pytest.raises(ValueError, match='SHA'):
        tool.resolve_rev(tmp_path, 'bad')


def test_public_defaults_are_parsed_without_shell_execution(tmp_path):
    from tools import compare_identity_dist as tool

    script = tmp_path / 'check.sh'
    script.write_text('echo never-run\n' + '\n'.join(
        f'  export {key}="${{{key}:-{value}}}"' for key, value in {
            'PUBLIC_ASSET_BASE': 'https://assets.example',
            'PUBLIC_CORRECTIONS_ENDPOINT': 'https://api.example',
            'PUBLIC_TURNSTILE_SITE_KEY': 'test-key',
        }.items()))
    assert tool.public_defaults(script) == {
        'PUBLIC_ASSET_BASE': 'https://assets.example',
        'PUBLIC_CORRECTIONS_ENDPOINT': 'https://api.example',
        'PUBLIC_TURNSTILE_SITE_KEY': 'test-key',
    }
    script.write_text('')
    with pytest.raises(ValueError, match='defaults'):
        tool.public_defaults(script)


@pytest.mark.parametrize('name, expected', [
    ('_astro/export.abc.js', True), ('_astro/PDF.worker.abc.js', True),
    ('_astro/verovio.abc.js', True), ('_astro/mei.abc.js', True),
    ('_astro/scan.abc.css', True), ('_astro/customize.abc.js', True),
    ('_astro/calendar.abc.js', False), ('export/index.html', False),
])
def test_export_bundle_classifier(name, expected):
    from tools import compare_identity_dist as tool

    assert tool.export_bundle(name) is expected


def test_json_differences_identify_nested_fields():
    from tools import compare_identity_dist as tool

    assert tool.json_differences({'rows': [{'date': 'old'}]},
                                 {'rows': [{'date': 'new'}]}) == [
        {'field': '/rows/0/date', 'before': 'old', 'after': 'new'}]


def fake_build_runner(monkeypatch, tmp_path, *, nondeterministic=False, fail=False):
    from tools import compare_identity_dist as tool

    monkeypatch.setattr(tool, 'resolve_rev', lambda repo, rev: 'a' * 40)
    calls = []

    def run(self, command, cwd, env=None, *, optional=False):
        command = list(command)
        calls.append((command, cwd, env))
        code = 1 if '--offline' in command or fail and command == ['uv', 'sync', '--frozen'] else 0
        self.steps.append({'command': command, 'cwd': str(cwd), 'seconds': 0.25,
                           'returncode': code})
        if command[0] == 'bash':
            tree = Path(command[-1].split(' -C ')[1])
            (tree / 'scripts').mkdir()
            shutil.copyfile(Path('scripts/check.sh'), tree / 'scripts/check.sh')
            (tree / 'web').mkdir()
        if 'typeset-mei-stale' in command:
            stale = cwd / 'build/mei/stale/stale.json'
            stale.parent.mkdir(parents=True)
            stale.write_text('{}')
        if command == ['pnpm', 'build']:
            shutil.copytree(FIXTURE, cwd / 'dist')
            if nondeterministic and cwd.parent.name == 'base-repeat':
                (cwd / 'dist/payload.json').write_text('{"music": [1, 3]}')
        if '--version' in command:
            return 'fake-version'
        if code and not optional:
            raise ValueError('fake build failure')
        return None if code else ''

    monkeypatch.setattr(tool.BuildRunner, 'run', run)
    return tool, calls


def test_matched_build_provenance_and_offline_fallback(monkeypatch, tmp_path, capsys):
    tool, calls = fake_build_runner(monkeypatch, tmp_path)
    monkeypatch.setenv('PUBLIC_ASSET_BASE', 'must-not-inherit')
    monkeypatch.setenv('PUBLIC_MEI_MANIFEST', 'fixture')
    out = tmp_path / 'out'
    assert tool.main(['--base', 'main', '--head', 'main', '--repeat', '--out', str(out)]) == 0
    report = json.loads((out / 'report.json').read_text())
    provenance = report['provenance']
    assert provenance['shas'] == {'base': 'a' * 40, 'head': 'a' * 40}
    assert provenance['versions'] == dict.fromkeys(('node', 'pnpm', 'uv'), 'fake-version')
    assert provenance['allow_used'] is False
    assert provenance['install_modes'] == dict.fromkeys(('base', 'base-repeat', 'head'), 'online')
    assert provenance['steps'] and provenance['total_seconds'] >= 0
    assert report['determinism']['passed'] is True
    assert report['export_path_bundles'] == []
    assert report['verify_export_pdf_required'] is False
    builds = [(cmd, env) for cmd, cwd, env in calls if cmd == ['pnpm', 'build']]
    assert len(builds) == 3
    assert all(env['PUBLIC_ASSET_BASE'] == 'https://images.cantusorgani.org'
               and 'PUBLIC_MEI_MANIFEST' not in env for _, env in builds)
    legacy = next(cmd for cmd, _, _ in calls if '--inventory' in cmd)
    assert '--exceptions' in legacy and str(out / 'head/web/dist') in legacy
    assert 'pnpm build:e2e && pnpm test:e2e:export' in capsys.readouterr().out


def test_repeat_failure_stops_before_head_and_reports_fields(monkeypatch, tmp_path):
    tool, calls = fake_build_runner(monkeypatch, tmp_path, nondeterministic=True)
    out = tmp_path / 'out'
    assert tool.main(['--base', 'main', '--head', 'main', '--repeat', '--out', str(out)]) == 1
    report = json.loads((out / 'report.json').read_text())
    assert report['determinism']['byte_changes'] == ['payload.json']
    assert report['determinism']['json_field_changes']['payload.json'] == [
        {'field': '/music/1', 'before': 2, 'after': 3}]
    assert not any(cwd == out / 'head/web' for _, cwd, _ in calls)
    assert report['provenance']['steps']


def test_failed_build_keeps_provenance(monkeypatch, tmp_path):
    tool, _ = fake_build_runner(monkeypatch, tmp_path, fail=True)
    out = tmp_path / 'out'
    assert tool.main(['--base', 'main', '--head', 'main', '--out', str(out)]) == 1
    report = json.loads((out / 'report.json').read_text())
    assert report['errors'] == ['fake build failure']
    assert report['provenance']['steps'][-1]['returncode'] == 1


def test_command_runner_records_failure_log_and_duration(monkeypatch, tmp_path):
    from tools import compare_identity_dist as tool

    def run(command, **kwargs):
        kwargs['stdout'].write('offline package missing\n')
        return subprocess.CompletedProcess(command, 7)

    monkeypatch.setattr(subprocess, 'run', run)
    runner = tool.BuildRunner(tmp_path)
    assert runner.run(['pnpm', 'install', '--offline'], tmp_path, optional=True) is None
    assert runner.steps[0]['returncode'] == 7
    assert runner.steps[0]['seconds'] >= 0
    assert Path(runner.steps[0]['log']).read_text() == 'offline package missing\n'
    with pytest.raises(ValueError, match='Command failed'):
        runner.run(['pnpm', 'build'], tmp_path)
    assert len(runner.steps) == 2


def test_stale_mei_comparison_preserves_dates_and_formatting(tmp_path):
    from tools import compare_identity_dist as tool

    for side, date in [('before', '2026-10-21'), ('after', '2026-10-22')]:
        path = tmp_path / side / 'build/mei/stale/stale.json'
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'generated': date}))
    result = tool.compare_stale(tmp_path / 'before', tmp_path / 'after')
    assert result['changed'] is True
    assert result['fields'] == [{'field': '/generated', 'before': '2026-10-21',
                                 'after': '2026-10-22'}]
    (tmp_path / 'after/build/mei/stale/stale.json').write_text('{"generated":"2026-10-21"}')
    result = tool.compare_stale(tmp_path / 'before', tmp_path / 'after')
    assert result['changed'] is True
    assert result['fields'] == []


def test_matched_build_export_changes_and_allow_are_reported(monkeypatch, tmp_path):
    tool, _ = fake_build_runner(monkeypatch, tmp_path)
    original_run = tool.BuildRunner.run

    def run(self, command, cwd, env=None, *, optional=False):
        result = original_run(self, command, cwd, env, optional=optional)
        if command == ['pnpm', 'build'] and cwd.parent.name == 'head':
            (cwd / 'dist/_astro/export.abc123.js').rename(cwd / 'dist/_astro/export.def456.js')
        return result

    monkeypatch.setattr(tool.BuildRunner, 'run', run)
    allow = tmp_path / 'allow.json'
    allow.write_text(json.dumps([{'path': '_astro/export.def456.js', 'reason': 'Reviewed'}]))
    out = tmp_path / 'out'
    assert tool.main(['--base', 'main', '--head', 'main', '--allow', str(allow),
                      '--out', str(out)]) == 0
    report = json.loads((out / 'report.json').read_text())
    assert report['provenance']['allow_used'] is True
    assert report['verify_export_pdf_required'] is True
    assert report['export_path_bundles'] == ['_astro/export.abc123.js', '_astro/export.def456.js']
