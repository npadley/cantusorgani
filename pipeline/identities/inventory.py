"""Enumerate effective printed objects without rerunning matchers or replay.

The catalogue is the post-replay authority. A unit carries a birth key for
allocation only; subsequent projection joins through ledger legacy bindings.
"""
from collections import defaultdict
from pathlib import Path

from pipeline import sections
from pipeline.source_refs import load_sources
from pipeline.typeset.match import MOVEMENTS, targets

from .model import origin, pointer, read

SINGLE_GENRES = {'hymn', 'antiphon', 'kyrie', 'credo', 'sequence', 'responsory',
                 'asperges', 'canticle', 'gloria', 'versicle', 'sanctus', 'agnus'}


def inventory(data):
    data = Path(data)
    registry = load_sources(data)
    units = []
    reps = []
    extra = []
    editions = {e['legacy_volume']: e for e in registry['editions']}
    catalog = read(data / 'catalog.json', {'pieces': []})
    seen = set()
    ref_data = {}
    ref_owners = defaultdict(list)

    def scan_location(refs, fallback=None):
        fallback = fallback or {'pagination': None, 'printed_pages': None, 'item_number': None}
        if not refs:
            return {**fallback, 'printed_pages': None, 'pdf_pages': None, 'system_refs': []}
        pages = [int(ref.split('/')[1]) for ref in refs]
        volume = refs[0].split('/')[0]
        maps = catalog.get('volumes', {}).get(volume, {}).get('page_map', [])
        mapped = [(page - m['offset'], m.get('pagination')) for page in pages for m in maps
                  if m['first_pdf'] <= page <= m['last_pdf']]
        printed = [min(p for p, _ in mapped), max(p for p, _ in mapped)] if len(mapped) == len(pages) else None
        pagination = mapped[0][1] if mapped and len({p for _, p in mapped}) == 1 else fallback.get('pagination')
        return {**fallback, 'pagination': pagination, 'printed_pages': printed,
                'pdf_pages': [min(pages), max(pages)], 'system_refs': refs}

    def add(seed, edition, parent, title, classification, refs, evidence, *,
            keys=(), locator=None, ordinal=None, chant=None, kind='unspecified',
            location=None, assets=None, aspects=None, work_seed=None, accompaniments=1):
        if seed in seen:
            raise ValueError(f'duplicate seed {seed}: {evidence}')
        seen.add(seed)
        unit = {'seed': seed, 'edition': edition, 'parent': parent, 'title': title,
                    'classification': classification, 'refs': refs, 'origin': evidence,
                    'keys': list(keys), 'locator': locator, 'ordinal': ordinal, 'chant': chant,
                    'kind': kind, 'work_seed': work_seed or seed, 'accompaniments': accompaniments,
                    'location': location or scan_location(refs)}
        units.append(unit)
        if refs:
            values = [ref_data.get(ref, (None, None)) for ref in refs]
            stems = assets if assets is not None else [v[0] for v in values]
            sizes = aspects if aspects is not None else [v[1] for v in values]
            if len(stems) != len(refs) or len(sizes) != len(refs) or any(
                    stem is None or size is None for stem, size in zip(stems, sizes, strict=True)):
                raise ValueError(f'unaligned or missing scan assets: {evidence}')
            reps.append({'seed': 'scan:' + seed, 'kind': 'scan', 'unit': seed,
                             'locator': {'system_refs': refs, 'asset_stems': stems, 'aspects': sizes},
                             'evidence': [evidence]})
        return unit

    # A reviewed hymn's explicit ref list wins over the open-ended catalogue
    # jump span. Its start ref identifies the same printed object, not a title.
    hymn_refs = {}
    def collect_hymns(value, parts=()):
        if isinstance(value, dict):
            if parts and parts[-1] == 'hymn' and value.get('refs'):
                refs = value['refs']
                previous = hymn_refs.setdefault(refs[0], refs)
                if previous != refs:
                    raise ValueError(f'incompatible reviewed hymn ranges: {refs[0]}')
            for key, child in value.items():
                collect_hymns(child, (*parts, key))
        elif isinstance(value, list):
            for i, child in enumerate(value):
                collect_hymns(child, (*parts, i))
    for file in ('vespers/vespers-noh8.yml', 'vespers/vespers-offices.yml'):
        collect_hymns(read(data / file))
    effective = {t.target: t for t in targets(catalog, lambda ref: int(ref.split('/')[1]))}
    for i, p in enumerate(catalog['pieces']):
        slug = p['slug']
        if p['volume'] not in editions:
            raise ValueError(f'unknown edition for {p["id"]}')
        refs = p.get('systems') or []
        for ref, stem, aspect in zip(refs, p.get('system_assets') or [],
                                     p.get('system_aspect') or [], strict=True):
            previous = ref_data.setdefault(ref, (stem, aspect))
            if previous != (stem, aspect):
                raise ValueError(f'incompatible scan owners: {ref}')
            ref_owners[ref].append(p)

    for i, p in enumerate(catalog['pieces']):
        slug = p['slug']
        top = 'piece:' + p['id']
        refs = p.get('systems') or []
        location = {'pagination': p.get('pagination'), 'printed_pages': p.get('printed_pages'),
                    'pdf_pages': p.get('pdf_pages'), 'system_refs': refs, 'item_number': None}
        children = []
        for j, s in enumerate(p.get('sections') or []):
            key = sections.target(slug, s)
            classification = ('reference' if 'borrowed_page' in s else
                              'unresolved' if s.get('placed') == 'order' or s.get('ref') not in refs else 'musical-unit')
            children.append((key, s, j, classification, pointer('pieces', i, 'sections', j)))
        for j, m in enumerate(p.get('movements') or []):
            key = f'movement:{slug}/{m["movement"]}'
            if key in effective and not any(c[0] == key for c in children):
                row = dict(m, kind=m['movement'], variant='')
                children.append((key, row, j, 'musical-unit', pointer('pieces', i, 'movements', j)))
        for j, h in enumerate(p.get('hymns') or []):
            if any(c[1].get('ref') == h['ref'] for c in children):
                continue
            # This exact reviewed hymn ref identifies the embedded unit. Its
            # selector is recorded only as evidence, never as a moving pointer.
            key = f'hymn:{slug}/{h["ref"]}'
            children.append((key, dict(h, kind='hymn', variant=''), j, 'musical-unit',
                             pointer('pieces', i, 'hymns', j)))
        single = not children and p.get('genre') in SINGLE_GENRES and bool(refs)
        classification = ('reference' if p.get('reference') and not refs else
                          'musical-unit' if single else 'container' if children else 'unresolved')
        add(top, editions[p['volume']]['id'], None, p.get('title'), classification, refs,
            origin('data/catalog.json', pointer('pieces', i), 'piece:' + slug),
            keys=['piece:' + slug, 'sections:' + slug], location=location,
            kind=p.get('genre', 'unspecified'), work_seed='piece:' + slug,
            chant=next((c['id'] for c in p.get('chant', []) if c.get('id')), None))
        starts = sorted({refs.index(c[1]['ref']) for c in children if c[1].get('ref') in refs})
        for key, row, ordinal, cl, ptr in children:
            start = refs.index(row['ref']) if row.get('ref') in refs else None
            end = next((n for n in starts if start is not None and n > start), len(refs))
            child_refs = refs[start:end] if start is not None else []
            if row['kind'] == 'hymn' and row.get('ref') in hymn_refs:
                child_refs = hymn_refs[row['ref']]
            loc = {k: row.get(k) for k in ('kind', 'key', 'n', 'variant')}
            loc['slug'] = slug
            loc['variant'] = row.get('variant') or None
            chant = row.get('gregobase_id') or row.get('chant')
            if chant is None:
                chant = next((c.get('id') for c in p.get('chant', [])
                              if c.get('movement') == row.get('key', row.get('movement'))), None)
            add(key, editions[p['volume']]['id'], top, row.get('title'), cl, child_refs,
                origin('data/catalog.json', ptr, key), keys=[key], locator=loc, ordinal=ordinal,
                chant=chant, kind=row['kind'], location=scan_location(child_refs, location))
            # Suppressed detected movements retain their facet and point to
            # the reviewed row, never a duplicate Gloria/setting.
            if row.get('kind') == 'other' and row.get('key') in MOVEMENTS:
                extra.append((f'movement:{slug}/{row["key"]}', key))

    def owner(refs, inherited):
        if inherited:
            choices = [p for p in catalog['pieces'] if p['slug'] == inherited]
        elif refs:
            choices = [p for p in ref_owners.get(refs[0], [])
                       if set(refs) <= set(p.get('systems') or [])]
        else:
            choices = []
        if len(choices) > 1:
            raise ValueError(f'ambiguous reviewed source owner: {refs}: {[p["id"] for p in choices]}')
        return choices[0] if choices else None

    exact_refs = {tuple(u['refs']): u for u in units
                  if u['classification'] == 'musical-unit' and u['refs']}

    def reviewed(value, file, parts=(), inherited=None):
        if isinstance(value, dict):
            inherited = value.get('piece', inherited)
            refs = value.get('refs')
            if isinstance(refs, list) or value.get('note'):
                refs = refs or []
                seed = f'vespers-source:{file}:{pointer(*parts)}'
                aliases = []
                if file.endswith('vespers-offices.yml') and len(parts) >= 3:
                    office = parts[1]
                    if parts[2] == 'antiphons' and len(parts) == 4:
                        aliases = [f'vespers:{office}/antiphon-{value["n"]}']
                    elif parts[2] == 'magnificat' and len(parts) == 3:
                        aliases = [f'vespers:{office}/magnificat']
                if parts[:1] == ('magnificat_antiphons',) and len(parts) == 2:
                    aliases = [f'vespers:sunday:{parts[1]}/magnificat']
                if refs and tuple(refs) in exact_refs:
                    existing_seed = exact_refs[tuple(refs)]['seed']
                    extra.append((seed, existing_seed))
                    for representation in reps:
                        if representation.get('unit') == existing_seed and representation['kind'] == 'scan':
                            representation['evidence'].append(origin('data/' + file, pointer(*parts), next(iter(aliases), None)))
                    for key in aliases:
                        extra.append((key, exact_refs[tuple(refs)]['seed']))
                else:
                    p = owner(refs, inherited)
                    edition = editions[(p['volume'] if p else refs[0].split('/')[0])]['id'] if refs or p else next(
                        e['id'] for e in registry['editions'] if e['legacy_volume'] == 'noh8')
                    u = add(seed, edition, 'piece:' + p['id'] if p else None,
                            value.get('incipit') or value.get('title') or value.get('label'),
                            'musical-unit' if refs else 'reference', refs,
                            origin('data/' + file, pointer(*parts), next(iter(aliases), None)),
                            keys=[seed, *aliases], chant=value.get('chant'), kind=('antiphon' if 'antiphons' in parts or 'magnificat_antiphons' in parts else
                                  str(next((p for p in reversed(parts) if isinstance(p, str)), 'vespers'))))
                    if refs:
                        exact_refs[tuple(refs)] = u
            for key, child in value.items():
                if key in ('refs', 'piece'):
                    continue
                if isinstance(child, list) and child and all(isinstance(r, str) and r in ref_data for r in child):
                    reviewed({'refs': child}, file, (*parts, key), inherited)
                else:
                    reviewed(child, file, (*parts, key), inherited)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                reviewed(child, file, (*parts, i), inherited)

    if any(e['adapter'] == 'noh' for e in registry['editions']):
        # Overlay Vespers fields are replayed in memory; no existing file is written.
        from pipeline import corrections
        for file in ('vespers/vespers-noh8.yml', 'vespers/vespers-offices.yml'):
            value = read(data / file)
            if value is not None:
                layer = corrections.apply_vespers(
                    corrections.load_vespers(data), corrections.load(data / 'corrections.yml')) if (
                        data / 'corrections.yml').exists() else None
                if layer is not None:
                    value = layer.doc if file.endswith('vespers-noh8.yml') else {'offices': layer.offices}
                reviewed(value, file)

    for edition in registry['editions']:
        if edition['adapter'] != 'numbered-hymnal':
            continue
        for i, item in enumerate(read(data / 'items.json', [])):
            key = 'hymnal:' + item['locator']['item_number']
            add(key, edition['id'], None, item['title'], 'musical-unit', [],
                origin('data/items.json', pointer(i), key), keys=[key], location=item['locator'],
                work_seed=item.get('work_key', key), accompaniments=item.get('accompaniments', 1))

    parts = read(data / 'typeset/parts.yml', [])
    manifest = read(data / 'typeset/manifest.json', {'parts': []})
    by_file = {p['file']: (i, p) for i, p in enumerate(manifest['parts'])}
    matches = {p['file']: p for p in parts}
    paths = {p.relative_to(data / 'typeset/src').as_posix() for p in (data / 'typeset/src').rglob('*.ly')}
    for file in sorted(paths | matches.keys() | by_file.keys()):
        match = matches.get(file, {})
        m = by_file.get(file)
        target = m[1]['target'] if m else match.get('target')
        reps.append({'seed': 'lilypond:' + file, 'kind': 'lilypond', 'target': target,
                         'unit': None, 'locator': {'source_path': 'data/typeset/src/' + file,
                         'legacy_target': target, 'render_hash': m[1]['hash'] if m else None,
                         'manifest_pointer': pointer('parts', m[0]) if m else None},
                         'evidence': [origin('data/typeset/parts.yml', pointer(parts.index(match)), target)]
                         if match else [origin('data/typeset/src/' + file)]})
    mei_manifest = read(data / 'typeset/mei/manifest.json', {'parts': []})
    for path in sorted((data / 'typeset/mei/records').glob('*.json')):
        record = read(path)
        target = record.get('target')
        joined = [(i, p) for i, p in enumerate(mei_manifest['parts'])
                  if p['target'] == target and p['renderHash'] == record.get('render_hash')]
        if len(joined) > 1:
            raise ValueError(f'ambiguous MEI manifest entry: {path.name}')
        reps.append({'seed': 'mei:' + path.name, 'kind': 'mei', 'target': target, 'unit': None,
                         'locator': {'record_path': 'data/typeset/mei/records/' + path.name,
                                  'legacy_target': target, 'render_hash': record.get('render_hash'),
                                  'artifact_sha256': record.get('artifact_sha256'),
                                  'manifest_pointer': pointer('parts', joined[0][0]) if joined else None},
                         'evidence': [origin('data/typeset/mei/records/' + path.name, '', target)]})
    return registry, units, reps, extra
