"""Locate references into the private documentation clone, without requiring it."""

import subprocess
from pathlib import Path


def docs_path(root: Path) -> Path:
    """Find the clone beside the main checkout, also from linked worktrees."""
    try:
        common = subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"],
            text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return root.parent / "cantusorgani-docs"
    return (Path(common).parent.parent / "cantusorgani-docs").resolve()


def docs_reference(reference: str) -> str | None:
    """Return a docs-relative path for either supported spelling."""
    for prefix in ("cantusorgani-docs/", "../cantusorgani-docs/"):
        if reference.startswith(prefix):
            return reference[len(prefix):]
    return None
