# Plan: NOH5 Kyriale Pilot

**Required Skill**: executing-plans
**Design doc**: `docs/claudekit/specs/2026-09-07-nova-organi-harmonia-design.md`

## Goal

**Problem**: an organist accompanying a sung Mass has no free, searchable way to
get the Nova Organi Harmonia accompaniment for a specific Ordinary. Today they
either own a physical 1942 volume, or scroll a 231-page unsearchable PDF scan on
a phone at the console.

**Goal**: make any NOH5 Ordinary (Missa I–XVIII, Cantus ad libitum, Missa pro
Defunctis) findable in under 15 seconds, readable in the browser on a tablet at
the organ bench without downloading anything, and exportable as a per-Mass PDF —
verified by named organists using it at a real service before the volume is
declared done.

## Architecture Overview

An offline Python pipeline turns `pdf-source/NOH5 Kyriale.pdf` into a git-tracked
catalog plus per-system WebP images in R2. An Astro static site renders that
catalog; a Cloudflare Worker accepts corrections into D1. NOH5 is the pilot
because it is self-contained, needs no calendar mapping, and exercises every
stage end to end.

## Tech Stack

- **Pipeline**: Python 3.12, `uv`, PyMuPDF, OpenCV, NumPy, Pillow, pytesseract (Latin), pytest, ruff
- **Web**: Astro (static), TypeScript (strict, no `any`), Pagefind, pdf-lib
- **Edge**: Cloudflare Workers, D1, R2, Turnstile, Vitest, wrangler
- **Data**: JSON + YAML, git-tracked

## Verified Source Facts

These were measured on 2026-09-07, not assumed:

| Fact | Value |
|---|---|
| PDF pages | 231 |
| Page raster | bitonal JBIG2, ~300 dpi, ≈2540×3490 px |
| Offset (NOH5) | printed 183 = PDF 229 → **+46** (NOH1 is +25; never share a constant) |
| Index location | PDF p.231, `INDEX PARTIS V.` |
| Index granularity | **Mass-level, not movement-level** (`Missa I … 5`, `Missa II … 11`) |
| Index range syntax | Both single (`98`) and ranges (`139-144`) occur |
| Index OCR quality | **Degraded.** Observed: `98`→`S8`, `106`→`:06`, `110`→`il0`, `114`→`j14` |
| Embedded text layer | **Present on every page** (PDFKit, 2026-09-07). p229 → `IN EXSEQUDS 183`; p51 → `I. TEMPORE PASCHALI \| (Lux et origo) \| Ky_n_e ... \| J. v. N.`; p231 → full index. Noisy: `EXSEQUDS`, `Festls`, `II` for `11` |
| Reference edition | CCW `Full PDF` / `- OCR`, 2201 pp each, 1.16 GB. Branding burned in, re-numbered, re-cropped, modern copyrighted preface. **Reconciliation only — never published** |
| Running heads | Present on music pages (e.g. `IN EXSEQUIIS`) — free per-page section metadata |
| Mode numbers | Printed left of systems (e.g. `II`) — free per-piece mode metadata |
| Signature marks | `PARS V` bottom-left — distinguishes body pages from front/back matter |

Consequence: the folio cross-check (Task 16) is **mandatory**, not defensive.

Second consequence: because every page carries an independent embedded OCR
reading, every OCR step in this plan is **dual-source**. Tesseract and the
embedded layer read the same pixels by different means; agreement is
verification, disagreement is a review-queue entry. This is the cheapest
reliability win available in the project, and it costs one extra extraction call
per page.

## Index Structure (NOH5)

```
ORDINARIUM MISSÆ        Asperges (1,2,4); Missa I–XVIII (5…96);
                        Credo I–IV (98,102,106,110); Toni Praefationum (114)
CANTUS AD LIBITUM       Kyrie I–XI (124…138); Gloria I–III (139-144);
                        Sanctus I–III (147-149); Agnus Dei I–II (150-151)
ALII CANTUS AD LIBITUM  Gloria (More Ambrosiano) 152; Credo V 154; Credo VI 158
MISSA PRO DEFUNCTIS     Missa «Requiem» 163; Absolutio 178; In Exsequiis 180
```

---

# Phase 0 — Foundation

## Task 0: Recruit named pilot users before writing code

**Files**: Create `docs/pilot-users.md`

**Steps**:

1. Identify and contact organists or schola directors who play sung Latin Mass
   regularly. Sources: the Church Music Association of America forum
   (musicasacra.com/forum), Gregorian chant groups, NPM chapters, and local
   FSSP/ICKSP parish music directors.

2. Record for each in `docs/pilot-users.md`: name, parish/role, and answers to
   three questions —
   - "How did you get NOH accompaniment for the last Mass you played?"
   - "What did that cost you in time, and what went wrong?"
   - "If I send you a link in six weeks, will you play from it at a real Mass and
     tell me what broke?"

3. **Gate**: aim for three yeses by name before Task 1. If fewer than three say
   yes, that is signal about scope — re-read the answers to question 1, because
   the wedge may be the Temporale rather than the Kyriale.

4. Commit
   ```bash
   git add docs/pilot-users.md
   git commit -m "docs: named pilot users and their current workflow"
   ```

---

## Task 0a: The `noh` CLI surface (build before any stage)

**Files**: Create `pipeline/cli.py`, `pipeline/manifest.py`; Test `tests/test_cli.py`

Every stage reachable by one verb, on one page or a whole volume, and re-runnable.
Argparse subparsers; no third-party CLI dependency.

```
uv run noh doctor                              # preflight: deps, creds, source PDFs
uv run noh render     --volume noh5 --pages 229
uv run noh clean      --volume noh5 --pages 229
uv run noh segment    --volume noh5 --pages 229 [--overlay] [--open]
uv run noh offset     --volume noh5
uv run noh index      --volume noh5
uv run noh crosscheck --volume noh5
uv run noh publish    --volume noh5 [--upload]
uv run noh status     --volume noh5            # what is done, what is stale
```

Shared flags on every stage verb:

| Flag | Default | Notes |
|---|---|---|
| `--volume ID` | required | no sensible default volume exists |
| `--pages SPEC` | all body pages | accepts `229`, `5-11`, `5,11,229` |
| `--force` | off | recompute even if the manifest says output is current |
| `--jobs N` | `os.cpu_count() - 1` | |
| `--out DIR` | `build/` | |

**Idempotence contract**: each stage writes
`build/<stage>/<vol>/manifest.json` recording
`{page: {input_sha, params_sha, output_path, mtime}}`. A stage skips any page whose
input and params are unchanged unless `--force`. This is what makes 2,445 pages
resumable after an interrupt — and it is why `read_folio` and `read_running_head`
must call the render **cache**, not `render_page` directly, or each will
re-rasterise the same page from scratch on every call.

Add to `pyproject.toml`: `[project.scripts] noh = "pipeline.cli:main"`. Keep
`python -m pipeline.cli` working as an alias.

---

## Task 0b: `noh doctor` — one command that explains every missing dependency

**Files**: Create `pipeline/doctor.py`; Test `tests/test_doctor.py`

Every check returns `(ok, what_failed, what_to_do)`. Sample output:

```
$ uv run noh doctor
ok    python 3.12.4
ok    uv 0.4.20
FAIL  tesseract: binary found (5.4.1) but Latin language data is missing.
      `lat` is required by render (folio OCR), index-ocr and running heads.
      Fix:  macOS   brew install tesseract-lang
            Debian  sudo apt install tesseract-ocr-lat
      Verify: tesseract --list-langs | grep lat
FAIL  pdf-source/NOH5 Kyriale.pdf not found.
      Source PDFs are not tracked in git (230 MB). See README
      "Getting the source PDFs"; expected sha256 is pinned in data/volumes.yml.
skip  R2 credentials (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
      R2_BUCKET): unset. Only `noh publish --upload` needs these.
      Fix: copy .dev.vars.example to .dev.vars, or export them in your shell.
```

Every stage verb calls `doctor` for the checks it needs before doing work, so a
missing `lat` fails in under a second with instructions — rather than as a
pytesseract traceback 40 minutes into a 2,445-page run.

---

## Task 1: Initialise repository and pipeline package

**Files**:
- Create: `.gitignore`, `pyproject.toml`, `pipeline/__init__.py`, `pipeline/py.typed`
- Create: `tests/__init__.py`

**Steps**:

1. Initialise git and ignore build artefacts
   ```bash
   cd /Users/npadley/development/nova-organi-harmonia-online
   git init
   printf '%s\n' 'build/' '.venv/' 'node_modules/' 'dist/' '.astro/' \
     '.wrangler/' '__pycache__/' '*.pyc' '.DS_Store' '.dev.vars' 'pdf-source/' > .gitignore
   ```

2. Create `pyproject.toml`
   ```toml
   [project]
   name = "noh-pipeline"
   version = "0.1.0"
   requires-python = ">=3.12"
   dependencies = [
     "pymupdf>=1.24",
     "opencv-python-headless>=4.10",
     "numpy>=2.0",
     "pillow>=10.4",
     "pytesseract>=0.3.13",
     "pyyaml>=6.0",
     "pydantic>=2.9",
   ]

   [dependency-groups]
   dev = ["pytest>=8.3", "ruff>=0.6"]

   [tool.ruff]
   line-length = 100

   [tool.pytest.ini_options]
   testpaths = ["tests"]
   markers = [
     "source: requires the untracked 230MB pdf-source/ PDFs; local only",
     "slow: renders pages at 300dpi",
   ]
   addopts = "--strict-markers"
   ```

   Every test touching `render_page` (Tasks 4, 5, 6, 12, 13, 16, 21) carries
   `@pytest.mark.source`; CI runs `uv run pytest -m "not source"`.

3. Install and verify
   ```bash
   uv sync
   uv run pytest --version
   # Expected: pytest 8.3.x
   ```

4. Commit
   ```bash
   git add -A
   git commit -m "chore: initialise repo and pipeline package"
   ```

**Note**: `pdf-source/` is 230 MB. Default: **leave untracked**, add
`pdf-source/` to `.gitignore`, and record checksums in `data/volumes.yml`.

A pinned hash with no source is unverifiable, so `data/volumes.yml` must also
carry, per volume: `source_url` (a durable mirror — IMSLP or archive.org item ID
preferred over a personal host), `retrieved` (ISO date), and `provenance`
(scanning institution, or "author's scan"). Without these a forker holds a
checksum they can never satisfy, and the dataset is reproducible by nobody but
the author — which contradicts the project's stated goal.

---

## Task 2: Volume registry with checksum pinning

**Files**:
- Create: `data/volumes.yml`
- Create: `pipeline/volumes.py`
- Test: `tests/test_volumes.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_volumes.py
   from pipeline.volumes import load_volumes

   def test_noh5_volume_is_registered():
       vols = load_volumes()
       noh5 = vols["noh5"]
       assert noh5.pdf_pages == 231
       assert noh5.page_offset is None  # derived by pipeline, never hand-set

   def test_registry_is_an_allowlist_not_a_glob():
       """pdf-source/ also holds the 1.16GB Corpus Christi Watershed reference
       edition, which carries burned-in branding and a copyrighted modern preface
       and must never be published. The pipeline reads only what volumes.yml
       names."""
       from pipeline.volumes import SOURCE
       on_disk = {f.name for f in SOURCE.glob("*.pdf")}
       registered = {v.file for v in load_volumes().values()}
       unregistered = on_disk - registered
       assert "Nova Organi Harmonia - Full PDF.pdf" in unregistered, (
           "the CCW reference edition must NOT be registered as a source volume"
       )

   def test_pipeline_refuses_an_unregistered_pdf():
       import pytest
       from pipeline.volumes import resolve_source
       with pytest.raises(ValueError, match="not in the registry"):
           resolve_source("Nova Organi Harmonia - Full PDF.pdf")
   ```

2. Verify it fails
   ```bash
   uv run pytest tests/test_volumes.py -v
   # Expected: FAILED — ModuleNotFoundError: pipeline.volumes
   ```

3. Create `data/volumes.yml`
   ```yaml
   volumes:
     noh5:
       title: "Kyriale"
       part: "V"
       file: "NOH5 Kyriale.pdf"
       pdf_pages: 231
       index_pdf_pages: [231]
       first_body_pdf_page: 47   # first PDF page bearing an arabic folio; sampling floor only
       page_offset: null   # DERIVED by pipeline.render — never hand-edit
       sha256: null        # filled by Task 3
       source_url: null    # durable mirror (archive.org / IMSLP item id)
       retrieved: null     # ISO date
       provenance: null    # scanning institution, or "author's scan"
   ```

