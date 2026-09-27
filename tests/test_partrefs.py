"""Parts a Proper prints by reference, read from the page text
(pipeline.partrefs): "Offertorium. Afferentur regi, Pars IV, p. 97." """

from __future__ import annotations

from pipeline.partrefs import Line, is_heading, reference_parts, zone_text


def line(page: int, y: float, text: str) -> Line:
    return Line(page=page, y=y, text=text)


def test_is_heading_dated_feast_and_eadem_die_and_capitals():
    assert is_heading("21. DECEMBRIS. - S. THOMAE APOSTOLI.")
    assert is_heading("EADEM DIE 4. - S. BARBARAE VIRGINIS ET MARTYRIS.")
    assert is_heading("FERIA SEXTA POST DOMINICAM I PASSIONIS")


def test_is_heading_reference_lines_and_chant_text_are_not():
    assert not is_heading("Offertorium. Afferentur regi, Pars IV, p. 97.")
    assert not is_heading("Ve _ ni de Li _ ba _ no, spon _ sa me _ a")
    assert not is_heading("PARS III")


def test_reference_parts_reads_ut_supra_pars_and_ibid():
    text = ("Graduale. Dilexisti justitiam, ibid., p. 108. Offertorium. Afferentur regi, Pars IV, "
            "p. 97. Communio. Principes persecuti sunt, ibid., p. 120. Alleluia, alleluia. V. "
            "Beatus vir qui suffert, ibid., p. 79.")
    assert reference_parts(text, "noh3") == [
        ("gradual", "noh3", 108), ("offertory", "noh4", 97), ("communion", "noh4", 120),
        ("alleluia", "noh4", 79)]


def test_reference_parts_ignores_syllabified_chant_and_rubric_masses():
    assert reference_parts("Al _ le _ lu _ ia, al _ le _ lu _ ia. Missa. Os justi, Pars IV, p. 76.",
                           "noh3") == []


def test_zone_text_runs_from_own_heading_to_the_next_heading():
    """St Lucy: her heading, a reference, her music, two more references, then
    St Thomas's heading and his references -- which are not hers."""
    lines = [
        line(58, 100, "13. DECEMBRIS. - S. LUCIAE VIRGINIS ET MARTYRIS."),
        line(58, 120, "Introitus. Dilexisti justitiam, Pars IV, p. 107."),
        line(58, 400, "Al _ le _ lu _ ia"),                       # her music
        line(59, 500, "Offertorium. Afferentur regi, Pars IV, p. 97."),
        line(59, 520, "21. DECEMBRIS. - S. THOMAE APOSTOLI."),
        line(59, 540, "Introitus. Mihi autem, ut supra, p. 4."),
    ]
    text = zone_text(lines, start=(58, 300.0))
    assert "Dilexisti" in text and "Afferentur" in text
    assert "Mihi autem" not in text


def test_zone_text_heading_at_the_foot_of_the_page_before():
    """St Thomas's music starts on p. 60; his heading and references are at the
    foot of p. 59."""
    lines = [
        line(59, 500, "Offertorium. Afferentur regi, Pars IV, p. 97."),
        line(59, 520, "21. DECEMBRIS. - S. THOMAE APOSTOLI."),
        line(59, 540, "Introitus. Mihi autem, ut supra, p. 4."),
        line(60, 50, "Gau _ de _ te ju _ sti"),
        line(60, 900, "29. DECEMBRIS. - S. THOMAE EPISCOPI."),
    ]
    text = zone_text(lines, start=(60, 40.0))
    assert "Mihi autem" in text
    assert "Afferentur" not in text


def test_zone_text_no_heading_found_starts_at_the_music():
    lines = [line(10, 100, "Offertorium. X, Pars IV, p. 9."), line(10, 500, "Communio. Y, ibid., p. 10.")]
    assert zone_text(lines, start=(10, 300.0)) == "Communio. Y, ibid., p. 10."


def test_reference_parts_rubric_naming_a_part_is_not_a_reference():
    """"Tempore Paschali omittitur Graduale, et ejus loco dicitur: Alleluia ...
    In conspectu, Pars IV, p. 45" says what replaces the Gradual; the Gradual
    itself is "Graduale. Angelis suis, Pars I, 169"."""
    text = ("Graduale. Angelis suis, Pars I, 169. Tempore Paschali omittitur Graduale, et ejus loco "
            "dicitur : Alleluia, alleluia V. In conspectu, Pars IV, p. 45.")
    assert ("gradual", "noh1", 169) in reference_parts(text, "noh3")
    assert all(p != ("gradual", "noh4", 45) for p in reference_parts(text, "noh3"))


def test_reference_parts_alleluia_in_the_paschal_rubric_is_the_paschal_alleluia():
    text = ("Graduale. Angelis suis, Pars I, 169. Alleluia. V. Angelus Domini, Pars II, p. 20. "
            "Tempore Paschali omittitur Graduale, et ejus loco dicitur : Alleluia, alleluia V. "
            "In conspectu, Pars IV, p. 139.")
    parts = reference_parts(text, "noh3")
    assert ("alleluia", "noh2", 20) in parts
    assert ("alleluia/paschal", "noh4", 139) in parts
