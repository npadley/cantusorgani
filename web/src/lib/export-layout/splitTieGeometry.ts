import type { Element } from '@xmldom/xmldom';

/**
 * A split sustain can have several hidden fragments before a system break. Attach its outgoing
 * tie to the nearest visible predecessor head, rather than the hidden final fragment's position.
 * A previously revealed continuation is itself a head, so this never walks past that system start.
 * Only generated split ties use this helper; explicit musical ties retain their own endpoints.
 */
export function splitTieStartId(previous: Element, byXmlId: ReadonlyMap<string, Element>): string {
  const fallback = previous.getAttribute('xml:id') ?? '';
  const seen = new Set<string>();
  let current = previous;
  while (true) {
    const id = current.getAttribute('xml:id');
    if (!id || seen.has(id)) return fallback;
    seen.add(id);
    if (current.getAttribute('head.visible') !== 'false' && current.getAttribute('visible') !== 'false') return id;
    const ref = current.getAttribute('prev');
    const predecessor = ref?.startsWith('#') ? byXmlId.get(ref.slice(1)) : undefined;
    if (!predecessor || (predecessor.localName ?? predecessor.nodeName) !== 'note') return fallback;
    current = predecessor;
  }
}
