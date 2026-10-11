import type { BreakOverride, EffectiveBreak, EffectiveBreaks, LayoutSettings, MeiPart } from './types';

/** Compare reduced rationals "n/d" exactly via BigInt cross-multiplication (never floats). Denominators are positive. */
function compareOnset(a: string, b: string): number {
  const [an, ad] = parseRational(a);
  const [bn, bd] = parseRational(b);
  const lhs = an * bd;
  const rhs = bn * ad;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

function parseRational(s: string): readonly [bigint, bigint] {
  const [n, d] = s.split('/');
  const num = BigInt(n ?? '0');
  const den = d === undefined ? 1n : BigInt(d);
  return [num, den === 0n ? 1n : den];
}

/**
 * Resolve the REQUIRED breaks for one MEI part: user overrides plus, under the 'original'
 * line policy, source breaks. Automatic breaks are added later by paginate.
 *
 * Priority: user page > user system > source (original policy only).
 * A `page` entry implies a new system as well; it is represented as a single `kind: 'page'` entry.
 * Pure: inputs are never mutated. Output is sorted by boundary onset (exact rationals).
 */
export function resolveBreaks(
  part: MeiPart,
  settings: LayoutSettings,
  overrides: readonly BreakOverride[],
): EffectiveBreaks {
  const { conversion } = part.part;
  const byId = new Map(conversion.boundaries.map((b, i) => [b.id, { boundary: b, index: i }] as const));
  const dropped: { override: BreakOverride; reason: 'STALE_ANCHOR' | 'UNSAFE_ANCHOR' }[] = [];
  const user = new Map<string, 'system' | 'page'>();

  for (const override of overrides) {
    if (override.sourceRevision !== conversion.sourceRevision) {
      dropped.push({ override, reason: 'STALE_ANCHOR' });
      continue;
    }
    if (!byId.has(override.boundaryId)) {
      dropped.push({ override, reason: 'UNSAFE_ANCHOR' });
      continue;
    }
    if (user.get(override.boundaryId) !== 'page') user.set(override.boundaryId, override.kind);
  }

  const resolved = new Map<string, EffectiveBreak>();
  for (const [boundaryId, kind] of user) resolved.set(boundaryId, { boundaryId, kind, origin: 'user' });
  if (settings.linePolicy === 'original') {
    for (const b of conversion.boundaries) {
      if (b.sourceBreak && !resolved.has(b.id)) resolved.set(b.id, { boundaryId: b.id, kind: 'system', origin: 'source' });
    }
  }

  const breaks = [...resolved.values()].sort((x, y) => {
    const bx = byId.get(x.boundaryId);
    const by = byId.get(y.boundaryId);
    if (!bx || !by) return 0;
    return compareOnset(bx.boundary.onset, by.boundary.onset) || bx.index - by.index;
  });

  return { partId: part.part.id, breaks, droppedOverrides: dropped };
}
