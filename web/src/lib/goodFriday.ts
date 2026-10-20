import doc from "../../../data/good-friday.json";

/**
 * Good Friday's chant-only page. The organ is silent from the Gloria of Holy
 * Thursday to the Easter Vigil, and NOH prints nothing for the day, so the
 * page is the Gregorian chants alone: GregoBase ids chosen by hand in
 * data/good-friday.json, their notation in data/chants.json (`noh chants`).
 */
export const GOOD_FRIDAY_HREF = "/good-friday/";

export interface GoodFridayItem {
  readonly label: string;
  readonly gregobase_id: number;
  readonly source: string;
  readonly note?: string;
}

export interface GoodFridaySection {
  readonly heading: string;
  readonly items: readonly GoodFridayItem[];
  readonly note?: string;
}

export interface GoodFridayRite {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly edition: string;
  readonly sections: readonly GoodFridaySection[];
}

interface RawGoodFriday {
  readonly calendars: { readonly "1962": string; readonly "ordinary-form": string };
  readonly rites: readonly GoodFridayRite[];
}

const data = doc as RawGoodFriday;

export function goodFridayRites(): readonly GoodFridayRite[] {
  return data.rites;
}

/** The chant-only page for a 1962 calendar key or an Ordinary Form occasion,
 *  at the anchor of its rite; null for every other day. */
export function goodFridayHref(key: string): string | null {
  if (key === data.calendars["1962"]) return `${GOOD_FRIDAY_HREF}#missal-1962`;
  if (key === data.calendars["ordinary-form"]) return `${GOOD_FRIDAY_HREF}#ordinary-form`;
  return null;
}

/** Every GregoBase id the page shows, in page order, without repeats. */
export function goodFridayChantIds(): readonly number[] {
  return [...new Set(data.rites.flatMap((r) => r.sections.flatMap((s) => s.items.map((i) => i.gregobase_id))))];
}