4. Implement `pipeline/volumes.py`
   ```python
   from dataclasses import dataclass
   from pathlib import Path
   import yaml

   DATA = Path(__file__).resolve().parent.parent / "data"

   @dataclass(frozen=True)
   class Volume:
       id: str
       title: str
       part: str
       file: str
       pdf_pages: int
       index_pdf_pages: list[int]
       page_offset: int | None
       sha256: str | None

   def load_volumes(path: Path = DATA / "volumes.yml") -> dict[str, Volume]:
       raw = yaml.safe_load(path.read_text(encoding="utf-8"))["volumes"]
       return {k: Volume(id=k, **v) for k, v in raw.items()}
   ```

5. Verify and commit
   ```bash
   uv run pytest tests/test_volumes.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): add volume registry"
   ```

---

## Task 3: Pin source checksums

**Files**: Modify `data/volumes.yml`; Create `pipeline/checksum.py`; Test `tests/test_checksum.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_checksum.py
   from pipeline.checksum import verify_volume

   def test_noh5_checksum_matches_registry():
       assert verify_volume("noh5") is True
   ```

2. Implement
   ```python
   # pipeline/checksum.py
   import hashlib
   from pathlib import Path
   from pipeline.volumes import load_volumes

   SOURCE = Path(__file__).resolve().parent.parent / "pdf-source"

   def sha256_of(path: Path) -> str:
       h = hashlib.sha256()
       with path.open("rb") as fh:
           for chunk in iter(lambda: fh.read(1 << 20), b""):
               h.update(chunk)
       return h.hexdigest()

   def verify_volume(vol_id: str) -> bool:
       vol = load_volumes()[vol_id]
       if vol.sha256 is None:
           raise ValueError(
               f"{vol_id}: sha256 is null in data/volumes.yml, so the source PDF cannot "
               f"be verified. Compute and paste it:\n"
               f"  uv run python -c \"from pipeline.checksum import sha256_of, SOURCE; "
               f"print(sha256_of(SOURCE/'{vol.file}'))\""
           )
       return sha256_of(SOURCE / vol.file) == vol.sha256
   ```

3. Compute and record the real hash
   ```bash
   uv run python -c "from pipeline.checksum import sha256_of, SOURCE; print(sha256_of(SOURCE/'NOH5 Kyriale.pdf'))"
   # Paste result into data/volumes.yml under noh5.sha256
   ```

4. Verify and commit
   ```bash
   uv run pytest tests/test_checksum.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): pin source PDF checksums"
   ```

---

# Phase 1 — Render and offset verification

## Task 4: Render a single page at 300 dpi

**Files**: Create `pipeline/render.py`; Test `tests/test_render.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_render.py
   from pipeline.render import render_page

   def test_render_page_produces_expected_dimensions(tmp_path):
       out = render_page("noh5", pdf_page=229, dest_dir=tmp_path, dpi=300)
       assert out.exists()
       from PIL import Image
       w, h = Image.open(out).size
       assert 2400 < w < 2700
       assert 3300 < h < 3700
   ```

2. Verify it fails
   ```bash
   uv run pytest tests/test_render.py -v
   # Expected: FAILED — ModuleNotFoundError: pipeline.render
   ```

3. Implement
   ```python
   # pipeline/render.py
   from pathlib import Path
   import pymupdf
   from pipeline.volumes import load_volumes

   SOURCE = Path(__file__).resolve().parent.parent / "pdf-source"

   def render_page(vol_id: str, pdf_page: int, dest_dir: Path, dpi: int = 300) -> Path:
       """pdf_page is 1-indexed, matching human page references."""
       vol = load_volumes()[vol_id]
       dest_dir.mkdir(parents=True, exist_ok=True)
       out = dest_dir / f"{pdf_page:04d}.png"
       with pymupdf.open(SOURCE / vol.file) as doc:
           doc[pdf_page - 1].get_pixmap(dpi=dpi).save(out)
       return out
   ```

4. Verify and commit
   ```bash
   uv run pytest tests/test_render.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): render PDF pages at 300dpi"
   ```

---

## Task 5: OCR the printed folio number

**Files**: Create `pipeline/folio.py`; Test `tests/test_folio.py`

Folios sit in the **top outer corner**: top-right on odd printed pages, top-left
on even. Crop both corners and accept whichever yields a confident integer.

**Steps**:

1. Write failing test — uses the two pages verified by hand
   ```python
   # tests/test_folio.py
   import pytest
   from pipeline.folio import read_folio

   @pytest.mark.source
   def test_embedded_text_layer_yields_folio_and_running_head():
       """Verified 2026-09-07: NOH5 PDF p229 extracts as 'IN EXSEQUDS 183' —
       running head and folio in one string, no rasterisation needed."""
       head, folio = read_embedded("noh5", 229)
       assert folio == 183
       assert "EXSEQU" in head.upper()   # 'EXSEQUDS': OCR is noisy, match loosely

   @pytest.mark.source
   def test_agreement_between_sources_is_verification(tmp_path):
       result = read_folio_dual("noh5", 229, tmp_path)
       assert result.folio == 183
       assert result.agreement is True

   @pytest.mark.source
   def test_disagreement_is_surfaced_not_silently_resolved(tmp_path):
       """When the two readings differ the pipeline must refuse to pick a winner:
       a wrong folio poisons the offset and every reference in the volume."""
       result = read_folio_dual("noh5", 3, tmp_path)   # front matter, no folio
       assert result.folio is None
       assert result.agreement is False

   @pytest.mark.source
   @pytest.mark.parametrize("pdf_page,expected", [(229, 183), (228, 182), (47, 1)])
   def test_reads_known_folios(tmp_path, pdf_page, expected):
       """229 is verified by hand; 228 exercises the verso (top-left) crop; 47 is the
       first body page and the tightest test of the +46 offset. Verify each by eye
       against the render before relying on this test."""
       assert read_folio("noh5", pdf_page, tmp_path) == expected

   @pytest.mark.source
   def test_front_matter_returns_none_rather_than_a_guess(tmp_path):
       assert read_folio("noh5", 3, tmp_path) is None
   ```

2. Implement
   ```python
   # pipeline/folio.py
   import re
   from pathlib import Path
   import pytesseract
   from PIL import Image
   from pipeline.render import render_page

   _DIGITS = re.compile(r"\d{1,3}")
   _CFG = "--psm 7 -c tessedit_char_whitelist=0123456789"

   def read_folio(vol_id: str, pdf_page: int, work_dir: Path) -> int | None:
       img = Image.open(render_page(vol_id, pdf_page, work_dir))
       w, h = img.size
       band = int(h * 0.06)
       corners = [
           img.crop((int(w * 0.72), 0, w, band)),   # top-right (recto)
           img.crop((0, 0, int(w * 0.28), band)),   # top-left  (verso)
       ]
       readings: list[int] = []
       for corner in corners:
           text = pytesseract.image_to_string(corner, config=_CFG)
           found = _DIGITS.findall(text)
           if len(found) == 1:
               readings.append(int(found[0]))
       # Zero readings, two competing corners, or several numbers in one corner:
       # refuse to guess. A wrong folio poisons the offset and every reference in it.
       if len(readings) != 1:
           return None
       return readings[0]
   ```

3. Add the embedded-text reader and the dual-source combiner

   ```python
   # append to pipeline/folio.py
   from dataclasses import dataclass
   import pymupdf
   from pipeline.volumes import load_volumes, SOURCE

   _FOLIO_IN_HEAD = re.compile(r"\b(\d{1,3})\b")

   def read_embedded(vol_id: str, pdf_page: int) -> tuple[str, int | None]:
       """Read the top band from the PDF's own OCR text layer. Free: no render."""
       vol = load_volumes()[vol_id]
       with pymupdf.open(SOURCE / vol.file) as doc:
           page = doc[pdf_page - 1]
           band = pymupdf.Rect(0, 0, page.rect.width, page.rect.height * 0.06)
           text = page.get_text("text", clip=band).strip()
       nums = _FOLIO_IN_HEAD.findall(text)
       return text, int(nums[-1]) if len(nums) == 1 else None

   @dataclass(frozen=True)
   class FolioReading:
       folio: int | None
       agreement: bool
       embedded: int | None
       tesseract: int | None
       running_head: str

   def read_folio_dual(vol_id: str, pdf_page: int, work_dir: Path) -> FolioReading:
       head, emb = read_embedded(vol_id, pdf_page)
       tes = read_folio(vol_id, pdf_page, work_dir)
       # Two independent readings of the same pixels. Agreement is verification.
       # Disagreement is a review-queue entry, never a coin flip: the embedded
       # layer is 1990s-grade OCR ('EXSEQUDS', 'II' for 11) and Tesseract has its
       # own failure modes, so neither is authoritative alone.
       agree = emb is not None and emb == tes
       return FolioReading(folio=emb if agree else None, agreement=agree,
                           embedded=emb, tesseract=tes, running_head=head)
   ```

4. Verify and commit
   ```bash
   uv run pytest tests/test_folio.py -v   # Expected: 6 passed
   git add -A && git commit -m "feat(pipeline): dual-source folio reading with disagreement gate"
   ```

---

## Task 6: Derive page offset by sampling

**Files**: Create `pipeline/offset.py`; Test `tests/test_offset.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_offset.py
   from pipeline.offset import derive_offset

   def test_noh5_offset_is_46(tmp_path):
       result = derive_offset("noh5", tmp_path, sample_size=20)
       assert result.offset == 46
       assert result.confidence >= 0.8
   ```

2. Implement
   ```python
   # pipeline/offset.py
   from collections import Counter
   from dataclasses import dataclass
   from pathlib import Path
   import random
   from pipeline.folio import read_folio
   from pipeline.volumes import load_volumes

   @dataclass(frozen=True)
   class OffsetResult:
       offset: int
       confidence: float
       samples: int
       disagreements: list[tuple[int, int]]

   def derive_offset(vol_id: str, work_dir: Path, sample_size: int = 20,
                     seed: int = 0) -> OffsetResult:
       vol = load_volumes()[vol_id]
       body = [p for p in range(1, vol.pdf_pages + 1) if p not in vol.index_pdf_pages]
       rng = random.Random(seed)
       # Never infer front-matter size from a fraction of the volume: for NOH5 the
       # 20% heuristic coincidentally equals the true 46-page front matter and would
       # be wrong for every other volume. Declare it in volumes.yml.
       candidates = [q for q in body if q >= vol.first_body_pdf_page]
       if len(candidates) < sample_size:
           raise RuntimeError(f"{vol_id}: only {len(candidates)} body pages to sample")
       pages = rng.sample(candidates, sample_size)

       votes: Counter[int] = Counter()
       observed: list[tuple[int, int]] = []
       for p in pages:
           reading = read_folio_dual(vol_id, p, work_dir)
           # Only agreed readings vote. An unagreed page contributes nothing rather
           # than contributing noise to the single most damaging value in the volume.
           if reading.folio is not None:
               votes[p - reading.folio] += 1
               observed.append((p, reading.folio))

       if not votes:
           raise RuntimeError(
               f"{vol_id}: could not read a printed folio on any of {len(pages)} sampled "
               f"pages.\n"
               f"  Likely causes, in order:\n"
               f"    1. Tesseract Latin data missing — run `uv run noh doctor`.\n"
               f"    2. The folio crop is wrong for this volume (folios are assumed in\n"
               f"       the top outer 28% x 6%; check the corners in pipeline/folio.py).\n"
               f"    3. The sampled pages are front/back matter with no printed folio.\n"
               f"  Rendered samples are in {work_dir} — open one and look at the corners.\n"
               f"  Sampled PDF pages were: {sorted(pages)}"
           )
       offset, count = votes.most_common(1)[0]
       disagreements = [(p, f) for p, f in observed if p - f != offset]
       return OffsetResult(offset, count / len(observed), len(observed), disagreements)
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_offset.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): derive page offset by folio sampling"
   ```

---

## Task 7: Fail the build on inconsistent offset

**Files**: Modify `pipeline/offset.py`; Test `tests/test_offset_guard.py`

This is the single highest-value guard in the project.

**Steps**:

1. Write failing test
   ```python
   # tests/test_offset_guard.py
   import pytest
   from pipeline.offset import OffsetResult, assert_consistent

   def test_rejects_low_confidence():
       bad = OffsetResult(offset=46, confidence=0.55, samples=20, disagreements=[(9, 9)])
       with pytest.raises(ValueError, match="inconsistent"):
           assert_consistent("noh5", bad)

   def test_accepts_clean_result():
       good = OffsetResult(offset=46, confidence=1.0, samples=20, disagreements=[])
       assert_consistent("noh5", good)
   ```

