"""The full music of Sunday Vespers, item by item, in the order it is sung.

Release 1 covers the green Sundays (after Epiphany and after Pentecost). Their
office is the Sunday psalter of NOH8 pp. 1-27 -- five antiphons and psalms,
the chapter's response, *Lucis Creator*, the versicle, the Benedicamus -- plus
the day's Magnificat antiphon and the Magnificat in its tone. Each Sunday ends
with the Marian antiphon of the season.

- data/vespers/vespers-noh8.yml holds every item's systems, reviewed by hand against the
  scans; `noh vespers-items` proposes the Magnificat antiphons and their tones
  (data/vespers/vespers-noh8.proposed.yml) from the headings and a wide margin crop.
- The site's 1962 calendar (data/calendar/<year>.json) alone decides which office
  a date keeps. A green Sunday displaced by a feast (Christ the King, All Saints)
  gets no green lineup.
- NOH8 prints the Magnificat itself only in VIII G. For another tone the psalm
  formula in the same tone and ending serves (the tone bank). A tone the bank
  lacks is never guessed from a neighbour: that Sunday is held back and queued
  (`tone_unprinted`).

`noh vespers-lineup` writes data/vespers/vespers-lineup.json, keyed by civil date.

Split by stage into calendar, reviewed, music, lineup and proposal; every name is
re-exported here, its old home."""

from pipeline.vespers.calendar import (  # noqa: F401
    CALENDAR,
    advent_start,
    calendar_days,
    easter,
    laus_tibi,
    marian_for,
    normal_key,
    ranks,
    season_of,
)
from pipeline.vespers.lineup import (  # noqa: F401
    YEARS_AHEAD,
    YEARS_BEHIND,
    _lineup,
    build_lineup,
    build_office,
    catalog_sha256,
    check_lineup,
    describe,
    dump_lineup,
    lineup_anchor,
    lineup_text,
    referenced_chants,
    resolve_day,
    sunday_lineup,
    tone_disagreements,
    window,
    write_lineup,
)
from pipeline.vespers.music import (  # noqa: F401
    PSALM_TITLES,
    _item,
    _music,
    _note,
    _psalm_verses,
    _source,
    magnificat_music,
    psalm_music,
)
from pipeline.vespers.proposal import (  # noqa: F401
    _HEADING,
    _ROMAN_VALUE,
    WIDE_STRIP,
    propose,
    read_tone_margin,
    sunday_heading,
)
from pipeline.vespers.reviewed import (  # noqa: F401
    _OCR_ROMAN,
    _ROMANS,
    CATALOG,
    GREEN,
    LINEUP,
    PROPOSED,
    REVIEWED,
    SCHEMA_VERSION,
    TONES,
    Reviewed,
    VespersDataError,
    load_reviewed,
    normalise_tone,
    tone_label,
)

__all__ = [
    "LINEUP",
    "REVIEWED",
    "TONES",
    "Reviewed",
    "VespersDataError",
    "advent_start",
    "build_lineup",
    "calendar_days",
    "check_lineup",
    "describe",
    "easter",
    "laus_tibi",
    "load_reviewed",
    "marian_for",
    "normal_key",
    "normalise_tone",
    "propose",
    "ranks",
    "read_tone_margin",
    "referenced_chants",
    "resolve_day",
    "season_of",
    "sunday_heading",
    "sunday_lineup",
    "tone_disagreements",
    "tone_label",
    "write_lineup",
]
