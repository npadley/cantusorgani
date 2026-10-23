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
});
