// ---------------------------------------------------------------- settings ---
export type PagePresetId =
  | 'letter' | 'a4' | 'a5'                 // print
  | 'ipad-mini' | 'ipad-11' | 'ipad-13'    // screen (forScore and similar)
  | 'custom';
export type PageKind = 'print' | 'screen' | 'custom';
export type Orientation = 'portrait' | 'landscape';
export type PartKind = 'mei' | 'scan' | 'fixed';
export type LinePolicy = 'original' | 'automatic';
export type StaffSizeId = 'small' | 'medium' | 'large';
export type LyricSizeId = 'small' | 'medium' | 'large';
export type SpacingId = 'compact' | 'normal' | 'spacious';

/** Portrait-normalised physical size: widthMm <= heightMm. */
export interface PageSize { readonly widthMm: number; readonly heightMm: number }

export interface LayoutSettings {
  readonly version: 2;
  readonly page: PagePresetId;
  /** Non-null iff page === 'custom'. Portrait-normalised; each side in [PAGE_MIN_MM, PAGE_MAX_MM]; long/short <= PAGE_MAX_RATIO. */
  readonly customSize: PageSize | null;
  readonly orientation: Orientation;
  /** Integer mm in [MARGIN_MIN_MM, MARGIN_MAX_MM]. Default 12 for print, 4 for screen and custom. */
  readonly marginMm: number;
  readonly staff: StaffSizeId;              // default 'medium'
  readonly lyrics: LyricSizeId;             // default 'medium'
  readonly spacing: SpacingId;              // default 'normal'
  /** null = "As many as fit"; else integer 1..MAX_SYSTEMS_LIMIT (a maximum, never an exact count). */
  readonly maxSystems: number | null;
  readonly linePolicy: LinePolicy;          // default 'original'
}

export const PAGE_MIN_MM = 90;
export const PAGE_MAX_MM = 450;
export const PAGE_MAX_RATIO = 3;
export const MARGIN_MIN_MM = 3;
export const MARGIN_MAX_MM = 25;
export const PRINT_MARGIN_ADVISORY_MM = 6;  // print pages below this show an advisory, never block
export const MAX_SYSTEMS_LIMIT = 8;

/** Staff height in mm and the Verovio `unit` at scale 100 (staff height = 8 * unit * 0.1 mm). */
export const STAFF_SIZES: Readonly<Record<StaffSizeId, { readonly unit: number; readonly heightMm: number }>> = {
  small:  { unit: 7,  heightMm: 5.6 },
  medium: { unit: 9,  heightMm: 7.2 },
  large:  { unit: 12, heightMm: 9.6 },
};
export const LYRIC_SIZE: Readonly<Record<LyricSizeId, number>> = { small: 3.5, medium: 4.5, large: 5.5 };   // Verovio lyricSize
export const SYSTEM_SPACING: Readonly<Record<SpacingId, number>> = { compact: 2, normal: 4, spacious: 8 };  // Verovio spacingSystem

/**
 * Portrait sizes. Screen presets verified by spike S7 (2026-10-08) against Apple tech specs, ±0.3 %.
 */
export const PAGE_PRESETS: Readonly<Record<Exclude<PagePresetId, 'custom'>, PageSize & { readonly kind: Exclude<PageKind, 'custom'>; readonly label: string; readonly sub: string }>> = {
  letter:      { widthMm: 215.9, heightMm: 279.4, kind: 'print',  label: 'Letter',      sub: '8½ × 11 in' },
  a4:          { widthMm: 210,   heightMm: 297,   kind: 'print',  label: 'A4',          sub: '210 × 297 mm' },
  a5:          { widthMm: 148,   heightMm: 210,   kind: 'print',  label: 'A5',          sub: '148 × 210 mm' },
  'ipad-mini': { widthMm: 115.9, heightMm: 176.6, kind: 'screen', label: 'iPad mini',   sub: 'fills the screen in forScore' }, // 1488×2266 @326
  'ipad-11':   { widthMm: 157.8, heightMm: 227.1, kind: 'screen', label: '11-inch iPad', sub: 'fills the screen in forScore' }, // 1640×2360 @264
  'ipad-13':   { widthMm: 197.0, heightMm: 262.9, kind: 'screen', label: '13-inch iPad', sub: 'fills the screen in forScore' }, // 2048×2732 @264
};

export const DEFAULT_SETTINGS: LayoutSettings = {
  version: 2, page: 'letter', customSize: null, orientation: 'portrait', marginMm: 12,
  staff: 'medium', lyrics: 'medium', spacing: 'normal', maxSystems: null, linePolicy: 'original',
};

