# Export Layout — Frozen Contracts (v2)

Date: 2026-10-08. Status: **authoritative**. This file supersedes the type sketches in the coordination plan (§3) and in each task. The coordinator freezes it in tasks **A1a** (Python) and **B3a** (TypeScript). After that, any change needs coordinator review, and every consumer's tests must be re-run.

Sources: the engineering review §5 (types), the design review §§C4/C5 (structured diagnostics, `afterText`), and the user decisions of 2026-10-08 (decision log D1–D6).

**What changed from v1:**
- `LayoutSettings` is now v2. It adds iPad screen presets and a custom page size. Margins are 3–25 mm.
- No music-font or text-font settings in v1 (D3). There is one font profile: `leipzig+serif`.
- Verovio runs at `scale: 100` with the page given in 0.1 mm, so `unit` 7/9/12 gives physical staves of 5.6/7.2/9.6 mm.
- `SafeBoundary.afterText` is new, and `LayoutDiagnostic` now carries structured `reason` and `suggestions`.
- `ExportRun` gains `target` and `hash` (task B3b).

Conventions:
- **TypeScript:** must compile under `web/tsconfig.json` (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). No `any`.
- **Python:** 3.12, frozen dataclasses, `fractions.Fraction` for every duration or onset. Floats are never used for musical time.
- **JSON:** stable sorted keys. Rationals are reduced strings such as `"7/8"`, `"0/1"`, `"3/1"`.
- **Hashes:**
  - Conversion and artifact hashes are SHA-256, full 64-character hex.
  - **Render hashes are copied verbatim** from `data/typeset/manifest.json`. These are SHA-256 truncated to 32 hex characters (`pipeline/typeset/render.py:90`).

---

## 1. TypeScript — `web/src/lib/export-layout/types.ts`

```ts
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
 * Portrait sizes. Screen presets verified by spike S7 (2026-10-08) against Apple tech specs, ±0.3 %
 * (native px / ppi * 25.4). Record the verified values and the device generation in the decision log.
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
  readonly sourceBreak: boolean;            // a \forceBreak (or \break) in the source
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
```

### 1.1 Mapping rules (`settings.ts`, each one is a unit test)

- `paperDimensions(s) -> PhysicalPage`: take the preset (or `customSize`), then swap width and height when `orientation === 'landscape'`. `kind` is the preset's kind, or `'custom'`.
- `normalizeSettings(unknown) -> NormalizedSettings`:
  - Unknown or invalid fields fall back to the `DEFAULT_SETTINGS` value, with an `INVALID_VALUE_RESET` notice.
  - A custom size out of bounds is clamped, with a `CUSTOM_SIZE_CLAMPED` notice.
  - `version !== 2` resets everything, with `UNKNOWN_VERSION_RESET`.
  - The margin is rounded to an integer and clamped to 3–25.
- `defaultMarginFor(kind)`: 12 for `print`, 4 for `screen` and `custom`. When the page kind changes, the margin follows the new default **only if** it still equals the old kind's default (the user hasn't touched it).
- `verovioOptions(settings, contentRect) -> Record<string, …>`, at **`scale: 100`**:
  - Page geometry: `pageWidth = floor(content.widthMm * 10)`, `pageHeight = floor(content.heightMm * 10)`. **`pageMarginLeft = ceil(unit * 3)`** (0.1 mm units: 2.1/2.7/3.6 mm), because Verovio draws the brace and the system barline at −0.28 × unit mm, left of the system origin (S2). **`pageMarginRight = 8`** (0.8 mm): Verovio justifies the final barline to the page edge and its stroke and glyphs overhang by 0.2 to 1.9 mm (worst: large staff on iPad mini). B4d diagnosis on Kyrie IX: not the left margin (overhang is the same with `pageMarginLeft` 0); 5 leaves 0.53 mm, 8 leaves at most 0.24 mm over the section 3 matrix plus three large-iPad cases. `pageMarginTop` and `pageMarginBottom` are `0`. We own the margins and headings. Clipping checks keep a 0.5 mm right-edge tolerance.
  - Sizes: `unit = STAFF_SIZES[staff].unit`, `lyricSize = LYRIC_SIZE[lyrics]`, `spacingSystem = SYSTEM_SPACING[spacing]`.
  - Fixed options: `font: 'Leipzig'`, `justifyVertically: page.kind !== 'print'`, `header: 'none'`, `footer: 'none'`, `svgViewBox: true`, `mnumInterval: 0`, `evenNoteSpacing: true`, `spacingLinear: 0.25`, `spacingNonLinear: 0.6`, **`xmlIdChecksum: true`**. That last option makes generated SVG ids reproducible, and makes Python and WASM output byte-identical (S2).
  - `breaks` is set by B4 (pass 1: `'line'` or `'auto'`; pass 2: `'encoded'`).
  - Verified by spike S2 (2026-10-09, `docs/superpowers/experiments/s2-verovio.md`): every name is accepted by Verovio 6.3.0. `setOptions` never reports a rejected name or value. It prints only to `console.error`, keeps the previous value, and `getLog()` stays empty. Callers therefore verify the values with `getOptions()`. `systemMaxPerPage` is deliberately unused, because `encoded` ignores it and the cap lives in `paginate()`. Pass 1 additionally sets `justifyVertically: false`, `pageHeight: 60000` and `svgBoundingBoxes: true`.
