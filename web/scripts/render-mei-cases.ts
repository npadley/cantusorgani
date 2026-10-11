// Evidence renderer (card A5b): lay out one MEI file for a list of LayoutCases with the real
// production renderMei and real Verovio WASM, and write the SVG pages for the review packet.
//
//   pnpm exec esbuild scripts/render-mei-cases.ts --bundle --platform=node --format=esm \
//     --packages=external --outfile=node_modules/.cache/render-mei-cases.mjs
//   node node_modules/.cache/render-mei-cases.mjs MEI CASES.json OUT_DIR [BOUNDARIES.json]
//
// (The Python evidence builder does this itself; the bundling step exists only because the
// production layout modules import each other without file extensions.)
//
// Writes per case, in OUT_DIR/<caseId>/: <caseId>-p<n>.svg (production output, what a reader gets)
// and <caseId>-p<n>.bbox.svg (the same layout with Verovio bounding boxes, for geometry checks);
// plus one OUT_DIR/cases.json. No parallel renderer: this is layout.ts's renderMei.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import { renderMei } from '../src/lib/export-layout/layout.ts';
import { lyricCollisions } from '../src/lib/export-layout/__fixtures__/lyricCollisions';
import type { PageRects } from '../src/lib/export-layout/layout.ts';
import { defaultMarginFor, paperDimensions, usableRect } from '../src/lib/export-layout/settings.ts';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS, STAFF_SIZES } from '../src/lib/export-layout/types.ts';
import type {
  FontProfile,
  LayoutDiagnostic,
  LayoutSettings,
  MeiExportPart,
  MeiPart,
  PagePresetId,
  SafeBoundary,
  VerovioLike,
} from '../src/lib/export-layout/types.ts';

interface CaseSpec {
  readonly id: string;
  readonly page: string;
  readonly orientation: 'portrait' | 'landscape';
  readonly staff: 'small' | 'medium' | 'large';
  readonly line_policy: 'original' | 'automatic';
  readonly max_systems: number | null;
}
interface CaseResult {
  readonly id: string;
  readonly pageCount: number;
  readonly systemsPerPage: readonly number[];
  readonly systemCount: number;
  readonly staffHeightMm: number;
  readonly expectedStaffHeightMm: number;
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly marginMm: number;
  readonly contentWidthMm: number;
  readonly contentHeightMm: number;
  readonly files: readonly string[];
  /** Adjacent-lyric pairs closer than 1 mm, measured with real Liberation Serif widths (lyricCollisions.ts). */
  readonly lyricGaps: readonly { readonly page: number; readonly a: string; readonly b: string; readonly gapMm: number }[];
  readonly diagnostics: readonly { readonly code: string; readonly severity: string; readonly detail: string }[];
}

