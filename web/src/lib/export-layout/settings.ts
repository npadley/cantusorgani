import type {
  LayoutSettings,
  PhysicalPage,
  RectMm,
  NormalizedSettings,
  SettingsNotice,
  PagePresetId,
  PageKind,
} from './types';
import {
  DEFAULT_SETTINGS,
  PAGE_PRESETS,
  PAGE_MIN_MM,
  PAGE_MAX_MM,
  PAGE_MAX_RATIO,
  MARGIN_MIN_MM,
  MARGIN_MAX_MM,
  STAFF_SIZES,
  LYRIC_SIZE,
  SYSTEM_SPACING,
} from './types';

/**
 * Converts layout settings to a physical page with dimensions in mm.
 * Applies orientation (landscape swaps width and height).
 */
export function paperDimensions(settings: LayoutSettings): PhysicalPage {
  let widthMm: number;
  let heightMm: number;
  let kind: PageKind;

  if (settings.page === 'custom') {
    const size = settings.customSize;
    if (!size) {
      throw new Error('customSize must be set when page is custom');
    }
    widthMm = size.widthMm;
    heightMm = size.heightMm;
    kind = 'custom';
  } else {
    const preset = PAGE_PRESETS[settings.page];
    widthMm = preset.widthMm;
    heightMm = preset.heightMm;
    kind = preset.kind;
  }

  // Apply orientation: swap if landscape
  if (settings.orientation === 'landscape') {
    [widthMm, heightMm] = [heightMm, widthMm];
  }

  return { widthMm, heightMm, kind };
}

/**
 * Validates and normalizes settings, returning a clean settings object
 * with any issues reported as notices.
 */