/** Physical page after orientation is applied. */
export interface PhysicalPage { readonly widthMm: number; readonly heightMm: number; readonly kind: PageKind }
export interface RectMm { readonly xMm: number; readonly yMm: number; readonly widthMm: number; readonly heightMm: number }

export type SettingsNoticeCode =
  | 'INVALID_VALUE_RESET' | 'UNKNOWN_VERSION_RESET' | 'MIGRATED_EXPORT_PAPER' | 'CUSTOM_SIZE_CLAMPED'
  | 'STORAGE_BLOCKED' | 'PREFS_UNREADABLE' | 'STALE_ANCHOR';
export interface SettingsNotice { readonly code: SettingsNoticeCode; readonly field: keyof LayoutSettings | null; readonly partId: string | null }
export interface NormalizedSettings { readonly settings: LayoutSettings; readonly notices: readonly SettingsNotice[] }

// ------------------------------------------------------------------- parts ---
export interface BreakOverride {
  readonly boundaryId: string;
  readonly sourceRevision: string;          // ApprovedConversion.sourceRevision
  readonly kind: 'system' | 'page';
}

export interface PartHeading {
  readonly label: string;
  readonly rubric: string | null;
  readonly rubricTranslation: string | null;
  readonly credit: string | null;
}

interface ExportPartBase {
  /** Unique within one export: `${segmentId}:${runIndex}`. */
  readonly id: string;
  readonly kind: PartKind;
  readonly label: string;
  readonly heading: PartHeading | null;
  /** Source systems this part covers. Used for selection and the 300 ceiling only, NEVER as output system counts. */
  readonly sourceSystemCount: number;
  readonly sourceRevision: string;          // render hash for mei/fixed; first stem for scan
}

export interface SafeBoundary {
  readonly id: string;                      // "b017"
  readonly onset: string;                   // reduced rational, whole notes
  readonly sourceBreak: boolean;             // a \forceBreak (or \break) in the source
  readonly division: 'finalis' | 'maxima' | 'maior' | 'minima' | null;
  readonly measureId: string;               // MEI xml:id of the <measure> that ENDS at this boundary
  /** Last lyric word before the boundary as printed ("eléison"), or null. Used in labels, menus and undo copy. */
  readonly afterText: string | null;
}

export interface MeiExportPart extends ExportPartBase {
  readonly kind: 'mei';
  readonly target: string;                  // e.g. "movement:ordinarium-missae-ix/kyrie"
  readonly renderHash: string;              // 32-hex, verbatim from data/typeset/manifest.json
  readonly conversion: ApprovedConversion;
}
export interface ScanExportPart extends ExportPartBase {
  readonly kind: 'scan';
  readonly stems: readonly string[];        // as ExportSegment.stems; fetch `${stem}@2x.png`
  /** True when an approved conversion exists but the reader chose scans on the page (UI explains how to switch). */
  readonly customizableAvailable: boolean;
}
export interface FixedExportPart extends ExportPartBase {
  readonly kind: 'fixed';
  readonly target: string;
  readonly renderHash: string;
  readonly letterPdf: string;
  readonly a4Pdf: string;
}
export type ExportPart = MeiExportPart | ScanExportPart | FixedExportPart;

/** A loaded MEI part ready for layout (B4 input). */
export interface MeiPart { readonly part: MeiExportPart; readonly meiXml: string }

export interface PartCapabilities {
  readonly page: true;
  readonly margins: true;
  readonly staffSize: boolean;
  readonly lyricsSize: boolean;
  readonly spacing: boolean;
  readonly linePolicy: boolean;
  readonly maxSystems: boolean;             // mei: true; scan: true (counts whole images); fixed: false
  readonly manualBreaks: boolean;
  readonly label: 'Customizable typeset' | 'Original scan' | 'Fixed typeset layout';
}

// --------------------------------------------------------- conversion data ---
export interface ApprovedConversion {
  readonly digest: string;                  // conversion digest (sha256 hex, 64)
  readonly meiUrl: string;                  // `${PUBLIC_ASSET_BASE}/mei/<digest>/score.mei`
  readonly meiSha256: string;
  readonly sourceRevision: string;          // === renderHash of the source it was converted from
  readonly profile: string;                 // "accompaniment-v1"
  readonly verovio: string;                 // exact build, e.g. "6.3.0-425dd7b"
  readonly boundaries: readonly SafeBoundary[];
  readonly capabilities: { readonly manualBreaks: boolean };
}
export interface ConversionManifestPart extends ApprovedConversion { readonly target: string; readonly renderHash: string }
export interface ConversionManifest { readonly schemaVersion: 1; readonly parts: readonly ConversionManifestPart[] }
export type ConversionLookup = (target: string, renderHash: string) => ApprovedConversion | null;

