import re
from pathlib import Path


def test_regenerate_all_volumes_match_catalog_rebuild():
    root = Path(__file__).resolve().parents[1]
    script = (root / "scripts/regenerate.sh").read_text(encoding="utf-8")
    workflow = (root / ".github/workflows/catalog-rebuild.yml").read_text(encoding="utf-8")

    script_all = re.search(r'if \[\[.*== "all" \]\]; then\s+VOLUMES=\(([^)]+)\)', script)
    workflow_all = re.search(r'if \[ "\$VOLUME" = "all" \]; then volumes="([^"]+)"', workflow)
    assert script_all is not None, "regenerate.sh must define volumes for all"
    assert workflow_all is not None, "catalog-rebuild.yml must define volumes for all"
    assert script_all.group(1).split() == workflow_all.group(1).split()
