"""Compare built identity-migration artifacts without normalising reader bytes.

Accept existing --before/--after trees or build pinned --base/--head revisions.
Allow entries name a changed _astro bundle path (old or new) and a review reason.
"""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time
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
              "json_value_changes": [], "json_field_changes": {}, "file_differences": {},
              "bundle_changes": [], "reference_only_html": [], "leaks": [],
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
            detail = {"before_sha256": hashlib.sha256(a).hexdigest(),
                      "after_sha256": hashlib.sha256(b).hexdigest()}
            try:
                detail["diff"] = "".join(difflib.unified_diff(
                    a.decode("utf-8").splitlines(keepends=True),
                    b.decode("utf-8").splitlines(keepends=True),
                    fromfile="before/" + name, tofile="after/" + name))
            except UnicodeError:
                detail["before_bytes"], detail["after_bytes"] = len(a), len(b)
            report["file_differences"][name] = detail
            if name.endswith(".html"):
                report["html_changes"].append(name)
            if name.endswith(".json"):
                report["json_byte_changes"].append(name)
        if name.endswith(".json"):
            try:
                if json.loads(a) != json.loads(b):
                    report["json_value_changes"].append(name)
                    report["json_field_changes"][name] = json_differences(json.loads(a), json.loads(b))
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
    # Normalize only explicitly allowed basenames, using one token per logical
    # bundle on both sides. Full byte equality still governs the HTML exception.
    basenames = {Path(path).name.encode(): path for path in sorted(allowed)}
    reference_pattern = (re.compile(
        rb"(?<![A-Za-z0-9_.-])(?:" + b"|".join(re.escape(base) for base in basenames)
        + rb")(?![A-Za-z0-9_.-])") if basenames else None)
    for name in report["html_changes"]:
        if reference_pattern is None:
            continue
        involved = set()

        def normalize(match, involved=involved):
            path = basenames[match[0]]
            involved.add(path)
            return ("@@" + bundle_key(path) + "@@").encode()

        before_bytes = reference_pattern.sub(normalize, left[name].read_bytes())
        after_bytes = reference_pattern.sub(normalize, right[name].read_bytes())
        if involved and before_bytes == after_bytes:
            report["reference_only_html"].append(
                {"path": name, "bundles": sorted(involved)})
            explained.add(name)
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
                  "bundle_changes", "reference_only_html", "metadata_changes", "control_file_changes", "leaks",
                  "unexplained", "errors", "warnings"):
        lines += [f"## {label}", ""]
        lines += [f"- {json.dumps(value, ensure_ascii=False)}" for value in report[label]] or ["None."]
        lines.append("")
    (out / "report.md").write_text("\n".join(lines))
    return report


PUBLIC_KEYS = ("PUBLIC_ASSET_BASE", "PUBLIC_CORRECTIONS_ENDPOINT", "PUBLIC_TURNSTILE_SITE_KEY")
EXPORT_NAMES = ("pdf", "export", "verovio", "mei", "scan", "customize")


def resolve_rev(repo, rev):
    result = subprocess.run(
        ["git", "rev-parse", "--verify", "--end-of-options", rev + "^{commit}"],
        cwd=repo, check=True, capture_output=True, text=True,
    )
    sha = result.stdout.strip()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError(f"Invalid commit SHA for {rev}")
    return sha


def public_defaults(script):
    text = script.read_text()
    result = {}
    for key in PUBLIC_KEYS:
        match = re.search(r'export\s+' + key + r'="\$\{' + key + r':-([^}]+)\}"', text)
        if not match:
            raise ValueError(f"Missing public defaults in {script}: {key}")
        result[key] = match[1]
    return result


def export_bundle(name):
    return bundle_key(name) is not None and any(word in name.lower() for word in EXPORT_NAMES)


def json_differences(before, after, path=""):
    """JSON pointers identify changed values; array order remains significant."""
    if type(before) is not type(after):
        return [{"field": path or "/", "before": before, "after": after}]
    if isinstance(before, dict):
        changes = []
        for key in sorted(before.keys() | after.keys()):
            pointer = path + "/" + key.replace("~", "~0").replace("/", "~1")
            if key not in before or key not in after:
                changes.append({"field": pointer, "before": before.get(key),
                                "after": after.get(key),
                                "presence": "added" if key in after else "removed"})
            else:
                changes.extend(json_differences(before[key], after[key], pointer))
        return changes
    if isinstance(before, list):
        changes = []
        for i in range(max(len(before), len(after))):
            pointer = path + "/" + str(i)
            if i >= min(len(before), len(after)):
                changes.append({"field": pointer, "before": before[i] if i < len(before) else None,
                                "after": after[i] if i < len(after) else None,
                                "presence": "added" if i >= len(before) else "removed"})
            else:
                changes.extend(json_differences(before[i], after[i], pointer))
        return changes
    return [] if before == after else [{"field": path or "/", "before": before, "after": after}]


