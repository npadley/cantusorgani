import type {
  BreakOverride,
  Preferences,
  PreferenceReadResult,
  SettingsNotice,
  StorageLike,
} from './types';
import { DEFAULT_SETTINGS, LEGACY_PAPER_KEY, PREFERENCES_KEY } from './types';
import { migrateLegacyPaper, normalizeSettings } from './settings';

function defaultPreferences(): Preferences {
  return { version: 2, settings: DEFAULT_SETTINGS, overrides: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBreakOverride(value: unknown): value is BreakOverride {
  if (!isRecord(value)) return false;
  return (
    typeof value.boundaryId === 'string' &&
    typeof value.sourceRevision === 'string' &&
    (value.kind === 'system' || value.kind === 'page')
  );
}

/**
 * Reads local export-layout preferences. Never throws.
 * Falls back to defaults with a notice when storage is blocked or the data is unusable.
 * `export-paper` is read as a one-way migration source and is never written or removed.
 */
export function readPreferences(
  storage: StorageLike | null,
  currentRevisions: Readonly<Record<string, string>> = {},
): PreferenceReadResult {
  if (storage === null) {
    return blocked();
  }

  let raw: string | null;
  let legacy: string | null;
  try {
    raw = storage.getItem(PREFERENCES_KEY);
    legacy = raw === null ? storage.getItem(LEGACY_PAPER_KEY) : null;
  } catch {
    return blocked();
  }

  const notices: SettingsNotice[] = [];

  if (raw === null) {
    if (legacy === null) {
      return { preferences: defaultPreferences(), notices };
    }
    const page = migrateLegacyPaper(legacy);
    notices.push({ code: 'MIGRATED_EXPORT_PAPER', field: 'page', partId: null });
    return {
      preferences: { version: 2, settings: { ...DEFAULT_SETTINGS, page }, overrides: {} },
      notices,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { preferences: defaultPreferences(), notices: [{ code: 'PREFS_UNREADABLE', field: null, partId: null }] };
  }
  if (!isRecord(parsed)) {
    return { preferences: defaultPreferences(), notices: [{ code: 'PREFS_UNREADABLE', field: null, partId: null }] };
  }

  // normalizeSettings resets unknown versions itself, so only hand it a version-2 candidate.
  const normalized = normalizeSettings(parsed.version === 2 ? parsed.settings : undefined);
  notices.push(...normalized.notices);

  const overrides: Record<string, BreakOverride[]> = {};
  if (isRecord(parsed.overrides)) {
    for (const [target, list] of Object.entries(parsed.overrides)) {
      if (target === '__proto__' || !Array.isArray(list)) continue;
      const valid = list.filter(isBreakOverride);
      const revision = Object.prototype.hasOwnProperty.call(currentRevisions, target)
        ? currentRevisions[target]
        : undefined;
      const fresh = revision === undefined
        ? valid
        : valid.filter((o) => o.sourceRevision === revision);
      if (fresh.length < valid.length) {
        notices.push({ code: 'STALE_ANCHOR', field: null, partId: target });
      }
      overrides[target] = fresh;
    }
  }

  return {
    preferences: { version: 2, settings: normalized.settings, overrides },
    notices,
  };
}

/**
 * Writes preferences to PREFERENCES_KEY. Returns false (never throws) when storage is
 * unavailable. Never touches LEGACY_PAPER_KEY.
 */
export function writePreferences(storage: StorageLike | null, prefs: Preferences): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
    return true;
  } catch {
    return false;
  }
}

function blocked(): PreferenceReadResult {
  return {
    preferences: defaultPreferences(),
    notices: [{ code: 'STORAGE_BLOCKED', field: null, partId: null }],
  };
}