- The PDF MediaBox is exactly `widthMm × heightMm × 72/25.4` pt, as float64 with no further rounding. The Verovio SVG is placed at the content rect origin.

---

## 2. Python — `pipeline/typeset/mei/diagnostics.py`, `model.py`

```python
# pipeline/typeset/mei/diagnostics.py
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

Severity = Literal["error", "warning", "info"]
DiagnosticCode = Literal[
    # audit / extraction
    "SOURCE_CHECK_FAILED", "UNKNOWN_INCLUDE", "COMPILE_FAILED", "UNKNOWN_FEATURE",
    "LYRIC_UNANCHORED", "VOICE_ENDS_UNEQUAL",
    # encoding
    "UNSUPPORTED_FEATURE", "UNSAFE_BOUNDARY", "SCHEMA_INVALID",
    # validation (A4)
    "VOICE_MISSING", "VOICE_EXTRA", "PITCH_MISMATCH", "ONSET_MISMATCH", "DURATION_MISMATCH",
    "ATTACK_MISMATCH", "TIE_MISMATCH", "SLUR_MISMATCH", "DIVISION_MISMATCH", "ENTRY_MARKER_MISMATCH",
    "ACCIDENTAL_DISPLAY_MISMATCH", "NOTEHEAD_MISMATCH", "ENDING_MISSING", "LYRIC_TEXT_MISMATCH",
    "LYRIC_ANCHOR_MISMATCH", "FRAGMENT_OVERLAP", "FRAGMENT_GAP", "RENDER_EVENT_MISSING",
    # review / manifest / publish
    "STALE_APPROVAL", "MATRIX_INCOMPLETE", "NOT_APPROVED", "HASH_MISMATCH", "UNSAFE_PATH",
    "TARGET_HASH_MISMATCH", "UNMATCHED_TARGET", "ASSET_MISSING", "KEY_COLLISION",
    # evidence geometry (flag for review only, never blocking)
    "GEOMETRY_CLIPPING", "GEOMETRY_COLLISION",
]

@dataclass(frozen=True)
class SourceLocation:
    filename: str      # repo-relative POSIX, e.g. "data/typeset/include/noh2.ily"
    line: int          # 1-based
    column: int        # as LilyPond reports

@dataclass(frozen=True)
class Diagnostic:
    code: DiagnosticCode
    severity: Severity
    message: str
    source_location: SourceLocation | None = None
    event_ids: tuple[str, ...] = ()
    details: tuple[tuple[str, str], ...] = ()   # sorted (key, value) pairs; hashable

# Every error-severity code except GEOMETRY_* blocks approval.
BLOCKING: frozenset[str] = frozenset(...)  # A1a fills this from DiagnosticCode explicitly
```

