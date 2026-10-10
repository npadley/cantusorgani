from __future__ import annotations

import re
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Literal, Protocol

from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation

IR_SCHEMA_VERSION = 1

def rational_to_str(value: Fraction) -> str:
    """Fraction(14,16) -> "7/8"; Fraction(0) -> "0/1"; Fraction(3) -> "3/1"."""
    return f"{value.numerator}/{value.denominator}"

def rational_from_str(text: str) -> Fraction:
    """Accept only r"-?\\d+/\\d+", reduced, denominator > 0. Raise ValueError on "0.5", "7/8.0", "14/16"."""
    if not re.match(r'^-?\d+/\d+$', text):
        raise ValueError(f"Invalid rational format: {text}")

    num_str, den_str = text.split('/')
    num = int(num_str)
    den = int(den_str)

    # Check denominator > 0
    if den <= 0:
        raise ValueError(f"Denominator must be > 0, got: {text}")

    # Create Fraction and check if it's reduced
    frac = Fraction(num, den)

    # Verify it's in reduced form: gcd(|numerator|, denominator) == 1
    if frac.numerator != num or frac.denominator != den:
        raise ValueError(f"Fraction is not reduced: {text}")

    return frac

Step = Literal["c", "d", "e", "f", "g", "a", "b"]
EventKind = Literal["note", "rest", "skip"]
Notehead = Literal["normal", "hidden", "quilisma"]
PrintedAccidental = Literal["none", "sharp", "flat", "natural", "double-sharp", "double-flat"]
DivisionKind = Literal["finalis", "maxima", "maior", "minima"]
LayerRole = Literal["chant", "accompaniment", "voice-line"]
SpanKind = Literal["tie", "slur", "voice-line"]
BoundaryReason = Literal["sustain-not-splittable", "slur-crosses", "voice-line-crosses",
                         "lyric-extender-crosses", "not-common-onset"]

@dataclass(frozen=True)
class Pitch:
    step: Step
    alter: Fraction          # semitones: 1 sharp, -1 flat (LilyPond alteration * 2)
    octave: int              # scientific: middle C = 4

@dataclass(frozen=True)
class NotatedDuration:
    log: int                 # 0 whole, 1 half, 2 quarter, 3 eighth
    dots: int
    scale: Fraction          # 1 when unscaled; "2*3/4" -> Fraction(3, 4)

@dataclass(frozen=True)
class StaffDef:
    id: str                  # LilyPond Staff id ("up", "down") or "staff#<n>"
    index: int               # 1-based, top to bottom
    clef_shape: Literal["G", "F", "C"]
    clef_line: int
    key_fifths: int

@dataclass(frozen=True)
class LayerDef:
    id: str                  # "<staff>:<voice-id or #ordinal>"; Kyrie IX: "up:chant","up:#1","down:#2","down:#3"
    home_staff_id: str
    ordinal: int             # first-event order, 0-based
    voice_command: Literal["voiceOne", "voiceTwo", "voiceThree", "voiceFour", "none"]
    role: LayerRole          # "chant" iff a Lyrics context is associated; "voice-line" iff every notehead is hidden

@dataclass(frozen=True)
class Event:
    id: str                  # f"{layer.ordinal}e{seq:04d}", stable within one source revision
    layer_id: str
    staff_id: str            # effective staff (differs from home after \change Staff)
    kind: EventKind
    onset: Fraction          # whole notes from score start
    duration: Fraction       # includes scale
    notated: NotatedDuration
    pitch: Pitch | None      # None for rest/skip
    printed_accidental: PrintedAccidental
    notehead: Notehead
    stem_visible: bool
    tie_to_next: bool
    location: SourceLocation

@dataclass(frozen=True)
class Span:
    id: str
    kind: SpanKind
    start_event_id: str
    end_event_id: str

@dataclass(frozen=True)
class LyricSyllable:
    id: str
    text: str                # "" for a blank `_` token
    onset: Fraction
    anchor_event_id: str | None   # None => LYRIC_UNANCHORED diagnostic
    hyphen_after: bool
    extender_after: bool
    lyrics_context: str
    location: SourceLocation

