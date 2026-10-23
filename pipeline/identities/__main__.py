"""Module CLI until card I connects the noh orchestrator."""
import argparse
import json

from . import allocate, bootstrap, build, check, resolve_target
from .model import DATA


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=type(DATA), default=DATA)
    subs = parser.add_subparsers(dest='command', required=True)
    for name in ['bootstrap', 'allocate']:
        sub = subs.add_parser(name)
        sub.add_argument('--adapter', default='noh')
    sub = subs.add_parser('build')
    sub.add_argument('--out', type=type(DATA))
    subs.add_parser('check')
    sub = subs.add_parser('resolve')
    sub.add_argument('target')
    args = parser.parse_args()
    try:
        if args.command in ('bootstrap', 'allocate'):
            count = {'bootstrap': bootstrap, 'allocate': allocate}[args.command](args.data, args.adapter)
            print(f'{count} allocations')
        elif args.command == 'build':
            result = build(args.data, args.out)
            print(json.dumps(result['migration.json']['entity_counts'], sort_keys=True))
        elif args.command == 'check':
            print(json.dumps(check(args.data)['entity_counts'], sort_keys=True))
        else:
            print(json.dumps(resolve_target(args.target, args.data), ensure_ascii=False, sort_keys=True))
    except (ValueError, KeyError) as exc:
        parser.exit(1, str(exc) + '\n')


if __name__ == '__main__':
    main()
