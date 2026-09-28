"""Where each item's music comes from: its printed systems, the tone bank (the
psalm formula or Magnificat in the same tone), or a note in its place."""

from __future__ import annotations

from pipeline.vespers.reviewed import Reviewed, tone_label

# --------------------------------------------------------------- the lineup ---

def _source(refs: list[str], **extra: object) -> dict[str, object]:
    return {"type": "printed", "refs": list(refs), **extra}


def _note(text: str, refs: list[str] | None = None) -> dict[str, object]:
    """A note in place of music. `refs`: the systems an editor's note replaces
    (data/corrections.yml `note`), kept so the item can still be corrected."""
    return {"type": "note", "text": text, **({"refs": list(refs)} if refs is not None else {})}


def _music(entry: dict[str, object]) -> dict[str, object]:
    """An antiphon's music: its systems, or the note an editor put in their place."""
    refs = list(entry.get("refs") or [])          # type: ignore[call-overload]
    if entry.get("note"):
        return _note(str(entry["note"]), refs)
    return _source(refs) if refs else _note("This antiphon is not printed in NOH VIII.")


def _item(key: str, group: str, kind: str, label: str, source: dict[str, object],
          tone: str | None = None, chant: int | None = None, number: int | None = None,
          repeat: bool = False, psalm_text: list[str] | None = None, target: str | None = None) -> dict[str, object]:
    item: dict[str, object] = {"item_key": key, "group": group, "kind": kind, "number": number, "label": label,
                               "tone": tone, "source": source, "chant": chant, "repeat": repeat}
    if psalm_text:
        item["psalm_text"] = psalm_text
    if target:
        # Where its tone and chant are corrected (data/corrections.yml).
        item["target"] = target
    return item


PSALM_TITLES = {109: "Dixit Dominus", 110: "Confitebor tibi", 111: "Beatus vir", 112: "Laudate pueri",
                113: "In exitu Israel", 115: "Credidi", 116: "Laudate Dominum", 121: "Laetatus sum",
                125: "In convertendo", 126: "Nisi Dominus", 127: "Beati omnes", 129: "De profundis",
                131: "Memento Domine", 138: "Domine probasti me", 147: "Lauda Jerusalem"}


def psalm_music(reviewed: Reviewed, psalm: int, tone: str | None, opening: list[str] | None
                ) -> tuple[dict[str, object], bool]:
    """The accompaniment a psalm is played from, and whether its text should be
    printed beside it: the Sunday psalter's full psalm when NOH8 prints this
    psalm in this tone; the office's own printed opening; a printed formula in
    the same tone and ending (the same psalm first); otherwise a note."""
    for ps in reviewed.doc["sunday_office"]["psalms"]:      # type: ignore[index]
        if ps["number"] == psalm and ps["tone"] == tone:
            return _source(ps["psalm"]), False
    if opening:
        return _source(opening, opening_only=True), True
    if tone:
        formulas = [f for f in reviewed.doc.get("psalm_formulas", []) if f["tone"] == tone]   # type: ignore[union-attr]
        formulas.sort(key=lambda f: f["psalm"] != psalm)
        if formulas:
            f = formulas[0]
            return ({"type": "bank", "refs": list(f["refs"]), "bank_kind": "psalm",
                     "bank_label": f"Psalm {f['psalm']} in {tone_label(tone)}",
                     "borrowed_from": f"{f['source']}, p. {f['page']}"}, True)
        return _note(f"No accompaniment in {tone_label(tone)} is printed in NOH VIII; "
                     f"the psalm is sung in that tone."), True
    return _note("The tone of this psalm is not printed."), True


def magnificat_music(reviewed: Reviewed, tone: str | None) -> dict[str, object]:
    doc = reviewed.doc
    for m in doc.get("magnificats", []):                   # type: ignore[union-attr]
        if m["tone"] == tone:
            return {"type": "bank", "refs": list(m["refs"]), "bank_kind": "magnificat", "bank_label": m["label"],
                    "borrowed_from": f"{m['source']}, p. {m['page']}"}
    if tone:
        formulas = [f for f in doc.get("psalm_formulas", []) if f["tone"] == tone]   # type: ignore[union-attr]
        if formulas:
            f = formulas[0]
            return {"type": "bank", "refs": list(f["refs"]), "bank_kind": "psalm",
                    "bank_label": f"Psalm {f['psalm']} in {tone_label(tone)}",
                    "borrowed_from": f"{f['source']}, p. {f['page']}"}
        return _note(f"No accompaniment for the Magnificat in {tone_label(tone)} is printed in NOH VIII; "
                     f"sing it unaccompanied or improvise in {tone_label(tone)}.")
    return _note("The tone of the Magnificat is not printed.")


def _psalm_verses(reviewed: Reviewed, psalm: int) -> list[str]:
    return list(reviewed.texts.get("psalms", {}).get(str(psalm), []))      # type: ignore[union-attr]


