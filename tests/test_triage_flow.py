"""Triage end-to-end flow, with wrangler (the external dependency) faked.

The fake records every SQL statement the tool would send to D1, so these tests
assert on what would actually reach the database — including the bug where
accepted corrections were never marked and stayed `pending` forever.
"""

import json
from dataclasses import dataclass, field

import pytest

from tools.triage import main as triage


@dataclass
class FakeD1:
    """Stands in for `wrangler d1 execute`: answers SELECTs, records everything."""
    pending: list[dict[str, object]] = field(default_factory=list)
    statements: list[str] = field(default_factory=list)

    def run(self, args: list[str], cwd=None) -> str:
        sql = args[args.index("--command") + 1]
        self.statements.append(sql)
        if sql.startswith("SELECT"):
            return json.dumps([{"results": self.pending}])
        return json.dumps([{"results": []}])

    def updates(self) -> list[str]:
        return [s for s in self.statements if s.startswith("UPDATE")]


def correction(**overrides: object) -> dict[str, object]:
    row = {"id": 1, "piece_id": "ordinarium-missae-i", "field": "mode",
           "proposed": "VIII", "note": "Liber Usualis", "status": "pending",
           "created_at": "2026-09-08 03:02:58"}
    row.update(overrides)
    return row


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    """A catalog in a temp data dir, and a FakeD1 wired in as the wrangler seam."""
    catalog = {"pieces": [{"id": "noh5-ordinarium-missae-i", "slug": "ordinarium-missae-i", "genre": "kyrie",
                           "mode": "III", "printed_pages": [5, 10], "pdf_pages": [51, 56]}]}
    (tmp_path / "catalog.json").write_text(json.dumps(catalog))
    (tmp_path / "catalog.base.json").write_text(json.dumps(catalog))
    monkeypatch.setattr(triage, "DATA", tmp_path)
    fake = FakeD1()
    monkeypatch.setattr(triage, "_run", fake.run)
    return tmp_path, fake


def answers(monkeypatch, *replies: str) -> None:
    it = iter(replies)
    monkeypatch.setattr("builtins.input", lambda _prompt="": next(it))


def read_catalog(path) -> dict:
    return json.loads((path / "catalog.json").read_text())


def test_main_no_pending_prints_and_exits_zero(workspace, capsys):
    assert triage.main([]) == 0
    assert "No pending corrections" in capsys.readouterr().out


def test_main_accept_writes_catalog_and_marks_row_accepted(workspace, monkeypatch):
    """Regression: accepted corrections were never marked. They stayed pending,
    showed as pending on the public queue, and were re-prompted next run."""
    data, fake = workspace
    fake.pending = [correction()]
    answers(monkeypatch, "y")
    assert triage.main([]) == 0
    assert read_catalog(data)["pieces"][0]["mode"] == "VIII"
    # Recorded in the overlay, so the next `noh catalog` run keeps it.
    assert "source: reader#1" in (data / "corrections.yml").read_text()
    assert json.loads((data / "catalog.base.json").read_text())["pieces"][0]["mode"] == "III"
    assert fake.updates() == [
        "UPDATE corrections SET status = 'accepted', commit_sha = NULL WHERE id = 1"]


def test_main_reject_marks_row_rejected_and_leaves_catalog(workspace, monkeypatch):
    data, fake = workspace
    fake.pending = [correction()]
    answers(monkeypatch, "n")
    triage.main([])
    assert read_catalog(data)["pieces"][0]["mode"] == "III"
    assert "status = 'rejected'" in fake.updates()[0]


def test_main_quit_keeps_what_was_already_accepted(workspace, monkeypatch):
    data, fake = workspace
    fake.pending = [correction(id=1), correction(id=2, proposed="IV")]
    answers(monkeypatch, "y", "q")
    triage.main([])
    assert read_catalog(data)["pieces"][0]["mode"] == "VIII"
    assert fake.updates() == [
        "UPDATE corrections SET status = 'accepted', commit_sha = NULL WHERE id = 1"]


