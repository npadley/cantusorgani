// Worker side of chant (CS §4.1, §5): the controller sends Exsurge's SVG strings; this turns each into
// sanitized, sized lines. Anything the normalizer or the sanitizer rejects becomes `null`, so that part
// prints without chant (compose reports CHANT_UNAVAILABLE). Nothing here is ever drawn unsanitized.
import { chantJobs, chantScaleFor } from './chantScale';
import { normalizeExsurgeSvg, splitChantLines } from './chantSvg';
import { sanitizePageSvg } from './svg';
import type { ChantLineArt, ExportPart, LayoutSettings } from './types';

/**
 * chantId -> its lines on paper, or null when it was not drawn or was rejected. Empty when chant is
 * off.
 */
export function buildChantLines(
  parts: readonly ExportPart[],
  settings: LayoutSettings,
  chantSvgs: ReadonlyMap<number, string> | null,
): ReadonlyMap<number, readonly ChantLineArt[] | null> {
  const out = new Map<number, readonly ChantLineArt[] | null>();
  if (settings.chant === 'off' || chantSvgs === null) return out;
  for (const { id, part } of chantJobs(parts)) {
    const raw = chantSvgs.get(id);
    if (raw === undefined) {
      out.set(id, null);
      continue;
    }
    try {
      const { mmPerUnit } = chantScaleFor(settings, part);
      const lines = splitChantLines(normalizeExsurgeSvg(raw)).map((l, line): ChantLineArt => ({
        chantId: id,
        line,
        svg: sanitizePageSvg(l.svg, `c${id}l${line}`),
        widthMm: l.widthUnits * mmPerUnit,
        heightMm: l.heightUnits * mmPerUnit,
      }));
      out.set(id, lines.length === 0 ? null : lines);
    } catch {
      out.set(id, null);
    }
  }
  return out;
}