const [meiPath, casesPath, outDir, boundariesPath] = process.argv.slice(2);
if (!meiPath || !casesPath || !outDir) {
  console.error('usage: render-mei-cases MEI CASES.json OUT_DIR [BOUNDARIES.json]');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const meiXml = readFileSync(meiPath, 'utf8');
const cases = JSON.parse(readFileSync(casesPath, 'utf8')) as readonly CaseSpec[];
const boundaries: SafeBoundary[] = boundariesPath
  ? (JSON.parse(readFileSync(boundariesPath, 'utf8')) as SafeBoundary[])
  : [];

function settingsOf(spec: CaseSpec): LayoutSettings {
  const custom = /^custom:(\d+)x(\d+)$/.exec(spec.page);
  const page: PagePresetId = custom ? 'custom' : (spec.page as PagePresetId);
  const base: LayoutSettings = {
    ...DEFAULT_SETTINGS,
    page,
    customSize: custom ? { widthMm: Number(custom[1]), heightMm: Number(custom[2]) } : null,
    orientation: spec.orientation,
    staff: spec.staff,
    maxSystems: spec.max_systems,
    linePolicy: spec.line_policy,
  };
  return { ...base, marginMm: defaultMarginFor(paperDimensions(base).kind) };
}

function partOf(): MeiPart {
  const part: MeiExportPart = {
    id: 'seg:0', kind: 'mei', label: 'Evidence', heading: null, sourceSystemCount: 0, sourceRevision: 'evidence',
    target: 'evidence', renderHash: '0'.repeat(32),
    conversion: {
      digest: '0'.repeat(64), meiUrl: '', meiSha256: '', sourceRevision: 'evidence', profile: 'accompaniment-v1',
      verovio: '', boundaries, capabilities: { manualBreaks: boundaries.length > 0 },
    },
  };
  return { part, meiXml };
}

const wasm = await createVerovioModule();
const results: CaseResult[] = [];
let verovioVersion = '';
for (const spec of cases) {
  const settings = settingsOf(spec);
  const physical = paperDimensions(settings);
  const content = usableRect(physical, settings.marginMm);
  const rects: PageRects = { content, firstPageContent: content };
  const toolkit = new VerovioToolkit(wasm);
  verovioVersion = toolkit.getVersion();
  const caseDir = join(outDir, spec.id);
  mkdirSync(caseDir, { recursive: true });
  // Keep the newest bounding-box render of each page: renderMei strips the boxes from what it
  // returns, and its last render of page n is the one it returns.
  const raw = new Map<number, string>();
  const spy: VerovioLike = {
    setOptions: (o) => toolkit.setOptions(o),
    loadData: (d) => toolkit.loadData(d),
    getPageCount: () => toolkit.getPageCount(),
    getLog: () => toolkit.getLog(),
    getVersion: () => toolkit.getVersion(),
    renderToSVG: (n) => {
      const svg = toolkit.renderToSVG(n);
      raw.set(n, svg);
      return svg;
    },
    getOptions: () => toolkit.getOptions(),
  } as VerovioLike;
  try {
    const layout = await renderMei(partOf(), settings, [], {
      token: 1, fonts: {} as FontProfile, limits: PROVISIONAL_LIMITS, isCancelled: () => false, toolkit: spy,
    }, rects);
    const files: string[] = [];
    const lyricGaps = layout.pages.flatMap((p, i) => lyricCollisions(p.svg, 1.0).map((c) => ({ page: i + 1, ...c })));
    layout.pages.forEach((p, i) => {
      const n = i + 1;
      const name = `${spec.id}-p${n}.svg`;
      writeFileSync(join(caseDir, name), p.svg);
      files.push(`${spec.id}/${name}`);
      const boxed = raw.get(n);
      if (boxed !== undefined && boxed.includes('bounding-box')) {
        writeFileSync(join(caseDir, `${spec.id}-p${n}.bbox.svg`), boxed);
      }
    });
    const diagnostics = layout.diagnostics.map((d: LayoutDiagnostic) => ({
      code: d.code, severity: d.severity, detail: d.detail,
    }));
    results.push({
      id: spec.id,
      pageCount: layout.pages.length,
      systemsPerPage: layout.pages.map((p) => p.systems.length),
      systemCount: layout.pages.reduce((s, p) => s + p.systems.length, 0),
      staffHeightMm: layout.staffHeightMm,
      expectedStaffHeightMm: STAFF_SIZES[settings.staff].heightMm,
      pageWidthMm: physical.widthMm,
      pageHeightMm: physical.heightMm,
      marginMm: settings.marginMm,
      contentWidthMm: content.widthMm,
      contentHeightMm: content.heightMm,
      files,
      lyricGaps,
      diagnostics,
    });
  } finally {
    toolkit.destroy();
  }
}
writeFileSync(join(outDir, 'cases.json'), JSON.stringify({ verovio: verovioVersion, cases: results }, null, 2) + '\n');
console.log(`rendered ${results.length} case(s) into ${outDir}`);
