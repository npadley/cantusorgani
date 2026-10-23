"""Capture an append-only historical address inventory and resolve it locally.

Manifest SHA-256 hashes UTF-8 lines of ``relative-path<TAB>file-sha256<LF>``.
URLs are entity-decoded by HTMLParser and percent-decoded once at capture.
Queries are retained as contracts; local resolution checks their static page only.
Schema 2 groups linked fragments/queries by path; unlinked IDs are checked by
compare_identity_dist HTML bytes. --anchors all writes scratch output only.
Capture unions inventories; to change capture policy, recapture the original trees.
Exceptions default to legacy-address-exceptions.json beside the inventory and
must match failing addresses exactly; resolved exceptions fail verification.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit
from xml.etree import ElementTree

ORIGIN = "https://cantusorgani.org"


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.anchors = set()
        self.hrefs = []
        self.canonicals = []
        self.robots = []
        self.refresh = None
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id"):
            self.anchors.add(attrs["id"])
        if tag == "a" and attrs.get("name"):
            self.anchors.add(attrs["name"])
        if attrs.get("href"):
            self.hrefs.append(attrs["href"])
        if tag == "link" and "canonical" in attrs.get("rel", "").lower().split():
            self.canonicals.append(attrs.get("href", ""))
        if tag == "meta":
            name = attrs.get("name", "").lower()
            if name in {"robots", "googlebot", "bingbot"}:
                self.robots.append([name, attrs.get("content", "")])
            if attrs.get("http-equiv", "").lower() == "refresh":
                match = re.search(r";\s*url\s*=\s*(.*)", attrs.get("content", ""), re.IGNORECASE)
                if match:
                    self.refresh = match[1].strip().strip("\"'")

    @property
    def policy(self):
        return {"canonicals": sorted(self.canonicals), "robots": sorted(self.robots)}


def files(dist):
    if not dist.is_dir():
        raise ValueError(f"Dist directory does not exist: {dist}")
    return {p.relative_to(dist).as_posix(): p for p in sorted(dist.rglob("*")) if p.is_file()}


def route(path):
    if path == "index.html":
        return "/"
    if path.endswith("/index.html"):
        return "/" + path[:-10]
    return "/" + path


def internal(value, base="/", hosts=None, decode=True):
    parts = urlsplit(urljoin(ORIGIN + base, value))
    if parts.scheme not in {"http", "https"} or parts.netloc not in (
        hosts or {urlsplit(ORIGIN).netloc}
    ):
        return None
    address = urlunsplit(("", "", parts.path or "/", parts.query, parts.fragment))
    return unquote(address) if decode else address


def sitemap_urls(entries):
    urls = set()
    for name, path in entries.items():
        if Path(name).match("sitemap*.xml"):
            root = ElementTree.fromstring(path.read_bytes())
            urls.update(node.text.strip() for node in root.iter()
                        if node.tag.rsplit("}", 1)[-1] == "loc" and node.text)
    return urls


def redirects(dist, *, static_only=True):
    result = []
    path = dist / "_redirects"
    if path.exists():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            line = line.split("#", 1)[0].strip() if line.lstrip().startswith("#") else line.strip()
            if not line:
                continue
            fields = line.split()
            if len(fields) not in {2, 3}:
                raise ValueError(f"Malformed _redirects line {number}: {line}")
            source, target = fields[:2]
            status = fields[2] if len(fields) == 3 else "302"
            if not re.fullmatch(r"[23]\d\d!?", status):
                raise ValueError(f"Invalid redirect status: {line}")
            if static_only and ("*" in source or re.search(r"(^|/):", source)
                                or re.search(r"(^|/):", target)):
                raise ValueError(f"Dynamic redirect unsupported: {line}")
            result.append({"from": source, "to": target, "status": status})
    return result


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def build_asset(name):
    """Build namespaces and hash-bearing filenames are not stable addresses."""
    return (name.startswith(("_astro/", "pagefind/"))
            or bool(re.search(r"\.[A-Za-z0-9_-]{8,}\.", Path(name).name))
            or bool(re.search(r"[-_][0-9a-fA-F]{8,}(?=\.)", Path(name).name)))


# Bookmarked state contracts (§8), including state normally added by client JS.
QUERY_CONTRACTS = {
    "/calendar/": ["date=2026-10-22"],
    "/calendar/ordinary-form/": [
        "date=2026-10-22&epiphany=jan6&ascension=thursday&corpusChristi=thursday",
        "date=2026-10-22&epiphany=sunday&ascension=sunday&corpusChristi=sunday"],
    "/corrections/": ["target=piece:dominica-i-adventus",
                      "target=typeset:kyriale/ix&seen=" + "0" * 32,
                      "piece=dominica-i-adventus&field=title"],
}


def addresses(inventory):
    result = set(inventory.get("resources", []))
    for row in inventory["routes"]:
        path = row["path"]
        result.add(path)
        result.update(path + "#" + fragment for fragment in row["fragments"])
        result.update(path + "?" + query for query in row["queries"])
    for url in inventory["sitemap_urls"]:
        if target := internal(url):
            result.add(target)
    for rule in inventory["redirects"]:
        for key in ("from", "to"):
            if target := internal(rule[key]):
                result.add(target)
    return sorted(result)


def capture(dists, out, commit=None, anchors="linked"):
    if anchors == "all" and (out.name == "legacy-addresses.json"
                             or out.resolve().is_relative_to(Path(__file__).resolve().parents[1])):
        raise ValueError("--anchors all is scratch-only; choose a different output filename")
    inventory = json.loads(out.read_text()) if out.exists() else {"schema_version": 2}
    if inventory["schema_version"] != 2:
        raise ValueError("Recapture schema 1 from its original dist trees into a new inventory")
    if inventory.get("anchor_mode", anchors) != anchors:
        raise ValueError("Cannot union different anchor modes")
    rows = {row["path"]: row for row in inventory.get("routes", [])}
    collected = {key: list(inventory.get(key, [])) for key in
                 ("sitemap_urls", "redirects", "origins", "resources", "pages")}

    def row(path):
        return rows.setdefault(path, {"path": path, "fragments": [], "queries": []})

    def link(target):
        parts = urlsplit(target)
        record = row(parts.path)
        if parts.query:
            record["queries"].append(parts.query + ("#" + parts.fragment if parts.fragment else ""))
        elif parts.fragment:
            record["fragments"].append(parts.fragment)

    for dist in dists:
        entries = files(dist)
        urls = sitemap_urls(entries)
        hosts = {urlsplit(ORIGIN).netloc} | {urlsplit(url).netloc for url in urls}
        manifest = "".join(f"{name}\t{hashlib.sha256(p.read_bytes()).hexdigest()}\n"
                           for name, p in entries.items())
        collected["origins"].append({
            "dist": str(dist.resolve()), "file_count": len(entries),
            "manifest_sha256": hashlib.sha256(manifest.encode()).hexdigest(),
            "commit": commit or "unknown"})
        collected["sitemap_urls"].extend(urls)
        collected["redirects"].extend(redirects(dist, static_only=False))
        for name, path in entries.items():
            if build_asset(name):
                continue
            address = route(name)
            if not name.endswith(".html"):
                if not name.startswith("_"):
                    collected["resources"].append(address)
                continue
            row(address)
            page = Page(path.read_text())
            collected["pages"].append({"path": address, **page.policy})
            if anchors == "all":
                row(address)["fragments"].extend(page.anchors)
            for href in page.hrefs:
                target = internal(href, address, hosts)
                if (target and not build_asset(urlsplit(target).path.lstrip("/"))
                        and (urlsplit(target).query or urlsplit(target).fragment)):
                    link(target)
        for address, queries in QUERY_CONTRACTS.items():
            if address in rows:
                row(address)["queries"].extend(queries)
        for address in list(rows):
            if address.startswith("/day/"):
                row(address)["queries"].append("date=2026-10-22")
            if address.startswith("/ordinary-form/"):
                row(address)["queries"].extend(["cycle=" + c for c in ("A", "B", "C")])
                row(address)["queries"].extend("season=" + season for season in
                    ("advent", "christmas", "lent", "triduum", "easter", "ordinary"))
    inventory.update(schema_version=2, anchor_mode=anchors)
    for record in rows.values():
        for key in ("fragments", "queries"):
            record[key] = sorted(set(record[key]))
    inventory["routes"] = [rows[path] for path in sorted(rows)]
    for key, values in collected.items():
        unique = {json.dumps(value, sort_keys=True, ensure_ascii=False): value for value in values}
        inventory[key] = [unique[key] for key in sorted(unique)]
    # Compact deterministic JSON keeps the tracked union below the repository budget.
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(inventory, sort_keys=True, ensure_ascii=False,
                              separators=(",", ":")) + "\n")
    return inventory


class Resolver:
    def __init__(self, dist):
        self.dist = dist.resolve()
        self.rules = redirects(dist)
        self.pages = {}

    def page(self, path):
        if path not in self.pages:
            self.pages[path] = Page(path.read_text())
        return self.pages[path]

    def resolve(self, address):
        seen = set()
        for hop in range(6):
            if address in seen:
                raise ValueError("redirect loop")
            seen.add(address)
            parts = urlsplit(address)
            target = next((r["to"] for r in self.rules if r["from"] == parts.path), None)
            if target is None:
                path = (self.dist / parts.path.lstrip("/")).resolve()
                if not path.is_relative_to(self.dist):
                    raise ValueError("path outside dist")
                if path.is_dir():
                    path /= "index.html"
                if not path.is_file():
                    raise ValueError(f"missing file: {parts.path}")
                page = self.page(path) if path.suffix == ".html" else None
                target = page.refresh if page else None
                if target is None:
                    if parts.fragment and (page is None or parts.fragment not in page.anchors):
                        raise ValueError(f"missing fragment: {parts.fragment}")
                    return path, page
            if hop == 5:
                raise ValueError("redirect chain exceeds 5 hops")
            destination = internal(target, parts.path)
            if destination is None:
                raise ValueError(f"external redirect cannot be verified: {target}")
            if "#" not in target and parts.fragment:
                destination += "#" + parts.fragment
            address = destination
        raise AssertionError("unreachable")


def verify(inventory, dist, exceptions=None):
    resolver = Resolver(dist)
    failures = []
    exceptions = exceptions or []
    allowed = {}
    for entry in exceptions:
        if (not isinstance(entry, dict) or set(entry) != {"address", "reason"}
                or not isinstance(entry["address"], str)
                or not isinstance(entry["reason"], str) or not entry["reason"].strip()
                or entry["address"] in allowed):
            raise ValueError("Exceptions require unique addresses and nonempty reasons")
        allowed[entry["address"]] = entry["reason"]
    broken = set()
    for address in addresses(inventory):
        try:
            resolver.resolve(address)
        except ValueError as error:
            broken.add(address)
            if address not in allowed:
                failures.append(f"{address}: {error}")
    for address in sorted(allowed.keys() - broken):
        failures.append(f"{address}: exception now resolves or is absent; remove it")
    for baseline in inventory.get("pages", []):
        # Redirect pages have their own policy; check the actual file, not its destination.
        path = dist / baseline["path"].lstrip("/")
        if path.is_dir():
            path /= "index.html"
        if path.is_file():
            policy = resolver.page(path).policy
            if policy != {key: baseline[key] for key in ("canonicals", "robots")}:
                failures.append(f"{baseline['path']}: canonical/robots policy changed")
    return failures


def summary(inventory):
    return (f"{len(inventory['routes'])} routes, "
            f"{sum(len(r['fragments']) for r in inventory['routes'])} linked fragments, "
            f"{sum(len(r['queries']) for r in inventory['routes'])} queries, "
            f"{len(inventory['sitemap_urls'])} sitemap URLs, "
            f"{len(inventory['redirects'])} redirects, "
            f"{len(inventory['resources'])} resources, {len(addresses(inventory))} addresses")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--capture", action="store_true")
    mode.add_argument("--inventory", type=Path)
    parser.add_argument("--dist", type=Path, action="append", required=True)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--commit")
    parser.add_argument("--anchors", choices=("linked", "all"), default="linked",
                        help="all captures IDs too, for untracked scratch output only")
    parser.add_argument("--exceptions", type=Path,
                        help="defaults to legacy-address-exceptions.json beside the inventory")
    args = parser.parse_args(argv)
    try:
        if args.capture:
            if not args.out:
                parser.error("--capture requires --out")
            inventory = capture(args.dist, args.out, args.commit, args.anchors)
            print(summary(inventory))
            return 0
        if len(args.dist) != 1:
            parser.error("--inventory requires exactly one --dist")
        inventory = json.loads(args.inventory.read_text())
        exception_path = args.exceptions or args.inventory.with_name("legacy-address-exceptions.json")
        exceptions = json.loads(exception_path.read_text()) if exception_path.exists() else []
        failures = verify(inventory, args.dist[0], exceptions)
        print(summary(inventory))
        for failure in failures:
            print(f"FAIL: {failure}")
        print(f"{len(failures)} failures")
        return int(bool(failures))
    except (ValueError, OSError, ElementTree.ParseError) as error:
        print(f"FAIL: {error}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
