"""What a LilyPond file may not contain, checked before LilyPond ever reads it.

LilyPond runs Scheme written inside a .ly file (`#(...)`, `$(...)`, `#name`),
with the full power of Guile: it could read files, run programs or open
connections. Some LilyPond commands read or write files too (`\\verbatim-file`,
`\\image`, `\\bookOutputName`). The upstream transcriptions and editors' edits
are input we do not control, so every file is checked for these, and for
`\\include` of anything but our own include files and LilyPond's own.

Only Scheme is searched for denied procedures, never the lyrics: Latin has
"exit" and "accepit". This is a denylist, so not the only defence: CI runs
LilyPond with no secrets and no network (design §3).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

# Scheme procedures that reach outside the music: the system, files, ports,
# the network, loading or evaluating code, the environment, LilyPond's options.
DENIED = frozenset({
    "system", "system*", "ly:system", "primitive-fork", "execl", "execlp", "execle",
    "open", "open-file", "open-input-file", "open-output-file", "open-input-pipe", "open-output-pipe",
    "open-pipe", "open-pipe*", "call-with-input-file", "call-with-output-file", "with-input-from-file",
    "with-output-to-file", "delete-file", "rename-file", "copy-file", "mkdir", "rmdir", "chdir", "opendir",
    "readdir", "chmod", "chown", "link", "symlink", "utime", "truncate-file", "port->fdes", "fdopen",
    "load", "load-from-path", "primitive-load", "primitive-load-path", "load-extension", "dynamic-link",
    "dynamic-call", "eval", "eval-string", "primitive-eval", "compile", "read-and-eval", "local-eval",
    "ly:parser-include-string", "ly:parser-parse-string", "ly:parse-file", "ly:parse-string-expression",
    "ly:gulp-file", "ly:gulp-file-utf8", "ly:set-option", "ly:add-option", "ly:command-line-options",
    "ly:get-option", "ly:output-file-name",
    "getenv", "setenv", "putenv", "unsetenv", "environ",
    "socket", "connect", "bind", "listen", "accept", "gethostbyname", "getaddrinfo", "http-get", "http-request",
    "exit", "primitive-exit", "kill", "use-modules", "resolve-module", "module-ref", "the-environment",
    "current-module", "interaction-environment", "debug-enable",
})
#: LilyPond commands that read or write files.
DENIED_COMMANDS = frozenset({"verbatim-file", "epsfile", "image", "bookOutputName", "bookOutputSuffix"})
#: LilyPond's own files that transcriptions may include.
LILYPOND_INCLUDES = frozenset({"gregorian.ly", "english.ly", "deutsch.ly", "italiano.ly"})

_IDENT = r"[A-Za-z!$%&*/:<=>?^_~+.@-][A-Za-z0-9!$%&*/:<=>?^_~+.@-]*"
_TOKEN = re.compile(rf"(?<![A-Za-z0-9!$%&*/:<=>?^_~+.@'-])({_IDENT})")
_INCLUDE = re.compile(r"\\include\s+\"([^\"]*)\"")
_COMMAND = re.compile(r"\\([A-Za-z][A-Za-z-]*)")
_DIRECT = re.compile(rf"[#$]\s*({_IDENT})")


@dataclass(frozen=True)
class Problem:
    line: int
    message: str

    def __str__(self) -> str:
        return f"line {self.line}: {self.message}"


def _blank(text: str, start: int, end: int) -> str:
    return text[:start] + re.sub(r"[^\n]", " ", text[start:end]) + text[end:]


def _strip_comments(text: str) -> str:
    """LilyPond comments (%{ %} and %) blanked, newlines kept so lines still
    count; a % inside a "string" is not a comment."""
    out: list[str] = []
    i, n = 0, len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "%":
            if text.startswith("%{", i):
                end = text.find("%}", i + 2)
                end = n if end < 0 else end + 2
            else:
                end = text.find("\n", i)
                end = n if end < 0 else end
            out.append(re.sub(r"[^\n]", " ", text[i:end]))
            i = end
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _blank_strings(text: str) -> str:
    """Every "string"'s contents blanked (quotes and newlines kept): text in a
    string is never code, and a ( in one must not unbalance a region."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        if text[i] == '"':
            j = i + 1
            while j < n and text[j] != '"':
                step = 2 if text[j] == "\\" else 1
                for k in range(j, min(j + step, n)):
                    if out[k] != "\n":
                        out[k] = " "
                j += step
            i = j + 1
            continue
        i += 1
    return "".join(out)


def scheme_regions(text: str) -> list[tuple[int, int]]:
    """(start, end) of every #( ... ) and $( ... ): balanced parentheses, with
    Scheme ; comments respected, in text whose strings are blanked. Embedded LilyPond (#{ ... #})
    inside stays in the region, so anything in it is searched too."""
    regions: list[tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n - 1:
        j = i + 1
        while j < n and text[j].isspace():
            j += 1
        if text[i] in "#$" and j < n and text[j] == "(":
            start, depth = i, 0
            while j < n:
                ch = text[j]
                if ch == ";":
                    while j < n and text[j] != "\n":
                        j += 1
                    continue
                elif ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            regions.append((start, min(j + 1, n)))
            i = j + 1
            continue
        i += 1
    return regions


def check(text: str, allowed_includes: frozenset[str]) -> list[Problem]:
    """Every problem in a LilyPond source, with its line; empty when it may be read."""
    clean = _strip_comments(text)
    line_at = [0]
    for m in re.finditer("\n", clean):
        line_at.append(m.end())

    def line_of(offset: int) -> int:
        lo, hi = 0, len(line_at) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_at[mid] <= offset:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1

    code = _blank_strings(clean)
    problems: list[Problem] = []
    for m in _COMMAND.finditer(code):
        if m.group(1) == "include":
            literal = _INCLUDE.match(clean, m.start())
            if not literal:
                problems.append(Problem(line_of(m.start()), "\\include must name a literal allowlisted file"))
            else:
                name = literal.group(1)
                if name not in allowed_includes and name not in LILYPOND_INCLUDES:
                    problems.append(Problem(line_of(m.start()), f'\\include "{name}" is not one of our include files '
                                                            f"({', '.join(sorted(allowed_includes))}) or LilyPond's own"))
        if m.group(1) in DENIED_COMMANDS:
            problems.append(Problem(line_of(m.start()), f"\\{m.group(1)} reads or writes files, so it is not allowed"))
    for m in _DIRECT.finditer(code):
        if m.group(1) in DENIED:
            problems.append(Problem(line_of(m.start()), f"Scheme `{m.group(1)}` reaches outside the music, "
                                                        "so it is not allowed"))
    for start, end in scheme_regions(code):
        for m in _TOKEN.finditer(code, start + 2, end):
            if m.group(1) in DENIED:
                problems.append(Problem(line_of(m.start()), f"Scheme `{m.group(1)}` reaches outside the music, "
                                                            "so it is not allowed"))
    return sorted(set(problems), key=lambda p: (p.line, p.message))


def check_file(path: Path, allowed_includes: frozenset[str]) -> list[Problem]:
    return check(path.read_text(encoding="utf-8"), allowed_includes)


__all__ = ["DENIED", "DENIED_COMMANDS", "LILYPOND_INCLUDES", "Problem", "check", "check_file", "scheme_regions"]
