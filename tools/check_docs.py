"""Check documentation references offline. Run with ``python -m tools.check_docs``.

Code paths are repository-relative; bare filenames are shorthand for repo files.
Markdown links are relative to the document containing them. The allowlist uses
exact ``doc:reference`` entries; full-line # comments and blank lines are ignored.
"""

from __future__ import annotations

import fnmatch
import html
import os
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
REPO_DIRS = {
    "pipeline", "web", "data", "scripts", "docs", "workers", "tools", "tests",
    ".github", ".claude", "vendor", "pdf-source", "node_modules",
}
# Untracked by design: 1Password mounts, build output, local agent config.
LOCAL_ONLY = {
    "web/.env", ".dev.vars", "web/dist", "web/dist-e2e", ".venv", "build",
    ".claude/worktrees", ".claude/settings.local.json",
}
FENCE = re.compile(r"^\s{0,3}(`{3,}|~{3,})(.*)$")
INLINE = re.compile(r"(`+)(?!`)(.+?)(?<!`)\1(?!`)")
TOKEN = re.compile(r'''[^\s`"'(),;|=&]+''')
COMMAND = re.compile(r"(?<![\w/.-])(?:uv\s+run\s+)?noh\s+([^\s`\"';|&]+)")
LINK = re.compile(r"(?<!!)\[[^\]\n]*\]\(\s*(<?[^\s)]+>?)" r'(?:\s+["\'][^\n]*?["\'])?\s*\)')


def ignored(reference: str) -> bool:
    return (
        any(marker in reference for marker in ("<", ">", "…", "...", "{", "}"))
        or bool(urlsplit(reference).scheme)
        or any(part in {"vendor", "node_modules"} for part in Path(reference).parts)
    )


def markdown_lines(text: str):
    """Yield line number, text, and context; fenced content is never inline code."""
    fence = ""
    language = ""
    for number, line in enumerate(text.splitlines(), 1):
        match = FENCE.match(line)
        if match:
            marker, info = match.groups()
            if not fence:
                fence, language = marker, info.strip().lower()
                yield number, "", "fence"
                continue
            if marker[0] == fence[0] and len(marker) >= len(fence) and not info.strip():
                fence = ""
                yield number, "", "fence"
                continue
        yield number, line, ("bash" if language == "bash" else "fence") if fence else "text"


