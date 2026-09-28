"""Catalogue a volume from its printed index — by script, with no AI.

Three steps, each checked by the next:

1. **Read the index as a table.** Page numbers are right-aligned to shared
   column edges; ordinals inside titles ("Solemnibus 2") share no edge and, unlike
   a page-number column, do not increase down the page. Numbers come from two
   sources: the PDF's embedded text layer, which has holes (it never captured
   Masses V-X in NOH5), and Tesseract on each number column of the rendered page.

2. **Resolve each OCR'd number.** Damaged digits ("S8", "il0") expand to candidate
   pages. The folio check cannot choose between them -- every body page carries
   its own folio, so a wrong 53 passes as readily as the true 58. Instead each
   candidate page is scored on its HEADINGS: the text printed outside the music
   systems, where a new piece announces itself ("VIII. (Firmator sancte)").

3. **Snap titles to the calendar.** For Proper volumes, the OCR'd title is matched
   to Missalemeum's Latin titles, which read like NOH's own index, to give each
   entry its 1962 calendar key.

Output is a PROPOSAL (data/index-<vol>.proposed.yml) with a status on every
entry. It never overwrites a reviewed index: a person promotes it.

Split by stage into table, matching, pages, proposals, headings; every name is
re-exported here, its old home."""

from pipeline.indexextract.headings import (  # noqa: F401
    FEAST_HEADING,
    HEADING_STARTS,
    MONTH_NAMES,
    NOT_HEADINGS,
    QUALIFIERS,
    REFERENCED_INTROIT,
    SECTIONS,
    FeastHeading,
    SectionHeading,
    _clean_heading,
    _heading_words,
    _is_capitals,
    _rubric,
    _section_marker,
    _title_case,
    extract_from_headings,
    extract_from_sections,
    is_qualifier,
    is_section_heading,
    parse_feast_heading,
    proposals_from_headings,
    proposals_from_sections,
    scan_feast_headings,
    scan_section_headings,
)
from pipeline.indexextract.matching import (  # noqa: F401
    _LIGATURES,
    _NUMERAL_OCR,
    _ROMAN,
    COVERAGE_WEIGHT,
    DAY_REPAIR,
    LABEL_MATCH,
    MONTHS_GENITIVE,
    ORDINALS,
    STOPWORDS,
    TEMPORA_SEASONS,
    VERIFIED_AT,
    Resolution,
    Snap,
    _calendar_tokens,
    _day,
    _fuzzy_in,
    _numerals,
    _repair_numeral,
    feast_date,
    fold,
    heading_score,
    label_of,
    resolve,
    snap_title,
    tempora_rank,
    title_similarity,
    tokens,
)
from pipeline.indexextract.pages import (  # noqa: F401
    FOOT_BAND,
    PX_PER_PT,
    TOP_BAND,
    HeadingReader,
    date_score,
    drop_running_head,
    embedded_words,
    read_index_rows,
    tesseract_column_words,
    tidy_rows,
)
from pipeline.indexextract.proposals import (  # noqa: F401
    _ROMAN_VALUES,
    BOOK_DIVISIONS,
    CANDIDATE_BONUS,
    CONFIDENT_SNAP,
    DIVISION_WORDS,
    GENRE_WORDS,
    PROPER_DIVISIONS,
    REVIEW_STATUSES,
    SECTION_DIVISIONS,
    UNORDERED_SECTIONS,
    WEEKDAYS,
    WORST_FIRST,
    Comparison,
    Proposal,
    _calendar_title,
    _fit_run,
    _group_title,
    assign_calendar,
    calendar_keys,
    compare,
    extract,
    guess,
    is_hymn_section,
    liturgical_date_order,
    make_reader,
    order_by_feast_date,
    roman_value,
    search_gaps,
    section_in_page_order,
    to_roman,
    to_yaml_doc,
    weekday_of,
    within_section_span,
)
from pipeline.indexextract.table import (  # noqa: F401
    COLUMN_GAP,
    INLINE_GAP,
    KNOWN_SECTIONS,
    LABEL,
    NUMBER_TOKEN,
    RANGE_SPLIT,
    REPAIR,
    Column,
    Row,
    Word,
    _known_section,
    add_label_anchors,
    column_at,
    column_spans,
    find_number_columns,
    group_lines,
    increasing_fraction,
    is_heading_word,
    is_number_like,
    merge_second_source,
    owner_of_line,
    page_candidates,
    rows_from_columns,
    section_heading_spans,
    section_headings,
)
