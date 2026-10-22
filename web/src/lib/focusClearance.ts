export interface Box { top: number; bottom: number }

/**
 * How far to scroll down so a focused element is not hidden under a bar pinned
 * to the bottom of the viewport. Zero when the element ends above the bar. `scroll-padding-bottom` cannot do this: the
 * browser does not scroll for an element that is already on screen.
 */
export function scrollToClearBar(focused: Box, bar: Box, gap = 16): number {
  if (focused.bottom <= bar.top) return 0;
  return focused.bottom + gap - bar.top;
}
