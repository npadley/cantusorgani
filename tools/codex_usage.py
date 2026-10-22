"""Print remaining Codex usage from local session logs, without network access."""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime
from pathlib import Path


def _valid_window(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    for key in ("used_percent", "resets_at"):
        number = value.get(key)
        if type(number) not in (int, float):
            return False
        try:
            if not math.isfinite(number):
                return False
        except OverflowError:
            return False
    if type(value.get("window_minutes")) is not int:
        return False
    try:
        _local(value["resets_at"])
    except (ValueError, OverflowError, OSError):
        return False
    return True


def _rate_limits(value: object) -> dict | None:
    if isinstance(value, dict):
        record = value.get("rate_limits")
        if isinstance(record, dict):
            windows = {key: record[key] for key in ("primary", "secondary")
                       if _valid_window(record.get(key))}
            if windows:
                return {**record, "primary": windows.get("primary"),
                        "secondary": windows.get("secondary")}
        for child in value.values():
            found = _rate_limits(child)
            if found is not None:
                return found
    return None


def latest_record(sessions_dir: Path) -> tuple[dict, float] | None:
    """Choose the newest valid record by line timestamp in the 50 newest logs."""
    files = []
    for path in sessions_dir.rglob("rollout-*.jsonl"):
        try:
            files.append((path.stat().st_mtime, path))
        except OSError:
            continue
    latest = None
    for modified, path in sorted(files, key=lambda item: item[0], reverse=True)[:50]:
        try:
            with path.open(encoding="utf-8", errors="replace") as stream:
                for line in stream:
                    try:
                        value = json.loads(line)
                        record = _rate_limits(value)
                        if record is None:
                            continue
                        recorded_at = modified
                        if "timestamp" in value:
                            timestamp = value["timestamp"]
                            if not isinstance(timestamp, str):
                                continue
                            recorded_at = datetime.fromisoformat(
                                timestamp
                            ).timestamp()
                        _local(recorded_at)
                    except (ValueError, TypeError, OverflowError, OSError, RecursionError):
                        continue
                    if latest is None or recorded_at >= latest[1]:
                        latest = record, recorded_at
        except OSError:
            continue
    return latest


def _local(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp).astimezone().isoformat(sep=" ", timespec="seconds")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print structured JSON")
    parser.add_argument("--sessions-dir", type=Path, default=Path.home() / ".codex/sessions")
    args = parser.parse_args(argv)
    found = latest_record(args.sessions_dir)
    if found is None:
        print(f"No rate_limits record found in the 50 newest logs under {args.sessions_dir}",
              file=sys.stderr)
        return 2
    record, modified = found
    now = time.time()
    if now - modified > 24 * 3600:
        print("Warning: usage record is older than 24 h and may be stale; "
              "it updates after the next Codex run.", file=sys.stderr)
    windows = []
    for key in ("primary", "secondary"):
        window = record.get(key)
        if not isinstance(window, dict):
            continue
        minutes = window["window_minutes"]
        windows.append({
            "label": {10080: "weekly", 300: "5-hour"}.get(minutes, f"{minutes}-minute"),
            "used_percent": window["used_percent"],
            "left_percent": 100 - window["used_percent"],
            "window_minutes": minutes,
            "resets_at": window["resets_at"],
            "resets_local": _local(window["resets_at"]),
        })
    output = {"windows": windows, "plan": record.get("plan_type"), "as_of": _local(modified)}
    if args.json:
        print(json.dumps(output))
    else:
        for window in windows:
            hours = int(max(0, window["resets_at"] - now) // 3600)
            days, hours = divmod(hours, 24)
            print(f"{window['label']}: {window['used_percent']:g}% used, "
                  f"{window['left_percent']:g}% left, resets {window['resets_local']} "
                  f"(in {days}d {hours}h)")
        print(f"plan: {output['plan']}")
        print(f"as of: {output['as_of']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
