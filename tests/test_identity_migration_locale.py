"""The migration proof tolerates minimal CI locale installations."""
from types import SimpleNamespace

import pytest

from tools import check_identity_migration as migration


@pytest.mark.parametrize('available, expected', [
    ({'en_US.UTF-8'}, 'en_US.UTF-8'),
    ({'C.UTF-8'}, 'C.UTF-8'),
    (set(), None),
])
def test_alternate_locale_falls_back_or_prints_skip(monkeypatch, capsys, available, expected):
    attempted = []

    def probe(command, **kwargs):
        attempted.append(command[-1])
        return SimpleNamespace(returncode=0 if command[-1] in available else 1)

    monkeypatch.setattr(migration.subprocess, 'run', probe)
    assert migration.alternate_locale() == expected
    assert attempted == (['en_US.UTF-8'] if expected == 'en_US.UTF-8'
                         else ['en_US.UTF-8', 'C.UTF-8'])
    if expected is None:
        assert 'skip' in capsys.readouterr().out.lower()
