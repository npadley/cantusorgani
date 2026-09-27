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

    cat = subs.add_parser("catalog", help="build data/catalog.json and review-queue.json")
    cat.add_argument("--volume", required=True)
    cat.add_argument("--no-parts", action="store_true",
                     help="keep each Proper's previous parts instead of re-dividing it")
    cat.add_argument("--parts-report", action="store_true",
                     help="write build/parts-sample-<volume>.html: 30 random part starts beside "
                          "their slices, for a hand check")

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

    if args.command == "catalog":
        from pipeline.catalog import PartsUnavailable, write_catalog
        try:
            cat_path, review_path = write_catalog(args.volume, parts=not args.no_parts)
        except PartsUnavailable as exc:
            print(f"catalog: {exc}\n  Nothing was written.", file=sys.stderr)
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
