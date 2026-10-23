"""Compare built identity-migration artifacts without normalising reader bytes.

B2 will implement --base/--head builds; B1 accepts existing --before/--after trees.
Allow entries name a changed _astro bundle path (old or new) and a review reason.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

from tools.check_legacy_addresses import Page, files, sitemap_urls, write_json

IDENTITY = re.compile(rb"(?:wrk|itm|set|rep)_[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


def bundle_key(path):
    if not path.startswith("_astro/") or Path(path).suffix.lower() in {".html", ".json", ".xml"}:
        return None
    # Astro uses name.hash.ext; names can themselves contain dots or underscores.
    match = re.fullmatch(r"(.+)\.([A-Za-z0-9_-]+)(\.[^.]+)", path)
    return match[1] + match[3] if match else None


def metadata(entries):
    return {name: Page(path.read_text()).policy for name, path in entries.items()
            if name.endswith(".html")}


def header_count(entries):
    path = entries.get("_headers")
    return sum(bool(line.strip()) and not line[0].isspace() and not line.startswith("#")
               for line in path.read_text().splitlines()) if path else 0


def compare(before, after, out, allow=None):
    left, right = files(before), files(after)
    report = {"schema_version": 1, "before": str(before.resolve()), "after": str(after.resolve()),
              "file_counts": {"before": len(left), "after": len(right)},
              "added": sorted(right.keys() - left.keys()),
              "removed": sorted(left.keys() - right.keys()),
              "byte_changes": [], "html_changes": [], "json_byte_changes": [],
              "json_value_changes": [], "bundle_changes": [], "leaks": [],
              "errors": [], "warnings": []}
    allowed = {}
    if allow:
        records = json.loads(allow.read_text())
        if not isinstance(records, list):
            raise ValueError("--allow must contain a JSON list")
        for entry in records:
            if (not isinstance(entry, dict) or set(entry) != {"path", "reason"}
                    or not isinstance(entry["path"], str)
                    or not isinstance(entry["reason"], str) or not entry["reason"].strip()
                    or bundle_key(entry["path"]) is None):
                raise ValueError("--allow accepts only hashed _astro bundles with a nonempty reason")
            if entry["path"] in allowed:
                raise ValueError("Duplicate --allow path")
            allowed[entry["path"]] = entry["reason"]
    for name in sorted(left.keys() & right.keys()):
        a, b = left[name].read_bytes(), right[name].read_bytes()
        if a != b:
            report["byte_changes"].append(name)
            if name.endswith(".html"):
                report["html_changes"].append(name)
            if name.endswith(".json"):
                report["json_byte_changes"].append(name)
        if name.endswith(".json"):
            try:
                if json.loads(a) != json.loads(b):
                    report["json_value_changes"].append(name)
            except (ValueError, UnicodeError) as error:
                report["errors"].append(f"Invalid JSON {name}: {error}")
    changed = set(report["added"] + report["removed"] + report["byte_changes"])
    groups = defaultdict(lambda: {"before": [], "after": []})
    for side, entries in (("before", left), ("after", right)):
        for name in entries:
            key = bundle_key(name)
            if key:
                groups[key][side].append(name)
    explained, used = set(), set()
    for key, group in sorted(groups.items()):
        paths = set(group["before"] + group["after"]) & changed
        if not paths:
            continue
        matches = paths & allowed.keys()
        # A single old/new pair can be reviewed together. Ambiguous groups require every path.
        accepted = bool(matches) and (max(map(len, group.values())) <= 1 or matches == paths)
        if accepted:
            explained.update(paths)
            used.update(matches)
        report["bundle_changes"].append({"logical_name": key,
                                          **{k: sorted(v) for k, v in group.items()},
                                          "explained": accepted,
                                          "reasons": {p: allowed[p] for p in sorted(matches)}})
    for path in sorted(allowed.keys() - used):
        report["errors"].append(f"Unused or ambiguous --allow entry: {path}")
    report["unexplained"] = sorted(changed - explained)
    for side, entries in (("before", left), ("after", right)):
        for name, path in entries.items():
            if "data/identities/" in "/" + name or IDENTITY.search(path.read_bytes()):
                report["leaks"].append({"tree": side, "path": name})
    report["sitemaps"] = {"before": sorted(sitemap_urls(left)),
                           "after": sorted(sitemap_urls(right))}
    left_meta, right_meta = metadata(left), metadata(right)
    report["metadata_changes"] = sorted(
        name for name in left_meta.keys() | right_meta.keys()
        if left_meta.get(name) != right_meta.get(name)
    )
    report["header_rule_counts"] = {"before": header_count(left), "after": header_count(right)}
    if max(report["header_rule_counts"].values()) >= 90:
        report["warnings"].append("_headers rule count near or above 100")
    report["control_file_changes"] = [name for name in ("_headers", "_redirects") if name in changed]
    report["passed"] = not (report["unexplained"] or report["leaks"] or report["errors"])
    write_json(out / "report.json", report)
    lines = ["# Identity dist comparison", "", "PASS" if report["passed"] else "FAIL", "",
             f"Files: {len(left)} before, {len(right)} after.", "",
             f"Header rules: {report['header_rule_counts']}", ""]
    for label in ("added", "removed", "byte_changes", "json_byte_changes", "json_value_changes",
                  "bundle_changes", "metadata_changes", "control_file_changes", "leaks",
                  "unexplained", "errors", "warnings"):
        lines += [f"## {label}", ""]
        lines += [f"- {json.dumps(value, ensure_ascii=False)}" for value in report[label]] or ["None."]
        lines.append("")
    (out / "report.md").write_text("\n".join(lines))
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path)
    parser.add_argument("--after", type=Path)
    parser.add_argument("--base", help="reserved for B2: pinned base commit")
    parser.add_argument("--head", help="reserved for B2: pinned head commit")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--allow", type=Path)
    args = parser.parse_args(argv)
    if args.base or args.head:
        parser.error("--base/--head build mode is reserved for card B2; use --before/--after")
    if not args.before or not args.after:
        parser.error("--before and --after are required")
    try:
        report = compare(args.before, args.after, args.out, args.allow)
    except (ValueError, OSError) as error:
        write_json(args.out / "report.json", {"passed": False, "errors": [str(error)]})
        (args.out / "report.md").write_text(f"# Identity dist comparison\n\nFAIL: {error}\n")
        print(f"FAIL: {error}")
        return 1
    print(f"{'PASS' if report['passed'] else 'FAIL'}: {len(report['unexplained'])} unexplained "
          f"differences, {len(report['leaks'])} identity leaks; report: {args.out}")
    return int(not report["passed"])


if __name__ == "__main__":
    raise SystemExit(main())
