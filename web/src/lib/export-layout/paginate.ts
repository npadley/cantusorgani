export interface PaginateInput {
  readonly systems: readonly { readonly heightMm: number; readonly startsAfterBoundary: string | null }[];
  readonly contentHeightMm: number;          // first page: minus heading
  readonly firstPageContentHeightMm: number;
  readonly minGapMm: number;                 // spacingSystem in mm
  readonly maxSystems: number | null;
  readonly forcedPageStarts: ReadonlySet<number>; // system indices from user page breaks
}
export type PaginateResult =
  | { readonly ok: true; readonly pages: readonly (readonly number[])[] }
  | { readonly ok: false; readonly code: 'SYSTEM_TOO_TALL'; readonly systemIndex: number };

/**
 * Pure greedy fill in system order. A new page starts when the cap is reached,
 * the next system (plus the minimum gap) would overflow the page, or the system
 * index is a forced page start (index 0 is a no-op).
 */
export function paginate(input: PaginateInput): PaginateResult {
  const { systems, contentHeightMm, firstPageContentHeightMm, minGapMm, maxSystems, forcedPageStarts } = input;
  const pages: number[][] = [];
  let current: number[] = [];
  let used = 0;
  let limit = firstPageContentHeightMm;

  for (let i = 0; i < systems.length; i++) {
    const h = systems[i]!.heightMm;
    if (current.length > 0) {
      const capReached = maxSystems !== null && current.length >= maxSystems;
      const overflows = used + minGapMm + h > limit;
      if (capReached || overflows || forcedPageStarts.has(i)) {
        pages.push(current);
        current = [];
        used = 0;
        limit = contentHeightMm;
      }
    }
    if (current.length === 0) {
      if (h > limit) return { ok: false, code: 'SYSTEM_TOO_TALL', systemIndex: i };
      used = h;
    } else {
      used = used + minGapMm + h;
    }
    current.push(i);
  }
  if (current.length > 0) pages.push(current);
  return { ok: true, pages };
}