```python
# pipeline/typeset/mei/model.py
from __future__ import annotations
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from typing import Literal, Protocol
from pipeline.typeset.mei.diagnostics import Diagnostic, SourceLocation

IR_SCHEMA_VERSION = 1

def rational_to_str(value: Fraction) -> str:
    """Fraction(14,16) -> "7/8"; Fraction(0) -> "0/1"; Fraction(3) -> "3/1"."""
def rational_from_str(text: str) -> Fraction:
    """Accept only r"-?\\d+/\\d+", reduced, denominator > 0. Raise ValueError on "0.5", "7/8.0", "14/16"."""

Step = Literal["c", "d", "e", "f", "g", "a", "b"]
EventKind = Literal["note", "rest", "skip"]
Notehead = Literal["normal", "hidden", "quilisma"]
PrintedAccidental = Literal["none", "sharp", "flat", "natural", "double-sharp", "double-flat"]
DivisionKind = Literal["finalis", "maxima", "maior", "minima"]
LayerRole = Literal["chant", "accompaniment", "voice-line"]
SpanKind = Literal["tie", "slur", "voice-line"]
BoundaryReason = Literal["sustain-not-splittable", "slur-crosses", "voice-line-crosses",
                         "lyric-extender-crosses", "not-common-onset"]

@dataclass(frozen=True)
class Pitch:
    step: Step
    alter: Fraction          # semitones: 1 sharp, -1 flat (LilyPond alteration * 2)
    octave: int              # scientific: middle C = 4

@dataclass(frozen=True)
class NotatedDuration:
    log: int                 # 0 whole, 1 half, 2 quarter, 3 eighth
    dots: int
    scale: Fraction          # 1 when unscaled; "2*3/4" -> Fraction(3, 4)

@dataclass(frozen=True)
class StaffDef:
    id: str                  # LilyPond Staff id ("up", "down") or "staff#<n>"
    index: int               # 1-based, top to bottom
    clef_shape: Literal["G", "F", "C"]
    clef_line: int
    key_fifths: int

@dataclass(frozen=True)
class LayerDef:
    id: str                  # "<staff>:<voice-id or #ordinal>"; Kyrie IX: "up:chant","up:#1","down:#2","down:#3"
    home_staff_id: str
    ordinal: int             # first-event order, 0-based
    voice_command: Literal["voiceOne", "voiceTwo", "voiceThree", "voiceFour", "none"]
    role: LayerRole          # "chant" iff a Lyrics context is associated; "voice-line" iff every notehead is hidden

@dataclass(frozen=True)
class Event:
    id: str                  # f"{layer.ordinal}e{seq:04d}", stable within one source revision
    layer_id: str
    staff_id: str            # effective staff (differs from home after \change Staff)
    kind: EventKind
    onset: Fraction          # whole notes from score start
    duration: Fraction       # includes scale
    notated: NotatedDuration
    pitch: Pitch | None      # None for rest/skip
    printed_accidental: PrintedAccidental
    notehead: Notehead
    stem_visible: bool
    tie_to_next: bool
    location: SourceLocation

@dataclass(frozen=True)
class Span:
    id: str
    kind: SpanKind
    start_event_id: str
    end_event_id: str

@dataclass(frozen=True)
class LyricSyllable:
    id: str
    text: str                # "" for a blank `_` token
    onset: Fraction
    anchor_event_id: str | None   # None => LYRIC_UNANCHORED diagnostic
    hyphen_after: bool
    extender_after: bool
    lyrics_context: str
    location: SourceLocation

@dataclass(frozen=True)
class EntryMarker:
    id: str
    text: str                # "*", "**"
    syllable_id: str         # syllable it precedes (\set stanza)
    location: SourceLocation

@dataclass(frozen=True)
class Division:
    id: str
    kind: DivisionKind       # from the BreathingSign stencil procedure name in noh2.ily
    onset: Fraction
    layer_id: str
    location: SourceLocation

@dataclass(frozen=True)
class Boundary:
    id: str                  # f"b{index:03d}" in onset order
    onset: Fraction
    source_break: bool
    division: DivisionKind | None
    after_text: str | None   # last lyric word (joined syllables, as printed) ending before this onset
    safe: bool
    reason: BoundaryReason | None   # non-None iff not safe

@dataclass(frozen=True)
class FeatureUse:
    family: str              # one of FEATURE_FAMILIES
    location: SourceLocation
    event_ids: tuple[str, ...]

FEATURE_FAMILIES: tuple[str, ...] = (
    "scaled-duration", "tie", "slur", "hidden-stem", "hidden-rest", "skip",
    "finalis", "divisio-maxima", "divisio-maior", "divisio-minima", "force-break",
    "stanza-marker", "blank-lyric", "melisma", "voice-line-voice", "voice-line-glissando",
    "cross-staff", "quilisma", "key-change", "clef-change", "note-shift", "manual-spacing",
)

@dataclass(frozen=True)
class ScoreIR:
    schema_version: Literal[1]
    source_path: str               # repo-relative
    dependency_digest: str
    lilypond_version: str
    extractor_version: str
    total_duration: Fraction
    staves: tuple[StaffDef, ...]
    layers: tuple[LayerDef, ...]
    events: tuple[Event, ...]      # sorted (onset, layer.ordinal, seq)
    spans: tuple[Span, ...]
    lyrics: tuple[LyricSyllable, ...]
    entry_markers: tuple[EntryMarker, ...]
    divisions: tuple[Division, ...]
    boundaries: tuple[Boundary, ...]
    features: tuple[FeatureUse, ...]
    diagnostics: tuple[Diagnostic, ...]
    def to_dict(self) -> dict[str, object]: ...   # rationals via rational_to_str; keys camelCase
    @classmethod
    def from_dict(cls, value: dict[str, object]) -> ScoreIR: ...

# --- profile -----------------------------------------------------------------
@dataclass(frozen=True)
class FeatureRule:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]  # engraving-only => review diagnostic, not a blocker
    mei: str                 # documentation of the mapping, e.g. "<breath type='divisio-minima'>"

@dataclass(frozen=True)
class ConversionProfile:
    id: str                  # "accompaniment-v1"
    version: int
    mei_version: Literal["5.0"]
    lyric_place: Literal["above"]
    container_policy: Literal["common-onset"]
    rules: tuple[FeatureRule, ...]
    @classmethod
    def load(cls, path: Path) -> ConversionProfile: ...   # data/typeset/mei/profiles/accompaniment-v1.json

# --- runner / extract ----------------------------------------------------------
class LilyPondRunnerAdapter(Protocol):
    version: str
    def run(self, args: list[str], cwd: Path, includes: tuple[Path, ...], timeout: int) -> tuple[bool, str]: ...
# Production wraps pipeline.typeset.lilypond.run + load_pin().version.
# Tests inject a fake that copies a checked-in TSV from tests/fixtures/mei/extraction/ into cwd.

@dataclass(frozen=True)
class ExtractionResult:
    ir: ScoreIR | None
    diagnostics: tuple[Diagnostic, ...]
    lilypond_version: str
    dependency_digest: str
    raw_evidence_path: Path            # build/typeset/mei/<digest>/events.tsv

# --- encode ----------------------------------------------------------------------
@dataclass(frozen=True)
class BoundaryManifestEntry:
    boundary_id: str
    onset: str                         # rational string
    measure_id: str                    # MEI xml:id of the measure ending here
    safe: bool
    source_break: bool
    division: DivisionKind | None
    after_text: str | None

@dataclass(frozen=True)
class FeatureDecision:
    family: str
    status: Literal["supported", "unsupported", "engraving-only"]
    occurrences: int

@dataclass(frozen=True)
class EncodedScore:
    xml: bytes
    artifact_sha256: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    feature_decisions: tuple[FeatureDecision, ...]
    provenance: dict[str, str]         # MEI xml:id -> IR event id (tied fragments map many->one)
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class SchemaBundle:
    root: Path                         # data/typeset/mei/schemas/mei-5.0/
    entry: str                         # "mei-CMN.rng"
    sha256: str                        # of the sorted concatenated files
    validator: str                     # chosen in S5

# --- validate ----------------------------------------------------------------------
@dataclass(frozen=True)
class NormalizedEvent:
    layer_key: str                     # f"{staff_index}.{layer_n}", NOT the IR id
    onset: Fraction
    duration: Fraction                 # tied fragments merged ONLY for a proven split
    kind: EventKind
    pitch: Pitch | None
    is_attack: bool
    notehead: Notehead
    printed_accidental: PrintedAccidental
    source_event_id: str | None        # via provenance; None is itself a difference

@dataclass(frozen=True)
class NormalizedScore:
    layers: dict[str, tuple[NormalizedEvent, ...]]
    lyrics: tuple[tuple[str, str | None], ...]     # (text, anchor source_event_id)
    entry_markers: tuple[tuple[str, str], ...]
    spans: tuple[tuple[SpanKind, str, str], ...]
    divisions: tuple[tuple[DivisionKind, Fraction], ...]
    total_duration: Fraction

@dataclass(frozen=True)
class SemanticDifference:
    code: str                          # a DiagnosticCode
    layer_key: str | None
    onset: Fraction | None
    source_event_ids: tuple[str, ...]
    detail: str

@dataclass(frozen=True)
class ValidationReport:
    schema_ok: bool
    schema_diagnostics: tuple[Diagnostic, ...]
    semantic_differences: tuple[SemanticDifference, ...]
    eligible: bool                     # schema_ok and no differences and no unsupported feature
    hashes: dict[str, str]
    tool_versions: dict[str, str]

# --- review ------------------------------------------------------------------------
ConversionState = Literal["unsupported", "failed", "needs-review", "approved"]

@dataclass(frozen=True)
class ConversionInputs:
    source_sha256: str
    include_sha256: str                # all data/typeset/include/*.ily, as render.source_hash does
    lilypond_version: str
    extractor_version: str
    converter_version: str
    profile_id: str
    profile_sha256: str
    schema_sha256: str
    verovio_version: str
    font_digest: str
    def digest(self) -> str: ...       # sha256 of canonical sorted JSON

@dataclass(frozen=True)
class LayoutCase:
    id: str                            # e.g. "letter-portrait-medium-original-auto"
    page: str                          # PagePresetId, or "custom:160x230"
    orientation: Literal["portrait", "landscape"]
    staff: Literal["small", "medium", "large"]
    line_policy: Literal["original", "automatic"]
    max_systems: int | None

REQUIRED_MATRIX: tuple[LayoutCase, ...]   # defined in §3 below; A5a builds it exactly

@dataclass(frozen=True)
class ReviewDecision:
    reviewer: str
    timestamp: str                     # ISO 8601 UTC
    inputs_digest: str
    artifact_sha256: str
    matrix_results: dict[str, Literal["pass", "fail", "accepted-difference"]]
    accepted_differences: tuple[str, ...]
    decision: Literal["approve", "reject"]

@dataclass(frozen=True)
class ConversionRecord:
    source_path: str
    target: str | None                 # from data/typeset/manifest.json; never inferred
    render_hash: str | None            # 32-hex from manifest.json
    state: ConversionState
    inputs: ConversionInputs
    artifact_sha256: str | None
    diagnostics: tuple[Diagnostic, ...]
    validation: ValidationReport | None
    review: ReviewDecision | None

class ReviewBlocked(Exception):
    def __init__(self, codes: tuple[str, ...], message: str) -> None: ...

@dataclass(frozen=True)
class EvidencePacket:
    directory: Path                    # build/typeset/mei/<digest>/evidence/
    index_html: Path
    cases: dict[str, Path]             # LayoutCase.id -> rendered SVG
    geometry_findings: tuple[Diagnostic, ...]

# --- audit ---------------------------------------------------------------------------
AuditClass = Literal["candidate", "source-check-failed", "compile-failed", "unknown-feature"]

@dataclass(frozen=True)
class SourceRecord:
    path: str
    dependency_digest: str
    includes: tuple[str, ...]          # today always ("gregorian.ly", "noh2.ily")
    target: str | None
    match_status: str | None           # from data/typeset/parts.yml
    voices: int
    staves: int
    features: dict[str, int]           # family -> count (text scan = candidate only)
    classification: AuditClass
    diagnostics: tuple[Diagnostic, ...]

@dataclass(frozen=True)
class AuditReport:
    sources: tuple[SourceRecord, ...]
    absent_targets: tuple[str, ...]    # catalogue targets with no source file
    family_counts: dict[str, int]
    unknown_commands: dict[str, int]
    proposed_pilot: tuple[str, ...]    # must equal PILOT_FIXTURES unless the coordinator changes it

PILOT_FIXTURES: tuple[str, ...] = (
    "vol-5/missa-ix/kyrie_IX.ly",            # F1 public pilot: 4 voices, entry markers
    "vol-3/al_ego_dilecto.csv.ly",           # F2 typical: 5th hidden voiceLines voice
    "vol-5/missa-xi/agnus_XI.ly",            # F3 \voiceLine "down" "up": cross-staff glissandi, printed accidentals (D15)
    "vol-5/missa-i/ite_Ib.ly",               # F4 \quil
    "vol-2/co_inclina_aurem_tuam.csv.ly",    # F5 divisio maior / maxima (also via \halfBar/\singleBar)
)

# --- manifest ------------------------------------------------------------------------
@dataclass(frozen=True)
class ManifestPart:                    # serialises to the TS ConversionManifestPart
    target: str
    render_hash: str
    digest: str
    mei_path: str                      # "mei/<digest>/score.mei"
    mei_sha256: str
    source_revision: str
    profile: str
    verovio: str
    boundaries: tuple[BoundaryManifestEntry, ...]
    capabilities: dict[str, bool]      # {"manualBreaks": bool}

@dataclass(frozen=True)
class ConversionManifest:
    schema_version: Literal[1]
    parts: tuple[ManifestPart, ...]

# --- publish / batch -----------------------------------------------------------------
class AssetStore(Protocol):
    def exists(self, key: str) -> bool: ...
    def put_if_absent(self, key: str, data: bytes, content_type: str) -> bool: ...

@dataclass(frozen=True)
class PublishInputs:
    records: tuple[ConversionRecord, ...]
    prefix: str                        # "mei"

@dataclass(frozen=True)
class VerifiedBundle:
    root: Path
    files: dict[str, str]              # key -> sha256

@dataclass(frozen=True)
class PublishReport:
    uploaded: tuple[str, ...]
    skipped_existing: tuple[str, ...]

class PublishBlocked(Exception): ...

@dataclass(frozen=True)
class BatchReport:
    requested: tuple[str, ...]
    results: dict[str, ConversionState]
    counts: dict[str, int]             # every ConversionState key present, zero allowed
    cached: tuple[str, ...]
    evidence: dict[str, Path]
```