2. Implement
   ```python
   # append to pipeline/offset.py
   MIN_CONFIDENCE = 0.9
   MIN_SAMPLES = 10

   def assert_consistent(vol_id: str, result: OffsetResult) -> None:
       if result.samples < MIN_SAMPLES:
           raise ValueError(f"{vol_id}: only {result.samples} folios read; need {MIN_SAMPLES}")
       if result.confidence < MIN_CONFIDENCE:
           raise ValueError(
               f"{vol_id}: inconsistent offset (confidence {result.confidence:.2f}); "
               f"disagreements: {result.disagreements}"
           )
   ```

3. Persist the derived value as a reviewable artefact

   `pipeline.offset` writes git-tracked `data/derived-offsets.json`:
   ```json
   {"noh5": {"offset": 46, "confidence": 1.0, "samples": 20, "seed": 0,
             "source_sha256": "<pinned volume hash>"}}
   ```
   Downstream stages read this file instead of re-deriving. Rationale: the offset
   is the one value that can poison every reference in a volume, so a change to it
   must appear as a line in a diff and be reviewed — not silently recomputed on
   each run. `assert_consistent` additionally raises if `source_sha256` does not
   match `volumes.yml`, so an offset cannot survive a change of source PDF.

4. Verify and commit
   ```bash
   uv run pytest tests/test_offset_guard.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): fail build on inconsistent page offset"
   ```

---

# Phase 2 — Clean and segment

## Task 8: Deskew and despeckle

**Files**: Create `pipeline/clean.py`; Test `tests/test_clean.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_clean.py
   import numpy as np
   from pipeline.clean import estimate_skew, clean_page

   import cv2, pytest

   def _ruled(angle: float) -> np.ndarray:
       img = np.full((800, 1200), 255, dtype=np.uint8)
       for y in (200, 400, 600):
           img[y:y + 4, 100:1100] = 0
       m = cv2.getRotationMatrix2D((600.0, 400.0), angle, 1.0)
       return cv2.warpAffine(img, m, (1200, 800), flags=cv2.INTER_NEAREST, borderValue=255)

   def test_estimate_skew_recovers_a_known_rotation():
       assert abs(estimate_skew(_ruled(0.0))) < 0.15
       assert estimate_skew(_ruled(1.3)) == pytest.approx(-1.3, abs=0.15)
       assert estimate_skew(_ruled(-2.4)) == pytest.approx(2.4, abs=0.15)

   def test_blank_page_is_not_rotated():
       blank = np.full((800, 1200), 255, dtype=np.uint8)
       assert estimate_skew(blank) == 0.0, "must not return -limit on a tie"

   def test_clean_preserves_shape(tmp_path):
       img = np.full((800, 1200), 255, dtype=np.uint8)
       out = clean_page(img)
       assert out.shape == img.shape
       assert out.dtype == np.uint8
   ```

2. Implement
   ```python
   # pipeline/clean.py
   import cv2
   import numpy as np

   def estimate_skew(gray: np.ndarray, limit: float = 5.0, step: float = 0.1) -> float:
       """Angle in degrees maximising row-variance of the horizontal projection."""
       inv = 255 - gray
       best_angle, best_score = 0.0, -1.0
       h, w = inv.shape
       centre = (w / 2, h / 2)
       for angle in np.arange(-limit, limit + step, step):
           m = cv2.getRotationMatrix2D(centre, angle, 1.0)
           rot = cv2.warpAffine(inv, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
           score = float(np.var(rot.sum(axis=1)))
           if score > best_score:
               best_angle, best_score = float(angle), score
       # A page with no long horizontal structure (front matter, index) has near-equal
       # variance at every angle; without this guard the first angle tested (-limit)
       # wins on the tie and the page is silently rotated by the full search limit.
       zero_score = float(np.var(inv.sum(axis=1)))
       if inv.mean() < 1.0 or best_score < zero_score * 1.05:
           return 0.0
       return best_angle

   def clean_page(gray: np.ndarray) -> np.ndarray:
       angle = estimate_skew(gray)
       h, w = gray.shape
       m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
       rot = cv2.warpAffine(gray, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=255)
       den = cv2.medianBlur(rot, 3)
       _, binary = cv2.threshold(den, 127, 255, cv2.THRESH_BINARY)
       return binary
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_clean.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): deskew and despeckle pages"
   ```

---

## Task 9: Detect staff lines

**Files**: Create `pipeline/segment.py`; Test `tests/test_staff_lines.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_staff_lines.py
   import numpy as np
   from pipeline.segment import find_staff_lines

   def test_finds_five_lines_of_a_synthetic_staff():
       img = np.full((600, 1400), 255, dtype=np.uint8)
       for i in range(5):
           img[100 + i * 12: 102 + i * 12, 200:1200] = 0
       lines = find_staff_lines(img)
       assert len(lines) == 5
       assert lines[0] < lines[-1]
   ```

2. Implement
   ```python
   # pipeline/segment.py
   import cv2
   import numpy as np

   def find_staff_lines(binary: np.ndarray, min_run_ratio: float = 0.5) -> list[int]:
       """Row indices of staff lines, found by long horizontal runs of ink."""
       inv = (binary < 128).astype(np.uint8)
       width = binary.shape[1]
       # Close a +-2px vertical wobble before opening: after deskew a 1900px staff line
       # can still drift 3-4 rows, leaving each row's contiguous run too short to
       # survive the horizontal opening — which would erase every line on the page.
       inv = cv2.dilate(inv, cv2.getStructuringElement(cv2.MORPH_RECT, (1, 5)))
       kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (int(width * 0.3), 1))
       horiz = cv2.morphologyEx(inv, cv2.MORPH_OPEN, kernel)
       profile = horiz.sum(axis=1)
       # Staves are indented (mode numbers sit left of the system), so threshold
       # against the longest run actually present, not against page width.
       peak = int(profile.max()) if profile.size else 0
       if peak < width * 0.35:
           return []          # genuinely no staff-like structure: front matter or index
       threshold = peak * min_run_ratio

       lines, run = [], []
       for y, value in enumerate(profile):
           if value >= threshold:
               run.append(y)
           elif run:
               lines.append(int(np.mean(run)))
               run = []
       if run:
           lines.append(int(np.mean(run)))
       return lines
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_staff_lines.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): detect staff lines"
   ```

---

## Task 10: Group staff lines into staves and systems

**Files**: Modify `pipeline/segment.py`; Test `tests/test_systems.py`

NOH systems are consistently **two staves** (treble + bass) joined by a brace.

**Steps**:

1. Write failing test
   ```python
   # tests/test_systems.py
   from pipeline.segment import group_staves, group_systems

   def test_groups_ten_lines_into_two_staves():
       lines = [100, 112, 124, 136, 148,  300, 312, 324, 336, 348]
       staves = group_staves(lines)
       assert len(staves) == 2
       assert staves[0].top == 100 and staves[0].bottom == 148

   def test_pairs_staves_into_one_system():
       lines = [100, 112, 124, 136, 148,  300, 312, 324, 336, 348]
       systems = group_systems(group_staves(lines))
       assert len(systems) == 1
       assert systems[0].staff_count == 2
   ```

2. Implement
   ```python
   # append to pipeline/segment.py
   from dataclasses import dataclass

   @dataclass(frozen=True)
   class Staff:
       top: int
       bottom: int

   @dataclass(frozen=True)
   class System:
       top: int
       bottom: int
       staff_count: int

   def group_staves(lines: list[int], slack: float = 0.15,
                    min_gap: float = 10.0, max_gap: float = 34.0) -> list[Staff]:
       """Consecutive runs of 5 evenly spaced lines form one staff.

       min_gap/max_gap bound staff-line spacing at 300dpi; without them five evenly
       spaced rubric baselines (see fixture page 229) are accepted as a staff. The
       old `mean_gap / tolerance` permitted 50% deviation — a rubber stamp, not a
       tolerance. Synthetic tests using 12px spacing must pass min_gap explicitly.
       """
       staves: list[Staff] = []
       i = 0
       while i + 4 < len(lines):
           window = lines[i:i + 5]
           gaps = [b - a for a, b in zip(window, window[1:])]
           mean_gap = sum(gaps) / len(gaps)
           if (min_gap <= mean_gap <= max_gap
                   and all(abs(g - mean_gap) <= mean_gap * slack for g in gaps)):
               staves.append(Staff(top=window[0], bottom=window[-1]))
               i += 5
           else:
               i += 1
       return staves

   def group_systems(staves: list[Staff], expected_staves: int = 2) -> list[System]:
       """NOH systems are exactly `expected_staves` braced staves. Group positionally
       and assert the intra-system gap is strictly smaller than the gap to the next
       system — the only property that makes the grouping defensible. A gap-ratio
       rule cannot work here: the inter-system gap holds the Latin text line, so any
       ratio loose enough to join a brace also merges neighbouring systems.
       """
       if not staves:
           return []
       if len(staves) % expected_staves != 0:
           raise ValueError(
               f"{len(staves)} staves is not a multiple of {expected_staves}; "
               "staff detection dropped or invented a staff — send this page to review"
           )
       systems: list[System] = []
       for i in range(0, len(staves), expected_staves):
           group = staves[i:i + expected_staves]
           inner = max(b.top - a.bottom for a, b in zip(group, group[1:]))
           if i + expected_staves < len(staves):
               outer = staves[i + expected_staves].top - group[-1].bottom
               if inner >= outer:
                   raise ValueError(
                       f"system {i // expected_staves}: intra-system gap {inner}px is not "
                       f"smaller than inter-system gap {outer}px — grouping is unsafe"
                   )
           systems.append(_close(group))
       return systems

   def _close(group: list[Staff]) -> System:
       return System(top=group[0].top, bottom=group[-1].bottom, staff_count=len(group))
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_systems.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): group staff lines into systems"
   ```

---

## Task 11: Extend system boxes to capture the Latin text line

**Files**: Modify `pipeline/segment.py`; Test `tests/test_system_bbox.py`

**Critical**: NOH sets its Latin text **above** each system, and mode numbers to
the left. A box drawn on staff lines alone crops the words off — which would
make every export useless.

**Steps**:

1. Write failing test
   ```python
   # tests/test_system_bbox.py
   from pipeline.segment import System, to_bboxes

   def test_box_extends_above_first_staff_for_text():
       systems = [System(top=400, bottom=520, staff_count=2)]
       boxes = to_bboxes(systems, page_height=3400, page_width=2540)
       assert boxes[0].top < 400, "must include the Latin text line above the staff"
       assert boxes[0].left == 0, "must include mode numbers printed left of the system"

   def test_boxes_never_overlap():
       systems = [System(400, 520, 2), System(560, 680, 2)]
       boxes = to_bboxes(systems, page_height=3400, page_width=2540)
       assert boxes[0].bottom <= boxes[1].top
   ```

2. Implement
   ```python
   # append to pipeline/segment.py
   @dataclass(frozen=True)
   class BBox:
       left: int
       top: int
       right: int
       bottom: int

   TEXT_HEADROOM = 0.55   # fraction of system height reserved for text above
   TAIL_PADDING = 0.08

   def to_bboxes(systems: list[System], page_height: int, page_width: int) -> list[BBox]:
       boxes: list[BBox] = []
       for i, sys_ in enumerate(systems):
           height = sys_.bottom - sys_.top
           want_top = sys_.top - int(height * TEXT_HEADROOM)
           floor = 0 if i == 0 else boxes[-1].bottom
           top = max(want_top, floor)
           bottom = min(sys_.bottom + int(height * TAIL_PADDING), page_height)
           if i + 1 < len(systems):
               nxt = systems[i + 1]
               nxt_headroom = int((nxt.bottom - nxt.top) * TEXT_HEADROOM)
               # Stop above the *next* system's text line, not above its staff, or the
               # next system's Latin text is cut in half across two slices — the exact
               # failure this task exists to prevent.
               bottom = min(bottom, nxt.top - nxt_headroom)
           if bottom <= sys_.bottom:
               raise ValueError(
                   f"system {i}: no clean cut below the staff (bottom={bottom}, "
                   f"staff_bottom={sys_.bottom}); systems too close — send page to review"
               )
           boxes.append(BBox(left=0, top=top, right=page_width, bottom=bottom))
       return boxes
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_system_bbox.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): extend system boxes to include text and mode"
   ```

