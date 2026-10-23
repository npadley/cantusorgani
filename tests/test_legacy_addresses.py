"""Mutation proofs for the captured historical address contract."""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from tools.check_legacy_addresses import addresses

FIXTURE = Path(__file__).parent / "fixtures/identities/addresses/base"


def run(*args):
    return subprocess.run(
        [sys.executable, "-m", "tools.check_legacy_addresses", *map(str, args)],
        check=False, capture_output=True, text=True,
    )


@pytest.fixture
def captured(tmp_path):
    dist = tmp_path / "dist"
    shutil.copytree(FIXTURE, dist)
    inventory = tmp_path / "inventory.json"
    result = run("--capture", "--dist", dist, "--out", inventory, "--commit", "unknown")
    assert result.returncode == 0, result.stderr
    return dist, inventory


def test_inventory_identical_tree_passes(captured):
    dist, inventory = captured
    assert run("--inventory", inventory, "--dist", dist).returncode == 0
    data = json.loads(inventory.read_text())
    assert "/about/?date=2026-10-22#credit" in addresses(data)
    assert data["origins"][0]["file_count"] == 7


@pytest.mark.parametrize("mutation", ["page", "fragment", "loop", "dynamic", "policy"])
def test_inventory_mutated_tree_fails(captured, mutation):
    dist, inventory = captured
    page = dist / "about/index.html"
    if mutation == "page":
        page.unlink()
    elif mutation == "fragment":
        page.write_text(page.read_text().replace('id="credit"', 'id="gone"'))
    elif mutation == "loop":
        (dist / "_redirects").write_text("/old/ /about/ 301\n/about/ /old/ 301\n")
    elif mutation == "dynamic":
        (dist / "_redirects").write_text("/old/* /about/:splat 301\n")
    else:
        page.write_text(page.read_text().replace("noindex, follow", "index, follow"))
    result = run("--inventory", inventory, "--dist", dist)
    assert result.returncode == 1, result.stdout + result.stderr


def test_refresh_chain_preserves_fragment(captured):
    dist, inventory = captured
    (dist / "_redirects").write_text("/old/ /hop/ 301\n")
    (dist / "hop").mkdir()
    (dist / "hop/index.html").write_text(
        '<meta http-equiv="Refresh" content="0; url=/about/">'
    )
    assert run("--inventory", inventory, "--dist", dist).returncode == 0
    data = json.loads(inventory.read_text())
    data["routes"].append({"path": "/old/", "fragments": ["credit"], "queries": []})
    inventory.write_text(json.dumps(data))
    assert run("--inventory", inventory, "--dist", dist).returncode == 0
    (dist / "hop/index.html").write_text(
        '<meta http-equiv="refresh" content="0;url=/hop/">'
    )
    assert run("--inventory", inventory, "--dist", dist).returncode == 1


def test_capture_union_keeps_old_entries(captured):
    dist, inventory = captured
    old = json.loads(inventory.read_text())
    (dist / "about/index.html").unlink()
    assert run("--capture", "--dist", dist, "--out", inventory).returncode == 0
    new = json.loads(inventory.read_text())
    assert set(addresses(old)) <= set(addresses(new))
    assert len(new["origins"]) == 2
    first = inventory.read_bytes()
    assert run("--capture", "--dist", dist, "--out", inventory).returncode == 0
    assert inventory.read_bytes() == first


def test_capture_records_dynamic_rules_but_resolution_refuses_them(captured):
    dist, inventory = captured
    (dist / "_redirects").write_text("/old/* /about/:splat 301\n")
    result = run("--capture", "--dist", dist, "--out", inventory)
    assert result.returncode == 0, result.stdout
    assert any(rule["from"] == "/old/*"
               for rule in json.loads(inventory.read_text())["redirects"])
    assert run("--inventory", inventory, "--dist", dist).returncode == 1


def test_capture_only_linked_anchors_and_scratch_all(captured):
    dist, inventory = captured
    data = json.loads(inventory.read_text())
    assert data['schema_version'] == 2
    about = next(row for row in data['routes'] if row['path'] == '/about/')
    assert about['fragments'] == []  # credit is linked with a query, kept together
    assert about['queries'] == ['date=2026-10-22#credit']
    assert 'anchors' not in data and 'addresses' not in data
    scratch = inventory.parent / 'scratch.json'
    result = run('--capture', '--anchors', 'all', '--dist', dist, '--out', scratch)
    assert result.returncode == 0, result.stderr
    about = next(row for row in json.loads(scratch.read_text())['routes']
                 if row['path'] == '/about/')
    assert about['fragments'] == ['credit', 'old']
    tracked = inventory.parent / 'data/identities/legacy-addresses.json'
    assert run('--capture', '--anchors', 'all', '--dist', dist,
               '--out', tracked).returncode == 1


def test_capture_excludes_build_assets_keeps_stable_resources(captured):
    dist, inventory = captured
    for name in ['pagefind/pagefind.js', 'assets/app.Ab12cd34.js',
                 'corrections/targets.json', 'chants/kyrie.json']:
        path = dist / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{}')
    assert run('--capture', '--dist', dist, '--out', inventory).returncode == 0
    resources = json.loads(inventory.read_text())['resources']
    assert '/corrections/targets.json' in resources
    assert '/chants/kyrie.json' in resources
    assert not any('_astro' in p or 'pagefind' in p or 'Ab12cd34' in p for p in resources)


def test_inventory_exceptions_must_match_failures_exactly(captured):
    dist, inventory = captured
    exceptions = inventory.parent / 'legacy-address-exceptions.json'
    exceptions.write_text(json.dumps([{'address': '/about/?date=2026-10-22#credit',
                                       'reason': 'broken on main'}]))
    assert run('--inventory', inventory, '--dist', dist).returncode == 1
    page = dist / 'about/index.html'
    page.write_text(page.read_text().replace('id="credit"', 'id="gone"'))
    assert run('--inventory', inventory, '--dist', dist).returncode == 0
    (dist / 'payload.json').unlink()
    assert run('--inventory', inventory, '--dist', dist).returncode == 1


def test_linked_fragment_without_query_is_kept(captured):
    dist, inventory = captured
    page = dist / 'index.html'
    page.write_text(page.read_text() + '<a href="/about/#old">Old</a>')
    assert run('--capture', '--dist', dist, '--out', inventory).returncode == 0
    data = json.loads(inventory.read_text())
    about = next(row for row in data['routes'] if row['path'] == '/about/')
    assert about['fragments'] == ['old']
    assert '/about/#old' in addresses(data)


def test_build_hash_detection_preserves_descriptive_font_names():
    from tools.check_legacy_addresses import build_asset

    assert build_asset('assets/app.ABCDEFGH.js')
    assert build_asset('assets/app-deadbeef.css')
    assert not build_asset('fonts/source-serif-4-latin-400-normal.woff2')