def heading_slugs(text: str) -> set[str]:
    """GitHub heading IDs: punctuation removed, spaces hyphenated, duplicates numbered."""
    slugs: set[str] = set()
    previous = ""
    for _, line, context in markdown_lines(text):
        if context != "text":
            previous = ""
            continue
        heading = re.match(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", line)
        title = heading.group(1) if heading else ""
        if not title and re.fullmatch(r" {0,3}(?:=+|-+)\s*", line) and previous.strip():
            title = previous.strip()
        previous = line
        if not title:
            continue
        title = re.sub(r"\[([^]]+)\]\([^)]*\)", r"\1", title)
        # Emphasis markers disappear when rendered; code-span underscores stay.
        emphasis = r"(?<!\w)(_{1,2})(?=\S)(.+?)(?<=\S)\1(?!\w)"
        parts = []
        end = 0
        for span in INLINE.finditer(title):
            parts.append(re.sub(emphasis, r"\2", title[end:span.start()]))
            parts.append(span.group(2))
            end = span.end()
        parts.append(re.sub(emphasis, r"\2", title[end:]))
        title = html.unescape(re.sub(r"<[^>]*>", "", "".join(parts))).lower()
        slug = "".join(
            char for char in title
            if char in "-_ " or unicodedata.category(char)[0] not in {"P", "S", "C"}
        ).replace(" ", "-")
        candidate = slug
        suffix = 0
        while candidate in slugs:
            suffix += 1
            candidate = f"{slug}-{suffix}"
        slugs.add(candidate)
    return slugs


def code_references(code: str, roots: set[str]):
    for match in COMMAND.finditer(code):
        command = match.group(1).rstrip(".,:")
        if not ignored(command) and re.fullmatch(r"[a-z][a-z0-9-]*", command):
            yield "command", f"noh {command}"
    for match in TOKEN.finditer(code):
        token = match.group().rstrip(".:")
        # Normalize annotations before URL detection (foo.py:12 is not a scheme).
        token = re.sub(r":\d+(?:[-:]\d+)*$", "", token).removeprefix("./")
        if ignored(token) or token.startswith(("/", "~", "-", "$", "#")):
            continue
        first = token.split("/", 1)[0]
        if "/" in token:
            if first in roots:
                yield "path", token
        elif token in roots:
            # Bare file names (a4.pdf, index.html) are usually build outputs named
            # in prose, not repo paths; only rooted paths are checked.
            yield "path", token


def check_docs(root: Path = ROOT) -> list[str]:
    """Return unsuppressed diagnostics in document and line order."""
    root = root.resolve()
    cli = root / "pipeline/cli.py"
    commands = set(re.findall(r'''\.add_parser\(\s*["']([^"']+)["']''', cli.read_text()))
    roots = REPO_DIRS | {path.name for path in root.iterdir()}
    allow_file = root / "tools/check_docs_allow.txt"
    allowed = {
        line.strip() for line in allow_file.read_text().splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    } if allow_file.exists() else set()
    documents = [root / name for name in ("README.md", "AGENTS.md", "CLAUDE.md")]
    documents += sorted((root / "docs").glob("*.md"))
    # Index names, not contents, for shorthand such as `corrections.yml`. Pruning
    # dependency and generated trees keeps the check fast on developer machines.
    filenames: set[str] = set()
    for _, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in {
            ".git", ".venv", "node_modules", "vendor", "__pycache__", ".pytest_cache",
        }]
        filenames.update(files)
    problems = []
    slug_cache: dict[Path, set[str]] = {}
    for doc in documents:
        if not doc.is_file():
            continue
        name = doc.relative_to(root).as_posix()
        for number, line, context in markdown_lines(doc.read_text()):
            references = []
            if context == "bash":
                references.extend(code_references(line, roots))
            elif context == "text":
                for span in INLINE.finditer(line):
                    references.extend(code_references(span.group(2), roots))
                prose = INLINE.sub("", line)
                references.extend(("link", match.group(1)) for match in LINK.finditer(prose))
            seen = set()
            for kind, reference in references:
                if (kind, reference) in seen or f"{name}:{reference}" in allowed:
                    continue
                seen.add((kind, reference))
                problem = ""
                if kind == "command":
                    if reference.split()[1] not in commands:
                        problem = "unknown noh subcommand"
                elif kind == "path":
                    if any(reference.rstrip("/") == local or reference.startswith(local + "/")
                           for local in LOCAL_ONLY) or (root / reference).exists():
                        pass  # Astro routes such as [key].astro are literal paths
                    elif any(char in reference for char in "*?["):
                        pattern = reference + "/*" if reference.endswith("/**") else reference
                        matches = (
                            any(fnmatch.fnmatchcase(name, pattern) for name in filenames)
                            if "/" not in reference else
                            any(path.is_file() and not ignored(path.relative_to(root).as_posix())
                                for path in root.glob(pattern))
                        )
                        if not matches:
                            problem = "glob matches no files"
                    elif not (root / reference).exists() and not (
                        "/" not in reference and reference in filenames
                    ):
                        problem = "path does not exist"
                else:
                    if ignored(reference) or reference.startswith("/"):
                        continue
                    parsed = urlsplit(reference)
                    if parsed.path and not parsed.path.lower().endswith(".md"):
                        continue
                    target = (doc.parent / unquote(parsed.path)).resolve() if parsed.path else doc
                    if not target.is_relative_to(root):
                        continue
                    if ignored(target.relative_to(root).as_posix()):
                        continue
                    if not target.is_file():
                        problem = "linked document does not exist"
                    elif parsed.fragment:
                        if target not in slug_cache:
                            slug_cache[target] = heading_slugs(target.read_text())
                        if unquote(parsed.fragment) not in slug_cache[target]:
                            problem = "anchor does not exist"
                if problem:
                    problems.append(f"{name}:{number}: {reference}: {problem}")
    return problems


def main(root: Path = ROOT) -> int:
    problems = check_docs(root)
    if problems:
        print("\n".join(problems))
        return 1
    print("Documentation references OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
