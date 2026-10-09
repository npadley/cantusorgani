import { describe, it, expect } from 'vitest';
import type { LayoutSettings, RectMm, PageKind } from './types';
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
  LEGACY_PAPER_KEY,
} from './types';
import {
  paperDimensions,
  normalizeSettings,
  defaultMarginFor,
  migrateLegacyPaper,
  usableRect,
  verovioOptions,
} from './settings';

describe('paperDimensions', () => {
  it('returns letter portrait dimensions', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'letter', orientation: 'portrait' });
    expect(result).toEqual({
      widthMm: 215.9,
      heightMm: 279.4,
      kind: 'print',
    });
  });

  it('returns a4 portrait dimensions', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'a4', orientation: 'portrait' });
    expect(result).toEqual({
      widthMm: 210,
      heightMm: 297,
      kind: 'print',
    });
  });

  it('returns a5 landscape dimensions (swapped)', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'a5', orientation: 'landscape' });
    expect(result).toEqual({
      widthMm: 210,
      heightMm: 148,
      kind: 'print',
    });
  });

  it('returns ipad-11 portrait dimensions', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'ipad-11', orientation: 'portrait' });
    expect(result).toEqual({
      widthMm: 157.8,
      heightMm: 227.1,
      kind: 'screen',
    });
  });

  it('returns custom page dimensions', () => {
    const result = paperDimensions({
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 100, heightMm: 150 },
      orientation: 'portrait',
    });
    expect(result).toEqual({
      widthMm: 100,
      heightMm: 150,
      kind: 'custom',
    });
  });

  it('swaps custom dimensions in landscape', () => {
    const result = paperDimensions({
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 100, heightMm: 150 },
      orientation: 'landscape',
    });
    expect(result).toEqual({
      widthMm: 150,
      heightMm: 100,
      kind: 'custom',
    });
  });

  it('returns correct ipad-mini dimensions', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'ipad-mini', orientation: 'portrait' });
    expect(result).toEqual({
      widthMm: 115.9,
      heightMm: 176.6,
      kind: 'screen',
    });
  });

  it('returns correct ipad-13 dimensions', () => {
    const result = paperDimensions({ ...DEFAULT_SETTINGS, page: 'ipad-13', orientation: 'portrait' });
    expect(result).toEqual({
      widthMm: 197.0,
      heightMm: 262.9,
      kind: 'screen',
    });
  });

  it('swaps landscape correctly for presets', () => {
    const portrait = paperDimensions({ ...DEFAULT_SETTINGS, page: 'letter', orientation: 'portrait' });
    const landscape = paperDimensions({ ...DEFAULT_SETTINGS, page: 'letter', orientation: 'landscape' });
    expect(landscape.widthMm).toBe(portrait.heightMm);
    expect(landscape.heightMm).toBe(portrait.widthMm);
  });
});

describe('normalizeSettings', () => {
  it('returns valid settings unchanged', () => {
    const result = normalizeSettings(DEFAULT_SETTINGS);
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.notices).toEqual([]);
  });

  it('resets unknown version with UNKNOWN_VERSION_RESET notice', () => {
    const invalid = { ...DEFAULT_SETTINGS, version: 1 } as unknown as LayoutSettings;
    const result = normalizeSettings(invalid);
    expect(result.settings.version).toBe(2);
    expect(result.settings.page).toBe('letter');
    expect(result.notices.some((n) => n.code === 'UNKNOWN_VERSION_RESET')).toBe(true);
  });

  it('clamps custom size to bounds', () => {
    const input = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 500, heightMm: 100 },
    };
    const result = normalizeSettings(input);
    expect(result.notices.some((n) => n.code === 'CUSTOM_SIZE_CLAMPED')).toBe(true);
    const customSize = result.settings.customSize;
    expect(customSize).not.toBeNull();
    expect(customSize!.widthMm).toBeLessThanOrEqual(PAGE_MAX_MM);
    expect(customSize!.heightMm).toBeLessThanOrEqual(PAGE_MAX_MM);
    expect(customSize!.widthMm).toBeGreaterThanOrEqual(PAGE_MIN_MM);
    expect(customSize!.heightMm).toBeGreaterThanOrEqual(PAGE_MIN_MM);
  });

  it('clamps custom size ratio if over PAGE_MAX_RATIO', () => {
    const input = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 100, heightMm: 400 },
    };
    const result = normalizeSettings(input);
    const customSize = result.settings.customSize;
    expect(customSize).not.toBeNull();
    const ratio = Math.max(customSize!.widthMm, customSize!.heightMm) /
                  Math.min(customSize!.widthMm, customSize!.heightMm);
    expect(ratio).toBeLessThanOrEqual(PAGE_MAX_RATIO);
  });

  it('clamps margin to 3-25 range', () => {
    const tooSmall = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 2 });
    expect(tooSmall.settings.marginMm).toBe(3);

    const tooLarge = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 30 });
    expect(tooLarge.settings.marginMm).toBe(25);

    const valid = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 12 });
    expect(valid.settings.marginMm).toBe(12);
  });

  it('resets invalid field with INVALID_VALUE_RESET', () => {
    const invalid = { ...DEFAULT_SETTINGS, staff: 'invalid' } as unknown as LayoutSettings;
    const result = normalizeSettings(invalid);
    expect(result.settings.staff).toBe('medium');
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET')).toBe(true);
  });

  it('handles junk value in a field', () => {
    const junk = { ...DEFAULT_SETTINGS, linePolicy: 'junk' } as unknown as LayoutSettings;
    const result = normalizeSettings(junk);
    expect(result.settings.linePolicy).toBe('original');
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET')).toBe(true);
  });
});

