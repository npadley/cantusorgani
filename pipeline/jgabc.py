"""jgabc's per-day chant ids: which parts a Proper has, and which chant each is.

jgabc (github.com/bbloomf/jgabc, Unlicense) keeps, in `propersdata.js`, an
object `proprium`: for each day of the 1962 Propers, each Common and each
votive Mass, the GregoBase chant id of its Introit, Gradual, Alleluia, Tract,
Sequence, Offertory and Communion. It is vendored into
data/jgabc-propers.json by `noh jgabc-fetch`.

The file is JavaScript. It is never executed: a strict parser accepts object
and array literals, strings, numbers and true/false/null, skips the helper
variables and regex literals jgabc uses as values (they carry nothing we use),
and rejects anything else -- a call, an operator -- naming the line.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDORED = ROOT / "data" / "jgabc-propers.json"
REPO = "bbloomf/jgabc"
SOURCE_PATH = "propersdata.js"


class JgabcSyntaxError(ValueError):
    """propersdata.js holds something that is not a plain literal."""


class JgabcIntegrityError(RuntimeError):
    """The vendored file is missing or does not match its recorded hash."""


class _Opaque:
    """A value the parser skips: a variable name or a regex literal."""


_OPAQUE = _Opaque()
_ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "v": "\v", "0": "\0",
            "'": "'", '"': '"', "\\": "\\", "/": "/"}
_NUMBER = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?")
_IDENT = re.compile(r"[A-Za-z_$][\w$]*")


class _Parser:
    def __init__(self, src: str, start: int = 0) -> None:
        self.src, self.pos = src, start

    # -- errors and whitespace --
    def error(self, what: str) -> JgabcSyntaxError:
        line = self.src.count("\n", 0, self.pos) + 1
        return JgabcSyntaxError(f"propersdata.js line {line}: {what}")

    def skip(self) -> None:
        while self.pos < len(self.src):
            ch = self.src[self.pos]
            if ch.isspace():
                self.pos += 1
            elif self.src.startswith("//", self.pos):
                end = self.src.find("\n", self.pos)
                self.pos = len(self.src) if end == -1 else end
            elif self.src.startswith("/*", self.pos):
                end = self.src.find("*/", self.pos + 2)
                if end == -1:
                    raise self.error("unterminated comment")
                self.pos = end + 2
            else:
                return

    def peek(self) -> str:
        self.skip()
        return self.src[self.pos] if self.pos < len(self.src) else ""

    def expect(self, ch: str) -> None:
        if self.peek() != ch:
            raise self.error(f"expected {ch!r}, found {self.peek()!r}")
        self.pos += 1

    # -- values --
    def value(self) -> object:
        ch = self.peek()
        if ch == "{":
            return self.obj()
        if ch == "[":
            return self.arr()
        if ch in "\"'":
            return self.string()
        if ch == "/":
            return self.regex()
        number = _NUMBER.match(self.src, self.pos)
        if number:
            self.pos = number.end()
            text = number.group(0)
            return float(text) if any(c in text for c in ".eE") else int(text)
        ident = _IDENT.match(self.src, self.pos)
        if ident:
            self.pos = ident.end()
            word = ident.group(0)
            if word in ("true", "false", "null"):
                return {"true": True, "false": False, "null": None}[word]
            return _OPAQUE        # a variable name, never looked up
        raise self.error(f"unexpected {ch!r}")

    def after_value(self, closers: str) -> None:
        """A value must be followed by a separator or a closer: this is where a
        call ("alert(1)") or an operator ("'a' + 'b'") is refused."""
        ch = self.peek()
        if ch != "," and ch not in closers:
            raise self.error(f"expected ',' or {closers!r} after a value, found {ch!r}")

    def obj(self) -> dict[str, object]:
        self.expect("{")
        out: dict[str, object] = {}
        while self.peek() != "}":
            ch = self.peek()
            if ch in "\"'":
                key = self.string()
            else:
                m = _IDENT.match(self.src, self.pos) or _NUMBER.match(self.src, self.pos)
                if not m:
                    raise self.error(f"expected a key, found {ch!r}")
                key, self.pos = m.group(0), m.end()
            self.expect(":")
            val = self.value()
            self.after_value("}")
            if val is not _OPAQUE:
                out[key] = val
            if self.peek() == ",":
                self.pos += 1
        self.expect("}")
        return out

    def arr(self) -> list[object]:
        self.expect("[")
        out: list[object] = []
        while self.peek() != "]":
            val = self.value()
            self.after_value("]")
            if val is not _OPAQUE:
                out.append(val)
            if self.peek() == ",":
                self.pos += 1
        self.expect("]")
        return out

    def string(self) -> str:
        quote = self.src[self.pos]
        self.pos += 1
        out: list[str] = []
        while True:
            if self.pos >= len(self.src):
                raise self.error("unterminated string")
            ch = self.src[self.pos]
            if ch == quote:
                self.pos += 1
                return "".join(out)
            if ch == "\n":
                raise self.error("newline in string")
            if ch == "\\":
                nxt = self.src[self.pos + 1:self.pos + 2]
                if nxt == "u":
                    out.append(chr(int(self.src[self.pos + 2:self.pos + 6], 16)))
                    self.pos += 6
                    continue
                if nxt == "\n":               # line continuation
                    self.pos += 2
                    continue
                out.append(_ESCAPES.get(nxt, nxt))
                self.pos += 2
                continue
            out.append(ch)
            self.pos += 1

    def regex(self) -> _Opaque:
        """Skip a regex literal: to the closing '/' outside a class, then flags."""
        self.pos += 1
        in_class = False
        while self.pos < len(self.src):
            ch = self.src[self.pos]
            if ch == "\\":
                self.pos += 2
                continue
            if ch == "\n":
                break
            if ch == "[":
                in_class = True
            elif ch == "]":
                in_class = False
            elif ch == "/" and not in_class:
                self.pos += 1
                while self.pos < len(self.src) and self.src[self.pos].isalpha():
                    self.pos += 1
                return _OPAQUE
            self.pos += 1
        raise self.error("unterminated regex literal")


def parse_js_literal(src: str) -> object:
    parser = _Parser(src)
    value = parser.value()
    if parser.peek() not in ("", ";"):
        raise parser.error(f"unexpected {parser.peek()!r} after the literal")
    return value


def _extract_var(js: str, name: str) -> object:
    m = re.search(rf"\bvar\s+{name}\s*=\s*", js)
    if not m:
        raise JgabcSyntaxError(f"propersdata.js: no `var {name} = ...` found")
    return _Parser(js, m.end()).value()


def extract_proprium(js: str) -> dict[str, object]:
    value = _extract_var(js, "proprium")
    if not isinstance(value, dict):
        raise JgabcSyntaxError("propersdata.js: proprium is not an object")
    return value


# The page's four menus; its link hash names the menu: propers.html#saint=Oct3.
MENUS = {"sundayKeys": "sunday", "saintKeys": "saint", "otherKeys": "mass", "commonsKeys": "common"}


def extract_menus(js: str) -> dict[str, str]:
    """jgabc key -> the menu (and so the link hash) it appears under."""
    out: dict[str, str] = {}
    for var, menu in MENUS.items():
        items = _extract_var(js, var)
        if not isinstance(items, list):
            raise JgabcSyntaxError(f"propersdata.js: {var} is not an array")
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("key"), str):
                out.setdefault(str(item["key"]), menu)
    return out


# Fields kept: the chant ids, the alias, and the incipits some entries print.
_ID_FIELD = re.compile(r"^[a-z]+(?:Pasch|Sept|Extra)?ID$|^(?:introitus|graduale|alleluia|tractus|"
                       r"sequentia|offertorium|communio)ID$")
_TEXT_FIELDS = frozenset({"ref", "in", "gr", "al", "tr", "seq", "of", "co"})


def slim(proprium: dict[str, object]) -> dict[str, dict[str, object]]:
    out: dict[str, dict[str, object]] = {}
    for key, entry in proprium.items():
        if not isinstance(entry, dict):
            continue
        kept = {f: v for f, v in entry.items()
                if (_ID_FIELD.match(f) and isinstance(v, int)) or f in _TEXT_FIELDS}
        out[key] = kept
    return out


def resolve(proprium: dict[str, dict[str, object]], key: str) -> dict[str, object] | None:
    """An entry with its `ref` chain merged in; the entry's own fields win."""
    merged: dict[str, object] = {}
    seen: set[str] = set()
    current: str | None = key
    while current is not None:
        if current in seen or current not in proprium:
            return None
        seen.add(current)
        entry = proprium[current]
        for field, value in entry.items():
            if field != "ref":
                merged.setdefault(field, value)
        ref = entry.get("ref")
        current = ref if isinstance(ref, str) else None
    return merged


