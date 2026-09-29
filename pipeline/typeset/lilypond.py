"""The pinned LilyPond: installing it, finding it, and running it.

Every render and every check uses the version in data/typeset/lilypond.yml. A
different LilyPond is refused rather than used, since the version is part of
each rendered file's hash and engraving changes between versions.

LilyPond runs Scheme embedded in the files it reads, so it is only ever run on
files that pass pipeline/typeset/source_check.py, and in CI in a job with no
secrets and no network (docs/claudekit/specs/2026-09-28-typesetting-design.md §3).
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from pipeline.volumes import DATA

ROOT = DATA.parent
PIN = DATA / "typeset" / "lilypond.yml"
VENDOR = ROOT / "vendor"
#: Our shared include files; LilyPond finds `\include "noh2.ily"` here.
INCLUDE = DATA / "typeset" / "include"


class LilyPondError(RuntimeError):
    """LilyPond is missing, the wrong version, or failed; the message says what to do."""


@dataclass(frozen=True)
class Pin:
    version: str
    builds: dict[str, dict[str, str]]


def load_pin(path: Path = PIN) -> Pin:
    doc: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8"))
    return Pin(version=str(doc["version"]), builds={str(k): dict(v) for k, v in doc["builds"].items()})


def platform_key(system: str | None = None, machine: str | None = None) -> str:
    """linux-x86_64, darwin-arm64 or darwin-x86_64, as the release names its builds."""
    system = (system or platform.system()).lower()
    machine = (machine or platform.machine()).lower()
    machine = {"amd64": "x86_64", "aarch64": "arm64"}.get(machine, machine)
    return f"{system}-{machine}"


def home(pin: Pin | None = None, vendor: Path = VENDOR) -> Path:
    pin = pin or load_pin()
    return vendor / f"lilypond-{pin.version}"


def install(pin: Pin | None = None, vendor: Path = VENDOR, key: str | None = None) -> Path:
    """Download the pinned build for this machine into vendor/, checked against
    its sha256 before anything is unpacked. Returns the lilypond binary."""
    import urllib.request

    pin = pin or load_pin()
    key = key or platform_key()
    build = pin.builds.get(key)
    if build is None:
        raise LilyPondError(f"no pinned LilyPond build for {key}; data/typeset/lilypond.yml has "
                            f"{', '.join(pin.builds)}")
    binary = home(pin, vendor) / "bin" / "lilypond"
    if binary.exists():
        return binary
    with urllib.request.urlopen(build["url"], timeout=300) as response:
        body = response.read()
    digest = hashlib.sha256(body).hexdigest()
    if digest != build["sha256"]:
        raise LilyPondError(f"{build['url']} has sha256 {digest}, not the pinned {build['sha256']}; "
                            "nothing was unpacked")
    vendor.mkdir(parents=True, exist_ok=True)
    archive = vendor / f"lilypond-{pin.version}-{key}.tar.gz"
    archive.write_bytes(body)
    with tarfile.open(archive) as tar:
        tar.extractall(vendor, filter="data")
    archive.unlink()
    if not binary.exists():
        raise LilyPondError(f"the pinned archive did not contain bin/lilypond under {home(pin, vendor)}")
    return binary


def find(pin: Pin | None = None, vendor: Path = VENDOR) -> Path:
    """The pinned lilypond binary: $NOH_LILYPOND, then vendor/, then PATH.
    Raises, naming the fix, if none is the pinned version."""
    pin = pin or load_pin()
    candidates = [os.environ.get("NOH_LILYPOND"), str(home(pin, vendor) / "bin" / "lilypond"), shutil.which("lilypond")]
    seen: list[str] = []
    for c in candidates:
        if not c or not Path(c).exists():
            continue
        found = version_of(Path(c))
        if found == pin.version:
            return Path(c)
        seen.append(f"{c} is {found or 'an unknown version'}")
    raise LilyPondError(f"LilyPond {pin.version} is needed" + (f" ({'; '.join(seen)})" if seen else "")
                        + ".\n      Fix: uv run noh lilypond-install")


def version_of(binary: Path) -> str | None:
    try:
        out = subprocess.run([str(binary), "--version"], check=False, capture_output=True, text=True, timeout=60).stdout
    except (OSError, subprocess.TimeoutExpired):
        return None
    m = re.search(r"GNU LilyPond (\d+\.\d+\.\d+)", out)
    return m.group(1) if m else None


def tool(name: str, pin: Pin | None = None) -> Path:
    """Another program of the pinned install (convert-ly), beside lilypond."""
    path = find(pin).parent / name
    if not path.exists():
        raise LilyPondError(f"{name} is not beside {find(pin)}")
    return path


@dataclass(frozen=True)
class Result:
    ok: bool
    log: str


#: With NOH_SANDBOX=1 (CI's render jobs), LilyPond runs in its own network
#: namespace: whatever Scheme a file holds, it can reach no network.
SANDBOX = ["unshare", "--user", "--net", "--map-current-user", "--"]


def sandbox() -> list[str]:
    return SANDBOX if os.environ.get("NOH_SANDBOX") == "1" else []


def run(args: list[str], cwd: Path, timeout: int = 180, includes: tuple[Path, ...] = (INCLUDE,)) -> Result:
    """Run the pinned lilypond with our include directories on its path."""
    binary = find()
    command = [*sandbox(), str(binary), *(f"--include={i}" for i in includes), "-dno-point-and-click", *args]
    try:
        done = subprocess.run(command, cwd=cwd, check=False, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return Result(False, f"LilyPond took longer than {timeout} s")
    return Result(done.returncode == 0, done.stderr)


__all__ = ["INCLUDE", "PIN", "LilyPondError", "Pin", "Result", "find", "home", "install", "load_pin",
           "platform_key", "run", "sandbox", "tool", "version_of"]
