"""Source-specific researched hymn links; uncertainty never publishes notation."""
import json
import hashlib
from pathlib import Path
import yaml
from pipeline.volumes import DATA

REVIEWED = DATA / "hymn-pairings.yml"
PUBLISHED = DATA / "hymn-pairings.json"
SUPPLEMENT = DATA / "hymn-chant-sources.json"


def supplementary_chants(path: Path = SUPPLEMENT):
    """Pinned primary downloads newer than the dump; unknown permissions stay link-only."""
    from pipeline.gregobase import Chant
    if not path.exists():
        return []
    rows = []
    for row in json.loads(path.read_text())['chants']:
        if (row.get('copyrighted') not in (True, False, None)
                or 'copyrighted' not in row
                or hashlib.sha256(row['raw_gabc'].encode()).hexdigest() != row['sha256']
                or not row.get('source_url') or not row.get('retrieved_on')):
            raise ValueError('Supplementary chant needs pinned source and permission metadata')
        rows.append((Chant(row['id'], row['incipit'], row['part'], row['mode'], row['gabc'], None),
                     row['copyrighted']))
    return rows


def compile_pairings(entries, catalog, chants):
    from pipeline.chants import chant_body
    pieces = {p['slug']: p for p in catalog['pieces']}
    known = {c.id: (c, copyrighted) for c, copyrighted in chants}
    out, notation = {}, set()
    for row in entries:
        ref, slug = row['ref'], row['slug']
        piece = pieces.get(slug)
        if not piece or ref not in piece['systems']:
            raise ValueError(f'{slug}: hymn source {ref} is not owned by the piece')
        starts = ({piece['systems'][0]} if piece.get('genre') == 'hymn' else
                  {h['ref'] for h in piece.get('hymns', [])} |
                  {h['ref'] for h in piece.get('sections', []) if h.get('kind') == 'hymn' and h.get('ref')})
        if ref not in starts or ref in out:
            raise ValueError(f'{slug}: duplicate or invalid hymn source {ref}')
        status, ident = row['status'], row.get('gregobase_id')
        if status not in ('verified', 'unverified', 'unresolved') or not row.get('evidence') or not row.get('sources'):
            raise ValueError(f'{slug}: hymn pairing needs status, evidence and sources')
        chant, copyrighted = known.get(ident, (None, False))
        if status != 'unresolved' and chant is None:
            raise ValueError(f'{slug}: unknown GregoBase chant {ident}')
        if status == 'unresolved' and ident is not None:
            raise ValueError(f'{slug}: unresolved pairing cannot select a chant')
        if status == 'verified':
            if copyrighted is True or not chant_body(chant.gabc):
                raise ValueError(f'{slug}: verified notation is copyrighted or absent')
            if piece.get('source_note'):
                raise ValueError(f'{slug}: incomplete source cannot have a verified pairing')
            if copyrighted is False:
                notation.add(ident)
        out[ref] = {'slug': slug, 'title': row['title'], 'id': ident, 'status': status,
                    'incipit': chant.incipit if chant else None, 'mode': chant.mode if chant else None,
                    'evidence': row['evidence'], 'sources': row['sources'], 'copyrighted': copyrighted,
                    'notation_available': status == 'verified' and copyrighted is False}
    return out, notation


def build(catalog, chants, source: Path = REVIEWED, dest: Path = PUBLISHED):
    entries = (yaml.safe_load(source.read_text()) or {}).get('pairings', []) if source.exists() else []
    result, ids = compile_pairings(entries, catalog, chants)
    dest.write_text(json.dumps({'pairings': result}, ensure_ascii=False, indent=2) + '\n')
    return ids