---

## Task 12: Segmentation regression harness

**Files**: Create `tests/fixtures/noh5-systems.json`, `pipeline/evaluate.py`; Test `tests/test_segmentation_regression.py`

**Steps**:

1. Build the fixture set — 12 NOH5 pages chosen for difficulty
   ```bash
   # PDF page numbers ONLY. Printed folio = PDF - 46 for NOH5; never mix the two in
   # one list. Printed 5,11,98,124,139,152,163,180 -> PDF 51,57,144,170,185,198,209,226.
   uv run noh render --volume noh5 \
     --pages 1,47,51,57,144,170,185,198,209,226,229,231 \
     --out tests/fixtures/pages/
   ```
   Hand-label expected system counts for **all twelve** pages into
   `tests/fixtures/noh5-systems.json` — an unlabelled page is not covered by the
   parametrised test and silently weakens the gate:
   ```json
   {
     "229": {"systems": 5, "note": "IN EXSEQUIIS, rubric paragraphs between systems"},
     "231": {"systems": 0, "note": "index page, no music"},
     "1":   {"systems": 0, "note": "front matter"}
   }
   ```

2. Write failing test
   ```python
   # tests/test_segmentation_regression.py
   import json
   from pathlib import Path
   import pytest
   from pipeline.evaluate import count_systems

   FIXTURES = json.loads(Path("tests/fixtures/noh5-systems.json").read_text())

   @pytest.mark.parametrize("page,expected", [(int(k), v["systems"]) for k, v in FIXTURES.items()])
   def test_system_count_matches_hand_label(page, expected):
       assert count_systems("noh5", page) == expected
   ```

3. Implement `count_systems` in `pipeline/evaluate.py` composing clean → find_staff_lines → group_staves → group_systems.

4. Build the overlay — the pipeline's one visible proof that it works

   ```bash
   uv run noh segment --volume noh5 --pages 229 --overlay --open
   # writes build/overlay/noh5/0229.png and opens it
   ```
   The overlay is the cleaned page with each detected `BBox` stroked in a distinct
   colour, numbered in reading order, annotated with detected system count, staff
   count, and any OCR'd running head and mode.

   Also emit `build/overlay/noh5/contact-sheet.html`: every fixture page's overlay
   in a scrolling grid, hand-labelled count beside detected count, mismatches
   highlighted. This turns the Task 12 gate from "12 passed" into something you can
   look at and believe, and makes tuning `TEXT_HEADROOM` tractable rather than
   guesswork.

5. Verify and commit
   ```bash
   uv run pytest tests/test_segmentation_regression.py -v
   # Expected: all fixture pages passing. Any failure = tune before proceeding.
   git add -A && git commit -m "test(pipeline): segmentation regression harness"
   ```

**Gate**: do not proceed to Phase 3 until this suite is green. Segmentation
quality is the ceiling on everything downstream.

---

# Phase 3 — Index and catalog

## Task 13: OCR the running head

**Files**: Create `pipeline/runninghead.py`; Test `tests/test_runninghead.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_runninghead.py
   from pipeline.runninghead import read_running_head

   def test_reads_in_exsequiis(tmp_path):
       assert "EXSEQUIIS" in read_running_head("noh5", 229, tmp_path).upper()
   ```

2. Implement — take the embedded text layer first (free, no render), fall back to
   Tesseract, and record both so `reconcile` can use agreement as verification.
   `read_embedded` from Task 5 already returns the running head alongside the
   folio, so this stage is largely a normalisation layer over it: strip the folio
   digits, uppercase, and fuzzy-match against a controlled vocabulary of NOH5
   section names (`ORDINARIUM MISSAE`, `CANTUS AD LIBITUM`, `MISSA PRO DEFUNCTIS`,
   `IN EXSEQUIIS`, …) so that `IN EXSEQUDS` resolves correctly.

   Fallback path — crop the centre of the top band, OCR with Latin data:
   ```python
   # pipeline/runninghead.py
   from pathlib import Path
   import pytesseract
   from PIL import Image
   from pipeline.render import render_page

   def read_running_head(vol_id: str, pdf_page: int, work_dir: Path) -> str:
       img = Image.open(render_page(vol_id, pdf_page, work_dir))
       w, h = img.size
       band = img.crop((int(w * 0.20), 0, int(w * 0.80), int(h * 0.06)))
       return pytesseract.image_to_string(band, lang="lat", config="--psm 7").strip()
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_runninghead.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): OCR running heads"
   ```

---

## Task 14: Parse the index page

**Files**: Create `pipeline/index_ocr.py`; Test `tests/test_index_parse.py`

Must handle both `Missa I … 5` and `Gloria I. II. III. … 139-144`.

**Steps**:

1. Write failing test
   ```python
   # tests/test_index_parse.py
   from pipeline.index_ocr import parse_index_line

   def test_parses_single_page_entry():
       e = parse_index_line("II.  In Festis Solemnibus. 1. - Kyrie fons bonitatis  .  11")
       assert e.label == "II." and e.first_page == 11 and e.last_page == 11

   def test_parses_page_range():
       e = parse_index_line("Gloria I. II. III. . . . . . 139-144")
       assert e.first_page == 139 and e.last_page == 144

   def test_returns_none_for_heading():
       assert parse_index_line("ORDINARIUM MISSÆ.") is None
   ```

2. Implement
   ```python
   # pipeline/index_ocr.py
   import re
   from dataclasses import dataclass

   _ENTRY = re.compile(r"^(?P<title>.*?)[\s.]*(?P<first>\d{1,3})(?:\s*-\s*(?P<last>\d{1,3}))?\s*$")
   _LABEL = re.compile(r"^(?P<label>(?:[IVXLC]+|Kyrie|Gloria|Sanctus|Agnus|Credo)[.\s])")

   @dataclass(frozen=True)
   class IndexEntry:
       label: str
       title: str
       first_page: int
       last_page: int

   def parse_index_line(line: str) -> IndexEntry | None:
       stripped = line.strip().rstrip(".")
       m = _ENTRY.match(stripped)
       if not m:
           return None
       title = m.group("title").strip(" .")
       if not title:
           return None
       first = int(m.group("first"))
       last = int(m.group("last") or first)
       label_m = _LABEL.match(title)
       return IndexEntry(
           label=label_m.group("label").strip() if label_m else "",
           title=title,
           first_page=first,
           last_page=last,
       )
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_index_parse.py -v   # Expected: 3 passed
   git add -A && git commit -m "feat(pipeline): parse INDEX PARTIS entries"
   ```

---

## Task 15: Hand-transcribe the NOH5 index as ground truth

**Files**: Create `data/index-noh5.yml`

The index page scan is **measurably degraded** (`98`→`S8`, `110`→`il0`), and the
embedded text layer is no better on that page — it renders the same entries as
`l. Mis. Tempore PaschalL - Lux el origo 5` and `II. In Festls Solemnibus. I..
Kyrie (o"s bmilalis II`, where the trailing `II` is the page number 11. With only
~45 entries, hand-transcription is faster and safer than fighting either OCR.

Both OCR sources become *cross-checks against* this file, never replacements. The
useful property is that they fail differently: where the embedded layer and
Tesseract agree with the hand transcription, the entry is triple-confirmed; where
all three differ, that entry goes to review before anything is published.

**Steps**:

1. Transcribe from the rendered index page
   ```yaml
   # data/index-noh5.yml
   sections:
     - name: "Ordinarium Missae"
       entries:
         - {label: "Asperges",  title: "Ad aspersionem Aquae benedictae extra T.P.", page: 1}
         - {label: "Asperges",  title: "Tempore Paschali", page: 2}
         - {label: "I",   title: "Missa Tempore Paschali - Lux et origo", page: 5}
         - {label: "II",  title: "In Festis Solemnibus 1 - Kyrie fons bonitatis", page: 11}
         # … through XVIII (page 96)
         - {label: "Credo I",   title: "Credo I",   page: 98}
         - {label: "Credo IV",  title: "Credo IV",  page: 110}
     - name: "Cantus ad libitum"
       entries:
         - {label: "Kyrie I", title: "Clemens Rector", page: 124}
         - {label: "Gloria I-III", title: "Gloria I. II. III.", page: 139, last_page: 144}
     - name: "Missa pro Defunctis"
       entries:
         - {label: "I",   title: "Missa «Requiem»", page: 163}
         - {label: "III", title: "In Exsequiis Defunctorum", page: 180}
   ```

2. Commit
   ```bash
   git add data/index-noh5.yml
   git commit -m "data: hand-transcribed NOH5 index as ground truth"
   ```

---

## Task 16: Cross-check index pages against printed folios

**Files**: Create `pipeline/crosscheck.py`; Test `tests/test_crosscheck.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_crosscheck.py
   from pipeline.crosscheck import verify_entry_pages

   def test_every_index_entry_lands_on_its_printed_folio(tmp_path):
       failures = verify_entry_pages("noh5", tmp_path)
       assert failures == [], f"index/folio mismatches: {failures}"
   ```

2. Implement — for each entry, render `printed + offset` and assert the folio matches
   ```python
   # pipeline/crosscheck.py
   from pathlib import Path
   import yaml
   from pipeline.folio import read_folio
   from pipeline.offset import derive_offset, assert_consistent

   DATA = Path(__file__).resolve().parent.parent / "data"

   def verify_entry_pages(vol_id: str, work_dir: Path) -> list[dict[str, int | str]]:
       result = derive_offset(vol_id, work_dir)
       assert_consistent(vol_id, result)
       doc = yaml.safe_load((DATA / f"index-{vol_id}.yml").read_text(encoding="utf-8"))

       failures: list[dict[str, int | str]] = []
       for section in doc["sections"]:
           for entry in section["entries"]:
               printed = entry["page"]
               actual = read_folio(vol_id, printed + result.offset, work_dir)
               if actual != printed:
                   failures.append({"title": entry["title"], "expected": printed,
                                    "read": actual if actual is not None else -1})
       return failures
   ```

3. Verify and commit
   ```bash
   uv run pytest tests/test_crosscheck.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): cross-check index pages against folios"
   ```

---

## Task 16b: Reconcile against the CCW reference edition

**Files**: Create `pipeline/reference.py`, `data/reference-editions.yml`; Test `tests/test_reference.py`

An independent second opinion on page ordering and completeness. **No CCW imagery
or text ever reaches the site** — this stage emits a census, not content.

**Steps**:

1. Declare the reference edition, explicitly separated from publication sources
   ```yaml
   # data/reference-editions.yml
   # RECONCILIATION ONLY. Never a publication source. See docs/LICENSES.md.
   ccw:
     title: "Nova Organi Harmonia (Corpus Christi Watershed edition)"
     file: "Nova Organi Harmonia - Full PDF.pdf"
     pdf_pages: 2201
     excluded_reason: >
       CCWATERSHED.ORG branding burned into every page image; pages re-numbered
       and re-cropped so the original folio and running head are absent; front
       matter includes a modern preface translation (D. Cook) under copyright.
   ```

2. Write failing test
   ```python
   # tests/test_reference.py
   import pytest
   from pipeline.reference import census, compare_to_volume

   @pytest.mark.source
   def test_ccw_census_covers_the_expected_page_count():
       assert census("ccw")["pages"] == 2201

   @pytest.mark.source
   def test_every_noh5_body_page_has_a_ccw_counterpart():
       result = compare_to_volume("noh5", "ccw")
       assert result.missing_in_reference == [], (
           f"pages absent from the CCW edition: {result.missing_in_reference}"
       )
       assert result.missing_in_source == [], (
           f"pages CCW has that our scan lacks: {result.missing_in_source}"
       )
   ```

3. Implement — match on the embedded Latin text of each page, not on page index.
   CCW deduplicates the repeated per-volume front matter (2201 vs our 2,445, a gap
   of ~244 ≈ eight volumes of front matter), so positional alignment is
   meaningless. Normalise each page's extracted Latin (accent-strip, lowercase,
   collapse whitespace) and align by best text overlap, reusing
   `normalise_incipit` from Task 19.

4. Emit `data/reference-census-noh5.json` recording, per NOH5 body page, the
   matched CCW page and the match score. A page with no confident match is a
   **review-queue entry, not a failure** — it may equally mean our scan has a page
   CCW dropped, which is worth knowing either way.

5. Verify and commit
   ```bash
   uv run pytest tests/test_reference.py -v
   git add -A && git commit -m "feat(pipeline): reconcile page census against CCW reference edition"
   ```