/** Pure input to snapshotSelection, built by readSelectionInput() from ExportBar's DOM (B3b). */
export interface SelectionInput {
  readonly title: string;
  readonly segments: readonly {
    readonly segmentId: string;
    readonly label: string;
    readonly rubric: string | null;
    readonly rubricTranslation: string | null;
    readonly credit: string | null;
    readonly stems: readonly string[];
    readonly runs: readonly {
      readonly count: number;
      readonly key: string | null;
      readonly label: string | null;
      readonly target: string | null;
      readonly hash: string | null;
      readonly letter: string | null;
      readonly a4: string | null;
      /** The reader currently sees scans for this run (ExportBar's showsScans(key)). */
      readonly showsScans: boolean;
    }[];
  }[];
}

// ------------------------------------------------------------------ layout ---
export interface EffectiveBreak {
  readonly boundaryId: string;
  readonly kind: 'system' | 'page';
  readonly origin: 'user' | 'source' | 'automatic';
}
export interface EffectiveBreaks {
  readonly partId: string;
  readonly breaks: readonly EffectiveBreak[];   // sorted by boundary onset
  readonly droppedOverrides: readonly { readonly override: BreakOverride; readonly reason: 'STALE_ANCHOR' | 'UNSAFE_ANCHOR' }[];
}

export interface ResourceLimits { readonly maxMeiBytes: number; readonly maxEvents: number; readonly maxPages: number; readonly jobTimeoutMs: number }
export const PROVISIONAL_LIMITS: ResourceLimits = { maxMeiBytes: 8 * 1024 * 1024, maxEvents: 20_000, maxPages: 100, jobTimeoutMs: 60_000 };

