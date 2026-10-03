"""Reviewed title associations; never infer liturgical equivalence from a fuzzy match."""
from pathlib import Path
import yaml


def load_hymn_links(path: Path, catalog: dict) -> dict[str, list[str]]:
    if not path.exists():
        return {}
    pieces = {p["slug"]: p for p in catalog["pieces"]}
    links = {}
    for row in (yaml.safe_load(path.read_text()) or {}).get("hymns", []):
        slugs = row["pieces"]
        for slug in slugs:
            p = pieces.get(slug)
            if not p or p.get("volume") != "noh7" or p.get("genre") != "hymn" or not p.get("systems") or p.get("source_note"):
                raise ValueError(f"{path.name}: {slug} is not an available Book VII hymn")
        for title in row["titles"]:
            if title in links:
                raise ValueError(f"{path.name}: duplicate reviewed hymn title {title}")
            links[title] = list(dict.fromkeys(slugs))
    return links


def attach_hymn_links(items: list[dict], links: dict[str, list[str]]) -> None:
    for item in items:
        if item.get("kind") == "hymn" and item.get("label") in links:
            item["hymn_links"] = links[item["label"]]
