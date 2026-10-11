// Pure helpers for break editing (UI spec 4): labels, kinds, thinning, roving navigation and
// the action panel's rules. No DOM, so the rules are unit-tested directly.

import type { EffectiveBreak } from '../lib/export-layout/types';

export type BreakKind = 'none' | 'system' | 'page' | 'orig' | 'auto';
export const MIN_HANDLE_GAP_PX = 44;

/** What a boundary currently is, from the layout result's effective breaks. */
export function kindOf(effective: EffectiveBreak | undefined): BreakKind {
  if (effective === undefined) return 'none';
  if (effective.origin === 'user') return effective.kind === 'page' ? 'page' : 'system';
  return effective.origin === 'source' ? 'orig' : 'auto';
}

export function nowText(kind: BreakKind): string {
  switch (kind) {
    case 'system': return 'your new system';
    case 'page': return 'your new page';
    case 'orig': return 'original line break';
    case 'auto': return 'automatic line break';
    default: return 'no break';
  }
}

/** The glyph inside a handle's visible square. */
export function glyphOf(kind: BreakKind): string {
  return kind === 'page' ? '⤓' : kind === 'none' ? '' : '↵';
}

const quoted = (afterText: string | null): string => (afterText === null || afterText === '' ? 'this point' : `'${afterText}'`);

/** "Break point 4 of 23 in Kyrie, after 'eléison', page 1. Now: no break." */
export function handleLabel(o: { index: number; total: number; part: string; afterText: string | null; page: number; kind: BreakKind }): string {
  return `Break point ${o.index + 1} of ${o.total} in ${o.part}, after ${quoted(o.afterText)}, page ${o.page}. Now: ${nowText(o.kind)}.`;
}

/** The hover/focus caption under a handle. */
export function captionOf(afterText: string | null): string { return `after ${quoted(afterText)}`; }

export interface MenuModel {
  readonly title: string;
  readonly now: string;
  readonly system: { readonly label: string; readonly disabled: boolean } | null; // null: replaced by the original-line-break note
  readonly page: { readonly label: string; readonly disabled: boolean };
  readonly remove: boolean;
  readonly originalNote: string | null;
}

export function menuModel(o: { index: number; total: number; afterText: string | null; kind: BreakKind }): MenuModel {
  const orig = o.kind === 'orig';
  return {
    title: `After "${o.afterText ?? 'this point'}" · break point ${o.index + 1} of ${o.total}`,
    now: `Now: ${nowText(o.kind)}`,
    system: orig ? null : { label: o.kind === 'system' ? 'Start new system here (current)' : 'Start new system here', disabled: o.kind === 'system' },
    page: { label: o.kind === 'page' ? 'Start new page here (current)' : 'Start new page here', disabled: o.kind === 'page' },
    remove: o.kind === 'system' || o.kind === 'page',
    originalNote: orig ? 'Original line break. To remove it, choose Line breaks: Fit to page.' : null,
  };
}

export function statusAfter(action: 'system' | 'page' | 'remove', afterText: string | null): string {
  const where = quoted(afterText);
  const what = action === 'page' ? `New page starts after ${where}.` : action === 'system' ? `New system starts after ${where}.` : `Break removed after ${where}.`;
  return `${what} Undo is available.`;
}

/**
 * Which handles to show when they crowd: walk each row left to right and keep a handle only when it
 * is at least `minGap` px from the last one kept. Returns visibility in input order. Hit areas are
 * never shrunk; crowded handles are reached through the menu's Previous/Next.
 */
export function thin(points: readonly { row: string; x: number }[], minGap = MIN_HANDLE_GAP_PX): boolean[] {
  const visible = points.map(() => false);
  const rows = new Map<string, number[]>();
  points.forEach((p, i) => rows.set(p.row, [...(rows.get(p.row) ?? []), i]));
  for (const indexes of rows.values()) {
    indexes.sort((a, b) => points[a]!.x - points[b]!.x);
    let last = -Infinity;
    for (const i of indexes) {
      if (points[i]!.x - last >= minGap - 1e-9) { visible[i] = true; last = points[i]!.x; }
    }
  }
  return visible;
}

export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';
/** Roving focus over `count` ordered handles; clamps at both ends (it does not wrap). */
export function navigate(current: number, key: NavKey, count: number): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowLeft': return Math.max(0, current - 1);
    case 'ArrowRight': return Math.min(count - 1, current + 1);
    case 'Home': return 0;
    default: return count - 1;
  }
}