---

## 3. Required review matrix (A5, B10)

`REQUIRED_MATRIX` has exactly these cases. Each runs on every pilot fixture. Medium staff and "As many as fit" apply unless a case says otherwise.

| id | page | orientation | staff | line policy | cap |
|---|---|---|---|---|---|
| letter-p-orig | letter | portrait | medium | original | — |
| letter-p-auto | letter | portrait | medium | automatic | — |
| letter-l-orig | letter | landscape | medium | original | — |
| a4-p-orig | a4 | portrait | medium | original | — |
| a4-l-auto | a4 | landscape | medium | automatic | — |
| a5-p-auto | a5 | portrait | medium | automatic | — |
| a5-l-orig | a5 | landscape | medium | original | — |
| letter-p-large-auto | letter | portrait | large | automatic | — |
| letter-p-small-cap2 | letter | portrait | small | automatic | 2 |
| ipad11-p-auto | ipad-11 | portrait | medium | automatic | — |
| ipad11-l-large-auto | ipad-11 | landscape | large | automatic | — |
| ipadmini-p-auto | ipad-mini | portrait | medium | automatic | — |
| custom-160x230-auto | custom:160x230 | portrait | medium | automatic | — |

The pass criterion for every case is the same:
- All voices, lyrics and final systems are present.
- Nothing is clipped.
- The cap is honoured.
- Page boundaries are visibly separate.
- The measured staff height is within ±0.1 mm.