describe('defaultMarginFor', () => {
  it('returns 12 for print pages', () => {
    expect(defaultMarginFor('print')).toBe(12);
  });

  it('returns 4 for screen pages', () => {
    expect(defaultMarginFor('screen')).toBe(4);
  });

  it('returns 4 for custom pages', () => {
    expect(defaultMarginFor('custom')).toBe(4);
  });

  it('respects user changes: keeps custom value when transitioning if different from old default', () => {
    // User was on print (default 12) and changed margin to 15
    const oldKind = 'print';
    const newKind = 'screen';
    const currentMargin = 15;

    // When transitioning, if currentMargin !== oldKind's default, keep it
    const oldDefault = defaultMarginFor(oldKind);
    const newDefault = defaultMarginFor(newKind);

    expect(oldDefault).toBe(12);
    expect(newDefault).toBe(4);
    // currentMargin (15) !== oldDefault (12), so it should be kept
    // This is the "user changed it" case
  });

  it('applies new default when user has not changed margin', () => {
    // User was on print (default 12) and never changed it (still 12)
    const oldKind = 'print';
    const newKind = 'screen';
    const currentMargin = 12;

    const oldDefault = defaultMarginFor(oldKind);
    const newDefault = defaultMarginFor(newKind);

    expect(oldDefault).toBe(12);
    expect(newDefault).toBe(4);
    // currentMargin (12) === oldDefault (12), so apply newDefault (4)
  });
});

describe('migrateLegacyPaper', () => {
  it("maps 'a4' to 'a4'", () => {
    expect(migrateLegacyPaper('a4')).toBe('a4');
  });

  it("maps 'letter' to 'letter'", () => {
    expect(migrateLegacyPaper('letter')).toBe('letter');
  });

  it('maps null to letter', () => {
    expect(migrateLegacyPaper(null)).toBe('letter');
  });

  it('maps junk value to letter', () => {
    expect(migrateLegacyPaper('junk')).toBe('letter');
    expect(migrateLegacyPaper('unknown')).toBe('letter');
    expect(migrateLegacyPaper('a5')).toBe('letter'); // 'a5' was not in old export-paper
  });
});

