"""Rendering, checking and publishing the typeset music."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Self

import pytest

from pipeline.typeset import manifest, publish, render
from pipeline.typeset.render import FORMATS, source_hash, warnings_in, wrap
from pipeline.typeset.svgcheck import check_pdf, problems
from tests.test_upload_transport import FakeS3

SOURCE = '\\version "2.26.0"\n\\include "gregorian.ly"\n\\include "noh2.ily"\nx = { c\'4 \\forceBreak }\n'
NARROW, WIDE, LETTER, A4 = FORMATS

# ------------------------------------------------------------------ render ---


def test_wrap_the_phone_layout_comes_after_the_house_style_and_the_page_at_the_end():
    text = wrap(SOURCE, NARROW)
    assert text.index('\\include "noh2.ily"') < text.index('\\include "prelude.ily"') < \
        text.index('\\include "narrow.ily"') < text.index("x = {")
    assert text.rstrip().endswith("#(set-global-staff-size 17)")
    assert "paper-width = 90\\mm" in text and '\\include "render.ily"' in text


def test_wrap_the_wide_and_print_layouts_keep_the_books_breaks():
    assert "narrow.ily" not in wrap(SOURCE, WIDE) and "prelude.ily" in wrap(SOURCE, WIDE)
    assert '#(set-paper-size "letter")' in wrap(SOURCE, LETTER) and '#(set-paper-size "a4")' in wrap(SOURCE, A4)
    assert "top-margin = 12\\mm" in wrap(SOURCE, LETTER)


def test_source_hash_changes_with_the_source_the_includes_and_the_version(tmp_path: Path):
    include = tmp_path / "include"
    include.mkdir()
    (include / "noh2.ily").write_text("a = 1\n")
    first = source_hash(SOURCE, include, "2.26.0")
    assert source_hash(SOURCE, include, "2.26.0") == first and len(first) == 32
    assert source_hash(SOURCE + "%\n", include, "2.26.0") != first
    assert source_hash(SOURCE, include, "2.26.1") != first
    (include / "noh2.ily").write_text("a = 2\n")
    assert source_hash(SOURCE, include, "2.26.0") != first


def test_warnings_in_names_the_line_and_skips_the_ignored_ones():
    log = ("/tmp/x/source.ly:52:1: warning: Unattached SlurEvent\n"
           "warning: gregorian.ly is deprecated; use VaticanaScore context\n"
           "programming error: no heads for note column\n")
    assert warnings_in(log) == ["line 52:1: warning: Unattached SlurEvent", "programming error: no heads for note column"]
    assert any(p.search(warnings_in(log)[1]) for p in render.FATAL_WARNINGS)
    assert not any(p.search(warnings_in(log)[1]) for p in render.RECOVERED)
    assert any(p.search("programming error: Tie without heads.  Suicide") for p in render.RECOVERED)


@pytest.mark.lilypond
def test_render_the_kyrie_draws_three_checked_files(tmp_path: Path):
    from pipeline.typeset.svgcheck import WIDTHS, check_file
    result = render.render(Path("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly"), tmp_path)
    assert result.ok and result.problems == []
    folder = tmp_path / result.hash
    assert sorted(p.name for p in folder.iterdir()) == ["a4.pdf", "letter.pdf", "narrow.svg", "wide.svg"]
    for name, width in WIDTHS.items():
        assert check_file(folder / name, width) == []
    for name in ("letter.pdf", "a4.pdf"):
        assert check_pdf((folder / name).read_bytes()) == []
    # Letter is 612 x 792 points; A4 595 x 842.
    assert b"MediaBox [ 0 0 612 792 ]" in (folder / "letter.pdf").read_bytes()
    assert b"MediaBox [ 0 0 596 842 ]" in (folder / "a4.pdf").read_bytes()


@pytest.mark.lilypond
def test_render_a_file_lilypond_cannot_read_leaves_nothing(tmp_path: Path):
    bad = tmp_path / "bad.ly"
    bad.write_text('\\version "2.26.0"\n{ c\'4 bese }\n')
    result = render.render(bad, tmp_path / "out")
    assert not result.ok and "not a note name" in result.problems[0]
    assert not (tmp_path / "out").exists()

# ---------------------------------------------------------------- svgcheck ---

GOOD = (b'<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        b'width="283" height="100"><defs><g id="glyph-0"><path d="M0 0"/></g></defs>'
        b'<use xlink:href="#glyph-0" x="1"/><rect width="1" height="1"/></svg>')


def svg(body: str) -> bytes:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
            f'width="283">{body}</svg>').encode()


def test_problems_a_lilypond_drawing_passes():
    assert problems(GOOD, 283.46) == []


@pytest.mark.parametrize(("data", "found"), [
    (svg("<script>alert(1)</script>"), "has a <script> element"),
    (svg('<g onload="alert(1)"/>'), "event handler (onload)"),
    (svg("<foreignObject><div/></foreignObject>"), "has a <foreignObject> element"),
    (svg('<use xlink:href="https://evil.example/x.svg#a"/>'), "links outside the file"),
    (svg('<rect style="fill: url(https://evil.example/p)"/>'), "points outside the file"),
    (b'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', "DOCTYPE or ENTITY"),
    (b"<svg", "not well-formed"),
    (b'<html xmlns="http://www.w3.org/1999/xhtml"/>', "not svg"),
])
def test_problems_anything_but_a_drawing_is_refused(data, found):
    assert any(found in p for p in problems(data))


def test_problems_the_wrong_width_is_refused():
    assert problems(GOOD, 538.6) == ["is 283 wide, not 539"]


def test_check_pdf_refuses_script_and_non_pdfs():
    assert check_pdf(b"%PDF-1.7\n...") == []
    assert check_pdf(b"<html>") == ["is not a PDF"]
    assert check_pdf(b"%PDF-1.7 /JavaScript (x)") != []

# ---------------------------------------------------------------- manifest ---


@pytest.fixture
def tree(tmp_path: Path) -> dict[str, Path]:
    src = tmp_path / "src" / "vol-5" / "missa-ix"
    src.mkdir(parents=True)
    for name in ("kyrie_IX.ly", "gloria_IX.ly", "ite_IX.ly"):
        (src / name).write_text(SOURCE + f"% {name}\n")
    include = tmp_path / "include"
    include.mkdir()
    (include / "noh2.ily").write_text("a = 1\n")
    parts = tmp_path / "parts.yml"
    parts.write_text(
        "- {file: vol-5/missa-ix/kyrie_IX.ly, target: 'movement:ordinarium-missae-ix/kyrie', status: matched,"
        " evidence: {melody: 1.0}}\n"
        "- {file: vol-5/missa-ix/gloria_IX.ly, target: null, status: proposed, evidence: {melody: 0.5, "
        "candidates: [{target: 'movement:ordinarium-missae-ix/gloria', melody: 0.5}]}}\n"
        "- {file: vol-5/missa-ix/ite_IX.ly, target: null, status: broken, evidence: {error: 'line 3: error: x'}}\n")
    return {"src": tmp_path / "src", "parts": parts, "include": include}


def test_build_shows_matched_parts_and_lists_the_rest_for_review(tree):
    shown, review = manifest.build(**tree)
    [part] = shown["parts"]
    assert part["target"] == "movement:ordinarium-missae-ix/kyrie" and len(part["hash"]) == 32
    assert shown["prefix"] == "typeset" and shown["files"] == ["narrow.svg", "wide.svg", "letter.pdf", "a4.pdf"]
    assert "Joe Egan" in shown["credit"]
    proposed, broken = review["items"]
    assert proposed["status"] == "proposed" and "hash" in proposed and proposed["candidates"]
    excerpt = broken.pop("excerpt")
    assert broken == {"file": "vol-5/missa-ix/ite_IX.ly", "status": "broken", "target": None,
                      "error": "line 3: error: x"}
    assert excerpt["line"] == 3 and excerpt["first"] == 1


def test_the_committed_manifest_is_current_and_names_every_matched_part():
    assert manifest.stale() == []
    parts = json.loads(manifest.MANIFEST.read_text())["parts"]
    matched = sum(1 for e in manifest.effective() if e["status"] == "matched")
    assert len(parts) == matched

# ----------------------------------------------------------------- publish ---


def rendered(out: Path, digest: str, wide: bytes = GOOD) -> None:
    folder = out / digest
    folder.mkdir(parents=True)
    narrow = GOOD.replace(b'width="283"', b'width="255"')        # 90 mm
    wide_ok = wide.replace(b'width="283"', b'width="539"') if wide is GOOD else wide
    (folder / "narrow.svg").write_bytes(narrow)
    (folder / "wide.svg").write_bytes(wide_ok)
    (folder / "letter.pdf").write_bytes(b"%PDF-1.7\n")
    (folder / "a4.pdf").write_bytes(b"%PDF-1.7\n")


def test_publish_uploads_checked_renders_and_nothing_of_a_bad_one(tmp_path, monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr("pipeline.upload._client", lambda creds: fake)
    rendered(tmp_path, "a" * 32)
    rendered(tmp_path, "b" * 32, wide=svg("<script/>").replace(b'width="283"', b'width="539"'))
    from pipeline.upload import Credentials
    creds = Credentials("acct", "id", "secret", "cantusorgani-assets")
    uploaded, there, found = publish.publish(tmp_path, creds)
    assert uploaded == 4 and there == 0
    assert sorted(fake.objects) == [f"typeset/{'a' * 32}/{n}" for n in ("a4.pdf", "letter.pdf", "narrow.svg", "wide.svg")]
    assert found == [f"{'b' * 32}/wide.svg: has a <script> element"]
    assert {p["ContentType"] for p in fake.puts} == {"image/svg+xml", "application/pdf"}
    again = publish.publish(tmp_path, creds)
    assert again[:2] == (0, 4)


class Answer:
    def __init__(self, status: int) -> None:
        self.status = status

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *exc: object) -> bool:
        return False


def test_missing_asks_the_public_address_for_every_file(monkeypatch):
    there = {"typeset/aa/narrow.svg", "typeset/aa/wide.svg", "typeset/aa/letter.pdf", "typeset/aa/a4.pdf",
             "typeset/bb/narrow.svg"}

    def urlopen(request, timeout):
        path = request.full_url.split("example.org/", 1)[1]
        if path not in there:
            raise OSError("404")
        return Answer(200)

    monkeypatch.setattr(publish.urllib.request, "urlopen", urlopen)
    assert publish.missing("https://images.example.org/", {"aa": "a.ly", "bb": "b.ly"}) == {"bb": "b.ly"}


def test_render_missing_fails_only_for_shown_parts(tmp_path, monkeypatch):
    shown = tmp_path / "manifest.json"
    review = tmp_path / "review.json"
    shown.write_text(json.dumps({"parts": [{"target": "movement:x/kyrie", "file": "k.ly", "hash": "h1"}]}))
    review.write_text(json.dumps({"items": [{"file": "g.ly", "status": "proposed", "hash": "h2"}]}))
    monkeypatch.setattr(publish, "render", lambda path, out: render.Rendered("h1" if path.name == "k.ly" else "h2",
                                                                              False, problems=["wide: error"]))
    report = publish.render_missing(None, tmp_path / "out", tmp_path, manifest_path=shown, review_path=review,
                                    check_current=False)
    assert not report.ok
    assert report.failed_shown == ["k.ly: wide: error"] and report.failed_review == ["g.ly: wide: error"]


def test_mark_render_failures_marks_broken_and_the_mark_goes_when_the_file_changes(tree):
    from pipeline.typeset import match
    marked = match.mark_render_failures({"vol-5/missa-ix/kyrie_IX.ly": "narrow: programming error: Tie without heads"},
                                        tree["parts"], tree["src"])
    assert marked == ["vol-5/missa-ix/kyrie_IX.ly"]
    [kyrie] = [e for e in match.load(tree["parts"]) if e["file"] == "vol-5/missa-ix/kyrie_IX.ly"]
    assert (kyrie["status"], kyrie["source"], kyrie["evidence"]["was"]) == ("broken", "render", "matched")
    assert "Tie without heads" in kyrie["evidence"]["error"]
    source = tree["src"] / "vol-5" / "missa-ix" / "kyrie_IX.ly"
    assert match.still_fails(source, kyrie)
    source.write_text(source.read_text() + "% fixed\n")
    assert not match.still_fails(source, kyrie)
    shown, review = manifest.build(**tree)
    assert shown["parts"] == []
    assert any(r["file"] == "vol-5/missa-ix/kyrie_IX.ly" and r["status"] == "broken" for r in review["items"])


def test_render_missing_refuses_a_stale_manifest(tmp_path, monkeypatch):
    monkeypatch.setattr("pipeline.typeset.manifest.stale", lambda *a: ["manifest.json"])
    with pytest.raises(publish.StaleManifest, match="run `uv run noh typeset-manifest` first"):
        publish.render_missing(None, tmp_path / "out", tmp_path)
    assert not (tmp_path / "out").exists()
