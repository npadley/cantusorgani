"""Card C5: the stale-conversion workflow reports and attempts carry-forward, and nothing else."""

from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOW = Path(".github/workflows/mei-stale.yml")


def load() -> dict:
    return yaml.safe_load(WORKFLOW.read_text())


def job() -> dict:
    return load()["jobs"]["stale"]


def commands(j: dict) -> str:
    return "\n".join(s.get("run", "") for s in j["steps"])


def test_workflow_runs_on_pushes_to_main_that_touch_sources_includes_or_converter() -> None:
    data = load()
    on = data[True] if True in data else data["on"]
    push = on["push"]
    assert push["branches"] == ["main"]
    assert set(push["paths"]) == {"data/typeset/src/**", "data/typeset/include/**", "pipeline/typeset/mei/**"}
    assert "pull_request" not in on and "pull_request_target" not in on


def test_workflow_and_job_have_no_permissions_and_no_secrets() -> None:
    data = load()
    assert data["permissions"] == {} and job()["permissions"] == {}
    assert "secrets." not in yaml.safe_dump(data)
    assert "environment" not in job()


def test_every_checkout_drops_credentials() -> None:
    checkouts = [s for s in job()["steps"] if s.get("uses", "").startswith("actions/checkout")]
    assert len(checkouts) >= 1
    assert all(s.get("with", {}).get("persist-credentials") is False for s in checkouts)


def test_workflow_never_publishes_or_commits() -> None:
    text = yaml.safe_dump(load())
    for banned in ("typeset-mei-publish", "git push", "git commit", "git add", "gh pr", "gh api", "R2_", "contents: write"):
        assert banned not in text, banned
    uploads = [s for s in job()["steps"] if s.get("uses", "").startswith("actions/upload-artifact")]
    assert {s["with"]["name"] for s in uploads} == {"mei-stale-report", "mei-carry-results"}


def test_workflow_reports_stale_then_converts_and_carries_in_the_sandbox() -> None:
    run = commands(job())
    assert "uv run noh typeset-mei-stale --json" in run
    assert run.index("typeset-mei-stale") < run.index("typeset-mei-convert") < run.index("typeset-mei-carry")
    assert 'typeset-mei-validate "build/mei/carry/$n/convert"' in run
    text = yaml.safe_dump(job())
    assert "NOH_SANDBOX" in text and "ulimit" in text and "unshare" in text
    assert "|| true" not in run and "set +e" not in run


def test_workflow_validates_paths_from_the_report_before_using_them() -> None:
    run = commands(job())
    assert "data/typeset/src/" in run and "data/typeset/mei/records/" in run and "*..*" in run


def test_no_expression_is_interpolated_into_a_run_script() -> None:
    for step in job()["steps"]:
        assert "${{" not in step.get("run", ""), step


def test_prior_revision_is_checked_out_from_the_push_event_for_the_comparison() -> None:
    prior = [s for s in job()["steps"] if s.get("with", {}).get("path") == "prior"]
    assert len(prior) == 1
    assert prior[0]["with"]["ref"] == "${{ github.event.before }}"
    assert prior[0].get("continue-on-error") is True
    assert "--prior-dir" in commands(job())