def _content_sha(proprium: dict[str, dict[str, object]], menus: dict[str, str]) -> str:
    canonical = json.dumps({"menus": menus, "proprium": proprium}, sort_keys=True,
                           ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def write_vendored(proprium: dict[str, dict[str, object]], commit: str, source_sha256: str,
                   path: Path = VENDORED, menus: dict[str, str] | None = None) -> Path:
    menus = menus or {}
    doc = {
        "source": {
            "repo": f"https://github.com/{REPO}", "path": SOURCE_PATH, "commit": commit,
            "source_sha256": source_sha256, "licence": "Unlicense",
            "refresh": "uv run noh jgabc-fetch [--commit SHA]; do not hand-edit",
        },
        "content_sha256": _content_sha(proprium, menus),
        "menus": menus,
        "proprium": proprium,
    }
    path.write_text(json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
                    encoding="utf-8")
    return path


def _load(path: Path) -> dict[str, object]:
    if not path.exists():
        raise JgabcIntegrityError(
            f"{path} is missing -- run uv run noh jgabc-fetch to vendor it.")
    doc: dict[str, object] = json.loads(path.read_text(encoding="utf-8"))
    proprium = doc["proprium"]
    menus = doc.get("menus") or {}
    actual, recorded = _content_sha(proprium, menus), doc.get("content_sha256")  # type: ignore[arg-type]
    if actual != recorded:
        raise JgabcIntegrityError(
            f"{path.name} sha256 {actual[:12]} does not match its header {str(recorded)[:12]} "
            f"-- re-run uv run noh jgabc-fetch; do not hand-edit.")
    return doc


def load_proprium(path: Path = VENDORED) -> dict[str, dict[str, object]]:
    return _load(path)["proprium"]  # type: ignore[return-value]


def load_menus(path: Path = VENDORED) -> dict[str, str]:
    return _load(path).get("menus") or {}  # type: ignore[return-value]


def proper_url(key: str, menus: dict[str, str]) -> str | None:
    """jgabc's page for one whole Proper, or None when no menu lists the key."""
    menu = menus.get(key)
    if menu is None:
        return None
    from urllib.parse import quote
    return f"https://bbloomf.github.io/jgabc/propers.html#{menu}={quote(key)}"


def fetch(commit: str | None = None, path: Path = VENDORED) -> tuple[Path, str, int]:
    """Download propersdata.js at `commit` (default: master's head), parse it
    and vendor the slimmed proprium. Leaves `path` untouched on any failure."""
    import urllib.request

    def get(url: str) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": "cantusorgani-pipeline"})
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()

    if commit is None:
        head = json.loads(get(f"https://api.github.com/repos/{REPO}/commits/master"))
        commit = str(head["sha"])
    if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
        raise JgabcSyntaxError(f"not a commit sha: {commit!r}")
    raw = get(f"https://raw.githubusercontent.com/{REPO}/{commit}/{SOURCE_PATH}")
    js = raw.decode("utf-8")
    proprium = slim(extract_proprium(js))   # raises before any write
    menus = extract_menus(js)
    write_vendored(proprium, commit, hashlib.sha256(raw).hexdigest(), path, menus)
    return path, commit, len(proprium)


# ------------------------------------------------------------ key mapping ---

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
_WEEKDAY = {"1": "m", "2": "t", "3": "w", "4": "h", "5": "f", "6": "s"}
# 1962 keys whose jgabc name does not follow the rules below.
JGABC_TABLE: dict[str, str] = {
    "sancti:10-DU": "ChristusRex",
    "sancti:01-06": "Epi",
    "sancti:02-24": "Feb24or25", "sancti:02-27": "Feb27or28",
    "tempora:Quadp1-0": "7a", "tempora:Quadp2-0": "6a", "tempora:Quadp3-0": "5a",
    "tempora:Quadp3-3": "5aw", "tempora:Quadp3-4": "5ah", "tempora:Quadp3-5": "5af",
    "tempora:Quadp3-6": "5as",
    "tempora:Pasc5-4": "Asc",
    "tempora:Pasc6-6": "Pasc6s",
    "tempora:Pent01-4": "CorpusChristi",
    "tempora:Pent02-5": "SCJ",
    "tempora:093-3": "EmbWedSept", "tempora:093-5": "EmbFriSept", "tempora:093-6": "EmbSatSept",
}
# Commons and votive Masses (NOH4) by slug.
JGABC_BY_SLUG: dict[str, str] = {
    "in-vigilia-unius-apostoli": "mass_vigil_apostle",
    "commune-unius-martyris-pontificis": "mass_i_martyr_bishop",
    "commune-unius-martyris-pontificis-alia-missa": "mass_ii_martyr_bishop",
    "commune-unius-martyris-non-pontificis": "mass_i_martyr_not_bishop",
    "commune-unius-martyris-non-pontificis-alia-missa": "mass_ii_martyr_not_bishop",
    "commune-martyrum-tempore-paschali-de-uno-martyre": "mass_one_martyr",
    "commune-martyrum-tempore-paschali-de-pluribus-martyribus": "mass_two_or_more_martyr",
    "commune-plurimorum-martyrum": "mass_i_two_or_more_martyr",
    "commune-plurimorum-martyrum-alia-missa": "mass_ii_two_or_more_martyr",
    "commune-plurimorum-martyrum-alia-missa-2": "mass_iii_two_or_more_martyr",
    "commune-confessoris-pontificis": "mass_i_confessor_bishop",
    "commune-confessoris-pontificis-alia-missa": "mass_ii_confessor_bishop",
    "commune-doctorum": "mass_doctors",
    "commune-confessoris-non-pontificis": "mass_i_confessor_not_bishop",
    "commune-confessoris-non-pontificis-alia-missa": "mass_ii_confessor_not_bishop",
    "commune-confessoris-non-pontificis-missa-pro-abbatibus": "mass_abbots",
    "commune-virginum-pro-virgine-et-martyre": "mass_i_virgin_martyr",
    "commune-virginum-pro-virgine-et-martyre-2": "mass_ii_virgin_martyr",
    "commune-virginum-pro-virgine-tantum": "mass_i_virgin_not_martyr",
    "commune-virginum-pro-virgine-tantum-2": "mass_ii_virgin_not_martyr",
    "commune-non-virginum-pro-una-martyre-non-virgine": "mass_holy_woman_martyr",
    "commune-non-virginum-pro-nec-virgine-nec-martyre": "mass_holy_woman_not_martyr",
    "in-anniversario-dedicationis-ecclesiae": "dedicatio",
    "commune-unius-aut-plurium-summorum-pontificum": "mass_holy_pope",
    "feria-ii-missa-de-sanctissima-trinitate": "votiveST",
    "feria-iii-missa-de-angelis": "votiveA",
    "feria-iv-missa-de-s-joseph": "votiveJ",
    "feria-iv-missa-de-ss-apostolis-petro-et-paulo": "votivePP",
    "feria-iv-missa-de-omnibus-ss-apostolis": "votiveOA",
    "feria-v-missa-de-spiritu-sancto": "votiveSS",
    "feria-v-missa-de-ss-eucharistiae-sacramento": "votiveSES",
    "feria-v-missa-de-d-n-jesu-christi-summo-et-aeterno-sacerdote": "votiveJCSES",
    "feria-vi-missa-de-sancta-cruce": "votiveSC",
    "feria-vi-missa-de-passione-d-n-jesu-christi": "votivePJC",
    "missa-de-sancta-maria-in-sabbato-ab-adventu-usque-ad-nativitatem": "SMadvent",
    "missa-de-sancta-maria-in-sabbato-a-nativitate-usque-ad-purificat": "SMchristmas",
    "missa-de-sancta-maria-in-sabbato-a-purificatione-usque-ad-pascha": "SMlent",
    "missa-de-sancta-maria-in-sabbato-a-pascha-usque-ad-pentecosten": "SMeaster",
    "missa-de-sancta-maria-in-sabbato-a-pentecoste-usque-ad-adventum": "SMpentecost",
    # jgabc names these by initials; a wrong guess shows as part_mismatch.
    "missa-pro-eligendo-summo-pontifice": "votiveESP",
    "missa-ad-tollendum-schisma": "votiveUE",
    "missa-pro-quacumque-necessitate": "votiveQN",
    "missa-pro-remissione-peccatorum": "votiveRP",
    "missa-ad-postulandam-gratiam-bene-moriendi": "votiveGBM",
    "missa-contra-paganos": "votiveED",
    "missa-tempore-belli": "votiveTB",
    "missa-pro-pace": "votiveP",
    "missa-pro-vitanda-mortalitate": "votiveVM",
    "missa-pro-infirmis": "votiveMPI",
    "missa-pro-peregrinantibus-vel-iter-agentibus": "votivePIA",
    "missa-pro-sponso-et-sponsa": "nuptialis",
    "missa-votiva-pro-fidei-propagatione": "votiveFP",
}


def jgabc_key(day: str) -> str | None:
    """The jgabc key for a 1962 calendar key, or None when there is no rule."""
    if day in JGABC_TABLE:
        return JGABC_TABLE[day]
    m = re.fullmatch(r"sancti:(\d\d)-(\d\d)(m[123]|[a-z]*)", day)
    if m:
        month, date, suffix = int(m.group(1)), int(m.group(2)), m.group(3)
        if not 1 <= month <= 12:
            return None
        base = f"{_MONTHS[month - 1]}{date}"
        return f"{base}_{suffix[1]}" if suffix.startswith("m") and len(suffix) == 2 else base
    m = re.fullmatch(r"tempora:(Adv|Epi|Nat|Quad|Pasc|Pent)(\d+)-(\d)(?:r|Feria)?", day)
    if not m:
        return None
    season, week, weekday = m.group(1), int(m.group(2)), m.group(3)
    if season == "Pasc" and week == 7:            # the Pentecost octave
        season, week = "Pent", 0
    stem = f"{season}{week}"
    if weekday == "0":
        return stem
    if season == "Adv" and week == 3 and weekday in "356":   # Advent Ember days
        return f"Adv3{_WEEKDAY[weekday]}"
    return f"{stem}{_WEEKDAY[weekday]}"


def jgabc_key_for_piece(piece: dict[str, object]) -> str | None:
    """A piece's jgabc key: Commons and votives by slug, a Proper by the first
    day it owns (not a day it lends its Mass to)."""
    slug = str(piece.get("slug", ""))
    if slug in JGABC_BY_SLUG:
        return JGABC_BY_SLUG[slug]
    linked = set(piece.get("linked_days") or [])   # type: ignore[arg-type]
    own = [str(d) for d in piece.get("days") or [] if d not in linked]  # type: ignore[union-attr]
    for day in own:
        key = jgabc_key(day)
        if key is not None:
            return key
    return None


__all__ = [
    "JGABC_BY_SLUG",
    "JGABC_TABLE",
    "MENUS",
    "JgabcIntegrityError",
    "JgabcSyntaxError",
    "extract_menus",
    "extract_proprium",
    "fetch",
    "jgabc_key",
    "jgabc_key_for_piece",
    "load_menus",
    "load_proprium",
    "parse_js_literal",
    "proper_url",
    "resolve",
    "slim",
    "write_vendored",
]