@dataclass(frozen=True)
class EntryMarker:
    id: str
    text: str                # "*", "**"
    syllable_id: str         # syllable it precedes (\set stanza)
    location: SourceLocation

@dataclass(frozen=True)
class Division:
    id: str
    kind: DivisionKind       # from the BreathingSign stencil procedure name in noh2.ily
    onset: Fraction
    layer_id: str
    location: SourceLocation

@dataclass(frozen=True)
class Boundary:
    id: str                  # f"b{index:03d}" in onset order
    onset: Fraction
    source_break: bool
    division: DivisionKind | None
    after_text: str | None   # last lyric word (joined syllables, as printed) ending before this onset
    safe: bool
    reason: BoundaryReason | None   # non-None iff not safe

@dataclass(frozen=True)
class FeatureUse:
    family: str              # one of FEATURE_FAMILIES
    location: SourceLocation
    event_ids: tuple[str, ...]

FEATURE_FAMILIES: tuple[str, ...] = (
    "scaled-duration", "tie", "slur", "hidden-stem", "hidden-rest", "skip",
    "finalis", "divisio-maxima", "divisio-maior", "divisio-minima", "force-break",
    "stanza-marker", "blank-lyric", "melisma", "voice-line-voice", "voice-line-glissando",
    "cross-staff", "quilisma", "key-change", "clef-change", "note-shift", "manual-spacing",
)