No case asserts an exact system count. The old "Letter/Large/Automatic → 4 + 1" expectation was measured at `scale: 40` and has been dropped.

## 4. TSV grammar (output of `listen_full.ily`, owned by spike S1)

**Finalised by S1 (2026-10-09), extractor `listen_full/1`.** This replaced the draft grammar; the change list is at the end of this section. Raw outputs for F1–F5 (F3 is `agnus_XI` per D15; `agnus_IX.tsv` is kept as a supplementary same-staff glissando fixture) are checked in at `tests/fixtures/mei/extraction/<basename>.tsv`. Evidence and field mapping: `docs/superpowers/experiments/s1-extraction.md`.
- One record per line, `\n`-terminated, UTF-8. Fields are tab-separated; the field count is fixed per `kind` (column 4).
- `onset` is an exact Guile rational of whole notes (`"109/8"`, `"0"`, `"3"`); parse with `Fraction`. A moment with a grace part is written `main@grace` so that a plain-rational parser fails loudly (no pilot has one).
- `dur` is the same kind of rational and already includes the duration scale.
- `loc` is `file:line:col` with a repository-relative file, a 1-based line and LilyPond's 0-based column; `-` when no event caused the record. A location inside `noh2.ily`'s music functions reports the **call site** in the source.
- `<layer>` is `<home staff>:<voice id>` or `<home staff>:#<ordinal>` (Kyrie IX: `up:chant`, `up:#1`, `down:#2`, `down:#3`). The home staff and ordinal are fixed at the voice's first record; the ordinal counts voices in first-record order and equals `LayerDef.ordinal`. Voices that never emit a record (an empty `voiceLines` voice) produce no layer.
- `<staff>` (column 3 on voice rows) is the **effective** staff when the record happened, so it differs from the layer's home staff after `\change Staff` (`\voiceLine "down" "up"`). `staff#<n>` names an unnamed staff.
- `lyrics:<ctx>` is the Lyrics context id, or `#<n>` in first-syllable order for unnamed contexts. `<assoc-layer>` is the layer of the Lyrics context's `associatedVoiceContext` at that moment, `-` if none (=> `LYRIC_UNANCHORED`).
- Within one onset, rows come in LilyPond's iteration order: listener rows (note, slur, tie, gliss, lyric ...) before acknowledger rows (head, stem, div, acc). Readers must key acknowledger rows by `(onset, layer, loc)`, not by adjacency.
- Text fields escape `\` as `\\`, tab as `\t`, newline as `\n`, CR as `\r`. A blank syllable (`_`) is the empty string.

```
onset  -            -        version  extractor(listen_full/N) lilypond(X.Y.Z)        # first row
onset  -            <staff>  staff    index(1-based, creation = top-to-bottom order)   # once per Staff
onset  <layer>      <home>   voice    ordinal voice_command(voiceOne..voiceFour|none)  # once per layer, before its first record
onset  -            <staff>  key      fifths loc                                       # one per voice that states \key (dedupe)
onset  -            <staff>  clef     glyph(clefs.G|clefs.F|clefs.C...) position loc   # only when glyph/position changes; loc usually "-"
onset  <layer>      <staff>  note     step(a-g) alter(semitones) octave(sci, c'=4) log dots scale_num scale_den dur loc
onset  <layer>      <staff>  rest     dur loc
onset  <layer>      <staff>  skip     dur loc
onset  <layer>      <staff>  head     transparent(0|1) stencil(normal|quilisma|none|other) loc   # acknowledger; loc = its note's loc
onset  <layer>      <staff>  rhead    hidden(0|1) loc                                  # rest grob; hidden = transparent or no stencil
onset  <layer>      <staff>  stem     hidden(0|1) loc                                  # one per chord; also emitted for rests; loc = first note/rest
onset  <layer|->    <staff>  acc      kind(natural|sharp|flat|double-sharp|double-flat|other) loc   # printed (visible) accidentals only
onset  <layer>      <staff>  col      force_hshift(number|-) x_extent(a,b|-) loc       # only when a source override is in force
onset  <layer>      <staff>  tie      loc
onset  <layer>      <staff>  slur     dir(-1 start|1 stop) loc
onset  <layer>      <staff>  gliss    loc                                              # any \glissando, incl. \voiceLine's
onset  <layer>      <staff>  div      kind(finalis|maxima|maior|minima|other) loc      # BreathingSign stencil procedure
onset  -            -        break    loc                                              # line-break-event with break-permission 'force
onset  lyrics:<ctx> <assoc-layer|->  lyric    text stanza loc                          # text "" = blank; stanza "-" = no new marker
onset  lyrics:<ctx> <assoc-layer|->  hyphen   loc
onset  lyrics:<ctx> <assoc-layer|->  extender loc
```

**Changes from the draft (coordinator review needed):** added `version`, `staff`, `voice`, `rhead`, `acc` and `col` rows; added `loc` to `head` and `stem` (needed to key them to their note); `head` stencil also allows `none|other`, `div` kind also allows `other`; `stem` and `rhead` report "hidden" (transparent **or** no stencil); `note` fields are now in IR units (step letter, alter in semitones, scientific octave); `key` is emitted once per voice stating `\key` (readers dedupe); `clef` is emitted only on change; lyric rows give `stanza` as `-` when no new marker; `hyphen`/`extender` gain `loc`; `break` is only a **forced** break.
