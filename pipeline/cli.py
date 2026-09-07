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

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

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

    return 1


if __name__ == "__main__":
    sys.exit(main())
