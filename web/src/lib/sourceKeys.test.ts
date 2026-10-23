import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import sources from '../../../data/identities/sources.json';
import { registeredSourceKeys, sourceKeys } from './sourceKeys';

describe('browser scan registry', () => {
  it('ships exactly the registered scan keys and their caption metadata', () => {
    const editions = sources.editions.filter(e => e.scan_registry_key !== null);
    expect([...registeredSourceKeys]).toEqual(editions.map(e => e.scan_registry_key));
    expect(sourceKeys).toEqual(Object.fromEntries(editions.map(e => [e.scan_registry_key, {
      adapter: e.adapter, short_label: e.short_label, scan_registry_key: e.scan_registry_key,
    }])));
  });

  it('needs no build-time define, because Wrangler bundles it for Pages Functions without one', () => {
    const text = readFileSync(new URL('./sourceKeys.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/declare const __[A-Z_]+__/u);
  });
});