@dataclass(frozen=True)
class ScoreIR:
    schema_version: Literal[1]
    source_path: str               # repo-relative
    dependency_digest: str
    lilypond_version: str
    extractor_version: str
    total_duration: Fraction
    staves: tuple[StaffDef, ...]
    layers: tuple[LayerDef, ...]
    events: tuple[Event, ...]      # sorted (onset, layer.ordinal, seq)
    spans: tuple[Span, ...]
    lyrics: tuple[LyricSyllable, ...]
    entry_markers: tuple[EntryMarker, ...]
    divisions: tuple[Division, ...]
    boundaries: tuple[Boundary, ...]
    features: tuple[FeatureUse, ...]
    diagnostics: tuple[Diagnostic, ...]

    def to_dict(self) -> dict[str, object]:
        """Convert to dict with camelCase keys and rationals as strings."""
        def to_camel_case(snake_str: str) -> str:
            components = snake_str.split('_')
            return components[0] + ''.join(x.title() for x in components[1:])

        def convert_value(v: object) -> object:
            if isinstance(v, Fraction):
                return rational_to_str(v)
            elif isinstance(v, Pitch):
                return {
                    'step': v.step,
                    'alter': rational_to_str(v.alter),
                    'octave': v.octave,
                }
            elif isinstance(v, NotatedDuration):
                return {
                    'log': v.log,
                    'dots': v.dots,
                    'scale': rational_to_str(v.scale),
                }
            elif isinstance(v, SourceLocation):
                return {
                    'filename': v.filename,
                    'line': v.line,
                    'column': v.column,
                }
            elif isinstance(v, Diagnostic):
                return {
                    'code': v.code,
                    'severity': v.severity,
                    'message': v.message,
                    'sourceLocation': convert_value(v.source_location) if v.source_location else None,
                    'eventIds': list(v.event_ids),
                    'details': [[k, v] for k, v in v.details],
                }
            elif isinstance(v, tuple):
                return [convert_value(item) for item in v]
            elif isinstance(v, dict):
                return {to_camel_case(k) if isinstance(k, str) else k: convert_value(val)
                        for k, val in v.items()}
            elif hasattr(v, '__dataclass_fields__'):
                # Generic dataclass conversion
                result = {}
                for field_name, field_value in v.__dict__.items():
                    result[to_camel_case(field_name)] = convert_value(field_value)
                return result
            else:
                return v

        result = {}
        for field_name, field_value in self.__dict__.items():
            result[to_camel_case(field_name)] = convert_value(field_value)
        return result

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> ScoreIR:
        """Reconstruct from dict with camelCase keys."""
        def to_snake_case(camel_str: str) -> str:
            result = []
            for i, c in enumerate(camel_str):
                if c.isupper() and i > 0:
                    result.append('_')
                    result.append(c.lower())
                else:
                    result.append(c)
            return ''.join(result)

        def dict_to_snake_case(d: dict) -> dict:
            """Recursively convert dict keys from camelCase to snake_case."""
            result = {}
            for k, v in d.items():
                new_key = to_snake_case(k) if isinstance(k, str) else k
                if isinstance(v, dict):
                    result[new_key] = dict_to_snake_case(v)
                elif isinstance(v, list):
                    result[new_key] = [dict_to_snake_case(item) if isinstance(item, dict) else item for item in v]
                else:
                    result[new_key] = v
            return result

        # Convert all keys from camelCase to snake_case recursively
        snake_dict = dict_to_snake_case(value)

        # Reconstruct nested objects
        snake_dict['total_duration'] = rational_from_str(snake_dict['total_duration'])

        # Convert staves
        staves = []
        for staff in snake_dict['staves']:
            staves.append(StaffDef(**staff))
        snake_dict['staves'] = tuple(staves)

        # Convert layers
        layers = []
        for layer in snake_dict['layers']:
            layers.append(LayerDef(**layer))
        snake_dict['layers'] = tuple(layers)

        # Convert events
        events = []
        for event in snake_dict['events']:
            pitch = None
            if event['pitch'] is not None:
                pitch = Pitch(
                    step=event['pitch']['step'],
                    alter=rational_from_str(event['pitch']['alter']),
                    octave=event['pitch']['octave'],
                )

            notated = NotatedDuration(
                log=event['notated']['log'],
                dots=event['notated']['dots'],
                scale=rational_from_str(event['notated']['scale']),
            )

            location = SourceLocation(
                filename=event['location']['filename'],
                line=event['location']['line'],
                column=event['location']['column'],
            )

            events.append(Event(
                id=event['id'],
                layer_id=event['layer_id'],
                staff_id=event['staff_id'],
                kind=event['kind'],
                onset=rational_from_str(event['onset']),
                duration=rational_from_str(event['duration']),
                notated=notated,
                pitch=pitch,
                printed_accidental=event['printed_accidental'],
                notehead=event['notehead'],
                stem_visible=event['stem_visible'],
                tie_to_next=event['tie_to_next'],
                location=location,
            ))
        snake_dict['events'] = tuple(events)

        # Convert spans
        spans = []
        for span in snake_dict['spans']:
            spans.append(Span(**span))
        snake_dict['spans'] = tuple(spans)

        # Convert lyrics
        lyrics = []
        for lyric in snake_dict['lyrics']:
            location = SourceLocation(
                filename=lyric['location']['filename'],
                line=lyric['location']['line'],
                column=lyric['location']['column'],
            )
            lyrics.append(LyricSyllable(
                id=lyric['id'],
                text=lyric['text'],
                onset=rational_from_str(lyric['onset']),
                anchor_event_id=lyric['anchor_event_id'],
                hyphen_after=lyric['hyphen_after'],
                extender_after=lyric['extender_after'],
                lyrics_context=lyric['lyrics_context'],
                location=location,
            ))
        snake_dict['lyrics'] = tuple(lyrics)

        # Convert entry markers
        entry_markers = []
        for marker in snake_dict['entry_markers']:
            location = SourceLocation(
                filename=marker['location']['filename'],
                line=marker['location']['line'],
                column=marker['location']['column'],
            )
            entry_markers.append(EntryMarker(
                id=marker['id'],
                text=marker['text'],
                syllable_id=marker['syllable_id'],
                location=location,
            ))
        snake_dict['entry_markers'] = tuple(entry_markers)

        # Convert divisions
        divisions = []
        for div in snake_dict['divisions']:
            location = SourceLocation(
                filename=div['location']['filename'],
                line=div['location']['line'],
                column=div['location']['column'],
            )
            divisions.append(Division(
                id=div['id'],
                kind=div['kind'],
                onset=rational_from_str(div['onset']),
                layer_id=div['layer_id'],
                location=location,
            ))
        snake_dict['divisions'] = tuple(divisions)

        # Convert boundaries
        boundaries = []
        for boundary in snake_dict['boundaries']:
            boundaries.append(Boundary(
                id=boundary['id'],
                onset=rational_from_str(boundary['onset']),
                source_break=boundary['source_break'],
                division=boundary['division'],
                after_text=boundary['after_text'],
                safe=boundary['safe'],
                reason=boundary['reason'],
            ))
        snake_dict['boundaries'] = tuple(boundaries)

        # Convert features
        features = []
        for feature in snake_dict['features']:
            location = SourceLocation(
                filename=feature['location']['filename'],
                line=feature['location']['line'],
                column=feature['location']['column'],
            )
            features.append(FeatureUse(
                family=feature['family'],
                location=location,
                event_ids=tuple(feature['event_ids']),
            ))
        snake_dict['features'] = tuple(features)

        # Convert diagnostics
        diagnostics = []
        for diagnostic in snake_dict['diagnostics']:
            location = None
            if diagnostic['source_location'] is not None:
                location = SourceLocation(
                    filename=diagnostic['source_location']['filename'],
                    line=diagnostic['source_location']['line'],
                    column=diagnostic['source_location']['column'],
                )

            details = tuple(tuple(pair) for pair in diagnostic['details'])

            diagnostics.append(Diagnostic(
                code=diagnostic['code'],
                severity=diagnostic['severity'],
                message=diagnostic['message'],
                source_location=location,
                event_ids=tuple(diagnostic['event_ids']),
                details=details,
            ))
        snake_dict['diagnostics'] = tuple(diagnostics)

        return cls(**snake_dict)

