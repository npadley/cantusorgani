import type { ExsurgeContext, ExsurgeLib } from '../exsurge';
import { cleanGabc } from '../gabc';
import type { ChantScale } from './chantScale';

/** What the renderer needs of one chant (the K4b ChantRef plus its GABC from /chant/<id>.json). */
export interface ChantSource {
  readonly id: number;
  readonly gabc: string;
  readonly annotation: string;
  readonly mode: string;
}

/** The face the PDF embeds; Exsurge must measure with it (CS §5 "Font consistency"). */
export const EXPORT_FONT_FAMILY = 'Liberation Serif';
/** Print ink for notation and text. */
const INK = '#000';
/** Rubric ink with at least 7:1 contrast on white PDF paper. */
export const RUBRIC_RED = '#a00000';

interface FontLoader {
  load(font: string): Promise<readonly unknown[]>;
}

/**
 * Waits for the regular and italic Liberation Serif that exportPreview.css declares. False when either
 * cannot be loaded (or is not declared), in which case the chant is omitted rather than measured with a
 * fallback face.
 */
export async function ensureExportFace(fonts: FontLoader | undefined = typeof document === 'undefined' ? undefined : document.fonts): Promise<boolean> {
  if (!fonts) return false;
  try {
    const faces = await Promise.all([
      fonts.load(`16px "${EXPORT_FONT_FAMILY}"`),
      fonts.load(`italic 16px "${EXPORT_FONT_FAMILY}"`),
    ]);
    return faces.every((loaded) => loaded.length > 0);
  } catch {
    return false;
  }
}

function context(lib: ExsurgeLib, scale: ChantScale): ExsurgeContext {
  const ctxt = new lib.ChantContext(lib.TextMeasuringStrategy.Canvas);
  ctxt.setGlyphScaling(1 / 16);
  ctxt.setFont(`'${EXPORT_FONT_FAMILY}'`, scale.setFontSize);
  ctxt.setRubricColor(RUBRIC_RED);
  ctxt.textColor = ctxt.staffLineColor = ctxt.neumeLineColor = ctxt.dividerLineColor = INK;
  ctxt.negativeFillColor = '#fff';
  ctxt.spaceBetweenSystems = 0;
  return ctxt;
}

const cache = new Map<string, Promise<string>>();

/** Test hook. */
export function clearChantRenderCache(): void {
  cache.clear();
}

/**
 * Draws one chant at the job's scale and returns Exsurge's SVG as a string (the layout worker
 * normalizes, splits and sanitizes it). Results are memoised by (chant, width, lyric size).
 * Resolves to null when the export face is unavailable; rejects when Exsurge fails on this GABC.
 */
export async function renderChantSvg(lib: ExsurgeLib, chant: ChantSource, scale: ChantScale): Promise<string | null> {
  if (!(await ensureExportFace())) return null;
  const key = `${chant.id}|${scale.widthUnits}|${scale.setFontSize}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = new Promise<string>((resolve, reject) => {
      try {
        const ctxt = context(lib, scale);
        const score = new lib.ChantScore(ctxt, lib.Gabc.createMappingsFromSource(ctxt, cleanGabc(chant.gabc)), true);
        score.annotation = new lib.Annotations(ctxt, `%${chant.annotation}%`, `%${chant.mode}%`);
        score.performLayoutAsync(ctxt, () => {
          try {
            score.layoutChantLines(ctxt, scale.widthUnits, () => {
              try {
                // createSvgNode(...).outerHTML: the same drawing as the page's switch (K3 escalation note).
                resolve(score.createSvgNode(ctxt).outerHTML);
              } catch (error) {
                reject(error);
              }
            });
          } catch (error) {
            reject(error);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
    cache.set(key, pending);
    pending.catch(() => cache.delete(key));
  }
  return pending;
}