**Explicitly out of scope for the pilot** (recorded so the decision is not
re-litigated): recovering the six `NOH1 missing pages` from CCW, and using CCW's
OCR as a third vote on Latin incipits. Both were considered and deferred.

---

## Task 17: Emit catalog.json

**Files**: Create `pipeline/catalog.py`, `data/catalog.json`; Test `tests/test_catalog.py`

Index entries are Mass-level. Movement boundaries (Kyrie/Gloria/Sanctus/Agnus)
come from running heads plus the first text line of each system; anything
uncertain goes to `review-queue.json`, never straight to publication.

**Steps**:

1. Write failing test
   ```python
   # tests/test_catalog.py
   from pipeline.catalog import build_catalog

   def test_catalog_has_pieces_with_required_fields():
       cat = build_catalog("noh5")
       assert cat["schema_version"] == 1
       assert len(cat["pieces"]) > 0
       for piece in cat["pieces"]:
           assert piece["id"] and piece["volume"] == "noh5"
           assert piece["genre"] in {
               "kyrie", "gloria", "credo", "sanctus", "agnus", "ite",
               "asperges", "requiem", "absolutio", "exsequiis", "tonus", "other",
           }
           # One vocabulary per concept: `review_status` is about the NOH piece record,
           # `chant.status` (Task 20) is about the GregoBase pairing. Never conflate.
           assert piece["review_status"] in {"verified", "unmatched", "review"}
           assert piece["chant"] is None or piece["chant"]["status"] in {
               "verified", "unverified", "unpaired",
           }
           assert len(piece["systems"]) > 0
   ```

2. Implement `build_catalog` composing index entries + offset + per-page systems.

3. Verify and commit
   ```bash
   uv run pytest tests/test_catalog.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): emit catalog.json"
   ```

---

## Task 18: Catalog invariants (fast CI gate)

**Files**: Test `tests/test_catalog_invariants.py`

**Steps**:

1. Write the invariant suite — pure data, runs in seconds
   ```python
   # tests/test_catalog_invariants.py
   import json
   from pathlib import Path
   import pytest

   CAT = json.loads(Path("data/catalog.json").read_text(encoding="utf-8"))

   def test_piece_ids_are_unique():
       ids = [p["id"] for p in CAT["pieces"]]
       assert len(ids) == len(set(ids))

   def test_no_two_pieces_claim_the_same_system():
       seen: dict[str, str] = {}
       for piece in CAT["pieces"]:
           for ref in piece["systems"]:
               assert ref not in seen, f"{ref} claimed by {seen[ref]} and {piece['id']}"
               seen[ref] = piece["id"]

   MAX_PRINTED_PAGE = 183   # highest folio in NOH5, verified 2026-09-07

   def test_page_ranges_are_in_bounds_of_the_verified_folio_range():
       for piece in CAT["pieces"]:
           first, last = piece["printed_pages"]
           assert 1 <= first <= last <= MAX_PRINTED_PAGE, piece["id"]

   def test_every_detected_system_is_claimed_by_exactly_one_piece():
       """A system the pipeline found but no piece references is music dropped on the
       floor — the export truncates and nothing else in CI notices."""
       detected = set(json.loads(
           Path("build/systems/noh5/manifest.json").read_text(encoding="utf-8"))["refs"])
       claimed = {ref for p in CAT["pieces"] for ref in p["systems"]}
       assert detected - claimed == set(), f"unclaimed systems: {sorted(detected - claimed)}"
       assert claimed - detected == set(), f"dangling refs: {sorted(claimed - detected)}"

   def test_systems_within_a_piece_are_in_reading_order():
       for piece in CAT["pieces"]:
           assert piece["systems"] == sorted(piece["systems"]), piece["id"]

   def test_every_piece_has_mode_or_is_explicitly_exempt():
       for piece in CAT["pieces"]:
           assert piece.get("mode") or piece["genre"] in {"tonus", "other"}
   ```

2. Verify and commit
   ```bash
   uv run pytest tests/test_catalog_invariants.py -v   # Expected: 4 passed
   git add -A && git commit -m "test(data): catalog invariants"
   ```

---

# Phase 4 — Chant pairing

## Task 19: Ingest GregoBase with attribution

**Files**: Create `pipeline/gregobase.py`, `data/LICENSES.md`; Test `tests/test_gregobase.py`

**Steps**:

1. Record licensing obligations first
   ```markdown
   # data/LICENSES.md
   ## NOH page images — Public Domain
   Nova Organi Harmonia (Mechelen, 1942). No rights reserved.

   ## Chant data — CC BY-SA 4.0
   GABC sourced from GregoBase (https://gregobase.selapa.net), CC BY-SA 4.0.
   Attribution appears on every page rendering a chant. Share-alike attaches to
   `data/catalog.json` chant fields and to all rendered chant output.
   PD scan assets are licensed separately and are NOT covered by share-alike.
   ```

2. Write failing test
   ```python
   # tests/test_gregobase.py
   from pipeline.gregobase import normalise_incipit, match_score

   def test_normalise_strips_accents_and_case():
       assert normalise_incipit("Kýrie eléison") == "kyrie eleison"

   def test_match_score_rewards_exact_incipit():
       assert match_score("kyrie eleison", "kyrie eleison") == 1.0
       assert match_score("kyrie eleison", "gloria in excelsis") < 0.4
   ```

3. Implement normalisation (NFKD accent strip, lowercase, punctuation removal)
   and a token-overlap `match_score`.

4. Verify and commit
   ```bash
   uv run pytest tests/test_gregobase.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): GregoBase ingest with CC-BY-SA attribution"
   ```

---

## Task 20: Pair pieces to chants with an honest confidence threshold

**Files**: Modify `pipeline/catalog.py`; Test `tests/test_pairing.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_pairing.py
   from pipeline.catalog import pair_chant

   def test_high_score_is_verified():
       assert pair_chant(score=0.95)["status"] == "verified"

   def test_low_score_is_unverified_not_hidden():
       result = pair_chant(score=0.55)
       assert result["status"] == "unverified"
       assert result["display"] is True, "show it, but labelled — never silently drop"

   def test_very_low_score_is_not_paired():
       assert pair_chant(score=0.2)["status"] == "unpaired"
   ```

2. Implement with explicit thresholds (`>=0.85` verified, `>=0.45` unverified, else unpaired).

3. Verify and commit
   ```bash
   uv run pytest tests/test_pairing.py -v   # Expected: 3 passed
   git add -A && git commit -m "feat(pipeline): pair pieces to chants with confidence states"
   ```

---

# Phase 5 — Publish

## Task 21: Slice systems to WebP

**Files**: Create `pipeline/publish.py`; Test `tests/test_slice.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_slice.py
   from PIL import Image
   from pipeline.publish import slice_systems

   def test_slices_are_written_at_1x_and_2x(tmp_path):
       paths = slice_systems("noh5", pdf_page=229, dest=tmp_path)
       assert len(paths) == 5
       for p in paths:
           assert p.suffix == ".webp"
           assert Image.open(p).width > 1000
   ```

2. Implement — crop each bbox and write four derivatives per system:
   `{n}.webp` and `{n}@2x.webp` for display, plus `{n}@2x.png` for PDF export
   (`pdf-lib` cannot embed WebP; see Task 27). Also record `systemAspect: [w, h]`
   per system into the manifest so Task 25 can reserve layout space and avoid
   reflow while slices load.

3. Verify and commit
   ```bash
   uv run pytest tests/test_slice.py -v   # Expected: 1 passed
   git add -A && git commit -m "feat(pipeline): slice systems to WebP"
   ```

---

## Task 22: Upload to R2

**Files**: Create `pipeline/upload.py`; Test `tests/test_upload.py`

Credentials come from environment variables only — never source.

**Steps**:

1. Write failing test
   ```python
   # tests/test_upload.py
   import pytest
   from pipeline.upload import r2_key, require_credentials

   def test_key_embeds_a_content_hash_so_reruns_never_overwrite():
       key = r2_key("noh5", 229, 0, sha256="deadbeefcafebabe" + "0" * 48)
       assert key == "systems/noh5/0229/000-deadbeefcafe.webp"

   def test_different_content_yields_a_different_key():
       a = r2_key("noh5", 229, 0, sha256="a" * 64)
       b = r2_key("noh5", 229, 0, sha256="b" * 64)
       assert a != b, "a re-run that changes a slice must not reuse its URL"

   def test_missing_credentials_raise_clearly(monkeypatch):
       monkeypatch.delenv("R2_ACCESS_KEY_ID", raising=False)
       with pytest.raises(RuntimeError, match="R2_ACCESS_KEY_ID"):
           require_credentials()
   ```

2. Implement `r2_key(vol, page, n, sha256)` as
   `systems/{vol}/{page:04d}/{n:03d}-{sha256[:12]}.webp`. Uploads are
   **write-if-absent, never overwrite**. Read `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` from the environment only.

   Rationale: the governing rule is that the pipeline is re-run as segmentation
   improves. With positional keys, a re-run that drops one system on page 229
   shifts every later index — `002.webp` then holds *different music at the same
   URL*, deployed HTML points at it, and CDN caches serve old bytes to some readers
   and new bytes to others, with no way back. Content-hashed keys make
   `catalog.json` the single revert point: revert the JSON, revert the imagery.

3. Verify and commit
   ```bash
   uv run pytest tests/test_upload.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(pipeline): upload system images to R2"
   ```

---

# Phase 6 — Website

## Task 23a: Reading tokens and type scale (before any component)

**Files**: Create `web/src/styles/tokens.css`, `web/src/styles/base.css`

Every later component consumes these. No component may introduce a raw hex, a px
font size, or an ad-hoc shadow.

```css
/* web/src/styles/tokens.css */
:root {
  color-scheme: light dark;

  /* Ink: bitonal scans are pure #000 on #FFF. Never tint the page behind them. */
  --paper:     #FDFCF9;   /* warm off-white, 1942 letterpress reference */
  --ink:       #14120E;   /* on --paper: 15.8:1 */
  --ink-muted: #524E45;   /* on --paper: 7.4:1 — still AAA body text */
  --rule:      #C9C2B4;   /* hairlines and table rules; never used for text */
  --accent:    #6B2318;   /* rubric red, from the source edition; 8.9:1 on paper */
  --warn-bg:   #FBF3E2;
  --warn-ink:  #5A4409;   /* on --warn-bg: 7.1:1 */

  /* Type: one serif for text, one UI face. No third family. */
  --font-text: "Source Serif 4", Georgia, serif;
  --font-ui:   system-ui, sans-serif;
  --step--1: clamp(0.94rem, 0.9rem + 0.2vw, 1rem);
  --step-0:  clamp(1.06rem, 1rem + 0.3vw, 1.19rem);   /* body: >=17px on tablet */
  --step-1:  clamp(1.33rem, 1.2rem + 0.6vw, 1.6rem);
  --step-2:  clamp(1.66rem, 1.4rem + 1.2vw, 2.25rem);

  --s-1: 0.25rem; --s-2: 0.5rem; --s-3: 1rem;
  --s-4: 1.5rem;  --s-5: 2.5rem; --s-6: 4rem;

  --tap-min: 44px;    /* every interactive target, no exceptions */
  --measure: 62ch;
  --radius: 2px;      /* print-shop square, not app-store round */
}

@media (prefers-color-scheme: dark) {
  :root { --paper: #14140F; --ink: #ECE7DA; --ink-muted: #B3AC9C;
          --rule: #3C382F; --accent: #E0A08C; --warn-bg: #2A2318; --warn-ink: #E8C87A; }
}
```

**Console-light rule**: in dark mode the scan slices must be inverted, not left as
black-on-white lightboxes at an organ console —
`.systems img { filter: invert(1) hue-rotate(180deg); }` under the dark query, with
a persisted user toggle (`data-scan-polarity="normal|inverted"` on `<html>`),
because inversion suits low light and normal suits daylight. Default follows
`prefers-color-scheme`.

**Forbidden**: gradients, glassmorphism, drop shadows on cards, decorative
border-radius above 2px, more than one accent colour. The visual reference is a
printed liturgical edition — rules, generous margins, small caps — not a SaaS
landing page.

**Verify**: `pnpm build`; check `--ink` and `--accent` against `--paper` in a
contrast checker and record the measured ratios as comments in the file.

---

## Task 23: Scaffold Astro with strict TypeScript

**Files**: Create `web/package.json`, `web/tsconfig.json`, `web/astro.config.mjs`

**Steps**:

