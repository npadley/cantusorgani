/** Reviewed edition labels and compatibility policy, read at build time. */
import sourcesText from '../../../data/identities/sources.yml?raw';
import { parse } from 'yaml';

export interface EditionPolicy {
  readonly show_related_hymns: boolean;
  readonly borrow_whole_reference: boolean;
  readonly related_hymns_heading: string | null;
  readonly reference_group: string | null;
}

interface Source {
  readonly id: string;
  readonly short_title: string;
}

export interface Edition {
  readonly id: string;
  readonly source_id: string;
  readonly legacy_volume: string | null;
  readonly scan_registry_key: string | null;
  readonly part: string | null;
  readonly citation_label: string;
  readonly short_label: string;
  readonly adapter: string;
  readonly rights_state: 'unknown' | 'cleared' | 'withdrawn';
  readonly policy: EditionPolicy;
}

export interface Sources {
  readonly schema_version: 1;
  readonly sources: readonly Source[];
  readonly editions: readonly Edition[];
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const nullable = (v: unknown): v is string | null => v === null || nonempty(v);
const sourceKey = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(v));
const source = (v: unknown): v is Source => object(v) && nonempty(v.id) && nonempty(v.short_title);
const policy = (v: unknown): v is EditionPolicy => object(v)
  && typeof v.show_related_hymns === 'boolean' && typeof v.borrow_whole_reference === 'boolean'
  && nullable(v.related_hymns_heading) && nullable(v.reference_group);
const edition = (v: unknown): v is Edition => object(v)
  && nonempty(v.id) && nonempty(v.source_id) && sourceKey(v.legacy_volume)
  && sourceKey(v.scan_registry_key) && nullable(v.part) && nonempty(v.citation_label)
  && nonempty(v.short_label) && nonempty(v.adapter)
  && (v.rights_state === 'unknown' || v.rights_state === 'cleared' || v.rights_state === 'withdrawn')
  && policy(v.policy);

/** A small typed guard for the projection consumed here; Python validates the full schema. */
export function parseSources(value: unknown): Sources {
  if (!object(value) || value.schema_version !== 1 || !Array.isArray(value.sources)
    || !value.sources.length || !value.sources.every(source) || !Array.isArray(value.editions)
    || !value.editions.every(edition)) throw new Error('Invalid sources.yml labels or policy');
  const sources = value.sources;
  const editions = value.editions;
  const unique = (keys: readonly (string | null)[]) => {
    const present = keys.filter((k): k is string => k !== null);
    return new Set(present).size === present.length;
  };
  if (!unique(sources.map(s => s.id)) || !unique(editions.map(e => e.id))
    || !unique(editions.map(e => e.legacy_volume)) || !unique(editions.map(e => e.scan_registry_key))
    || editions.some(e => !sources.some(s => s.id === e.source_id))) {
    throw new Error('Duplicate or dangling sources.yml edition');
  }
  return { schema_version: 1, sources, editions };
}

const parsed: unknown = parse(sourcesText);
export const sourceRegistry = parseSources(parsed);
export const registeredSourceKeys: ReadonlySet<string> = new Set(sourceRegistry.editions
  .flatMap(e => e.scan_registry_key === null ? [] : [e.scan_registry_key]));

export function editionFor(key: string, registry: Sources = sourceRegistry): Edition {
  const matches = registry.editions.filter(e => e.legacy_volume === key || e.scan_registry_key === key || e.id === key);
  if (matches.length !== 1) throw new Error(`Unknown or ambiguous edition: ${key}`);
  return matches[0]!;
}

export function editionPolicy(key: string, registry: Sources = sourceRegistry): EditionPolicy {
  return editionFor(key, registry).policy;
}

/** Absent sources retain the collection credit; an unknown edition is an error. */
export function sourceLabel(key?: string | null, registry: Sources = sourceRegistry): string {
  if (key == null) return registry.sources[0]!.short_title;
  return editionFor(key, registry).citation_label;
}

export function borrowedVolumeLabel(key: string | null, registry: Sources = sourceRegistry): string {
  return key ? sourceLabel(key, registry) : 'another volume';
}