export function normalizeSettings(unknown: unknown): NormalizedSettings {
  const notices: SettingsNotice[] = [];

  // Type guard and version check
  if (
    typeof unknown !== 'object' ||
    unknown === null ||
    !('version' in unknown) ||
    (unknown as Record<string, unknown>).version !== 2
  ) {
    // Reset everything on version mismatch
    notices.push({
      code: 'UNKNOWN_VERSION_RESET',
      field: null,
      partId: null,
    });
    return { settings: DEFAULT_SETTINGS, notices };
  }

  const obj = unknown as Record<string, unknown>;
  let settings: LayoutSettings = DEFAULT_SETTINGS;

  // Helper to get a value with fallback
  const getField = <T,>(
    key: keyof LayoutSettings,
    validator: (v: unknown) => v is T,
    defaultValue: T
  ): T => {
    const value = obj[key];
    if (validator(value)) {
      return value;
    }
    notices.push({
      code: 'INVALID_VALUE_RESET',
      field: key,
      partId: null,
    });
    return defaultValue;
  };

  // Validate each field
  const page = getField<PagePresetId>(
    'page',
    (v): v is PagePresetId =>
      typeof v === 'string' && (v in PAGE_PRESETS || v === 'custom'),
    DEFAULT_SETTINGS.page
  );

  // Handle customSize with custom/null invariant
  let customSize: { readonly widthMm: number; readonly heightMm: number } | null = null;
  if (page === 'custom') {
    // Page is custom, so customSize must be valid
    if (obj.customSize === null || obj.customSize === undefined) {
      // custom page with null customSize: reset page to default
      const newPage = DEFAULT_SETTINGS.page;
      notices.push({
        code: 'INVALID_VALUE_RESET',
        field: 'page',
        partId: null,
      });
      // Return with default page and null customSize
      const marginMm = DEFAULT_SETTINGS.marginMm;
      return {
        settings: {
          version: 2,
          page: newPage,
          customSize: null,
          orientation: DEFAULT_SETTINGS.orientation,
          marginMm,
          staff: DEFAULT_SETTINGS.staff,
          lyrics: DEFAULT_SETTINGS.lyrics,
          spacing: DEFAULT_SETTINGS.spacing,
          maxSystems: DEFAULT_SETTINGS.maxSystems,
          linePolicy: DEFAULT_SETTINGS.linePolicy,
        },
        notices,
      };
    } else if (
      typeof obj.customSize === 'object' &&
      typeof (obj.customSize as Record<string, unknown>).widthMm === 'number' &&
      typeof (obj.customSize as Record<string, unknown>).heightMm === 'number' &&
      Number.isFinite((obj.customSize as Record<string, unknown>).widthMm) &&
      Number.isFinite((obj.customSize as Record<string, unknown>).heightMm)
    ) {
      customSize = obj.customSize as { readonly widthMm: number; readonly heightMm: number };
    } else {
      // Invalid customSize for custom page: reset to default page
      notices.push({
        code: 'INVALID_VALUE_RESET',
        field: 'customSize',
        partId: null,
      });
      const marginMm = DEFAULT_SETTINGS.marginMm;
      return {
        settings: {
          version: 2,
          page: DEFAULT_SETTINGS.page,
          customSize: null,
          orientation: DEFAULT_SETTINGS.orientation,
          marginMm,
          staff: DEFAULT_SETTINGS.staff,
          lyrics: DEFAULT_SETTINGS.lyrics,
          spacing: DEFAULT_SETTINGS.spacing,
          maxSystems: DEFAULT_SETTINGS.maxSystems,
          linePolicy: DEFAULT_SETTINGS.linePolicy,
        },
        notices,
      };
    }
  } else {
    // Page is non-custom, so drop any customSize to null
    if (obj.customSize !== null && obj.customSize !== undefined) {
      customSize = null;
      notices.push({
        code: 'INVALID_VALUE_RESET',
        field: 'customSize',
        partId: null,
      });
    }
  }

  // Clamp custom size if needed
  if (page === 'custom' && customSize) {
    let clamped = false;

    if (
      customSize.widthMm < PAGE_MIN_MM ||
      customSize.heightMm < PAGE_MIN_MM ||
      customSize.widthMm > PAGE_MAX_MM ||
      customSize.heightMm > PAGE_MAX_MM
    ) {
      customSize = {
        widthMm: Math.max(PAGE_MIN_MM, Math.min(PAGE_MAX_MM, customSize.widthMm)),
        heightMm: Math.max(PAGE_MIN_MM, Math.min(PAGE_MAX_MM, customSize.heightMm)),
      };
      clamped = true;
    }

    // Check and clamp ratio
    const maxDim = Math.max(customSize.widthMm, customSize.heightMm);
    const minDim = Math.min(customSize.widthMm, customSize.heightMm);
    if (maxDim / minDim > PAGE_MAX_RATIO) {
      const targetMin = maxDim / PAGE_MAX_RATIO;
      if (customSize.widthMm < customSize.heightMm) {
        customSize = { widthMm: targetMin, heightMm: customSize.heightMm };
      } else {
        customSize = { widthMm: customSize.widthMm, heightMm: targetMin };
      }
      clamped = true;
    }

    // Portrait-normalize: if width > height, swap them
    if (customSize.widthMm > customSize.heightMm) {
      customSize = { widthMm: customSize.heightMm, heightMm: customSize.widthMm };
    }

    if (clamped) {
      notices.push({
        code: 'CUSTOM_SIZE_CLAMPED',
        field: 'customSize',
        partId: null,
      });
    }
  }

  const orientation = getField<'portrait' | 'landscape'>(
    'orientation',
    (v): v is 'portrait' | 'landscape' => v === 'portrait' || v === 'landscape',
    DEFAULT_SETTINGS.orientation
  );

  // Margin: validate finitude, round, clamp
  let marginMm = getField<number>(
    'marginMm',
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
    DEFAULT_SETTINGS.marginMm
  );

  // Round margin to whole number
  const roundedMargin = Math.round(marginMm);
  if (roundedMargin !== marginMm) {
    marginMm = roundedMargin;
    notices.push({
      code: 'INVALID_VALUE_RESET',
      field: 'marginMm',
      partId: null,
    });
  }

  // Clamp margin to 3-25
  if (marginMm < MARGIN_MIN_MM || marginMm > MARGIN_MAX_MM) {
    marginMm = Math.max(MARGIN_MIN_MM, Math.min(MARGIN_MAX_MM, marginMm));
  }

  const staff = getField<'small' | 'medium' | 'large'>(
    'staff',
    (v): v is 'small' | 'medium' | 'large' => v === 'small' || v === 'medium' || v === 'large',
    DEFAULT_SETTINGS.staff
  );

  const lyrics = getField<'small' | 'medium' | 'large'>(
    'lyrics',
    (v): v is 'small' | 'medium' | 'large' => v === 'small' || v === 'medium' || v === 'large',
    DEFAULT_SETTINGS.lyrics
  );

  const spacing = getField<'compact' | 'normal' | 'spacious'>(
    'spacing',
    (v): v is 'compact' | 'normal' | 'spacious' =>
      v === 'compact' || v === 'normal' || v === 'spacious',
    DEFAULT_SETTINGS.spacing
  );

  // maxSystems: must be null or integer in 1..MAX_SYSTEMS_LIMIT
  let maxSystems: number | null = null;
  if (obj.maxSystems === null || obj.maxSystems === undefined) {
    maxSystems = null;
  } else if (
    typeof obj.maxSystems === 'number' &&
    Number.isFinite(obj.maxSystems) &&
    Number.isInteger(obj.maxSystems) &&
    obj.maxSystems >= 1 &&
    obj.maxSystems <= 8
  ) {
    maxSystems = obj.maxSystems;
  } else {
    maxSystems = DEFAULT_SETTINGS.maxSystems;
    notices.push({
      code: 'INVALID_VALUE_RESET',
      field: 'maxSystems',
      partId: null,
    });
  }

  const linePolicy = getField<'original' | 'automatic'>(
    'linePolicy',
    (v): v is 'original' | 'automatic' => v === 'original' || v === 'automatic',
    DEFAULT_SETTINGS.linePolicy
  );

  settings = {
    version: 2,
    page,
    customSize,
    orientation,
    marginMm,
    staff,
    lyrics,
    spacing,
    maxSystems,
    linePolicy,
  };

  return { settings, notices };
}