# --- profile -----------------------------------------------------------------
@dataclass(frozen=True)
class FeatureRule:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]  # engraving-only => review diagnostic, not a blocker
    mei: str                 # documentation of the mapping, e.g. "<breath type='divisio-minima'>"

@dataclass(frozen=True)
class ConversionProfile:
    id: str                  # "accompaniment-v1"
    version: int
    mei_version: Literal["5.0"]
    lyric_place: Literal["above"]
    container_policy: Literal["common-onset"]
    rules: tuple[FeatureRule, ...]
    @classmethod
    def load(cls, path: Path) -> ConversionProfile:
        import json  # local import: this card may only touch the body of load()

        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw["meiVersion"] != "5.0":
            raise ValueError(f"unsupported meiVersion: {raw['meiVersion']!r}")

        rules = tuple(
            FeatureRule(family=item["family"], status=item["status"], mei=item["mei"])
            for item in raw["rules"]
        )
        valid_statuses = ("supported", "unsupported", "engraving-only")
        for rule in rules:
            if rule.status not in valid_statuses:
                raise ValueError(f"invalid status for {rule.family}: {rule.status!r}")

        families = [rule.family for rule in rules]
        duplicates = sorted({family for family in families if families.count(family) > 1})
        if duplicates:
            raise ValueError(f"duplicate families: {duplicates}")
        missing = sorted(set(FEATURE_FAMILIES) - set(families))
        unknown = sorted(set(families) - set(FEATURE_FAMILIES))
        if missing or unknown:
            raise ValueError(f"families must match FEATURE_FAMILIES; missing {missing}, unknown {unknown}")
        if tuple(families) != FEATURE_FAMILIES:
            raise ValueError("families are not in FEATURE_FAMILIES order")

        return cls(
            id=raw["id"],
            version=raw["version"],
            mei_version=raw["meiVersion"],
            lyric_place=raw["lyricPlace"],
            container_policy=raw["containerPolicy"],
            rules=rules,
        )

# --- runner / extract ----------------------------------------------------------
class LilyPondRunnerAdapter(Protocol):
    version: str
    def run(self, args: list[str], cwd: Path, includes: tuple[Path, ...], timeout: int) -> tuple[bool, str]: ...