1. Scaffold
   ```bash
   cd web && pnpm create astro@latest . -- --template minimal --typescript strict --no-install --no-git
   pnpm add pdf-lib && pnpm add -D pagefind vitest @types/node
   ```

2. Enforce the no-`any` rule in `web/tsconfig.json`
   ```json
   {
     "extends": "astro/tsconfigs/strict",
     "compilerOptions": {
       "strict": true,
       "noImplicitAny": true,
       "noUncheckedIndexedAccess": true
     }
   }
   ```

3. Verify and commit
   ```bash
   pnpm build   # Expected: build succeeds
   git add -A && git commit -m "chore(web): scaffold Astro with strict TypeScript"
   ```

---

## Task 24: Typed catalog loader

**Files**: Create `web/src/lib/catalog.ts`; Test `web/src/lib/catalog.test.ts`

**Steps**:

1. Write failing test
   ```typescript
   // web/src/lib/catalog.test.ts
   import { describe, it, expect } from "vitest";
   import { loadCatalog, piecesForMass } from "./catalog";

   describe("catalog", () => {
     it("loads pieces with a typed shape", () => {
       const cat = loadCatalog();
       expect(cat.schemaVersion).toBe(1);
       expect(cat.pieces.length).toBeGreaterThan(0);
     });

     it("groups Ordinary movements under their Mass", () => {
       const movements = piecesForMass("I");
       expect(movements.map((m) => m.genre)).toContain("kyrie");
     });
   });
   ```

2. Implement with explicit interfaces — **no `any`**
   ```typescript
   // web/src/lib/catalog.ts
   import raw from "../../../data/catalog.json";

   export type Genre =
     | "kyrie" | "gloria" | "credo" | "sanctus" | "agnus" | "ite"
     | "asperges" | "requiem" | "absolutio" | "exsequiis" | "tonus" | "other";

   /** Confidence of the NOH piece -> GregoBase chant match (Task 20). */
   export type PairStatus = "verified" | "unverified" | "unpaired";

   /** Confidence of the catalog record itself (Task 17). A distinct axis: a piece
    *  can have a verified chant pairing and an unverified title. These two
    *  vocabularies must never be collapsed in the UI — see Task 26. */
   export type RecordStatus = "verified" | "unmatched" | "review";

   export interface ChantPairing {
     readonly source: "gregobase";
     readonly id: number;
     readonly gabc: string;
     readonly status: PairStatus;
   }

   export interface Piece {
     readonly id: string;
     readonly volume: string;
     readonly title: string;
     readonly incipit: string;
     readonly genre: Genre;
     readonly mode: string | null;
     readonly mass: string | null;
     readonly printedPages: readonly [number, number];
     readonly systems: readonly string[];
     readonly chant: ChantPairing | null;
     readonly status: RecordStatus;
   }

   export interface Catalog {
     readonly schemaVersion: number;
     readonly pieces: readonly Piece[];
   }

   // The pipeline emits snake_case; the site speaks camelCase. Map explicitly and
   // fail the build on drift — a double cast would ship `undefined` to every template.
   interface RawPiece {
     readonly id: string; readonly volume: string; readonly title: string;
     readonly incipit: string; readonly genre: string; readonly mode: string | null;
     readonly mass: string | null; readonly printed_pages: readonly [number, number];
     readonly systems: readonly string[]; readonly chant: ChantPairing | null;
     readonly review_status: string;
   }
   interface RawCatalog { readonly schema_version: number; readonly pieces: readonly RawPiece[] }

   const GENRES: ReadonlySet<string> = new Set<Genre>([
     "kyrie", "gloria", "credo", "sanctus", "agnus", "ite",
     "asperges", "requiem", "absolutio", "exsequiis", "tonus", "other",
   ]);
   const RECORD_STATUSES: ReadonlySet<string> = new Set<RecordStatus>([
     "verified", "unmatched", "review",
   ]);

   export const SCHEMA_VERSION = 1;

   export function loadCatalog(): Catalog {
     const doc = raw as RawCatalog;
     if (doc.schema_version !== SCHEMA_VERSION)
       throw new Error(`catalog schema_version ${doc.schema_version}, expected ${SCHEMA_VERSION}`);
     const pieces = doc.pieces.map((p): Piece => {
       if (!GENRES.has(p.genre)) throw new Error(`${p.id}: unknown genre ${p.genre}`);
       if (!RECORD_STATUSES.has(p.review_status))
         throw new Error(`${p.id}: unknown review_status ${p.review_status}`);
       return {
         ...p,
         genre: p.genre as Genre,
         status: p.review_status as RecordStatus,
         printedPages: p.printed_pages,
       };
     });
     return { schemaVersion: doc.schema_version, pieces };
   }

   export function piecesForMass(mass: string): readonly Piece[] {
     return loadCatalog().pieces.filter((p) => p.mass === mass);
   }
   ```

3. Verify and commit
   ```bash
   cd web && pnpm vitest run src/lib/catalog.test.ts   # Expected: 2 passed
   git add -A && git commit -m "feat(web): typed catalog loader"
   ```

---

## Task 25: Piece and Mass routes with inline music

**Files**: Create `web/src/pages/piece/[id].astro`, `web/src/pages/kyriale/[mass].astro`, `web/src/components/SystemStack.astro`

Music must be **readable in the browser without downloading a PDF** — this is
the primary reading mode.

**Steps**:

1. Build `SystemStack.astro` rendering each system with `srcset` for 2×
   ```astro
   ---
   interface Props { systems: readonly string[]; title: string }
   const { systems, title } = Astro.props;
   const base = import.meta.env.PUBLIC_ASSET_BASE;
   ---
   <figure class="systems" role="group" aria-labelledby={`sys-${id}`}>
     <figcaption id={`sys-${id}`} class="sr-only">
       {title}, mode {mode ?? "not recorded"}, organ accompaniment from Nova Organi
       Harmonia part V, printed pages {printedPages[0]}–{printedPages[1]}, shown as
       {systems.length} scanned music systems. These are images of a 1942 printed
       score and cannot be read by a screen reader; the Latin text of this chant is
       available below.
     </figcaption>
     {systems.map((ref, i) => (
       <div class="system-slot" style={`aspect-ratio:${systemAspect[i][0]}/${systemAspect[i][1]}`}>
         <img
           class="system"
           src={`${base}/${ref}.webp`}
           srcset={`${base}/${ref}.webp 1x, ${base}/${ref}@2x.webp 2x`}
           sizes="(min-width: 60rem) 56rem, 100vw"
           width={systemAspect[i][0]} height={systemAspect[i][1]}
           loading={i < 2 ? "eager" : "lazy"}
           decoding="async"
           fetchpriority={i === 0 ? "high" : "auto"}
           onerror="this.closest('.system-slot').dataset.state='error'"
           alt=""
         />
       </div>
     ))}
   </figure>
   ```

   Intrinsic `width`/`height` (and the reserved `aspect-ratio` slot) are required:
   without them the page reflows as each slice loads, which is the single worst
   behaviour for someone following music on a tablet. `alt=""` plus one
   `figcaption` replaces five useless "system 3" alt strings. Task 17 must add
   `systemAspect: [w, h]` per system ref to `catalog.json`.

2. Generate static paths from the catalog in both routes.

3. Define all four `SystemStack` states, each in a fixed aspect-ratio slot so
   nothing reflows:

   - **Loading** — the slot reserves its exact height from `systemAspect` and shows
     a flat `--rule` block. No shimmer, no spinner: motion under sight-reading is
     worse than stillness.
   - **Error / missing R2 asset** — `[data-state="error"]` renders inside the
     reserved box, `--warn-ink` on `--warn-bg`: "System {n} of {total} could not be
     loaded (`{ref}`). The rest of this piece is shown below." plus a "Report this"
     link pre-filled to the corrections form. **Never collapse the slot** — a
     silently missing system sends an organist to the bench with a bar missing.
   - **Empty** — a piece with no systems must not render a blank page: "This piece
     is catalogued but its music has not been sliced yet (printed pages
     {first}–{last} of part V)."
   - **Offline** — a service worker caches the slices of any piece the user has
     opened. A persistent `--warn-bg` bar reads "You are offline. This piece is
     available; search and export are not." A console loft with no signal is the
     expected environment, not an edge case.

4. Reading affordances, specified rather than left to the implementer:

   - Primary action on `/piece/[id]` is **read** — systems begin above the fold,
     below only title, mode and printed-page reference. "Add to selection" and
     "Export PDF" are secondary, in a bar pinned to the bottom under 60rem so they
     stay reachable one-handed.
   - Primary action on `/kyriale/[mass]` is **choose a movement** — the movement
     list renders as `--step-1` links in liturgical order (a fixed `GENRE_ORDER`
     array, never catalog order) with mode and printed page as `--ink-muted`
     metadata, not equal-weight cards.
   - `--tap-min` on every movement link and selection checkbox.
   - Zoom: `.system { max-width: 100%; }` by default; a per-piece Zoom toggle
     switches the figure to `width: 200%; overflow-x: auto;` with
     `overscroll-behavior-x: contain`, so pinch-zoom is not the only way to see
     detail on a console-mounted tablet.

5. Print stylesheet is part of this task, not a follow-up. `@media print`:
   `.system { break-inside: avoid; filter: none; }`, hide all navigation and
   selection UI, force `--paper`/`--ink` to `#fff`/`#000`, and print title, mode
   and NOH printed-page reference as a running header. Organists print from the
   browser; without this they get navigation chrome on the music stand.

6. Keyboard and focus: every link and control reachable in DOM order with a
   visible `:focus-visible` outline of `2px solid var(--accent)` and
   `outline-offset: 2px`; "Skip to music" is the first focusable element on
   `/piece/[id]`; the Zoom toggle is a real `<button aria-pressed>`. Verify with a
   keyboard-only pass over one Mass page and record the tab order in the commit.

7. Verify and commit
   ```bash
   cd web && pnpm build
   # Expected: one HTML page per piece and per Mass
   git add -A && git commit -m "feat(web): piece and Mass routes with inline music"
   ```

---

## Task 26: Chant pairing display with attribution

**Files**: Create `web/src/components/ChantPair.astro`

**Steps**:

1. Render the paired chant beside the accompaniment (stacked below under 60rem —
   never a squeezed two-column at tablet width), with the exact published copy for
   each `PairStatus`. This copy is user-facing product, not placeholder; do not
   paraphrase it at implementation time.

   - **`verified`** — no badge. A badge on the normal case teaches readers to
     ignore badges. Attribution line only.
   - **`unverified`** — a `--warn-bg` / `--warn-ink` panel *above* the chant, not a
     corner pill: "Unverified pairing. We matched this 1942 accompaniment to a
     chant from GregoBase automatically, and no one has checked it. Compare the
     notes above the staff before you play from it." Followed by a "This pairing is
     wrong" link into the corrections form with `field=chant` pre-selected.
   - **`unpaired`** — no chant column at all, and the honest reason in
     `--ink-muted`: "No chant has been matched to this accompaniment yet." with a
     "Suggest a chant" link. Never render an empty chant panel.

   `RecordStatus` is a separate axis and needs its own line at the top of
   `/piece/[id]`:
   - **`unmatched` / `review`** — "Catalogued, not yet verified. The title, mode and
     page range on this page were derived automatically from the 1942 index and have
     not been checked by a person." The music images themselves are not in doubt —
     say so, so the warning does not read as "this scan may be wrong".

   Attribution: one persistent line under the chant, `--step--1` `--ink-muted`,
   "Chant notation from GregoBase, CC BY-SA 4.0" with a link, plus a footer note
   distinguishing it from the public-domain NOH scans. Never a modal, never a
   dismissible toast — share-alike attribution must survive print, so it lives
   inside the printed area.

2. Verify and commit
   ```bash
   cd web && pnpm build
   git add -A && git commit -m "feat(web): chant pairing display with CC-BY-SA attribution"
   ```

**Open**: renderer choice (Gregorio build-time SVG vs client-side Exsurge).
Confirm current maintenance status of both before committing — see design doc
open question 3.

---

## Task 27: Search and PDF export

**Files**: Create `web/src/pages/search.astro`, `web/src/workers/pdf.worker.ts`

**Steps**:

1. Wire Pagefind over incipits, titles, modes **and the per-page Latin text
   extracted from the embedded OCR layer**. The last of these is the reason search
   is genuinely useful at launch rather than after the catalogue is complete: even
   an unmatched page is findable by the Latin words printed above its staves.

   Index the raw extracted text in a hidden Pagefind field, not as visible page
   content — it is noisy OCR (`Ky_n_e` for `Kyrie`, `EXSEQUDS` for `EXSEQUIIS`)
   and must never be presented to a reader as though it were a transcription.
   Normalise with `normalise_incipit` (Task 19) before indexing so that an
   accent-free query still matches, and label the search box "Search Latin text,
   titles and modes" so expectations match behaviour.

