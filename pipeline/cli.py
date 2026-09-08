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

    folio = subs.add_parser("folio", help="read folios for pages (dual-source)")
    _add_common(folio)

    idx = subs.add_parser("index", help="show the hand-transcribed index")
    idx.add_argument("--volume", required=True)

    cross = subs.add_parser("crosscheck", help="verify index pages against printed folios")
    cross.add_argument("--volume", required=True)

    head = subs.add_parser("head", help="read running heads and match them to sections")
    _add_common(head)

    cat = subs.add_parser("catalog", help="build data/catalog.json and review-queue.json")
    cat.add_argument("--volume", required=True)

    pub = subs.add_parser("publish", help="slice systems to webp/png derivatives")
    _add_common(pub)
    pub.add_argument("--upload", action="store_true", help="also upload to R2")
    pub.add_argument("--no-trim", action="store_true", help="keep full page width")
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

    if args.command == "catalog":
        from pipeline.catalog import write_catalog
        cat_path, review_path = write_catalog(args.volume)
        import json as _json
        catalog = _json.loads(cat_path.read_text(encoding="utf-8"))
        review = _json.loads(review_path.read_text(encoding="utf-8"))
        systems = sum(len(p["systems"]) for p in catalog["pieces"])
        movements = sum(len(p["movements"]) for p in catalog["pieces"])
        print(f"{cat_path}: {len(catalog['pieces'])} pieces, {systems} systems, "
              f"{movements} confident movements")
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
        pages = parse_pages(args.pages) if args.pages else list(
            range(vol.first_body_pdf_page, vol.pdf_pages + 1))
        total = 0
        uploaded = skipped = 0
        failures: list[tuple[str, str]] = []
        for i, page in enumerate(pages, 1):
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