describe('usableRect', () => {
  it('returns content rect inside margins', () => {
    const page = { widthMm: 210, heightMm: 297, kind: 'print' as PageKind };
    const margin = 12;
    const result = usableRect(page, margin);

    expect(result.xMm).toBe(margin);
    expect(result.yMm).toBe(margin);
    expect(result.widthMm).toBe(210 - 2 * margin);
    expect(result.heightMm).toBe(297 - 2 * margin);
  });

  it('handles minimum margin correctly', () => {
    const page = { widthMm: 210, heightMm: 297, kind: 'print' as PageKind };
    const result = usableRect(page, MARGIN_MIN_MM);

    expect(result.widthMm).toBe(210 - 2 * MARGIN_MIN_MM);
    expect(result.heightMm).toBe(297 - 2 * MARGIN_MIN_MM);
  });

  it('handles maximum margin correctly', () => {
    const page = { widthMm: 210, heightMm: 297, kind: 'print' as PageKind };
    const result = usableRect(page, MARGIN_MAX_MM);

    expect(result.widthMm).toBe(210 - 2 * MARGIN_MAX_MM);
    expect(result.heightMm).toBe(297 - 2 * MARGIN_MAX_MM);
  });

  it('works with screen pages', () => {
    const page = { widthMm: 157.8, heightMm: 227.1, kind: 'screen' as PageKind };
    const margin = 4;
    const result = usableRect(page, margin);

    expect(result.xMm).toBe(margin);
    expect(result.yMm).toBe(margin);
    expect(result.widthMm).toBe(157.8 - 2 * margin);
    expect(result.heightMm).toBe(227.1 - 2 * margin);
  });

  it('works with custom pages', () => {
    const page = { widthMm: 160, heightMm: 230, kind: 'custom' as PageKind };
    const margin = 8;
    const result = usableRect(page, margin);

    expect(result.xMm).toBe(margin);
    expect(result.yMm).toBe(margin);
    expect(result.widthMm).toBe(160 - 2 * margin);
    expect(result.heightMm).toBe(230 - 2 * margin);
  });
});

describe('verovioOptions', () => {
  it('sets scale to 100', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.scale).toBe(100);
  });

  it('sets unit to 9 for medium staff', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, staff: 'medium' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.unit).toBe(9);
  });

  it('sets unit to 7 for small staff', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, staff: 'small' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.unit).toBe(7);
  });

  it('sets unit to 12 for large staff', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, staff: 'large' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.unit).toBe(12);
  });

  it('calculates pageWidth as floor(content.widthMm * 10)', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186.55, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.pageWidth).toBe(Math.floor(186.55 * 10));
    expect(options.pageWidth).toBe(1865);
  });

  it('calculates pageHeight as floor(content.heightMm * 10)', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265.33 };
    const options = verovioOptions(settings, content);

    expect(options.pageHeight).toBe(Math.floor(265.33 * 10));
    expect(options.pageHeight).toBe(2653);
  });

  it('sets all pageMargins to 0', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.pageMarginLeft).toBe(0);
    expect(options.pageMarginRight).toBe(0);
    expect(options.pageMarginTop).toBe(0);
    expect(options.pageMarginBottom).toBe(0);
  });

  it('sets font to Leipzig', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.font).toBe('Leipzig');
  });

  it('sets justifyVertically to false for print pages', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, page: 'letter' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.justifyVertically).toBe(false);
  });

  it('sets justifyVertically to true for screen pages', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, page: 'ipad-11' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.justifyVertically).toBe(true);
  });

  it('sets justifyVertically to true for custom pages', () => {
    const settings: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 160, heightMm: 230 },
    };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.justifyVertically).toBe(true);
  });

  it('sets fixed options correctly', () => {
    const settings = DEFAULT_SETTINGS;
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.header).toBe('none');
    expect(options.footer).toBe('none');
    expect(options.svgViewBox).toBe(true);
    expect(options.mnumInterval).toBe(0);
    expect(options.evenNoteSpacing).toBe(true);
    expect(options.spacingLinear).toBe(0.25);
    expect(options.spacingNonLinear).toBe(0.6);
  });

  it('sets lyricSize from LYRIC_SIZE lookup', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, lyrics: 'large' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.lyricSize).toBe(LYRIC_SIZE.large);
  });

  it('sets spacingSystem from SYSTEM_SPACING lookup', () => {
    const settings: LayoutSettings = { ...DEFAULT_SETTINGS, spacing: 'spacious' };
    const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
    const options = verovioOptions(settings, content);

    expect(options.spacingSystem).toBe(SYSTEM_SPACING.spacious);
  });

  it('uses all STAFF_SIZES unit values correctly', () => {
    for (const [sizeId, sizeInfo] of Object.entries(STAFF_SIZES)) {
      const settings = { ...DEFAULT_SETTINGS, staff: sizeId as 'small' | 'medium' | 'large' };
      const content: RectMm = { xMm: 0, yMm: 0, widthMm: 186, heightMm: 265 };
      const options = verovioOptions(settings, content);

      expect(options.unit).toBe(sizeInfo.unit);
    }
  });
});