2. Assemble PDFs in a Web Worker with `pdf-lib`, capped at 60 systems. Specify the
   whole export flow, not only the cap:

   - **Idle** — the button reads "Export PDF (12 systems, ~3 pages)". The count and
     page estimate are the reassurance an organist needs before committing, and they
     replace a generic label.
   - **In progress** — a determinate progress control, `aria-busy="true"`, reading
     "Building PDF — system 7 of 12" (the worker posts `{progress, total}` per
     system). The page stays usable.
   - **Success** — the download starts and an `aria-live="polite"` region announces
     "PDF ready — 12 systems, 3 pages, 1.4 MB." Keep the selection so a second
     export is one tap.
   - **Error (over cap)** — "You have selected {n} systems. Export is limited to 60
     so it can be built on a tablet. Remove {n-60}, or export this Mass in two
     parts." Offer a "Split into two PDFs" action rather than a dead end.
   - **Error (fetch/decode)** — "Could not fetch system {ref}. Nothing was
     downloaded. Try again, or report this." Never emit a partial PDF.
   - **Empty selection** — the button is disabled with `aria-disabled="true"`
     reading "Select at least one piece to export", not hidden.

   Search states in the same task: an empty query shows the Kyriale Mass list (a
   blank search page wastes the most common visit); zero results shows "No match
   for '{q}'. Try a Latin incipit (Kyrie fons bonitatis), a Mass number (Missa IX),
   or a mode (mode II)."; each result row shows the incipit at `--step-0`, then
   Mass / genre / mode / printed page at `--step--1` `--ink-muted` — one line of
   hierarchy, not a card grid.
   ```typescript
   // web/src/workers/pdf.worker.ts
   import { PDFDocument } from "pdf-lib";

   const MAX_SYSTEMS = 60;

   interface BuildRequest { readonly refs: readonly string[]; readonly base: string }

   self.onmessage = async (event: MessageEvent<BuildRequest>): Promise<void> => {
     const { refs, base } = event.data;
     if (refs.length === 0 || refs.length > MAX_SYSTEMS) {
       self.postMessage({ ok: false, error: `Select between 1 and ${MAX_SYSTEMS} systems.` });
       return;
     }
     try {
       const doc = await PDFDocument.create();
       let page = doc.addPage([595, 842]);
       let cursor = 802;                       // baseline of the next system, top-down
       for (const [i, ref] of refs.entries()) {
         const res = await fetch(`${base}/${ref}@2x.png`);
         if (!res.ok) throw new Error(`Could not fetch system ${ref} (${res.status}). Nothing was downloaded.`);
         const img = await doc.embedPng(await res.arrayBuffer());
         const scale = 555 / img.width;
         const h = img.height * scale;
         // Pack systems down the page. One system per page would make a single Mass
         // a 60-page download — unusable at the organ bench.
         if (cursor - h < 40) { page = doc.addPage([595, 842]); cursor = 802; }
         page.drawImage(img, { x: 20, y: cursor - h, width: 555, height: h });
         cursor -= h + 12;
         self.postMessage({ progress: i + 1, total: refs.length });
       }
       // Never emit a partial PDF: a silently incomplete export is the worst
       // possible outcome at a console.
       self.postMessage({ ok: true, bytes: await doc.save() });
     } catch (err) {
       self.postMessage({ ok: false, error: err instanceof Error ? err.message : "export failed" });
     }
   };
   ```

3. Verify and commit
   ```bash
   cd web && pnpm build && pnpm vitest run
   git add -A && git commit -m "feat(web): Pagefind search and client-side PDF export"
   ```

**Resolved**: `embedPng` cannot accept WebP, so Task 21 emits `{n}@2x.png`
alongside the WebP display derivatives and the worker fetches the PNG. This costs
storage but keeps the export path free of a canvas-decode step that would fail
silently in older Safari on iPad — the exact device this is for.

---

# Phase 7 — Corrections

## Task 28: Worker schema validation

**Files**: Create `workers/corrections/src/schema.ts`; Test `workers/corrections/test/schema.test.ts`

Per project security rules: validate at the boundary, no `any`.

**Steps**:

1. Write failing test
   ```typescript
   // workers/corrections/test/schema.test.ts
   import { describe, it, expect } from "vitest";
   import { parseCorrection } from "../src/schema";

   describe("parseCorrection", () => {
     it("accepts a well-formed correction", () => {
       const r = parseCorrection({ pieceId: "noh5-missa-i-kyrie", field: "mode",
                                   proposedValue: "IV", note: "checked against Liber" });
       expect(r.ok).toBe(true);
     });

     it("rejects an unknown field name", () => {
       expect(parseCorrection({ pieceId: "x", field: "systems", proposedValue: "y" }).ok).toBe(false);
     });

     it("rejects an oversized note", () => {
       const r = parseCorrection({ pieceId: "x", field: "mode", proposedValue: "IV",
                                   note: "a".repeat(2001) });
       expect(r.ok).toBe(false);
     });

     it("rejects a proposedValue failing its field pattern", () => {
       expect(parseCorrection({ pieceId: "x", field: "mode", proposedValue: "<script>" }).ok).toBe(false);
     });
   });
   ```

2. Implement with per-field patterns
   ```typescript
   // workers/corrections/src/schema.ts
   export type CorrectableField = "title" | "incipit" | "mode" | "genre" | "printedPages";

   const PATTERNS: Readonly<Record<CorrectableField, RegExp>> = {
     title: /^[\p{L}\p{N}\s.,'«»()-]{1,120}$/u,
     incipit: /^[\p{L}\p{N}\s.,'-]{1,120}$/u,
     mode: /^(I|II|III|IV|V|VI|VII|VIII)$/,
     genre: /^(kyrie|gloria|credo|sanctus|agnus|ite|asperges|requiem|absolutio|exsequiis|tonus|other)$/,
     printedPages: /^\d{1,3}-\d{1,3}$/,
   };

   export interface Correction {
     readonly pieceId: string;
     readonly field: CorrectableField;
     readonly proposedValue: string;
     readonly note: string;
   }

   export type ParseResult =
     | { readonly ok: true; readonly value: Correction }
     | { readonly ok: false; readonly error: string };

   export function parseCorrection(input: unknown): ParseResult {
     if (typeof input !== "object" || input === null) return { ok: false, error: "not an object" };
     const raw = input as Record<string, unknown>;

     const pieceId = raw.pieceId;
     if (typeof pieceId !== "string" || !/^[a-z0-9-]{1,80}$/.test(pieceId))
       return { ok: false, error: "invalid pieceId" };

     const field = raw.field;
     if (typeof field !== "string" || !(field in PATTERNS))
       return {
         ok: false,
         error: `Unknown field "${String(field)}". Correctable fields are: ${Object.keys(PATTERNS).join(", ")}.`,
       };
     const typedField = field as CorrectableField;

     const proposedValue = raw.proposedValue;
     if (typeof proposedValue !== "string" || !PATTERNS[typedField].test(proposedValue))
       return {
         ok: false,
         error: `proposedValue is not valid for field "${typedField}". Expected pattern: ${PATTERNS[typedField].source}`,
       };

     const note = raw.note ?? "";
     if (typeof note !== "string" || note.length > 2000)
       return { ok: false, error: "invalid note" };

     return { ok: true, value: { pieceId, field: typedField, proposedValue, note } };
   }
   ```

3. Verify and commit
   ```bash
   cd workers/corrections && pnpm vitest run   # Expected: 4 passed
   git add -A && git commit -m "feat(worker): validate corrections at the boundary"
   ```

---

## Task 29: D1 storage with parameterized queries and rate limiting

**Files**: Create `workers/corrections/src/index.ts`, `workers/corrections/schema.sql`, `wrangler.toml`

**Steps**:

1. Create the D1 schema
   ```sql
   -- workers/corrections/schema.sql
   CREATE TABLE IF NOT EXISTS corrections (
     id           INTEGER PRIMARY KEY AUTOINCREMENT,
     piece_id     TEXT NOT NULL,
     field        TEXT NOT NULL,
     proposed     TEXT NOT NULL,
     note         TEXT NOT NULL DEFAULT '',
     status       TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','accepted','rejected')),
     commit_sha   TEXT,
     submitter_hash TEXT NOT NULL DEFAULT '',
     created_at   TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_corrections_status ON corrections(status, created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_corrections_rate ON corrections(submitter_hash, created_at);
   CREATE UNIQUE INDEX IF NOT EXISTS idx_corrections_dedupe
     ON corrections(piece_id, field, proposed) WHERE status = 'pending';
   ```

2. Implement the handler — **parameterized queries only**, Turnstile, per-IP rate limit
   ```typescript
   // workers/corrections/src/index.ts
   import { parseCorrection } from "./schema";

   export interface Env {
     readonly DB: D1Database;
     readonly TURNSTILE_SECRET: string;
     /** Kill switch: intake can be paused without a redeploy. */
     readonly CORRECTIONS_ENABLED: string;
   }

   const RATE_LIMIT = 5;
   const WINDOW_SECONDS = 3600;

   // KV is eventually consistent and get-then-put is not atomic: a concurrent burst
   // all reads the same value and all passes. KV also caps writes at ~1/s per key, so
   // an attacker's increments are dropped. Count durably in D1 instead, in one
   // statement, against the same store the insert lands in.
   async function hashIp(ip: string): Promise<string> {
     const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`noh:${ip}`));
     return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
   }

   async function underLimit(env: Env, ip: string): Promise<boolean> {
     const row = await env.DB
       .prepare(
         "SELECT COUNT(*) AS n FROM corrections " +
         "WHERE submitter_hash = ?1 AND created_at > datetime('now', ?2)"
       )
       .bind(await hashIp(ip), `-${WINDOW_SECONDS} seconds`)
       .first<{ n: number }>();
     return (row?.n ?? 0) < RATE_LIMIT;
   }

   export default {
     async fetch(request: Request, env: Env): Promise<Response> {
       const allowedOrigin = env.ALLOWED_ORIGIN;   // from wrangler.toml [vars]
       const cors = {
         "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
         "Access-Control-Allow-Methods": "POST, OPTIONS",
         "Access-Control-Allow-Headers": "content-type",
         "Vary": "Origin",
       } as const;
       // Pages and the Worker are different origins, so a JSON POST preflights.
       // Answering OPTIONS with 405 would make every submission fail before it is sent.
       if (request.method === "OPTIONS")
         return new Response(null, { status: 204, headers: cors });
       if (request.method !== "POST")
         return new Response("Method Not Allowed", { status: 405, headers: cors });
       if (request.headers.get("Origin") !== ALLOWED_ORIGIN)
         return Response.json({ error: "forbidden origin" }, { status: 403, headers: cors });
       if (!(request.headers.get("content-type") ?? "").includes("application/json"))
         return Response.json({ error: "expected application/json" }, { status: 415, headers: cors });
       if (env.CORRECTIONS_ENABLED !== "true")
         return Response.json({ error: "intake paused" }, { status: 503, headers: cors });

       const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
       if (!(await underLimit(env, ip)))
         return Response.json({ error: "Rate limit exceeded" }, { status: 429 });

       const body = await request.json().catch(() => null) as { turnstileToken?: unknown } | null;
       const token = body?.turnstileToken;
       if (typeof token !== "string" || token.length === 0 || token.length > 2048)
         return Response.json({ error: "missing turnstile token" }, { status: 400, headers: cors });
       const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
       });
       const outcome = await verify.json() as { success?: boolean };
       if (outcome.success !== true)
         return Response.json({ error: "challenge failed" }, { status: 403, headers: cors });

       const parsed = parseCorrection(body);
       if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400, headers: cors });

       const { pieceId, field, proposedValue, note } = parsed.value;
       await env.DB
         .prepare(
           "INSERT INTO corrections (piece_id, field, proposed, note, submitter_hash) " +
           "VALUES (?, ?, ?, ?, ?)"
         )
         .bind(pieceId, field, proposedValue, note, await hashIp(ip))
         .run();

       return Response.json({ ok: true }, { status: 201, headers: cors });
     },
   } satisfies ExportedHandler<Env>;
   ```