export interface LayoutConstraints {
  readonly page: PhysicalPage;
  readonly usable: RectMm;
  readonly maxSystems: number | null;
  readonly staffHeightMm: number;
  readonly requiredBreaks: readonly EffectiveBreak[];
  readonly expectedEventIds: ReadonlySet<string>;
}
export interface RenderContext {
  readonly token: number;
  readonly fonts: FontProfile;
  readonly limits: ResourceLimits;
  readonly isCancelled: () => boolean;
  readonly toolkit: VerovioLike;
}
/** Minimal Verovio surface we use (tests inject a fake). */
export interface VerovioLike {
  setOptions(options: Readonly<Record<string, string | number | boolean>>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  getLog(): string;
  getVersion(): string;
}

export interface SystemGeometry {
  readonly index: number;                       // 0-based within part
  readonly firstBoundaryId: string | null;      // boundary the system starts after; null for the first
  readonly topMm: number;                       // relative to the content origin
  readonly heightMm: number;
}
export interface MeiPageLayout { readonly svg: string; readonly systems: readonly SystemGeometry[] }
export interface MeiLayout {
  readonly partId: string;
  readonly pages: readonly MeiPageLayout[];
  readonly effectiveBreaks: EffectiveBreaks;
  readonly staffHeightMm: number;               // measured from the SVG
  readonly verovioOptions: Readonly<Record<string, string | number | boolean>>;
  readonly diagnostics: readonly LayoutDiagnostic[];
}

/** Canonical runtime codes. The UI copy deck (UI spec §7) maps every one of these; unknown codes get the generic copy. */
export type LayoutDiagnosticCode =
  | 'UNSATISFIABLE_LAYOUT' | 'CAP_EXCEEDED' | 'STALE_ANCHOR' | 'UNSAFE_ANCHOR' | 'CONTENT_CLIPPED'
  | 'EVENT_MISSING' | 'STAFF_HEIGHT_MISMATCH' | 'CROWDED_ORIGINAL_LINES'
  | 'RENDERER_FAILED' | 'RENDERER_LOAD_FAILED' | 'ASSET_MISSING' | 'ASSET_HASH_MISMATCH'
  | 'UNSAFE_SVG' | 'INVALID_PAGE' | 'FONT_UNAVAILABLE' | 'BUDGET_EXCEEDED' | 'SOURCE_CEILING'
  | 'FIXED_PAGE_COUNT_MISMATCH' | 'SCAN_TOO_LARGE' | 'PDF_FAILED' | 'CANCELLED' | 'TIMEOUT';
export type UnsatisfiableReason = 'system-too-tall' | 'system-too-wide' | 'heading-too-tall' | 'no-convergence';
export type LayoutSuggestion =
  | 'smaller-music' | 'larger-page' | 'landscape' | 'portrait' | 'smaller-margins' | 'fit-to-page' | 'remove-break';
export interface LayoutDiagnostic {
  readonly code: LayoutDiagnosticCode;
  readonly severity: 'error' | 'warning';
  readonly partId: string | null;
  readonly pageIndex: number | null;
  readonly boundaryIds: readonly string[];
  readonly reason: UnsatisfiableReason | null;     // non-null iff code === 'UNSATISFIABLE_LAYOUT'
  readonly suggestions: readonly LayoutSuggestion[];
  /** Developer detail for logs/data-code only. NEVER rendered to visitors. */
  readonly detail: string;
}

// ---------------------------------------------------------- canonical pages ---
export interface HeadingBlock {
  readonly lines: readonly { readonly text: string; readonly role: 'heading' | 'rubric' | 'translation' | 'credit'; readonly sizePt: number; readonly baselineMm: number }[];
  readonly rect: RectMm;
}
export interface Transform { readonly scaleX: number; readonly scaleY: number; readonly translateXMm: number; readonly translateYMm: number }

interface CanonicalPageBase {
  readonly index: number;                       // 0-based in export
  readonly widthMm: number;
  readonly heightMm: number;
  readonly partId: string;
  readonly printable: RectMm;                   // page minus margins
  readonly content: RectMm;                     // printable minus heading/footer reservation
  readonly heading: HeadingBlock | null;
  readonly footer: HeadingBlock | null;
  /** Fraction of content height left unused (0..1). UI shows the blank-page note when > 0.25 and another page of the same part follows. */
  readonly unusedFraction: number;
}
export interface MeiCanonicalPage extends CanonicalPageBase {
  readonly kind: 'mei';
  readonly svg: SanitizedSvg;
  readonly svgPlacement: Transform;
  readonly systemCount: number;
  readonly boundaries: readonly { readonly boundaryId: string; readonly rect: RectMm }[];
}
export interface ScanCanonicalPage extends CanonicalPageBase {
  readonly kind: 'scan';
  readonly images: readonly { readonly stem: string; readonly rect: RectMm; readonly pxWidth: number; readonly pxHeight: number }[];
  readonly systemCount: number;                 // complete images
}
export interface FixedCanonicalPage extends CanonicalPageBase {
  readonly kind: 'fixed';
  readonly sourceUrl: string;
  readonly sourcePaper: 'letter' | 'a4';        // rule: a4 when target h/w >= 1.35, else letter
  readonly sourcePageIndex: number;
  readonly sourceSizePt: { readonly width: number; readonly height: number };
  readonly transform: Transform;                // scaleX === scaleY always
  readonly systemCount: null;
}
export type CanonicalPage = MeiCanonicalPage | ScanCanonicalPage | FixedCanonicalPage;

export interface LayoutRequest {
  readonly token: number;
  readonly title: string;
  readonly parts: readonly ExportPart[];
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>;   // by part id
}
export interface LayoutResult {
  readonly token: number;
  readonly partIds: readonly string[];
  readonly digests: { readonly input: string; readonly settings: string; readonly fonts: string; readonly renderer: string; readonly result: string };
  readonly effectiveBreaks: readonly EffectiveBreaks[];
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly pages: readonly CanonicalPage[];
  readonly complete: boolean;                   // false => download disabled
}

// ------------------------------------------------------------------ worker ---
export type LayoutWorkerRequest =
  | { readonly type: 'layout'; readonly request: LayoutRequest }
  | { readonly type: 'cancel'; readonly token: number };
export type LayoutWorkerResponse =
  | { readonly type: 'progress'; readonly token: number; readonly partId: string; readonly done: number; readonly total: number }
  | { readonly type: 'result'; readonly token: number; readonly result: LayoutResult }
  | { readonly type: 'error'; readonly token: number; readonly diagnostic: LayoutDiagnostic };
export type PdfWorkerRequest = { readonly type: 'pdf'; readonly token: number; readonly result: LayoutResult };
export type PdfWorkerResponse =
  | { readonly type: 'progress'; readonly token: number; readonly done: number; readonly total: number }
  | { readonly type: 'pdf'; readonly token: number; readonly bytes: ArrayBuffer; readonly pageCount: number; readonly byteSize: number }
  | { readonly type: 'error'; readonly token: number; readonly diagnostic: LayoutDiagnostic };
export interface PdfResult { readonly bytes: Uint8Array; readonly pageCount: number; readonly byteSize: number }

// ------------------------------------------------------------------ assets ---
export interface AssetLoader {
  /** Fetch and verify sha256 (when given). Rejects with Error('ASSET_HASH_MISMATCH: <url>') or Error('ASSET_MISSING: <url>'). */
  bytes(url: string, sha256: string | null): Promise<Uint8Array>;
}
export interface PreviewBitmap { readonly width: number; readonly height: number; readonly blob: Blob }

// ------------------------------------------------------------------- fonts ---
/** v1 has exactly one profile (decision D3). Leipzig glyphs are SVG paths, so only TEXT fonts are embedded in the PDF. */
export type FontProfileId = 'leipzig+serif';
export interface FontAsset { readonly family: string; readonly url: string; readonly sha256: string; readonly license: string; readonly bytes: Uint8Array }
export interface FontProfile {
  readonly id: FontProfileId;
  readonly musicFont: 'Leipzig';            // Verovio `font`
  readonly lyricFont: FontAsset;            // per spike S3/S4: the face whose metrics Verovio lays lyrics out with
  readonly headingRegular: FontAsset;
  readonly headingItalic: FontAsset;
  readonly headingBold: FontAsset;
  readonly digest: string;
}

// --------------------------------------------------------------------- svg ---
export interface SanitizedSvg { readonly svg: string; readonly ids: readonly string[]; readonly namespace: string }
export interface SvgBounds { readonly widthMm: number; readonly heightMm: number; readonly contentBBox: RectMm }

// -------------------------------------------------------------- controller ---
export type ControllerPhase = 'idle' | 'loading' | 'rendering' | 'ready' | 'exporting' | 'error';
export interface ControllerState {
  readonly phase: ControllerPhase;
  readonly parts: readonly ExportPart[];
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>;
  readonly requestToken: number;
  readonly result: LayoutResult | null;           // current, matching requestToken
  readonly previousResult: LayoutResult | null;   // shown while rendering
  readonly diagnostics: readonly LayoutDiagnostic[];
  readonly notices: readonly SettingsNotice[];
  readonly canUndo: boolean;
  /** phase === 'ready' && result?.token === requestToken && result.complete && no error diagnostics */
  readonly canDownload: boolean;
}
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface ControllerDependencies {
  readonly createLayoutWorker: () => WorkerLike;
  readonly createPdfWorker: () => WorkerLike;
  readonly storage: StorageLike | null;
  readonly now: () => number;
  readonly setTimeout: (fn: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
  readonly saveFile: (bytes: Uint8Array, filename: string) => void;
  readonly limits: ResourceLimits;
  /** Admission profile; when absent, one is derived from `limits` (no aggregate event cap). */
  readonly profile?: ResourceProfile;
  /** Supplies MEI byte sizes and event counts when known; default counts source systems only. */
  readonly estimate?: (parts: readonly ExportPart[]) => BudgetInput;
}
export type BreakAction = BreakOverride | { readonly boundaryId: string; readonly kind: 'remove' };
export interface ExportController {
  open(parts: readonly ExportPart[], title?: string): void;
  updateSettings(patch: Partial<Omit<LayoutSettings, 'version'>>): void;
  setBreak(partId: string, action: BreakAction): void;
  /** Clears user breaks and restores every setting to default EXCEPT page, customSize, orientation. Undoable. */
  resetLayout(): void;
  undo(): void;                                   // session-only stack, max 50 entries
  download(): Promise<void>;
  cancelDownload(): void;
  close(): void;
  subscribe(listener: (state: ControllerState) => void): () => void;
}
export interface Preferences {
  readonly version: 2;
  readonly settings: LayoutSettings;
  readonly overrides: Readonly<Record<string, readonly BreakOverride[]>>;  // keyed by target
}
export interface PreferenceReadResult { readonly preferences: Preferences; readonly notices: readonly SettingsNotice[] }
export const PREFERENCES_KEY = 'export-layout-v2';
/** Read-only migration source: 'a4' -> page 'a4', anything else -> 'letter'. Never written or deleted (quick export owns it). */
export const LEGACY_PAPER_KEY = 'export-paper';

// ------------------------------------------------------------------ limits ---
export interface ResourceProfile {
  readonly version: number;
  readonly provisional: boolean;
  readonly limits: ResourceLimits;
  readonly maxAggregateEvents: number;
  readonly measuredOn: readonly { readonly device: string; readonly browser: string; readonly date: string }[];
  readonly rendererDigest: string;
  readonly fontDigest: string;
}
export interface BudgetInput { readonly meiBytes: readonly number[]; readonly eventCounts: readonly number[]; readonly sourceSystems: number; readonly predictedPages: number }
export type BudgetDecision =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly code: 'BUDGET_EXCEEDED' | 'SOURCE_CEILING'; readonly limit: string };