# Production wraps pipeline.typeset.lilypond.run + load_pin().version.
# Tests inject a fake that copies a checked-in TSV from tests/fixtures/mei/extraction/ into cwd.

@dataclass(frozen=True)
class ExtractionResult:
    ir: ScoreIR | None
    diagnostics: tuple[Diagnostic, ...]
    lilypond_version: str
    dependency_digest: str
    raw_evidence_path: Path            # build/typeset/mei/<digest>/events.tsv

# --- encode ----------------------------------------------------------------------
@dataclass(frozen=True)
class BoundaryManifestEntry:
    boundary_id: str
    onset: str                         # rational string
    measure_id: str                    # MEI xml:id of the measure ending here
    safe: bool
    source_break: bool
    division: DivisionKind | None
    after_text: str | None

@dataclass(frozen=True)
class FeatureDecision:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]
    occurrences: int

@dataclass(frozen=True)
class EncodedScore:
    xml: bytes
    artifact_sha256: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    feature_decisions: tuple[FeatureDecision, ...]
    provenance: dict[str, str]         # MEI xml:id -> IR event id (tied fragments map many->one)
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class SchemaBundle:
    root: Path                         # data/typeset/mei/schemas/mei-5.0/
    entry: str                         # "mei-CMN.rng"
    sha256: str                        # of the sorted concatenated files
    validator: str                     # chosen in S5

# --- validate ----------------------------------------------------------------------
@dataclass(frozen=True)
class NormalizedEvent:
    layer_key: str                     # f"{staff_index}.{layer_n}", NOT the IR id
    onset: Fraction
    duration: Fraction                 # tied fragments merged ONLY for a proven split
    kind: EventKind
    pitch: Pitch | None
    is_attack: bool
    notehead: Notehead
    printed_accidental: PrintedAccidental
    source_event_id: str | None        # via provenance; None is itself a difference

@dataclass(frozen=True)
class NormalizedScore:
    layers: dict[str, tuple[NormalizedEvent, ...]]
    lyrics: tuple[tuple[str, str | None], ...]     # (text, anchor source_event_id)
    entry_markers: tuple[tuple[str, str], ...]
    spans: tuple[tuple[SpanKind, str, str], ...]
    divisions: tuple[tuple[DivisionKind, Fraction], ...]
    total_duration: Fraction

@dataclass(frozen=True)
class SemanticDifference:
    code: str                          # a DiagnosticCode
    layer_key: str | None
    onset: Fraction | None
    source_event_ids: tuple[str, ...]
    detail: str

@dataclass(frozen=True)
class ValidationReport:
    schema_ok: bool
    schema_diagnostics: tuple[Diagnostic, ...]
    semantic_differences: tuple[SemanticDifference, ...]
    eligible: bool                     # schema_ok and no differences and no unsupported feature
    hashes: dict[str, str]
    tool_versions: dict[str, str]

# --- review ------------------------------------------------------------------------
ConversionState = Literal["unsupported", "failed", "needs-review", "approved"]

@dataclass(frozen=True)
class ConversionInputs:
    source_sha256: str
    include_sha256: str                # all data/typeset/include/*.ily, as render.source_hash does
    lilypond_version: str
    extractor_version: str
    converter_version: str
    profile_id: str
    profile_sha256: str
    schema_sha256: str
    verovio_version: str
    font_digest: str
    def digest(self) -> str:
        raise NotImplementedError("card A5a")

@dataclass(frozen=True)
class LayoutCase:
    id: str                            # e.g. "letter-portrait-medium-original-auto"
    page: str                          # PagePresetId, or "custom:160x230"
    orientation: Literal["portrait", "landscape"]
    staff: Literal["small", "medium", "large"]
    line_policy: Literal["original", "automatic"]
    max_systems: int | None

REQUIRED_MATRIX: tuple[LayoutCase, ...] = ()  # A5a fills this from contracts §3