3. Verify and commit
   ```bash
   cd workers/corrections && pnpm wrangler d1 execute noh-corrections --local --file=schema.sql
   pnpm vitest run
   git add -A && git commit -m "feat(worker): store corrections in D1 with rate limiting"
   ```

---

## Task 30: Public status page — structural fields only

**Files**: Create `workers/corrections/src/status.ts`; Test `workers/corrections/test/status.test.ts`

**The security-critical task.** Submitter free text must never render publicly.

**Steps**:

1. Write failing test
   ```typescript
   // workers/corrections/test/status.test.ts
   import { describe, it, expect } from "vitest";
   import { toPublicRow } from "../src/status";

   describe("toPublicRow", () => {
     it("omits the private note entirely", () => {
       const row = toPublicRow({ id: 1, piece_id: "noh5-missa-i-kyrie", field: "mode",
                                 proposed: "IV", note: "<script>alert(1)</script>",
                                 status: "pending", created_at: "2026-09-07" });
       expect(JSON.stringify(row)).not.toContain("script");
       expect("note" in row).toBe(false);
     });

     it("drops rows whose stored value fails revalidation", () => {
       expect(toPublicRow({ id: 2, piece_id: "x", field: "mode", proposed: "<img onerror=1>",
                            status: "pending", note: "", created_at: "2026-09-07" })).toBeNull();
     });
   });
   ```

2. Implement — revalidate on the way **out**, not only on the way in
   ```typescript
   // workers/corrections/src/status.ts
   import { parseCorrection } from "./schema";

   export interface StoredRow {
     readonly id: number; readonly piece_id: string; readonly field: string;
     readonly proposed: string; readonly note: string;
     readonly status: string; readonly created_at: string;
   }

   export interface PublicRow {
     readonly id: number; readonly pieceId: string; readonly field: string;
     readonly proposedValue: string; readonly status: string; readonly createdAt: string;
   }

   export function toPublicRow(row: StoredRow): PublicRow | null {
     const check = parseCorrection({
       pieceId: row.piece_id, field: row.field, proposedValue: row.proposed,
     });
     if (!check.ok) return null;
     if (!["pending", "accepted", "rejected"].includes(row.status)) return null;
     if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?$/.test(row.created_at)) return null;
     // Emit the values that were validated, never the raw stored strings: if
     // parseCorrection ever normalises, the published value must not diverge.
     return {
       id: row.id, pieceId: check.value.pieceId, field: check.value.field,
       proposedValue: check.value.proposedValue, status: row.status, createdAt: row.created_at,
     };
   }
   ```

3. Verify and commit
   ```bash
   cd workers/corrections && pnpm vitest run   # Expected: 2 passed
   git add -A && git commit -m "feat(worker): structural-only public status rows"
   ```

---

## Task 31: Triage CLI

**Files**: Create `tools/triage/main.py`; Test `tests/test_triage.py`

**Steps**:

1. Write failing test
   ```python
   # tests/test_triage.py
   from tools.triage.main import apply_correction

   def test_apply_updates_catalog_field():
       cat = {"pieces": [{"id": "p1", "mode": "III"}]}
       out = apply_correction(cat, piece_id="p1", field="mode", value="IV")
       assert out["pieces"][0]["mode"] == "IV"

   def test_apply_rejects_unknown_piece():
       import pytest
       with pytest.raises(KeyError):
           apply_correction({"pieces": []}, piece_id="nope", field="mode", value="IV")
   ```

2. Implement: fetch pending rows, render the cited page beside the change,
   accept/reject, write `data/catalog.json`, mark the row with the commit SHA.

3. Verify and commit
   ```bash
   uv run pytest tests/test_triage.py -v   # Expected: 2 passed
   git add -A && git commit -m "feat(tools): correction triage CLI"
   ```

---

# Phase 8 — Ship

## Task 32: End-to-end test

**Files**: Test `tests/test_e2e_missa_i.py`

**Steps**:

1. Write the test
   ```python
   # tests/test_e2e_missa_i.py
   import json
   from pathlib import Path

   def test_missa_i_is_complete_and_navigable():
       cat = json.loads(Path("data/catalog.json").read_text(encoding="utf-8"))
       missa_i = [p for p in cat["pieces"] if p.get("mass") == "I"]
       genres = {p["genre"] for p in missa_i}
       assert {"kyrie", "gloria", "sanctus", "agnus"} <= genres
       for piece in missa_i:
           assert piece["systems"], f"{piece['id']} has no systems"
       assert Path("web/dist/kyriale/I/index.html").exists()
   ```

2. Verify and commit
   ```bash
   uv run pytest tests/test_e2e_missa_i.py -v   # Expected: 1 passed
   git add -A && git commit -m "test: end-to-end Missa I"
   ```

---

## Task 32b: README and reproduction guide

**Files**: Create `README.md`, `docs/REPRODUCING.md`, `.dev.vars.example`

Stub `README.md` at Task 1 and fill it here; do not genuinely defer it to the end.

`README.md` is ordered by what a developer tries first, not by module:

1. What this is (one paragraph) + link to the live site
2. **Quickstart** — render and view one page in under five minutes:
   ```bash
   git clone <repo> && cd nova-organi-harmonia-online
   uv sync
   uv run noh doctor              # tells you exactly what is missing
   # place "NOH5 Kyriale.pdf" in pdf-source/  (see "Getting the source PDFs")
   uv run noh segment --volume noh5 --pages 229 --overlay --open
   # -> build/overlay/noh5/0229.png opens: 5 systems boxed on the page
   ```
3. Getting the source PDFs — origin, public-domain status, mirror URL, and the
   pinned sha256s in `data/volumes.yml`
4. Rebuilding the whole catalog — `uv run noh publish --volume noh5`, expected
   wall-clock for 231 pages, and the fact that stages resume
5. Running the site locally — `cd web && pnpm install && pnpm dev`
6. Contributing a correction — the D1 queue and how triage lands in git
7. Licensing — PD scans vs CC-BY-SA catalog/chant data (link `data/LICENSES.md`)

`docs/REPRODUCING.md` states the guarantee explicitly: delete `build/` and
`data/catalog.json`, run `uv run noh publish --volume noh5`, and the result must be
byte-identical to what is committed. Record the verification date.

---

## Task 33: Deploy

**Files**: Create `.github/workflows/deploy.yml`

**Steps**:

1. CI runs data invariants and web tests only — never the CPU-heavy pipeline
   (that runs locally, and its output is committed). CI invokes
   `uv run pytest -m "not source"`.

2. Deploy Pages and the Worker; set R2 and Turnstile secrets via
   `wrangler secret put` — never in source.

3. Rollback contract — **must exist before the first public deploy**

   | Change | Undo | Blast radius if not undone |
   |---|---|---|
   | Bad `data/catalog.json` | `git revert <sha>`, rebuild Pages. Imagery unaffected: R2 keys carry a content hash (Task 22) and objects are never overwritten | Wrong titles/modes/page refs sitewide |
   | Bad segmentation run | Revert `catalog.json`; orphaned R2 objects are inert, swept by a 30-day lifecycle rule | None once the catalog is reverted |
   | Bad Pages deploy | `wrangler pages deployment list`, then `wrangler pages deployment rollback <id>` | Broken site until reverted |
   | Bad Worker deploy | `wrangler deployments list`, then `wrangler rollback --message "<reason>"`. D1 rows written meanwhile stay `pending` and are harmless | Corrections endpoint down or accepting bad rows |
   | D1 schema change | Numbered additive-only migrations in `workers/corrections/migrations/NNNN_*.sql`, applied with `wrangler d1 migrations apply`, each with a paired `NNNN_*_down.sql`. Never drop or rename a column in the same deploy that stops writing it — reader first, writer second, drop a week later | Worker 500s on every submit; queue silently lost |
   | Catalog schema bump | Bump `SCHEMA_VERSION` in `web/src/lib/catalog.ts` **and** `schema_version` in the pipeline in one commit; the loader throws on mismatch, so a half-deployed pair fails the build rather than rendering blanks | Every template renders `undefined` |

   Pre-deploy: `wrangler d1 export noh-corrections --output backups/$(date -u +%Y%m%dT%H%M%SZ).sql`.
   The Worker reads `CORRECTIONS_ENABLED` at the top of `fetch` and returns 503 when
   unset, so intake can be killed without a redeploy.

4. Verify and commit
   ```bash
   cd web && pnpm build && pnpm wrangler pages deploy dist
   cd ../workers/corrections && pnpm wrangler deploy
   git add -A && git commit -m "chore: deploy pipeline for Pages and Worker"
   ```

---

## Task 34: Put it in front of the pilot users

**Steps**:

1. Email each person from `docs/pilot-users.md` a direct link to `/kyriale/I` and
   one question: "Can you play from this at your next Mass?"

2. Post the link in one place only — wherever the strongest response to Task 0
   came from — with honest framing: NOH5 only, scans not re-engraving, corrections
   welcome.

3. Before sending, do one real-device pass: Missa IX on an iPad at 50% brightness,
   a keyboard-only tab through a Mass page, and a printed copy from the browser.

4. Record what broke in `docs/pilot-feedback.md` verbatim — including tablet
   legibility, page-turn behaviour at the console, and whether they read in the
   browser or exported the PDF.

5. **Gate on the next volume**: do not start NOH1 until three organists have played
   from NOH5 at an actual service. If they have not, the problem is not that you
   need more volumes.

---

## Task 35: Make the artefact outlive the author

**Files**: Create `data/README.md`, `docs/CONTINUITY.md`, `.github/workflows/archive.yml`

**Steps**:

1. Publish a bulk export at a stable URL: `catalog.json`, `index-noh5.yml`,
   `volumes.yml` (with checksums), `derived-offsets.json`, and a manifest of every
   R2 system key. Anyone must be able to rebuild the site from this plus the PD
   source PDFs, with **no access to your Cloudflare account**.

2. Deposit a snapshot of that export plus the cleaned page images to the Internet
   Archive, and mint a DOI via Zenodo so the catalog is citable in scholarship.
   Automate the deposit in CI on every tagged release.

3. Write `data/README.md` documenting the catalog schema field by field, the
   1942/1962 status enum, and the PD-vs-CC-BY-SA split, so a stranger can use the
   data without reading `pipeline/`.

4. Write `docs/CONTINUITY.md`: domain registrar, where the R2/D1 accounts live, and
   an explicit statement that all original work is released CC0/CC-BY-SA so someone
   else may fork and rehost without asking.

5. Verify a clean-room rebuild from the published export alone, then commit.

---

# Execution Handoff

**Option 1 — Subagent-driven (this session)**: use `executing-plans` for a fresh
agent per task with review gates between them.

**Option 2 — Parallel session**: execute in a separate worktree, following tasks
in order, committing after each.

# Risks Carried Into Execution

1. **Task 12 is the gate.** If system detection cannot hit the hand-labelled
   counts on all 12 fixture pages, stop and tune. Every downstream task inherits
   its error rate.
2. **Movement boundaries are not in the index.** Tasks 13/17 infer them from
   running heads and text lines. Expect a real review queue here; budget for it.
3. **WebP cannot be embedded by `pdf-lib` directly** (Task 27). Resolve the
   PNG-vs-decode question early — it affects what Task 21 emits.
4. **Tesseract Latin data** must be installed (`brew install tesseract tesseract-lang`).
   Tasks 5, 13 and 14 fail without it.
5. **Index OCR is degraded**, so Task 15 hand-transcribes ground truth. Do not
   substitute either OCR source for that file.
5b. **The embedded text layer is a signal, never a transcription.** It is 1990s
   OCR over 1942 print. It may be shown to no reader as text, indexed only as a
   hidden search field, and used only where a second source agrees with it.
5c. **The CCW reference edition must never become a publication source.** Branding
   is burned into the imagery and its front matter carries a modern copyrighted
   translation. `data/volumes.yml` is an allowlist and Task 2 has a test that
   fails if CCW is ever registered as a volume.
6. **The reading experience is under-budgeted relative to the pipeline.** The user
   is an organist on a console-mounted tablet in low light, minutes before a
   service. If Tasks 23a/25/26 are compressed under schedule pressure, **ship fewer
   pieces rather than fewer states** — a beautifully segmented catalog that reflows
   mid-Gloria, cannot be read in the dark, and prints with a navigation bar is a
   failed product.
7. **`group_systems` now raises rather than guessing** when staff count is not a
   multiple of two, or when the intra-system gap is not smaller than the
   inter-system gap. Expect these to fire on real pages during Task 12 tuning. That
   is the design working: each one is a page for the review queue, not a crash to
   suppress.
