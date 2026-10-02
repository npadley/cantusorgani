import json
from pathlib import Path

import pytest

from pipeline.typeset.preview import preview_key, publish_preview, render_preview


def payload(tmp_path, text="c4"):
    data = {"file": "vol-5/x.ly", "text": text, "commitSha": "a" * 40}
    data["key"] = preview_key(data["file"], text, data["commitSha"])
    p = tmp_path / "payload.json"
    p.write_text(json.dumps(data))
    return p, data


def test_key_covers_unicode_and_context():
    assert preview_key("vol-5/x.ly", "é 🎵", "a" * 40) != preview_key(
        "vol-5/x.ly", "é 🎵", "b" * 40
    )
    assert (
        preview_key("vol-5/x.ly", "é 🎵", "a" * 40)
        == "3e69af309fbe1196a2dfe1f16dd13dcd0f072b75a226bafac90b745f07179c4e"
    )


def test_refuse_malformed_and_unsafe_payload(tmp_path):
    p, d = payload(tmp_path, '#(system "bad")')
    with pytest.raises(ValueError):
        render_preview(p, tmp_path / "out")
    d["file"] = "../x.ly"
    p.write_text(json.dumps(d))
    with pytest.raises(ValueError):
        render_preview(p, tmp_path / "out")


def test_bounded_errors_and_upload_never_renders(tmp_path, monkeypatch):
    from pipeline.typeset import preview, render

    p, d = payload(tmp_path)
    monkeypatch.setattr(
        render, "render", lambda *a: render.Rendered("a" * 32, False, problems=["bad " * 3000])
    )
    render_preview(p, tmp_path / "out", verify_context=False)
    result = json.loads((tmp_path / "out" / d["key"] / "result.json").read_text())
    assert not result["ok"] and len(result["problems"][0]) <= 1000
    captured = []
    monkeypatch.setattr(preview, "upload_all", lambda plans, creds: captured.extend(plans))
    publish_preview(tmp_path / "out", object())
    assert [p.key for p in captured] == [f"typeset-preview/{d['key']}/result.json"]


def test_bad_svg_refused_before_upload(tmp_path, monkeypatch):
    from pipeline.typeset import preview

    _p, d = payload(tmp_path)
    folder = tmp_path / "out" / d["key"]
    folder.mkdir(parents=True)
    (folder / "result.json").write_text(
        json.dumps({"key": d["key"], "ok": True, "problems": [], "warnings": []})
    )
    (folder / "wide.svg").write_text("<svg><script>bad</script></svg>")
    monkeypatch.setattr(preview, "upload_all", lambda *a: pytest.fail("must not upload"))
    with pytest.raises(ValueError):
        publish_preview(tmp_path / "out", object())


@pytest.mark.lilypond
def test_pinned_preview(tmp_path):
    text = Path("data/typeset/src/vol-5/missa-ix/kyrie_IX.ly").read_text()
    p, d = payload(tmp_path, text)
    d["file"] = "vol-5/missa-ix/kyrie_IX.ly"
    d["key"] = preview_key(d["file"], text, d["commitSha"])
    p.write_text(json.dumps(d))
    render_preview(p, tmp_path / "out", verify_context=False)
    result = json.loads((tmp_path / "out" / d["key"] / "result.json").read_text())
    assert result["ok"] and (tmp_path / "out" / d["key"] / "wide.svg").exists()
