"""Card C5: typeset-mei-stale reports approved conversions whose inputs have moved on."""

from __future__ import annotations

import dataclasses
import json
from pathlib import Path

from pipeline.typeset.mei.cli import stale_command
from pipeline.typeset.mei.manifest import record_to_dict
from pipeline.typeset.mei.model import ConversionInputs, ConversionRecord
from pipeline.typeset.mei.stale import FIELD_REASONS, stale_entries
from tests.test_mei_publish import INPUTS, MEI, make_record, sha

PARTS = [{"target": "movement:x", "file": "x.ly", "hash": "a" * 32}]


def approved() -> ConversionRecord:
    return make_record(sha(MEI))


def moved(**patch: str):
    return lambda record: dataclasses.replace(record.inputs, **patch)


def test_stale_entries_current_record_is_not_reported() -> None:
    assert stale_entries([approved()], lambda r: r.inputs, PARTS) == []


def test_stale_entries_each_input_field_maps_to_its_reason() -> None:
    expected = {
        "source_sha256": "source", "include_sha256": "include", "converter_version": "converter",
        "extractor_version": "extractor", "profile_id": "profile", "profile_sha256": "profile",
        "schema_sha256": "schema", "lilypond_version": "lilypond", "verovio_version": "verovio", "font_digest": "font",
    }
    assert FIELD_REASONS == expected
    assert set(expected) == {f.name for f in dataclasses.fields(ConversionInputs)}
    for field, reason in expected.items():
        (entry,) = stale_entries([approved()], moved(**{field: "changed"}), PARTS)
        assert [r.field for r in entry.reasons] == [field] and entry.reasons[0].reason == reason
        assert entry.reasons[0].recorded == getattr(INPUTS, field) and entry.reasons[0].current == "changed"


def test_stale_entries_lists_every_changed_field_in_declaration_order() -> None:
    (entry,) = stale_entries([approved()], moved(font_digest="z", source_sha256="y"), PARTS)
    assert [r.reason for r in entry.reasons] == ["source", "font"]
    assert entry.target == "movement:x" and entry.artifact_sha256 == sha(MEI)
    assert entry.source_path == "data/typeset/src/x.ly"


def test_stale_entries_changed_render_hash_is_reported_even_with_unchanged_inputs() -> None:
    parts = [{"target": "movement:x", "file": "x.ly", "hash": "b" * 32}]
    (entry,) = stale_entries([approved()], lambda r: r.inputs, parts)
    assert [r.reason for r in entry.reasons] == ["render_hash"]
    assert entry.reasons[0].recorded == "a" * 32 and entry.reasons[0].current == "b" * 32


def test_stale_entries_target_missing_from_the_matched_parts_is_reported() -> None:
    (entry,) = stale_entries([approved()], lambda r: r.inputs, [])
    assert [r.reason for r in entry.reasons] == ["render_hash"] and entry.reasons[0].current == "absent"


def test_stale_entries_unapproved_records_are_ignored() -> None:
    needs_review = dataclasses.replace(approved(), state="needs-review", review=None)
    assert stale_entries([needs_review], moved(include_sha256="q"), PARTS) == []


def test_stale_entries_review_bound_to_another_digest_is_reported_as_approval() -> None:
    record = approved()
    assert record.review is not None
    broken = dataclasses.replace(record, review=dataclasses.replace(record.review, inputs_digest="0" * 64))
    (entry,) = stale_entries([broken], lambda r: r.inputs, PARTS)
    assert [r.reason for r in entry.reasons] == ["approval"]


def write_records(directory: Path, *records: ConversionRecord) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    for n, record in enumerate(records):
        (directory / f"r{n}.json").write_text(json.dumps(record_to_dict(record)), encoding="utf-8")
    return directory


def matched(tmp_path: Path, hash_: str = "a" * 32) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"parts": [{"target": "movement:x", "file": "x.ly", "hash": hash_}]}), encoding="utf-8")
    return path


def test_stale_command_json_lists_stale_records_and_exits_zero(tmp_path: Path, capsys) -> None:
    records = write_records(tmp_path / "records", approved())
    rc = stale_command(records, as_json=True, current_inputs=moved(include_sha256="new"), matched=matched(tmp_path))
    assert rc == 0
    data = json.loads(capsys.readouterr().out)
    assert data["checked"] == 1 and len(data["stale"]) == 1
    item = data["stale"][0]
    assert item["sourcePath"] == "data/typeset/src/x.ly" and item["target"] == "movement:x"
    assert item["reasons"] == [{"field": "include_sha256", "reason": "include", "recorded": "i", "current": "new"}]


def test_stale_command_table_is_readable(tmp_path: Path, capsys) -> None:
    records = write_records(tmp_path / "records", approved())
    stale_command(records, current_inputs=moved(converter_version="c2"), matched=matched(tmp_path))
    out = capsys.readouterr().out
    assert "movement:x" in out and "converter" in out and "data/typeset/src/x.ly" in out
    assert "1 of 1 approved conversion(s) stale" in out


def test_stale_command_nothing_stale_says_so(tmp_path: Path, capsys) -> None:
    records = write_records(tmp_path / "records", approved())
    assert stale_command(records, current_inputs=lambda r: r.inputs, matched=matched(tmp_path)) == 0
    assert "none stale" in capsys.readouterr().out


def test_stale_command_fail_on_stale_exits_one_only_when_stale(tmp_path: Path) -> None:
    records = write_records(tmp_path / "records", approved())
    ok = {"current_inputs": lambda r: r.inputs, "matched": matched(tmp_path)}
    assert stale_command(records, fail_on_stale=True, **ok) == 0
    stale = {"current_inputs": moved(font_digest="z"), "matched": matched(tmp_path)}
    assert stale_command(records, fail_on_stale=False, **stale) == 0
    assert stale_command(records, fail_on_stale=True, **stale) == 1


def test_stale_command_out_writes_the_json_report(tmp_path: Path) -> None:
    records = write_records(tmp_path / "records", approved())
    out = tmp_path / "build" / "stale.json"
    stale_command(records, as_json=True, out=out, current_inputs=moved(font_digest="z"), matched=matched(tmp_path))
    assert json.loads(out.read_text(encoding="utf-8"))["stale"][0]["reasons"][0]["reason"] == "font"


def test_noh_registers_typeset_mei_stale(tmp_path: Path, capsys) -> None:
    from pipeline import cli

    records = write_records(tmp_path / "records", approved())
    assert cli.main(["typeset-mei-stale", "--records", str(records), "--json"]) == 0
    data = json.loads(capsys.readouterr().out)
    assert data["checked"] == 1 and data["stale"] and data["stale"][0]["target"] == "movement:x"
    assert cli.main(["typeset-mei-stale", "--records", str(records), "--fail-on-stale"]) == 1


def test_noh_typeset_mei_stale_default_records_dir_is_the_committed_one(capsys) -> None:
    from pipeline import cli

    assert cli.main(["typeset-mei-stale", "--json"]) == 0
    assert "checked" in json.loads(capsys.readouterr().out)
