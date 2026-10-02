"""`noh` command line.

Every stage is reachable by one verb, on one page or a whole volume, and is
re-runnable. Stages skip work whose inputs are unchanged unless --force.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def parse_pages(spec: str) -> list[int]:
    """Accept '229', '5-11', '5,11,229' and combinations."""
    pages: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            lo_i, hi_i = int(lo), int(hi)
            if lo_i > hi_i:
                raise ValueError(f"descending page range: {part!r}")
            pages.extend(range(lo_i, hi_i + 1))
        else:
            pages.append(int(part))
    return sorted(dict.fromkeys(pages))


def _add_common(sub: argparse.ArgumentParser) -> None:
    sub.add_argument("--volume", required=True, help="volume id from data/volumes.yml")
    sub.add_argument("--pages", default=None, help="e.g. 229 | 5-11 | 5,11,229")
    sub.add_argument("--force", action="store_true", help="recompute unchanged outputs")
    sub.add_argument("--out", type=Path, default=None, help="output dir (default build/)")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="noh", description="Nova Organi Harmonia pipeline")
    subs = p.add_subparsers(dest="command", required=True)

    subs.add_parser("doctor", help="preflight: dependencies, sources, credentials")
    ti = subs.add_parser("typeset-import",
                         help="import the volunteers' LilyPond transcriptions from a pinned commit into data/typeset/")
    ti.add_argument("--commit", required=True, help="the upstream commit's full sha (never a branch)")
    tm = subs.add_parser("typeset-match",
                         help="propose which part each transcription is (data/typeset/parts.yml), by page, name and melody")
    tm.add_argument("--forget-render-failures", action="store_true",
                    help="decide files marked broken by a render afresh (after changing what counts as a failure)")
    tc = subs.add_parser("typeset-check",
                         help="check the typeset sources (source check), parts.yml and the manifest; needs no LilyPond (CI)")
    tc.add_argument("--remote", metavar="BASE", default=None,
                    help="also check every render the manifest names answers at BASE (PUBLIC_ASSET_BASE)")
    subs.add_parser("typeset-manifest",
                    help="write data/typeset/manifest.json and review.json from the sources (no LilyPond)")
    tr_ = subs.add_parser("typeset-render", help="render the typeset music not yet published, into build/typeset/out/")
    tr_.add_argument("--missing-from", metavar="BASE", default=None,
                     help="render only what does not answer at BASE (PUBLIC_ASSET_BASE); default: everything")
    tr_.add_argument("--mark-broken", action="store_true",
                     help="mark files LilyPond cannot draw as broken in parts.yml (for their scans to stay), "
                          "and rewrite the manifest")
    subs.add_parser("typeset-publish", help="check and upload build/typeset/out/ to R2 (write-if-absent)")
    tp = subs.add_parser("typeset-prune",
                         help="delete renders on R2 that the manifest and review files no longer name "
                              "(a dry run unless --delete)")
    tp.add_argument("--delete", action="store_true", help="delete them; without it, only report")
    tp.add_argument("--grace-days", type=int, default=14,
                    help="keep anything uploaded within this many days (default 14): a pull request's renders")
    subs.add_parser("lilypond-install",
                    help="download the pinned LilyPond (data/typeset/lilypond.yml) into vendor/, checksum-checked")
    subs.add_parser("r2-check",
                    help="check the R2 credentials: their shape, then write, read and delete a test object")

    render = subs.add_parser("render", help="rasterise pages at 300dpi")
    _add_common(render)
    render.add_argument("--dpi", type=int, default=300)

    offset = subs.add_parser("offset", help="derive and persist the page offset")
    offset.add_argument("--volume", required=True)
    offset.add_argument("--sample-size", type=int, default=20)
    offset.add_argument("--seed", type=int, default=0)
    offset.add_argument("--segments", action="store_true",
                        help="derive a piecewise page map (a scan with inserted or missing pages)")

    folio = subs.add_parser("folio", help="read folios for pages (dual-source)")
    _add_common(folio)

    idx = subs.add_parser("index", help="show the hand-transcribed index")
    idx.add_argument("--volume", required=True)

    cross = subs.add_parser("crosscheck", help="verify index pages against printed folios")
    cross.add_argument("--volume", required=True)

    head = subs.add_parser("head", help="read running heads and match them to sections")
    _add_common(head)

    calendar = subs.add_parser("calendar", help="regenerate the 1962 calendar from Missalemeum")
    calendar.add_argument("--from", dest="first", type=int, default=2024)
    calendar.add_argument("--to", dest="last", type=int, default=2050)

    ix = subs.add_parser("index-extract",
                         help="read a volume's printed index by script and verify it against page headings")
    ix.add_argument("--volume", required=True, help="volume id from data/volumes.yml")
    ix.add_argument("--from-sections", action="store_true",
                    help="catalogue a volume with no index from its capitals section headings (NOH4)")
    ix.add_argument("--from-headings", action="store_true",
                    help="catalogue from the body's dated feast headings instead of the index (NOH3)")
    ix.add_argument("--alphabetical", action="store_true",
                    help="the index is alphabetical, not in page order (NOH3)")
    ix.add_argument("--division", default="varia", help="division for sections with no clearer one")
    ix.add_argument("--no-ocr", action="store_true", help="embedded text layer only (fast, weaker)")
    ix.add_argument("--section", default=None,
                    help="section name for entries under no printed heading, e.g. 'Proprium de Tempore'")
    ix.add_argument("--out", type=Path, default=None,
                    help="proposal path (default data/index-<vol>.proposed.yml)")

    jg = subs.add_parser("jgabc-fetch",
                         help="vendor jgabc's per-day chant ids into data/jgabc-propers.json")
    jg.add_argument("--commit", default=None, help="jgabc commit sha (default: master's head)")

    subs.add_parser("chants", help="write data/chants.json: the notation of every chant a part names")
    subs.add_parser("gregobase-fetch",
                    help="download the pinned GregoBase dump (CC0) into vendor/, checked against its sha256")

    of = subs.add_parser("officium-fetch",
                         help="vendor Divinum Officium's Vespers texts (1960) into data/vespers/divinum-officium-vespers.json")
    of.add_argument("--commit", default=None, help="Divinum Officium commit sha (default: the pinned one)")
    vf = subs.add_parser("vesperale-fetch",
                         help="vendor jsrjenkins/vesperale's Sunday Vespers table into data/vespers/vesperale-lineup.json")
    vf.add_argument("--commit", default=None, help="vesperale commit sha (default: the pinned one)")
    subs.add_parser("vespers-items",
                    help="propose each green Sunday's Magnificat antiphon and tone from NOH8 "
                         "(data/vespers/vespers-noh8.proposed.yml, for review)")
    vl = subs.add_parser("vespers-lineup",
                         help="write data/vespers/vespers-lineup.json: each Sunday's Vespers in sung order")
    vl.add_argument("--day", default=None,
                    help="print one day's lineup instead: a date (2026-09-13) or a key (tempora:Pent16-0)")
    vl.add_argument("--json", action="store_true", help="with --day: print that day's JSON")

    source_batch = subs.add_parser("typeset-source-batch", help="Check/render approved source and refresh its matching evidence without secrets")
    source_batch.add_argument("payload", type=Path)
    source_batch.add_argument("--out", type=Path, default=Path("build/source-batch/parts.yml"))
    for command in ("typeset-preview-render", "typeset-preview-publish"):
        preview = subs.add_parser(command, help="Render or independently upload a source preview")
        if command.endswith("render"):
            preview.add_argument("payload", type=Path)
        preview.add_argument("--out", type=Path, default=Path("build/typeset-preview"))

    cat = subs.add_parser("catalog", help="build data/catalog.json and review-queue.json")
    cat.add_argument("--volume", required=True)
    cat.add_argument("--no-parts", action="store_true",
                     help="keep each Proper's previous parts instead of re-dividing it")
    cat.add_argument("--parts-report", action="store_true",
                     help="write build/parts-sample-<volume>.html: 30 random part starts beside "
                          "their slices, for a hand check")

    ac = subs.add_parser("apply-corrections",
                         help="apply data/corrections.yml over data/catalog.base.json into "
                              "data/catalog.json (no PDFs needed)")
    ac.add_argument("--check", action="store_true",
                    help="write nothing; fail if data/catalog.json is not current (for CI)")
    co = subs.add_parser("correct", help="record a hand correction in data/corrections.yml")
    co.add_argument("target", help="piece:<slug>, part:<slug>/<part>, vespers:<office>/antiphon-<n> ... "
                                   "(find it with `noh where <page URL>`)")
    co.add_argument("field", help="a piece: title, incipit, mode, genre, printed_pages; a part: start_system, "
                                  "chant; a Vespers item: tone, chant")
    co.add_argument("value", help="the corrected value, e.g. \"Dominica I Adventus\" or 5-10")
    co.add_argument("--note", default="", help="why: e.g. \"as printed on p. 3\"")
    co.add_argument("--source", default="editor", help="editor, or reader#<id> for a reader's report")
    cb = subs.add_parser("correct-batch",
                         help="record a batch of corrections from the admin screen (a JSON file), all or nothing")
    cb.add_argument("file", help="the batch: {\"batch\": \"b-...\", \"entries\": [...]}")
    cb.add_argument("--summary", default=None, help="write the pull request description here")
    cb.add_argument("--hold", default=None,
                    help="write why the batch waits for the owner here, one reason a line (empty: merge it)")
    wh = subs.add_parser("where", help="what a page is, and which file to change to fix it")
    wh.add_argument("query", help="a page URL or path (/piece/<slug>/), or a few words of a title")
    se = subs.add_parser("sections", help="a Proper's sections: where each starts, what the book prints "
                         "there, and its chant; --review writes them to data/sections/ to check")
    se.add_argument("slug", help="the piece's slug (from its URL: /piece/<slug>/)")
    se.add_argument("--review", action="store_true",
                    help="write the current list to data/sections/<volume>.yml, to check against the scans "
                         "and edit; from then on that list is the piece's sections")
    cs = subs.add_parser("corrections", help="list the hand corrections, or drop one")
    cs.add_argument("--drop", metavar="ID", default=None, help="delete the entry with this id")
    cs.add_argument("--lapsed", action="store_true",
                    help="list only the reviews that have lapsed (what they confirmed has changed, or gone)")
    tr = subs.add_parser("triage", help="review readers' corrections from the Corrections form")
    tr.add_argument("--local", action="store_true", help="use the local D1 database")
    tr.add_argument("--dry-run", action="store_true", help="show what would change, write nothing")
    tr.add_argument("--stamp", action="store_true",
                    help="after committing, record the commit against the accepted corrections")

    pub = subs.add_parser("publish", help="slice systems to webp/png derivatives")
    _add_common(pub)
    pub.add_argument("--upload", action="store_true", help="also upload to R2")
    pub.add_argument("--no-trim", action="store_true", help="keep full page width")
    pub.add_argument("--skip-slice", action="store_true",
                     help="upload what is already sliced (needs each page's manifest) without re-slicing")
    pub.add_argument("--dry-run", action="store_true",
                     help="with --upload, report what would be sent without sending")

    overlay = subs.add_parser("overlay", help="write segmentation overlays and contact sheet")
    _add_common(overlay)
    overlay.add_argument("--sheet", action="store_true", help="also write contact-sheet.html")

    return p


def _corrections_command(args: argparse.Namespace) -> int:
    import json as _json

    from pipeline import corrections as c
    try:
        if args.command == "apply-corrections":
            if args.check:
                stale = c.stale_outputs()
                if stale:
                    print(f"{', '.join(stale)} not current with corrections.yml.\n"
                          "  Fix: uv run noh apply-corrections, then commit the files it names",
                          file=sys.stderr)
                    return 1
                print("data/catalog.json, the Vespers lineup, reviewed.json and the typeset manifest are current with corrections.yml")
                return 0
            count, files = c.write_all()
            print(f"{count} correction(s) applied; " + (f"rewrote {', '.join(files)}" if files else "nothing changed"))
            return 0
        if args.command == "correct":
            entry, replaced = c.correct(args.target, args.field, args.value, note=args.note, source=args.source)
            _, files = c.write_all()
            verb = "updated" if replaced else "recorded"
            print(f"{verb} {entry.id}: {entry.target} {entry.field} {entry.was!r} -> {entry.value!r}\n"
                  f"rewrote {', '.join(files) or 'nothing else'}. Preview with `pnpm --dir web dev`, then commit\n"
                  "data/corrections.yml and the files named.")
            return 0
        if args.command == "correct-batch":
            from pathlib import Path as _Path
            batch = _json.loads(_Path(args.file).read_text(encoding="utf-8"))
            recorded = c.correct_batch(batch)
            c.write_all()
            hold = c.hold_reasons(recorded, sources=batch.get("sources"))
            if args.summary:
                _Path(args.summary).write_text(c.batch_summary(str(batch["batch"]), recorded, hold, sources=batch.get("sources")), encoding="utf-8")
            if args.hold:
                _Path(args.hold).write_text("".join(f"{r}\n" for r in hold), encoding="utf-8")
            print(f"recorded {len(recorded)} correction(s): {', '.join(e.id for e in recorded)}")
            return 0
        if args.command == "corrections":
            if args.drop:
                entry = c.drop(args.drop)
                _, files = c.write_all()
                print(f"dropped {entry.id} ({entry.target} {entry.field}); rewrote {', '.join(files) or 'nothing'}")
                return 0
            entries = c.load()
            base = c.load_base()
            stale = {e.id for e in c.no_ops(base, entries, c.load_vespers())}
            lapsed = {e.id for e in c.reviews(c.apply(base, entries), entries)[1]}
            shown = [e for e in entries if e.id in lapsed] if args.lapsed else entries
            for e in shown:
                flag = ("  (now a no-op: fixed at the source; drop it)" if e.id in stale else
                        "  (review lapsed: what it confirmed has changed; review again or drop it)"
                        if e.id in lapsed else "")
                print(f"{e.id}  {e.target}  {e.field}: {e.was!r} -> {e.value!r}  [{e.source}, {e.date}]{flag}")
            print(f"{len(shown)} {'lapsed review' if args.lapsed else 'correction'}(s)")
            return 0
        if args.command == "sections":
            from pipeline import sections as _sections
            catalog = _json.loads(c.CATALOG.read_text(encoding="utf-8"))
            piece = next((p for p in catalog["pieces"] if p["slug"] == args.slug), None)
            if piece is None:
                print(f"sections: no piece {args.slug!r}. Run `uv run noh where <page URL>` for its slug.",
                      file=sys.stderr)
                return 1
            print(_sections.describe(piece))
            if args.review:
                path = _sections.save_reviewed(args.slug, str(piece["volume"]), _sections.as_reviewed(piece))
                print(f"wrote {path.relative_to(path.parent.parent.parent)}: check each section against the scan "
                      "and edit it, then `uv run noh apply-corrections`")
            return 0
        from pipeline.where import where
        catalog = _json.loads(c.CATALOG.read_text(encoding="utf-8"))
        found = where(args.query, catalog)
        if not found:
            print(f"nothing matches {args.query!r}. Paste a page URL, or try fewer words.", file=sys.stderr)
            return 1
        for loc in found:
            print(f"{loc.target}\n  {loc.label}\n  source:  {loc.source}\n  then:    {loc.command}")
            if loc.more:
                print("  also:    " + "\n           ".join(loc.more))
        return 0
    except c.CorrectionError as exc:
        print(f"{args.command}: {exc}\n  Nothing was written.", file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Python block-buffers stdout when it is a pipe, so a seven-minute publish
    # run writes nothing until it finishes and looks hung to anyone watching a
    # log file. Progress lines are the only evidence the run is alive.
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, ValueError):
        pass

    if args.command == "doctor":
        from pipeline.doctor import report, run
        return report(run())

    if args.command == "typeset-import":
        from pipeline.typeset.importer import UpstreamError, run_import
        try:
            report = run_import(args.commit)
        except UpstreamError as error:
            print(f"FAIL  {error}", file=sys.stderr)
            return 1
        print("\n".join(report.lines()))
        return 1 if report.conflicts else 0

    if args.command == "typeset-match":
        from collections import Counter

        from pipeline.typeset.lilypond import LilyPondError
        from pipeline.typeset.match import PARTS_FILE, run
        try:
            entries = run(forget_render_failures=args.forget_render_failures)
        except LilyPondError as error:
            print(f"FAIL  {error}", file=sys.stderr)
            return 1
        counts = Counter(e.status for e in entries)
        print(f"wrote {PARTS_FILE.relative_to(PARTS_FILE.parents[2])}: {len(entries)} files; "
              + ", ".join(f"{n} {s}" for s, n in counts.most_common()))
        return 0

    if args.command == "typeset-manifest":
        from pipeline.typeset.manifest import write
        changed = write()
        print(f"rewrote {', '.join(changed)}" if changed else "manifest.json and review.json are current")
        return 0

    if args.command == "typeset-source-batch":
        import json

        from pipeline.typeset.source_batch import refresh_sources
        refresh_sources(json.loads(args.payload.read_text()), args.out)
        return 0
    if args.command in ("typeset-preview-render", "typeset-preview-publish"):
        from pipeline.typeset.preview import publish_preview, render_preview
        if args.command.endswith("render"):
            render_preview(args.payload, args.out)
        else:
            publish_preview(args.out)
        return 0
    if args.command == "typeset-render":
        from pipeline.typeset.publish import OUT, StaleManifest, render_missing
        try:
            report = render_missing(args.missing_from)
        except StaleManifest as error:
            print(f"FAIL  {error}", file=sys.stderr)
            return 1
        if args.mark_broken and report.failures:
            from pipeline.typeset.manifest import write
            from pipeline.typeset.match import mark_render_failures
            marked = mark_render_failures(report.failures)
            write()
            print(f"marked {len(marked)} file(s) broken in parts.yml; rewrote the manifest")
            return 0
        for line in report.failed_shown:
            print(f"FAIL  {line}", file=sys.stderr)
        for line in report.failed_review:
            print(f"note  (review list only) {line}")
        print(f"rendered {len(report.rendered)} into {OUT}; {len(report.failed_shown)} shown part(s) failed, "
              f"{len(report.failed_review)} on the review list failed")
        return 0 if report.ok else 1

    if args.command == "typeset-publish":
        from pipeline.typeset.publish import publish
        uploaded, there, problems_ = publish()
        for line in problems_:
            print(f"FAIL  {line}", file=sys.stderr)
        print(f"uploaded {uploaded} file(s); {there} already published")
        return 1 if problems_ else 0

    if args.command == "typeset-prune":
        from pipeline.typeset.prune import prune
        if args.grace_days < 1:
            print("--grace-days must be at least 1", file=sys.stderr)
            return 2
        found, failed = prune(apply=args.delete, grace_days=args.grace_days)
        verb = "deleted" if args.delete else "would delete"
        print(f"{verb} {len(found.delete)} file(s) of {found.renders} render(s), "
              f"{found.bytes / 1_048_576:.1f} MB; kept {found.named} file(s) the manifest and review files name "
              f"and {found.recent} uploaded in the last {args.grace_days} days")
        if found.other:
            print(f"note  left {found.other} file(s) under typeset/ that are not a render's")
        for line in failed:
            print(f"FAIL  {line}", file=sys.stderr)
        return 1 if failed else 0

    if args.command == "typeset-check":
        from pipeline.typeset.check import problems
        from pipeline.typeset.manifest import stale
        found = problems()
        found += [f"data/typeset/{name} is not current: run `uv run noh typeset-manifest`" for name in stale()]
        if args.remote and not found:
            from pipeline.typeset.publish import remote_problems
            found += remote_problems(args.remote)
        for line in found:
            print(f"FAIL  {line}", file=sys.stderr)
        if not found:
            print("data/typeset: every source passes the source check; parts.yml is sound")
        return 1 if found else 0

    if args.command == "lilypond-install":
        from pipeline.typeset.lilypond import LilyPondError, install, version_of
        try:
            binary = install()
        except LilyPondError as error:
            print(f"FAIL  {error}", file=sys.stderr)
            return 1
        print(f"OK    {binary} ({version_of(binary)})")
        return 0

    if args.command == "r2-check":
        from pipeline.upload import credential_problems, probe, require_credentials
        try:
            creds = require_credentials()
        except RuntimeError as error:
            print(f"FAIL  {error}", file=sys.stderr)
            return 1
        problems = credential_problems(creds)
        for problem in problems:
            print(f"FAIL  {problem}", file=sys.stderr)
        if problems:
            return 1
        try:
            key = probe(creds)
        except Exception as error:  # noqa: BLE001 - reported, then a failing exit
            print(f"FAIL  bucket {creds.bucket}: {type(error).__name__}: {error}", file=sys.stderr)
            return 1
        print(f"OK    bucket {creds.bucket}: wrote, read back and deleted {key}")
        return 0

    if args.command == "render":
        from pipeline.render import render_page
        from pipeline.volumes import load_volumes
        vol = load_volumes()[args.volume]
        pages = parse_pages(args.pages) if args.pages else list(range(1, vol.pdf_pages + 1))
        for i, page in enumerate(pages, 1):
            out = render_page(args.volume, page, args.out, dpi=args.dpi, force=args.force)
            print(f"[{i}/{len(pages)}] {out}")
        return 0

    if args.command == "offset" and args.segments:
        from pipeline.offset import derive_page_map, persist_page_map
        page_map = derive_page_map(args.volume, seed=args.seed)
        for seg in page_map.segments:
            print(f"{args.volume}: pdf {seg.first_pdf}-{seg.last_pdf}  offset {seg.offset:+d}  "
                  f"verified readings {seg.verified}")
        for first, last in page_map.gaps:
            print(f"  unmapped pdf {first}-{last}")
        persist_page_map(args.volume, page_map)
        return 0

    if args.command == "offset":
        from pipeline.offset import assert_consistent, derive_offset, persist
        result = derive_offset(args.volume, sample_size=args.sample_size, seed=args.seed)
        assert_consistent(args.volume, result)
        persist(args.volume, result, seed=args.seed)
        print(f"{args.volume}: offset {result.offset:+d}  "
              f"confidence {result.confidence:.2f}  agreed samples {result.samples}")
        if result.disagreements:
            print(f"  disagreements: {result.disagreements}")
        return 0

    if args.command == "folio":
        from pipeline.folio import read_folio_dual
        for page in parse_pages(args.pages or ""):
            r = read_folio_dual(args.volume, page, args.out)
            mark = "ok " if r.agreement else "?? "
            print(f"{mark} pdf p{page:4d}  folio={r.folio}  "
                  f"embedded={r.embedded} tesseract={r.tesseract}  head={r.running_head!r}")
        return 0

    if args.command == "index":
        from pipeline.index import load_index, resolve_ranges
        for entry, lo, hi in resolve_ranges(load_index(args.volume)):
            span = f"{lo}" if lo == hi else f"{lo}-{hi}"
            print(f"{entry.slug:44s} {entry.genre:14s} pp.{span:9s} {entry.title[:44]}")
        return 0

    if args.command == "crosscheck":
        from collections import Counter

        from pipeline.crosscheck import mismatches, verify_entry_pages
        checks = verify_entry_pages(args.volume)
        counts = Counter(c.status for c in checks)
        for c in checks:
            mark = {"confirmed": "ok ", "unconfirmed": "?  ", "mismatch": "!! "}[c.status]
            print(f"{mark} printed {c.printed_page:3d} -> pdf {c.pdf_page:3d}  "
                  f"embedded={c.embedded} tesseract={c.tesseract}  {c.title[:38]}")
        print(f"\nconfirmed={counts['confirmed']} unconfirmed={counts['unconfirmed']} "
              f"mismatch={counts['mismatch']} of {len(checks)}")
        return 1 if mismatches(checks) else 0

    if args.command == "head":
        from pipeline.runninghead import read_running_head, vocabulary
        vocab = vocabulary(args.volume)
        for page in parse_pages(args.pages or ""):
            r = read_running_head(args.volume, page, vocab)
            print(f"pdf p{page:4d}  section={r.matched!s:16s} score={r.score:.2f}  "
                  f"raw={r.raw[:44]!r}")
        return 0

    if args.command == "calendar":
        from pipeline.litcal import generate
        manifest = generate(args.first, args.last)
        print(f"calendar {args.first}-{args.last} from Missalemeum {manifest['commit']} "
              f"({manifest['licence']})")
        return 0

    if args.command == "index-extract":
        return _index_extract(args)

    if args.command == "jgabc-fetch":
        from pipeline.jgabc import JgabcSyntaxError, fetch
        try:
            path, commit, count = fetch(args.commit)
        except JgabcSyntaxError as exc:
            print(f"jgabc-fetch: {exc}\n  data/jgabc-propers.json was left untouched.",
                  file=sys.stderr)
            return 1
        print(f"{path}: {count} Propers from jgabc @ {commit[:12]}")
        return 0

    if args.command == "officium-fetch":
        from pipeline.officium import PINNED as DO_PINNED
        from pipeline.officium import OfficiumError
        from pipeline.officium import fetch as fetch_officium
        try:
            path, commit, count = fetch_officium(args.commit or DO_PINNED)
        except (OfficiumError, OSError) as exc:
            print(f"officium-fetch: {exc}\n  data/vespers/divinum-officium-vespers.json was left untouched.",
                  file=sys.stderr)
            return 1
        print(f"wrote {path}: Vespers of {count} offices, commit {commit[:12]}")
        return 0

    if args.command == "vesperale-fetch":
        from pipeline.vesperale import PINNED, VesperaleIntegrityError
        from pipeline.vesperale import fetch as fetch_vesperale
        try:
            path, commit, count = fetch_vesperale(args.commit or PINNED)
        except (VesperaleIntegrityError, OSError) as exc:
            print(f"vesperale-fetch: {exc}\n  data/vespers/vesperale-lineup.json was left untouched.",
                  file=sys.stderr)
            return 1
        print(f"wrote {path}: {count} Sundays' Magnificat antiphons and tones, commit {commit[:12]}")
        return 0

    if args.command == "vespers-items":
        import json as _json

        import yaml as _yaml

        from pipeline.officium import OfficiumError
        from pipeline.officium import load as load_officium
        from pipeline.vesperitems import office_systems, propose_offices
        from pipeline.vespers import CATALOG, propose
        from pipeline.volumes import VESPERS
        path, count = propose()
        print(f"{path}: {count} Magnificat antiphons of the green Sundays proposed")
        try:
            texts = load_officium()
        except OfficiumError as exc:
            print(f"vespers-items: {exc}", file=sys.stderr)
            return 1
        offices = propose_offices(office_systems(_json.loads(CATALOG.read_text(encoding="utf-8"))), texts)
        out = VESPERS / "vespers-offices.proposed.yml"
        out.write_text("# PROPOSED by `noh vespers-items` -- not reviewed. Check each placement (score) and tone "
                       "against the scan,\n# then carry it into data/vespers/vespers-offices.yml.\n"
                       + _yaml.safe_dump({"offices": offices}, sort_keys=False, allow_unicode=True, width=150),
                       encoding="utf-8")
        weak = sum(1 for o in offices.values() for a in (o.get("antiphons") if isinstance(o.get("antiphons"), list)
                   else []) if not isinstance(a.get("score"), float) or a["score"] < 0.7)
        print(f"{out}: {len(offices)} offices proposed; {weak} antiphon placements to check by eye "
              f"(score under 0.7 or unplaced). Review into data/vespers/vespers-offices.yml.")
        return 0

    if args.command == "vespers-lineup":
        import json as _json

        from pipeline.vespers import (
            LINEUP,
            VespersDataError,
            calendar_days,
            describe,
            resolve_day,
            write_lineup,
        )
        if args.day:
            if not LINEUP.exists():
                print("vespers-lineup: data/vespers/vespers-lineup.json is missing; run uv run noh vespers-lineup "
                      "first.", file=sys.stderr)
                return 1
            doc = _json.loads(LINEUP.read_text(encoding="utf-8"))
            try:
                dates = resolve_day(args.day, calendar_days())
            except ValueError as exc:
                print(f"vespers-lineup: {exc}", file=sys.stderr)
                return 1
            # A key falls on many dates: show the next one from today.
            from datetime import UTC, datetime
            today = datetime.now(UTC).date().isoformat()
            upcoming = [d for d in dates if d >= today]
            iso = (upcoming or dates)[0]
            if args.json:
                print(_json.dumps(doc["days"].get(iso), ensure_ascii=False, indent=1))
            else:
                print(describe(iso, doc))
            return 0
        try:
            path, doc, review = write_lineup()
        except VespersDataError as exc:
            print(f"vespers-lineup: {exc}", file=sys.stderr)
            return 1
        days, held, first = doc["days"], doc["held_back"], doc.get("first_vespers", {})
        years = sorted({d[:4] for d in days} | {d[:4] for d in held})
        span = f" ({years[0]}-{years[-1]})" if years else ""
        print(f"{path}: {len(days)} Vespers by date and {len(first)} I Vespers of I class feasts; "
              f"{len(held)} Sundays held back{span}")
        bank = sum(1 for d in days.values() for i in d["items"] if i["source"]["type"] == "bank")
        notes = sum(1 for d in days.values() for i in d["items"] if i["source"]["type"] == "note")
        print(f"  items from the tone bank: {bank}; notes (sung unaccompanied): {notes}")
        for r in review:
            print(f"  {r['kind']}: {r['why']}")
        return 0

    if args.command == "gregobase-fetch":
        from pipeline.gregobase import DumpError, fetch_dump
        try:
            path = fetch_dump()
        except (DumpError, OSError) as exc:
            print(f"gregobase-fetch: {exc}", file=sys.stderr)
            return 1
        print(f"{path}: the pinned GregoBase dump, sha256 checked")
        return 0

    if args.command == "chants":
        from pipeline.chants import build
        from pipeline.gregobase import DUMP
        if not DUMP.exists():
            print(f"chants: {DUMP.name} is missing (not in git).\n  Fix: uv run noh gregobase-fetch",
                  file=sys.stderr)
            return 1
        path, written, withheld = build()
        print(f"{path}: {written} chants; {withheld} referenced but withheld (flagged copyrighted, "
              f"or no notation)")
        return 0

    if args.command in {"apply-corrections", "correct", "correct-batch", "where", "corrections", "sections"}:
        return _corrections_command(args)

    if args.command == "triage":
        from tools.triage.main import main as triage
        return triage([*(["--local"] if args.local else []), *(["--dry-run"] if args.dry_run else []),
                       *(["--stamp"] if args.stamp else [])])

    if args.command == "catalog":
        from pipeline.catalog import PartsUnavailable, write_catalog
        from pipeline.corrections import CorrectionError
        try:
            cat_path, review_path = write_catalog(args.volume, parts=not args.no_parts)
        except PartsUnavailable as exc:
            print(f"catalog: {exc}\n  Nothing was written.", file=sys.stderr)
            return 1
        except CorrectionError as exc:
            print(f"catalog: wrote data/catalog.base.json, but data/catalog.json was not updated:\n{exc}\n"
                  "  Fix corrections.yml, then run: uv run noh apply-corrections", file=sys.stderr)
            return 1
        import json as _json
        catalog = _json.loads(cat_path.read_text(encoding="utf-8"))
        review = _json.loads(review_path.read_text(encoding="utf-8"))
        systems = sum(len(p["systems"]) for p in catalog["pieces"])
        movements = sum(len(p["movements"]) for p in catalog["pieces"])
        print(f"{cat_path}: {len(catalog['pieces'])} pieces, {systems} systems, "
              f"{movements} confident movements")
        from pipeline.partsreport import summary, write_sample
        print(summary(catalog, review, args.volume))
        if args.parts_report:
            print(f"hand-check sample: {write_sample(catalog, args.volume)}")
        print(f"{review_path}: {len(review)} entries needing review")
        return 0

    if args.command == "publish":
        from pipeline.publish import slice_systems, upload_plans
        from pipeline.volumes import load_volumes
        credentials = None
        if args.upload:
            from pipeline.upload import require_credentials
            credentials = require_credentials()   # fail before an hour of work
        vol = load_volumes()[args.volume]
        pages = parse_pages(args.pages) if args.pages else [
            p for p in range(vol.first_body_pdf_page, (vol.last_body_pdf_page or vol.pdf_pages) + 1)
            if p not in vol.index_pdf_pages]
        total = 0
        uploaded = skipped = 0
        failures: list[tuple[str, str]] = []
        for i, page in enumerate(pages, 1):
            from pipeline.publish import load_manifest
            manifest = load_manifest(args.volume, page, args.out) if args.skip_slice else None
            if manifest is not None:
                written = list(range(len(manifest)))
            else:
                # Not sliced yet -- or a page with no systems, which has no
                # manifest: slicing it again costs nothing.
                written = slice_systems(args.volume, page, args.out, trim=not args.no_trim)
            total += len(written)
            note = ""
            if args.upload:
                from pipeline.upload import upload_all
                report = upload_all(upload_plans(args.volume, page, args.out),
                                    credentials, dry_run=args.dry_run)
                uploaded += report.uploaded
                skipped += report.skipped
                failures.extend(report.failed)
                verb = "would upload" if args.dry_run else "uploaded"
                note = f"  ({verb} {report.uploaded}, skipped {report.skipped})"
            print(f"[{i}/{len(pages)}] pdf {page}: {len(written)} systems{note}")

        print(f"{total} systems sliced")
        if args.out is None:
            from pipeline.publish import export_manifests
            print(f"{export_manifests(args.volume)}: the published slices, for rebuilding without them")
        if args.upload:
            if args.dry_run:
                print(f"DRY RUN — would upload {uploaded} object(s); nothing was sent.")
            else:
                print(f"objects uploaded {uploaded}, already present {skipped}, "
                      f"failed {len(failures)}")
            for key, message in failures[:10]:
                print(f"  FAILED {key}: {message}")
            return 1 if failures else 0
        return 0

    if args.command == "overlay":
        from pipeline.evaluate import write_contact_sheet, write_overlay
        pages = parse_pages(args.pages) if args.pages else None
        if pages:
            for page in pages:
                print(write_overlay(args.volume, page))
        if args.sheet or not pages:
            print(write_contact_sheet(args.volume, pages))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())


def _index_extract(args: argparse.Namespace) -> int:
    from collections import Counter

    import yaml

    from pipeline.indexextract import REVIEW_STATUSES, compare, extract, to_yaml_doc
    from pipeline.litcal import load_vocabulary
    from pipeline.volumes import DATA, load_volumes

    vol = load_volumes()[args.volume]
    # Only calendar books get calendar keys: a Kyriale title matching a feast by
    # accident would put a Mass on the wrong day.
    vocabulary = (load_vocabulary()
                  if args.division in {"temporale", "sanctorale", "commune", "vesperale"} else None)
    if args.from_sections:
        from pipeline.indexextract import extract_from_sections
        proposals = extract_from_sections(args.volume, load_vocabulary())
    elif args.from_headings:
        from pipeline.indexextract import extract_from_headings
        index = extract(args.volume, ordered=not args.alphabetical, ocr=not args.no_ocr,
                        vocabulary=vocabulary)
        proposals = extract_from_headings(args.volume, vocabulary, index=index)
    else:
        proposals = extract(args.volume, ordered=not args.alphabetical, ocr=not args.no_ocr,
                            vocabulary=vocabulary)
    for p in proposals:
        mark = "ok " if p.status == "verified" else "?  " if p.page else "!! "
        days = ",".join(p.days)
        print(f"{mark}{p.page!s:>4}  {p.status:10s} {p.score:.2f}  {p.title[:48]:48s} {days}")
    counts = Counter(p.status for p in proposals)
    print("\n" + "  ".join(f"{k}={v}" for k, v in sorted(counts.items()))
          + f"  of {len(proposals)}; {sum(counts[s] for s in REVIEW_STATUSES)} to review")

    reviewed = DATA / f"index-{args.volume}.yml"
    if reviewed.exists():
        doc = yaml.safe_load(reviewed.read_text(encoding="utf-8"))
        pages = [e["page"] for s in doc["sections"] for e in s["entries"]]
        result = compare(proposals, pages)
        print(f"against {reviewed.name}: {result.agree}/{len(pages)} pages agree; "
              f"not proposed {result.missing}; proposed but not reviewed "
              f"{[(p, t[:30]) for _, p, t in result.differ]}")

    out = args.out or DATA / f"index-{args.volume}.proposed.yml"
    doc = to_yaml_doc(args.volume, vol.part, proposals, args.division,
                      vocabulary=load_vocabulary(), section_name=args.section)
    header = (f"# PROPOSED index for {args.volume}, written by `noh index-extract`. No AI.\n"
              "# Review every entry whose status is not 'verified', then promote this file\n"
              f"# to index-{args.volume}.yml. The script never overwrites a reviewed index.\n")
    out.write_text(header + yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, width=120),
                   encoding="utf-8")
    print(f"wrote {out}")
    return 0
