/**
 * GABC as Exsurge needs it, and the viewer's chant preference.
 */

/** GregoBase markup Exsurge does not know and would print literally ("<eu>E u o u a e</eu>"). */
const UNSUPPORTED_TAGS = /<\/?(?:eu|nlba|alt)>/g;

export function cleanGabc(gabc: string): string {
  return gabc.replace(UNSUPPORTED_TAGS, "").trim();
}

export type ChantDisplay = "link" | "show";
export const CHANT_PREF_KEY = "chant-display";

/** Storage that may be missing or throw (privacy modes, previews). */
export interface PrefStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored preference; "link" unless the viewer chose to show the chant. */
export function readChantDisplay(store: PrefStore | null): ChantDisplay {
  try {
    return store?.getItem(CHANT_PREF_KEY) === "show" ? "show" : "link";
  } catch {
    return "link";
  }
}

/** Remember the choice; a store that throws is ignored, the page still works. */
export function writeChantDisplay(store: PrefStore | null, value: ChantDisplay): void {
  try {
    store?.setItem(CHANT_PREF_KEY, value);
  } catch {
    // Per-viewer convenience only.
  }
}
