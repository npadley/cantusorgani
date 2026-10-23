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