def test_main_invalid_value_is_refused_and_rejected_without_prompting(workspace, monkeypatch):
    data, fake = workspace
    fake.pending = [correction(proposed="<script>")]
    monkeypatch.setattr("builtins.input", lambda _p="": pytest.fail("must not prompt"))
    triage.main([])
    assert "status = 'rejected'" in fake.updates()[0]
    assert read_catalog(data)["pieces"][0]["mode"] == "III"


def test_main_unknown_piece_is_refused_after_acceptance(workspace, monkeypatch):
    _, fake = workspace
    fake.pending = [correction(piece_id="does-not-exist")]
    answers(monkeypatch, "y")
    triage.main([])
    assert "status = 'rejected'" in fake.updates()[0]


def test_main_dry_run_writes_and_marks_nothing(workspace, monkeypatch):
    data, fake = workspace
    fake.pending = [correction(), correction(id=2, proposed="<bad>")]
    monkeypatch.setattr("builtins.input", lambda _p="": pytest.fail("must not prompt"))
    triage.main(["--dry-run"])
    assert fake.updates() == []
    assert read_catalog(data)["pieces"][0]["mode"] == "III"


def test_main_local_flag_targets_the_local_database(workspace, monkeypatch):
    _, fake = workspace
    seen: list[list[str]] = []
    original = fake.run
    monkeypatch.setattr(triage, "_run", lambda args, cwd=None: (seen.append(args), original(args))[1])
    triage.main(["--local"])
    assert "--local" in seen[0] and "--remote" not in seen[0]


def test_bind_rejects_a_string_that_is_not_a_simple_token():
    """Nothing a stranger wrote may reach SQL through the binder."""
    with pytest.raises(ValueError, match="refusing to bind"):
        triage._bind("UPDATE t SET a = ? WHERE id = ?", ("x'; DROP TABLE corrections; --", 1))


def test_bind_placeholder_count_mismatch_is_an_error():
    with pytest.raises(ValueError, match="placeholders"):
        triage._bind("SELECT ? , ?", (1,))


def test_bind_rejects_booleans_that_would_pass_as_ints():
    with pytest.raises(TypeError):
        triage._bind("SELECT ?", (True,))


def test_mark_rejects_an_unexpected_status(workspace):
    with pytest.raises(ValueError, match="refusing to set status"):
        triage.mark(1, "published", None)


def test_mark_rejects_a_malformed_commit_sha(workspace):
    with pytest.raises(ValueError, match="refusing commit sha"):
        triage.mark(1, "accepted", "HEAD; rm -rf /")


def test_stamp_refuses_while_catalog_is_uncommitted(workspace, monkeypatch):
    monkeypatch.setattr(triage, "catalog_is_committed", lambda: False)
    with pytest.raises(RuntimeError, match="Commit them first"):
        triage.main(["--stamp"])


def test_stamp_records_head_against_unstamped_accepted_rows(workspace, monkeypatch):
    _, fake = workspace
    monkeypatch.setattr(triage, "catalog_is_committed", lambda: True)
    original = fake.run

    def run(args, cwd=None):
        if args[:2] == ["git", "rev-parse"]:
            return "abc1234\n"
        return original(args)

    monkeypatch.setattr(triage, "_run", run)
    assert triage.main(["--stamp"]) == 0
    assert fake.updates() == [
        ("UPDATE corrections SET commit_sha = 'abc1234' "
         "WHERE status = 'accepted' AND commit_sha IS NULL")]


def test_head_sha_rejects_unexpected_git_output(monkeypatch):
    monkeypatch.setattr(triage, "_run", lambda args, cwd=None: "not a sha\n")
    with pytest.raises(RuntimeError, match="unexpected git sha"):
        triage.head_sha()


def test_run_nonzero_exit_raises_with_stderr(monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr(triage.subprocess, "run",
                        lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr="boom"))
    with pytest.raises(RuntimeError, match="boom"):
        triage._run(["npx", "wrangler"])


def test_cited_page_names_the_overlay_for_visual_checking():
    catalog = {"pieces": [{"id": "p", "slug": "s", "printed_pages": [5, 10], "pdf_pages": [51, 56]}]}
    assert "overlay: build/overlay/noh5/0051.png" in triage._cited_page(catalog, "s")
    assert triage._cited_page(catalog, "missing") == "piece not found in catalog"
