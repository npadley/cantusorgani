"""Join card B's optional captured address inventory; retain HTTP mechanisms."""
from pathlib import Path
from urllib.parse import urlsplit

from .model import read


def addresses(data, snapshot, aliases, *, root):
    root = Path(root)
    redirects = []
    path = root / 'web/public/_redirects'
    for line in (path.read_text() if path.exists() else '').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        parts = line.split()
        if len(parts) != 3:
            raise ValueError(f'malformed redirect: {line}')
        redirects.append({'from_': parts[0], 'to': parts[1], 'status': int(parts[2])})
    aliases['redirects'] = [{'from': r['from_'], 'to': r['to'], 'status': r['status']} for r in redirects]
    rows = {}

    def add(path, fragment=None, destination=None, dest_fragment=None, mechanism='identity', ids=()):
        row = {'path': path, 'fragment': fragment, 'destination_path': destination or path,
                   'destination_fragment': dest_fragment if destination else fragment,
                   'mechanism': mechanism, 'entity_ids': list(ids)}
        key = (path, fragment)
        if key in rows and rows[key] != row:
            raise ValueError(f'conflicting address {key}: {rows[key]} and {row}')
        rows[key] = row

    items = {i['id']: i for i in snapshot['source_items']}
    settings = {s['id']: s for s in snapshot['settings']}
    for slug, ident in aliases['legacy_slugs'].items():
        children = [i for i in items.values() if i['parent_id'] == ident]
        works = sorted({settings[s]['work_id'] for i in [items[ident], *children] for s in i['setting_ids']})
        path = f'/piece/{slug}/'
        destination = '/kyriale/' + slug.removeprefix('ordinarium-missae-') + '/' if (
            slug.startswith('ordinarium-missae-') and slug.removeprefix('ordinarium-missae-') in (
                'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii',
                'xiv', 'xv', 'xvi', 'xvii', 'xviii')) else None
        add(path, destination=destination, mechanism='astro-refresh' if destination else 'identity',
            ids=[ident, *works])
        if destination:
            add(destination, ids=[ident, *works])
        for child in children:
            key = child['origin']['legacy_target'] or ''
            if key.startswith(('part:', 'movement:')):
                fragment = key.split('/', 1)[1].replace(':', '-')
                if fragment.startswith('other-') and fragment[6:] in ('kyrie', 'gloria', 'credo', 'sanctus', 'agnus', 'ite'):
                    fragment = fragment[6:]
                add(destination or path, fragment, ids=[child['id']])
    for rule in aliases['redirects']:
        key = (rule['from'], None)
        rows.pop(key, None)
        destination = urlsplit(rule['to'])
        add(rule['from'], destination=destination.path, dest_fragment=destination.fragment or None, mechanism='pages-rule')
        if (destination.path, None) not in rows:
            add(destination.path)
    inventory = read(Path(data) / 'identities/legacy-addresses.json', {})
    # Card B owns the full capture. Its schema-2 routes include fragments;
    # queries are retained by B as state contracts, not identity keys.
    if inventory:
        if inventory.get('redirects') and sorted(inventory['redirects'], key=lambda r: r['from']) != sorted(
                [{**r, 'status': str(r['status'])} for r in aliases['redirects']],
                key=lambda r: r['from']):
            raise ValueError('address registry disagrees with current _redirects')
        for route in inventory.get('routes', []):
            path = route['path']
            if (path, None) not in rows:
                add(path)
            base = rows[path, None]
            for fragment in route.get('fragments', []):
                if (path, fragment) not in rows:
                    destination = base['destination_path'] if base['mechanism'] != 'identity' else None
                    ids = rows.get((destination or path, fragment), {}).get('entity_ids', [])
                    add(path, fragment, destination=destination, dest_fragment=fragment,
                        mechanism=base['mechanism'], ids=ids)
        for resource in inventory.get('resources', []):
            if (resource, None) not in rows:
                add(resource)
        captured = {r['path'] for r in inventory.get('routes', [])} | set(inventory.get('resources', []))
        for rule in aliases['redirects']:
            if urlsplit(rule['to']).path not in captured:
                raise ValueError(f'missing captured redirect destination: {rule}')
    for row in inventory.get('addresses', []):
        path, fragment = row['path'], row.get('fragment')
        if (path, fragment) not in rows:
            add(path, fragment, destination=row.get('destination_path'),
                dest_fragment=row.get('destination_fragment'), mechanism=row.get('mechanism', 'identity'))
    for key, row in rows.items():
        visited = set()
        current = key
        while current in rows and rows[current]['destination_path'] != current[0]:
            if current in visited:
                raise ValueError(f'address loop: {key}')
            visited.add(current)
            r = rows[current]
            current = (r['destination_path'], r['destination_fragment'])
    aliases['addresses'] = sorted(rows.values(), key=lambda r: (r['path'], r['fragment'] or ''))