@dataclass(frozen=True)
class ReviewDecision:
    reviewer: str
    timestamp: str                     # ISO 8601 UTC
    inputs_digest: str
    artifact_sha256: str
    matrix_results: dict[str, Literal["pass", "fail", "accepted-difference"]]
    accepted_differences: tuple[str, ...]
    decision: Literal["approve", "reject"]

@dataclass(frozen=True)
class ConversionRecord:
    source_path: str
    target: str | None                 # from data/typeset/manifest.json; never inferred
    render_hash: str | None            # 32-hex from manifest.json
    state: ConversionState
    inputs: ConversionInputs
    artifact_sha256: str | None
    diagnostics: tuple[Diagnostic, ...]
    validation: ValidationReport | None
    review: ReviewDecision | None

class ReviewBlocked(Exception):
    def __init__(self, codes: tuple[str, ...], message: str) -> None:
        self.codes = codes
        super().__init__(message)

@dataclass(frozen=True)
class EvidencePacket:
    directory: Path                    # build/typeset/mei/<digest>/evidence/
    index_html: Path
    cases: dict[str, Path]             # LayoutCase.id -> rendered SVG
    geometry_findings: tuple[Diagnostic, ...]

# --- audit ---------------------------------------------------------------------------
AuditClass = Literal["candidate", "source-check-failed", "compile-failed", "unknown-feature"]

@dataclass(frozen=True)
class SourceRecord:
    path: str
    dependency_digest: str
    includes: tuple[str, ...]          # today always ("gregorian.ly", "noh2.ily")
    target: str | None
    match_status: str | None           # from data/typeset/parts.yml
    voices: int
    staves: int
    features: dict[str, int]           # family -> count (text scan = candidate only)
    classification: AuditClass
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class AuditReport:
    sources: tuple[SourceRecord, ...]
    absent_targets: tuple[str, ...]    # catalogue targets with no source file
    family_counts: dict[str, int]
    unknown_commands: dict[str, int]
    proposed_pilot: tuple[str, ...]    # must equal PILOT_FIXTURES unless the coordinator changes it

PILOT_FIXTURES: tuple[str, ...] = (
    "vol-5/missa-ix/kyrie_IX.ly",            # F1 public pilot: 4 voices, entry markers
    "vol-3/al_ego_dilecto.csv.ly",           # F2 typical: 5th hidden voiceLines voice
    "vol-5/missa-xi/agnus_XI.ly",            # F3 \voiceLine "down" "up": cross-staff glissandi, printed accidentals (D15)
    "vol-5/missa-i/ite_Ib.ly",               # F4 \quil
    "vol-2/co_inclina_aurem_tuam.csv.ly",    # F5 divisio maior / maxima (also via \halfBar/\singleBar)
)

# --- manifest ------------------------------------------------------------------------
@dataclass(frozen=True)
class ManifestPart:                    # serialises to the TS ConversionManifestPart
    target: str
    render_hash: str
    digest: str
    mei_path: str                      # "mei/<digest>/score.mei"
    mei_sha256: str
    source_revision: str
    profile: str
    verovio: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    capabilities: dict[str, bool]      # {"manualBreaks": bool}

@dataclass(frozen=True)
class ConversionManifest:
    schema_version: Literal[1]
    parts: tuple[ManifestPart, ...]

# --- publish / batch -----------------------------------------------------------------
class AssetStore(Protocol):
    def exists(self, key: str) -> bool: ...
    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool: ...

@dataclass(frozen=True)
class PublishInputs:
    records: tuple[ConversionRecord, ...]
    prefix: str                        # "mei"

@dataclass(frozen=True)
class VerifiedBundle:
    root: Path
    files: dict[str, str]              # key -> sha256

@dataclass(frozen=True)
class PublishReport:
    uploaded: tuple[str, ...]
    skipped_existing: tuple[str, ...]

class PublishBlocked(Exception): ...

@dataclass(frozen=True)
class BatchReport:
    requested: tuple[str, ...]
    results: dict[str, ConversionState]
    counts: dict[str, int]             # every ConversionState key present, zero allowed
    cached: tuple[str, ...]
    evidence: dict[str, Path]
