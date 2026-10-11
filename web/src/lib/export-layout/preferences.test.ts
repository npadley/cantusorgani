import { describe, it, expect } from 'vitest';
import {
  readPreferences,
  writePreferences,
} from './preferences';
import type { Preferences, StorageLike } from './types';
import { PREFERENCES_KEY, LEGACY_PAPER_KEY, DEFAULT_SETTINGS } from './types';

describe('preferences', () => {
  describe('readPreferences', () => {
    it('handles null storage', () => {
      const result = readPreferences(null);
      expect(result.preferences.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.preferences.overrides).toEqual({});
      const storageNotice = result.notices.find((n) => n.code === 'STORAGE_BLOCKED');
      expect(storageNotice).toBeDefined();
    });

    it('handles throwing getItem', () => {
      const storage: StorageLike = {
        getItem: () => {
          throw new Error('Storage error');
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.preferences.overrides).toEqual({});
      const storageNotice = result.notices.find((n) => n.code === 'STORAGE_BLOCKED');
      expect(storageNotice).toBeDefined();
    });

    it('handles corrupt JSON', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return 'not valid json {';
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.preferences.overrides).toEqual({});
      const unreadableNotice = result.notices.find((n) => n.code === 'PREFS_UNREADABLE');
      expect(unreadableNotice).toBeDefined();
    });

    it('handles unknown version', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return JSON.stringify({
              version: 99,
              settings: DEFAULT_SETTINGS,
              overrides: {},
            });
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings).toEqual(DEFAULT_SETTINGS);
      expect(result.preferences.overrides).toEqual({});
      const versionNotice = result.notices.find((n) => n.code === 'UNKNOWN_VERSION_RESET');
      expect(versionNotice).toBeDefined();
    });

    it('migrates legacy export-paper a4', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return null;
          }
          if (key === LEGACY_PAPER_KEY) {
            return 'a4';
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings.page).toBe('a4');
      const migratedNotice = result.notices.find((n) => n.code === 'MIGRATED_EXPORT_PAPER');
      expect(migratedNotice).toBeDefined();
    });

    it('migrates legacy export-paper letter', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return null;
          }
          if (key === LEGACY_PAPER_KEY) {
            return 'letter';
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings.page).toBe('letter');
      const migratedNotice = result.notices.find((n) => n.code === 'MIGRATED_EXPORT_PAPER');
      expect(migratedNotice).toBeDefined();
    });

    it('migrates legacy export-paper junk to letter', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return null;
          }
          if (key === LEGACY_PAPER_KEY) {
            return 'invalid-value';
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings.page).toBe('letter');
      const migratedNotice = result.notices.find((n) => n.code === 'MIGRATED_EXPORT_PAPER');
      expect(migratedNotice).toBeDefined();
    });

    it('drops malformed overrides silently', () => {
      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return JSON.stringify({
              version: 2,
              settings: DEFAULT_SETTINGS,
              overrides: {
                'target1': [
                  { boundaryId: 'b1', sourceRevision: 'rev1', kind: 'system' },
                  { boundaryId: 'b2' }, // missing fields
                  { boundaryId: 'b3', sourceRevision: 'rev3', kind: 'invalid-kind' }, // invalid kind
                ],
                'target2': 'not-an-array', // not an array
              },
            });
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.overrides['target1']).toEqual([
        { boundaryId: 'b1', sourceRevision: 'rev1', kind: 'system' },
      ]);
      expect(result.preferences.overrides['target2']).toBeUndefined();
    });

    it('drops stale overrides with STALE_ANCHOR notice', () => {
      const currentRevisions = {
        'target1': 'newer-revision',
      };

      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return JSON.stringify({
              version: 2,
              settings: DEFAULT_SETTINGS,
              overrides: {
                'target1': [
                  { boundaryId: 'b1', sourceRevision: 'old-revision', kind: 'system' },
                  { boundaryId: 'b2', sourceRevision: 'old-revision', kind: 'page' },
                ],
              },
            });
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage, currentRevisions);
      expect(result.preferences.overrides['target1']).toEqual([]);

      const staleNotices = result.notices.filter((n) => n.code === 'STALE_ANCHOR');
      expect(staleNotices).toHaveLength(1);
      expect(staleNotices[0]?.partId).toBe('target1');
    });

    it('keeps overrides with matching sourceRevision', () => {
      const currentRevisions = {
        'target1': 'matching-revision',
      };

      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return JSON.stringify({
              version: 2,
              settings: DEFAULT_SETTINGS,
              overrides: {
                'target1': [
                  { boundaryId: 'b1', sourceRevision: 'matching-revision', kind: 'system' },
                ],
              },
            });
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage, currentRevisions);
      expect(result.preferences.overrides['target1']).toHaveLength(1);
      expect(result.preferences.overrides['target1']?.[0]?.boundaryId).toBe('b1');
      const staleNotices = result.notices.filter((n) => n.code === 'STALE_ANCHOR');
      expect(staleNotices).toHaveLength(0);
    });

    it('handles valid round trip', () => {
      const prefs: Preferences = {
        version: 2,
        settings: {
          ...DEFAULT_SETTINGS,
          page: 'a4',
          marginMm: 15,
          staff: 'large',
        },
        overrides: {
          'target1': [
            { boundaryId: 'b1', sourceRevision: 'rev1', kind: 'system' },
            { boundaryId: 'b2', sourceRevision: 'rev1', kind: 'page' },
          ],
        },
      };

      const storage: StorageLike = {
        getItem: (key: string) => {
          if (key === PREFERENCES_KEY) {
            return JSON.stringify(prefs);
          }
          return null;
        },
        setItem: () => {},
        removeItem: () => {},
      };

      const result = readPreferences(storage);
      expect(result.preferences.settings.page).toBe('a4');
      expect(result.preferences.settings.marginMm).toBe(15);
      expect(result.preferences.settings.staff).toBe('large');
      expect(result.preferences.overrides['target1']).toHaveLength(2);
      expect(result.notices).toHaveLength(0);
    });
  });

  describe('writePreferences', () => {
    it('handles null storage', () => {
      const prefs: Preferences = {
        version: 2,
        settings: DEFAULT_SETTINGS,
        overrides: {},
      };

      const result = writePreferences(null, prefs);
      expect(result).toBe(false);
    });

    it('handles throwing setItem', () => {
      const storage: StorageLike = {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage error');
        },
        removeItem: () => {},
      };

      const prefs: Preferences = {
        version: 2,
        settings: DEFAULT_SETTINGS,
        overrides: {},
      };

      const result = writePreferences(storage, prefs);
      expect(result).toBe(false);
    });

    it('never writes or removes LEGACY_PAPER_KEY', () => {
      const calls: Array<{ method: string; key: string; value?: string }> = [];

      const storage: StorageLike = {
        getItem: () => null,
        setItem: (key: string, value: string) => {
          calls.push({ method: 'setItem', key, value });
        },
        removeItem: (key: string) => {
          calls.push({ method: 'removeItem', key });
        },
      };

      const prefs: Preferences = {
        version: 2,
        settings: DEFAULT_SETTINGS,
        overrides: {},
      };

      const result = writePreferences(storage, prefs);
      expect(result).toBe(true);

      // Verify LEGACY_PAPER_KEY was never touched
      const legacyCalls = calls.filter((c) => c.key === LEGACY_PAPER_KEY);
      expect(legacyCalls).toHaveLength(0);

      // Verify PREFERENCES_KEY was written
      const prefsCalls = calls.filter((c) => c.key === PREFERENCES_KEY && c.method === 'setItem');
      expect(prefsCalls).toHaveLength(1);
    });

    it('writes preferences JSON correctly', () => {
      let writtenValue: string | null = null;

      const storage: StorageLike = {
        getItem: () => null,
        setItem: (key: string, value: string) => {
          if (key === PREFERENCES_KEY) {
            writtenValue = value;
          }
        },
        removeItem: () => {},
      };

      const prefs: Preferences = {
        version: 2,
        settings: {
          ...DEFAULT_SETTINGS,
          page: 'a4',
          marginMm: 15,
        },
        overrides: {
          'target1': [
            { boundaryId: 'b1', sourceRevision: 'rev1', kind: 'system' },
          ],
        },
      };

      const result = writePreferences(storage, prefs);
      expect(result).toBe(true);
      expect(writtenValue).not.toBeNull();

      const parsed = JSON.parse(writtenValue!);
      expect(parsed.version).toBe(2);
      expect(parsed.settings.page).toBe('a4');
      expect(parsed.settings.marginMm).toBe(15);
      expect(parsed.overrides['target1']).toHaveLength(1);
    });

    it('returns false on write error and never throws', () => {
      const storage: StorageLike = {
        getItem: () => null,
        setItem: () => {
          throw new Error('Write failed');
        },
        removeItem: () => {},
      };

      const prefs: Preferences = {
        version: 2,
        settings: DEFAULT_SETTINGS,
        overrides: {},
      };

      expect(() => {
        writePreferences(storage, prefs);
      }).not.toThrow();

      const result = writePreferences(storage, prefs);
      expect(result).toBe(false);
    });
  });
});
