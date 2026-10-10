import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import createVerovioModule from 'verovio/wasm';
import type { VerovioModule } from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';
import type { PageRects } from '../layout';
import { paperDimensions, usableRect } from '../settings';
import { DEFAULT_SETTINGS, PROVISIONAL_LIMITS } from '../types';
import type {
  FontProfile,
  LayoutDiagnostic,
  LayoutSettings,
  MeiExportPart,
  MeiPart,
  RenderContext,
  SafeBoundary,
  VerovioLike,
} from '../types';

/** Generous per-test budget for real-WASM tests (Vitest's 5 s default flakes under parallel load). */
export const WASM_TIMEOUT_MS = 30_000;

export const pad = (n: number): string => String(n).padStart(3, '0');

export function partOf(meiXml: string, boundaries: readonly SafeBoundary[], rev = 'rev1'): MeiPart {
  const part: MeiExportPart = {
    id: 'seg:0', kind: 'mei', label: 'Kyrie', heading: null, sourceSystemCount: 4, sourceRevision: rev,
    target: 'movement:test', renderHash: 'h'.repeat(32),
    conversion: {
      digest: 'd'.repeat(64), meiUrl: '', meiSha256: '', sourceRevision: rev, profile: 'accompaniment-v1',
      verovio: '6.3.0-425dd7b', boundaries, capabilities: { manualBreaks: true },
    },
  };
  return { part, meiXml };
}
export const settingsOf = (patch: Partial<LayoutSettings> = {}): LayoutSettings => ({ ...DEFAULT_SETTINGS, ...patch });
export const rectsOf = (s: LayoutSettings, headingMm = 0): PageRects => {
  const content = usableRect(paperDimensions(s), s.marginMm);
  return { content, firstPageContent: { ...content, heightMm: content.heightMm - headingMm } };
};
export function ctxOf(toolkit: VerovioLike, isCancelled: () => boolean = () => false): RenderContext {
  return { token: 1, fonts: {} as FontProfile, limits: PROVISIONAL_LIMITS, isCancelled, toolkit };
}
export const errors = (d: readonly LayoutDiagnostic[]): LayoutDiagnostic[] => d.filter((x) => x.severity === 'error');

export const EXPERIMENT_MEI = readFileSync(join(__dirname, 'kyrie-ix-experiment.mei'), 'utf8');
const SOURCE_BREAK_MEASURES = [8, 16, 26, 39, 50]; // each <sb/> follows these measures in the fixture
const m3 = (n: number): string => `m${pad(n)}`;
/**
 * Boundaries: the five source-break boundaries are b001..b005 (so b002 follows m016), the rest are c001...
 * Every measure but the last has one.
 */
export function experimentBoundaries(): SafeBoundary[] {
  const out: SafeBoundary[] = [];
  let other = 1;
  for (let k = 1; k <= 60; k++) {
    const si = SOURCE_BREAK_MEASURES.indexOf(k);
    out.push({
      id: si >= 0 ? `b${pad(si + 1)}` : `c${pad(other++)}`,
      onset: `${k}/1`, sourceBreak: si >= 0, division: null, measureId: m3(k), afterText: null,
    });
  }
  return out;
}
export const EXPERIMENT = partOf(EXPERIMENT_MEI, experimentBoundaries());
export const EXPERIMENT_NOTES = new Set([...EXPERIMENT_MEI.matchAll(/<note\b[^>]*?\sxml:id="([^"]+)"/g)].map((m) => m[1]!));

/** One Verovio WASM module per test file; toolkits are created per render and destroyed after the file. */
export function useRealVerovio(): { readonly newToolkit: () => VerovioToolkit } {
  let wasm: VerovioModule | undefined;
  const toolkits: VerovioToolkit[] = [];
  beforeAll(async () => { wasm = await createVerovioModule(); }, WASM_TIMEOUT_MS);
  afterAll(() => { for (const tk of toolkits) tk.destroy(); toolkits.length = 0; });
  return {
    newToolkit: () => {
      if (!wasm) throw new Error('Verovio WASM module not initialised');
      const tk = new VerovioToolkit(wasm);
      toolkits.push(tk);
      return tk;
    },
  };
}
