/** Browser-safe scan registry: only the keys and caption metadata from sources.json.
 *  Imported by the correction forms and by the admin Pages Functions, so it must
 *  not depend on a build-time define (Wrangler bundles Functions without Astro's). */
import sources from "../../../data/identities/sources.json";

interface SourceKey {
  readonly adapter: string;
  readonly short_label: string;
  readonly scan_registry_key: string;
}

export const sourceKeys: Readonly<Record<string, SourceKey>> = Object.fromEntries(
  sources.editions.flatMap(({ adapter, short_label, scan_registry_key }) =>
    scan_registry_key === null ? [] : [[scan_registry_key, { adapter, short_label, scan_registry_key }]]),
);
export const registeredSourceKeys: ReadonlySet<string> = new Set(Object.keys(sourceKeys));
