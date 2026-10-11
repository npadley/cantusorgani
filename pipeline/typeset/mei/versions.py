"""Version strings for the conversion code, bound to the code's own bytes.

An approval records ``extractor_version`` and ``converter_version`` as part of its inputs. If these
were constants, editing the code would leave an old approval looking current. So each string ends
with a digest of the files that decide the output, and ``manifest.current_inputs_from_files`` and
``typeset-mei-review`` take both from here (the single definition).

* ``extractor_version``: ``listen_full.ily`` (the LilyPond-side listener) and ``extract.py``
  (TSV -> IR). The IR's own ``extractorVersion`` field comes from the TSV ``version`` row and is
  informational; approval inputs use this value.
* ``converter_version``: ``encode.py`` (IR -> MEI), ``model.py`` (IR types, profile loading,
  rational formatting) and ``diagnostics.py``. ``extract.py`` is covered by the extractor digest;
  the profile JSON, the schema and the include files have their own hashes in ``ConversionInputs``.

Files are hashed in sorted-name order as ``name NUL bytes NUL``.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

MEI_DIR = Path(__file__).resolve().parent
EXTRACTOR_BASE = "listen_full/1"
CONVERTER_BASE = "mei-convert/1"
EXTRACTOR_FILES = ("extract.py", "listen_full.ily")
CONVERTER_FILES = ("diagnostics.py", "encode.py", "model.py")


def _digest(root: Path, names: tuple[str, ...]) -> str:
    h = hashlib.sha256()
    for name in sorted(names):
        h.update(name.encode() + b"\0" + (root / name).read_bytes() + b"\0")
    return h.hexdigest()[:16]


def extractor_version(root: Path = MEI_DIR) -> str:
    return f"{EXTRACTOR_BASE}+{_digest(root, EXTRACTOR_FILES)}"


def converter_version(root: Path = MEI_DIR) -> str:
    return f"{CONVERTER_BASE}+{_digest(root, CONVERTER_FILES)}"
