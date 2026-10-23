/** Browser-safe scan registry, projected from sources.json by the build config. */
interface SourceKey {
  readonly adapter: string;
  readonly short_label: string;
  readonly scan_registry_key: string;
}

declare const __SOURCE_KEYS__: Readonly<Record<string, SourceKey>>;

export const sourceKeys = __SOURCE_KEYS__;
export const registeredSourceKeys: ReadonlySet<string> = new Set(Object.keys(sourceKeys));