class BuildRunner:
    """Record every subprocess, including failed offline installs, in durable logs."""

    def __init__(self, out):
        self.out = out
        self.steps = []

    def run(self, command, cwd, env=None, *, optional=False):
        log = self.out / "logs" / f"{len(self.steps):03d}.log"
        log.parent.mkdir(parents=True, exist_ok=True)
        step = {"command": list(command), "cwd": str(cwd), "log": str(log)}
        started = time.monotonic()
        try:
            with log.open("w") as stream:
                result = subprocess.run(command, cwd=cwd, env=env, stdout=stream,
                                        stderr=subprocess.STDOUT, check=False)
            step["returncode"] = result.returncode
        except OSError as error:
            step["returncode"] = -1
            log.write_text(str(error))
        finally:
            step["seconds"] = round(time.monotonic() - started, 6)
            self.steps.append(step)
        if step["returncode"]:
            if optional:
                return None
            raise ValueError(f"Command failed ({step['returncode']}): {shlex.join(command)}; "
                             f"cwd: {cwd}; log: {log}")
        return log.read_text().strip()


def matched_build(args):
    repo = Path(__file__).resolve().parents[1]
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    runner = BuildRunner(out)
    started = time.monotonic()
    provenance = {"shas": {}, "versions": {}, "steps": runner.steps,
                  "allow_used": args.allow is not None, "install_modes": {}, "input_hashes": {},
                  "comparison_seconds": {},
                  "skipped_ci_checks": [("typeset-check --remote: network validation, not a build "
                                        "prerequisite; matched builds make no remote checks"),
                                        "Playwright installation: suites are a separate follow-up"]}
    report = {"passed": False, "errors": [], "provenance": provenance,
              "export_path_bundles": None, "verify_export_pdf_required": None,
              "export_follow_up": (
                  f"In {out / 'head/web'} run: pnpm build:e2e && pnpm test:e2e:export. "
                  "If export-path bundles changed, run verify-export-pdf on both trees for the §11 "
                  "fixtures: dominica-i-adventus, sabbato-temporum-adventus, Kyriale IX, OF "
                  "mixed-lender, dated I/II Vespers, standalone hymn and scan-only music.")}

    # Only pass local tool/cache settings, never application secrets or fixture overrides.
    env = {key: value for key, value in os.environ.items()
           if key in {"PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "UV_CACHE_DIR",
                      "XDG_CACHE_HOME", "PNPM_HOME"}}
    env.update(CI="true")
    try:
        for side, rev in (("base", args.base), ("head", args.head)):
            step = {"command": ["git", "rev-parse", "--verify", "--end-of-options",
                                rev + "^{commit}"], "cwd": str(repo), "returncode": 1}
            resolving = time.monotonic()
            try:
                provenance["shas"][side] = resolve_rev(repo, rev)
                step["returncode"] = 0
            finally:
                step["seconds"] = round(time.monotonic() - resolving, 6)
                runner.steps.append(step)
        env.update(public_defaults(repo / "scripts/check.sh"))
        provenance["defaults_source_sha256"] = hashlib.sha256(
            (repo / "scripts/check.sh").read_bytes()).hexdigest()
        provenance["public_defaults"] = {key: env[key] for key in PUBLIC_KEYS}
        for program in ("node", "pnpm", "uv"):
            provenance["versions"][program] = runner.run([program, "--version"], repo, env)

        def build(side, sha):
            tree = out / side
            # Refuse existing trees: reusing dependencies/output would invalidate the proof.
            tree.mkdir()
            names = runner.run(["git", "ls-tree", "-r", "--name-only", sha], repo, env)
            if any(Path(name).name in {".env", ".dev.vars"} for name in (names or "").splitlines()):
                raise ValueError("Refusing to archive tracked environment files")
            runner.run(["bash", "-o", "pipefail", "-c",
                        f"git archive {sha} | tar -x -C {shlex.quote(str(tree))}"], repo, env)
            for name in ("uv.lock", "pyproject.toml", "web/pnpm-lock.yaml", "web/package.json",
                         "scripts/check.sh", ".github/workflows/site.yml"):
                path = tree / name
                if path.is_file():
                    provenance["input_hashes"].setdefault(side, {})[name] = (
                        hashlib.sha256(path.read_bytes()).hexdigest())
            if runner.run(["pnpm", "install", "--frozen-lockfile", "--offline"], tree / "web",
                          env, optional=True) is None:
                provenance["install_modes"][side] = "online"
                runner.run(["pnpm", "install", "--frozen-lockfile"], tree / "web", env)
            else:
                provenance["install_modes"][side] = "offline"
            runner.run(["uv", "sync", "--frozen"], tree, env)
            runner.run(["uv", "run", "noh", "typeset-mei-stale", "--json", "--out",
                        "build/mei/stale/stale.json"], tree, env)
            runner.run(["pnpm", "build"], tree / "web", env)
            return tree

        base = build("base", provenance["shas"]["base"])
        if args.repeat:
            repeat = build("base-repeat", provenance["shas"]["base"])
            comparing = time.monotonic()
            determinism = compare(base / "web/dist", repeat / "web/dist", out / "determinism")
            stale = compare_stale(base, repeat)
            determinism["stale_mei"] = stale
            determinism["passed"] = determinism["passed"] and not stale["changed"]
            provenance["comparison_seconds"]["repeat"] = round(time.monotonic() - comparing, 6)
            report["determinism"] = determinism
            write_json(out / "determinism/report.json", determinism)
            if not determinism["passed"]:
                report["errors"].append("Baseline repeat differs; see determinism files and fields")
                return report
        head = build("head", provenance["shas"]["head"])
        comparing = time.monotonic()
        comparison = compare(base / "web/dist", head / "web/dist", out, args.allow)
        report.update(comparison)
        report["stale_mei"] = compare_stale(base, head)
        provenance["comparison_seconds"]["head"] = round(time.monotonic() - comparing, 6)
        report["passed"] = report["passed"] and not report["stale_mei"]["changed"]
        inventory = repo / "data/identities/legacy-addresses.json"
        command = [sys.executable, "-m", "tools.check_legacy_addresses", "--inventory",
                   str(inventory), "--exceptions",
                   str(inventory.with_name("legacy-address-exceptions.json")),
                   "--dist", str(head / "web/dist")]
        result = runner.run(command, repo, env, optional=True)
        report["legacy_addresses_passed"] = result is not None
        report["passed"] = report["passed"] and report["legacy_addresses_passed"]
        changed = report["added"] + report["removed"] + report["byte_changes"]
        report["export_path_bundles"] = sorted({name for name in changed if export_bundle(name)})
        report["verify_export_pdf_required"] = bool(report["export_path_bundles"])
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        report["passed"] = False
        report["errors"].append(str(error))
    finally:
        provenance["total_seconds"] = round(time.monotonic() - started, 6)
        write_json(out / "report.json", report)
        (out / "report.md").write_text(
            "# Matched identity builds\n\n" + ("PASS" if report["passed"] else "FAIL") +
            "\n\n```json\n" + json.dumps(report, indent=2, ensure_ascii=False) + "\n```\n")
    return report


def compare_stale(before, after):
    relative = "build/mei/stale/stale.json"
    left, right = before / relative, after / relative
    if not left.exists() or not right.exists():
        raise ValueError(f"Missing stale-MEI report: {left} or {right}")
    return {"path": relative, "changed": left.read_bytes() != right.read_bytes(),
            "fields": json_differences(json.loads(left.read_bytes()), json.loads(right.read_bytes()))}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path)
    parser.add_argument("--after", type=Path)
    parser.add_argument("--base", help="base commit revision")
    parser.add_argument("--head", help="head commit revision")
    parser.add_argument("--repeat", action="store_true", help="check two fresh base builds first")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--allow", type=Path)
    args = parser.parse_args(argv)
    if args.base or args.head:
        if not (args.base and args.head) or args.before or args.after:
            parser.error("use --base and --head together, without --before/--after")
        report = matched_build(args)
        if report.get("export_follow_up"):
            print(report["export_follow_up"])
        print(f"{'PASS' if report['passed'] else 'FAIL'}; report: {args.out / 'report.json'}")
        for error in report["errors"]:
            print(error)
        return int(not report["passed"])
    if not args.before or not args.after or args.repeat:
        parser.error("--before and --after are required; --repeat needs --base/--head")
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