/**
 * Returns the default margin in mm for a given page kind.
 * 12 for print, 4 for screen and custom.
 */
export function defaultMarginFor(kind: PageKind): number {
  if (kind === 'print') {
    return 12;
  }
  return 4;
}

/**
 * Helper to determine if margin should follow new default when kind changes.
 * Returns the next margin value when transitioning between page kinds.
 * If the current margin equals the previous kind's default, apply the new default.
 * Otherwise, keep the user's custom margin.
 */
export function nextMargin(prevKind: PageKind, nextKind: PageKind, currentMargin: number): number {
  const prevDefault = defaultMarginFor(prevKind);
  const nextDefault = defaultMarginFor(nextKind);

  // If user hasn't changed the margin (it still equals the old default),
  // apply the new default
  if (currentMargin === prevDefault) {
    return nextDefault;
  }

  // User has changed it, so keep the current margin
  return currentMargin;
}

/**
 * Migrates legacy export-paper value to a PagePresetId.
 * 'a4' maps to 'a4', anything else (including 'letter', null, junk) maps to 'letter'.
 */
export function migrateLegacyPaper(value: string | null): PagePresetId {
  if (value === 'a4') {
    return 'a4';
  }
  return 'letter';
}

/**
 * Calculates the usable content rectangle inside a page, accounting for margins.
 */
export function usableRect(page: PhysicalPage, marginMm: number): RectMm {
  return {
    xMm: marginMm,
    yMm: marginMm,
    widthMm: page.widthMm - 2 * marginMm,
    heightMm: page.heightMm - 2 * marginMm,
  };
}

/**
 * Generates Verovio options from layout settings and content rectangle.
 * All options use scale: 100 per decision log D8.
 */
export function verovioOptions(
  settings: LayoutSettings,
  content: RectMm
): Readonly<Record<string, string | number | boolean>> {
  const page = paperDimensions(settings);

  return {
    // Scale and page geometry
    scale: 100,
    pageWidth: Math.floor(content.widthMm * 10),
    pageHeight: Math.floor(content.heightMm * 10),
    // Verovio draws the brace left of the system origin (S2): leave room for it.
    pageMarginLeft: Math.ceil(STAFF_SIZES[settings.staff].unit * 3),
    pageMarginRight: 0,
    pageMarginTop: 0,
    pageMarginBottom: 0,

    // Size settings
    unit: STAFF_SIZES[settings.staff].unit,
    lyricSize: LYRIC_SIZE[settings.lyrics],
    spacingSystem: SYSTEM_SPACING[settings.spacing],

    // Fixed options
    font: 'Leipzig',
    justifyVertically: page.kind !== 'print',
    header: 'none',
    footer: 'none',
    svgViewBox: true,
    mnumInterval: 0,
    xmlIdChecksum: true,
    evenNoteSpacing: true,
    spacingLinear: 0.25,
    spacingNonLinear: 0.6,
  };
}
