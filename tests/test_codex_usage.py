"""Local Codex usage reporting; fixtures never read the user's session logs."""

from __future__ import annotations

import json
import os
import time

from tools.codex_usage import main


def write_log(tmp_path, name="new", age=0, records=None):
    path = tmp_path / "2026/10/22" / f"rollout-{name}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    if records is None:
        records = [limits()]
    path.write_text("".join(json.dumps({"payload": {"rate_limits": r}}) + "\n" for r in records))
    modified = time.time() - age
    os.utime(path, (modified, modified))
    return path


def limits(used=6, secondary=None):
    return {"primary": {"used_percent": used, "window_minutes": 10080,
                        "resets_at": int(time.time()) + 172800},
            "secondary": secondary, "plan_type": "plus"}


def test_codex_usage_newest_record_wins(tmp_path, capsys):
    write_log(tmp_path, "old", age=60, records=[limits(90)])
    path = write_log(tmp_path, records=[limits(10), limits(20)])
    with path.open("a") as stream:
        stream.write('{"payload": {}}\nunfinished JSON\n')
    assert main(["--sessions-dir", str(tmp_path)]) == 0
    assert "weekly: 20% used, 80% left" in capsys.readouterr().out


def test_codex_usage_secondary_window_printed(tmp_path, capsys):
    secondary = {"used_percent": 12.5, "window_minutes": 300,
                 "resets_at": int(time.time()) + 3600}
    write_log(tmp_path, records=[limits(secondary=secondary)])
    assert main(["--sessions-dir", str(tmp_path)]) == 0
    out = capsys.readouterr().out
    assert "5-hour: 12.5% used, 87.5% left, resets " in out
    assert "plan: plus\nas of: " in out


def test_codex_usage_no_record_exit_2(tmp_path, capsys):
    write_log(tmp_path, records=[None])
    assert main(["--sessions-dir", str(tmp_path)]) == 2
    assert "No rate_limits record found" in capsys.readouterr().err


def test_codex_usage_json_shape(tmp_path, capsys):
    write_log(tmp_path)
    assert main(["--sessions-dir", str(tmp_path), "--json"]) == 0
    result = json.loads(capsys.readouterr().out)
    assert set(result) == {"windows", "plan", "as_of"}
    assert result["plan"] == "plus"
    window = result["windows"][0]
    assert window["label"] == "weekly"
    assert window["used_percent"] == 6
    assert window["left_percent"] == 94
    assert window["window_minutes"] == 10080
    assert isinstance(window["resets_at"], int)
    assert isinstance(window["resets_local"], str)


def test_codex_usage_stale_record_warns(tmp_path, capsys):
    write_log(tmp_path, age=25 * 3600)
    assert main(["--sessions-dir", str(tmp_path), "--json"]) == 0
    captured = capsys.readouterr()
    assert "older than 24 h" in captured.err
    assert "next Codex run" in captured.err
    assert json.loads(captured.out)["plan"] == "plus"


def test_codex_usage_scan_limit_ignores_older_files(tmp_path, capsys):
    write_log(tmp_path, "old", age=1000)
    for index in range(50):
        write_log(tmp_path, str(index), age=index, records=[None])
    assert main(["--sessions-dir", str(tmp_path)]) == 2


def test_codex_usage_other_window_minute_label(tmp_path, capsys):
    record = limits()
    record["primary"]["window_minutes"] = 60
    write_log(tmp_path, records=[record])
    assert main(["--sessions-dir", str(tmp_path)]) == 0
    assert "60-minute:" in capsys.readouterr().out