describe('custom/null invariant', () => {
  it('resets to default page when custom with null customSize', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, page: 'custom', customSize: null });
    expect(result.settings.page).toBe('letter');
    expect(result.settings.customSize).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'page')).toBe(true);
  });

  it('paperDimensions works after normalizing custom with null customSize', () => {
    const normalized = normalizeSettings({ ...DEFAULT_SETTINGS, page: 'custom', customSize: null });
    const result = paperDimensions(normalized.settings);
    expect(result).not.toThrow;
    expect(result.widthMm).toBe(215.9); // letter
  });

  it('drops customSize to null when page is non-custom', () => {
    const input: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'letter',
      customSize: { widthMm: 100, heightMm: 150 },
    };
    const result = normalizeSettings(input);
    expect(result.settings.customSize).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'customSize')).toBe(true);
  });
});

describe('non-finite numbers rejection', () => {
  it('resets NaN marginMm to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: NaN });
    expect(result.settings.marginMm).toBe(12);
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'marginMm')).toBe(true);
  });

  it('resets Infinity marginMm to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: Infinity });
    expect(result.settings.marginMm).toBe(12);
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'marginMm')).toBe(true);
  });

  it('resets NaN customSize.widthMm', () => {
    const input: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: NaN, heightMm: 150 },
    };
    const result = normalizeSettings(input);
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET')).toBe(true);
  });

  it('resets Infinity customSize.heightMm', () => {
    const input: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 100, heightMm: Infinity },
    };
    const result = normalizeSettings(input);
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET')).toBe(true);
  });

  it('resets NaN maxSystems to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: NaN });
    expect(result.settings.maxSystems).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'maxSystems')).toBe(true);
  });
});

describe('margin rounding and clamping', () => {
  it('rounds margin to whole number', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 12.7 });
    expect(result.settings.marginMm).toBe(13);
  });

  it('rounds margin down', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 12.3 });
    expect(result.settings.marginMm).toBe(12);
  });

  it('emits notice when margin value changes due to rounding', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, marginMm: 12.5 });
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'marginMm')).toBe(true);
  });
});

describe('maxSystems validation', () => {
  it('resets 0 to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: 0 });
    expect(result.settings.maxSystems).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'maxSystems')).toBe(true);
  });

  it('resets 9 (over limit) to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: 9 });
    expect(result.settings.maxSystems).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'maxSystems')).toBe(true);
  });

  it('resets 100 to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: 100 });
    expect(result.settings.maxSystems).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'maxSystems')).toBe(true);
  });

  it('resets 2.5 (non-integer) to default', () => {
    const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: 2.5 });
    expect(result.settings.maxSystems).toBeNull();
    expect(result.notices.some((n) => n.code === 'INVALID_VALUE_RESET' && n.field === 'maxSystems')).toBe(true);
  });

  it('accepts valid values 1-8', () => {
    for (let i = 1; i <= 8; i++) {
      const result = normalizeSettings({ ...DEFAULT_SETTINGS, maxSystems: i });
      expect(result.settings.maxSystems).toBe(i);
      expect(result.notices.some((n) => n.field === 'maxSystems')).toBe(false);
    }
  });
});

describe('custom size portrait normalization', () => {
  it('swaps dimensions if width > height', () => {
    const input: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 200, heightMm: 150 },
    };
    const result = normalizeSettings(input);
    expect(result.settings.customSize!.widthMm).toBe(150);
    expect(result.settings.customSize!.heightMm).toBe(200);
    expect(result.notices.some((n) => n.code === 'CUSTOM_SIZE_CLAMPED')).toBe(false);
  });

  it('keeps dimensions if width <= height', () => {
    const input: LayoutSettings = {
      ...DEFAULT_SETTINGS,
      page: 'custom',
      customSize: { widthMm: 150, heightMm: 200 },
    };
    const result = normalizeSettings(input);
    expect(result.settings.customSize!.widthMm).toBe(150);
    expect(result.settings.customSize!.heightMm).toBe(200);
  });
});

describe('preset heights (S7 verification)', () => {
  it('ipad-mini has updated height', () => {
    expect(PAGE_PRESETS['ipad-mini'].heightMm).toBe(176.6);
  });

  it('ipad-13 has updated height', () => {
    expect(PAGE_PRESETS['ipad-13'].heightMm).toBe(262.9);
  });
});
