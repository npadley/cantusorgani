import rawVocabulary from "../../../data/calendar/days.json";
import rawSource from "../../../data/calendar/source.json";

/**
 * The 1962 liturgical calendar, as generated from Missalemeum (MIT).
 *
 * Season and colour are derived from the DATE, not the vocabulary: an ordinary
 * weekday is the single observance ":feria", recorded in white for every day of
 * the year, while its real colour is violet in Lent and green after Pentecost.
 */

export type Flexibility = "tempora" | "sancti" | "commune" | "";
export type Rank = 1 | 2 | 3 | 4;
export type Season =
  | "advent" | "christmas" | "epiphany" | "septuagesima" | "lent"
  | "passiontide" | "easter" | "pentecost";

export interface Observance {
  readonly key: string;
  readonly flexibility: Flexibility;
  readonly name: string;
  readonly rank: Rank;
  readonly colors: readonly string[];
  readonly titleEn: string;
  readonly titleLa: string;
}

export interface CalendarDay {
  readonly celebration: readonly string[];
  readonly commemoration: readonly string[];
}

export interface CalendarSource {
  readonly source: string;
  readonly url: string;
  readonly licence: string;
  readonly commit: string;
  readonly rubrics: string;
  readonly years: readonly [number, number];
}

interface RawObservance {
  readonly key: string; readonly flexibility: string; readonly name: string;
  readonly rank: number; readonly colors: readonly string[];
  readonly title_en: string; readonly title_la: string;
}

const FLEXIBILITIES: ReadonlySet<string> = new Set(["tempora", "sancti", "commune", ""]);

/** Validate and map the generated vocabulary. Pure, so it can be shown bad input. */
export function parseVocabulary(input: unknown): ReadonlyMap<string, Observance> {
  const out = new Map<string, Observance>();
  for (const [key, raw] of Object.entries(input as Record<string, RawObservance>)) {
    if (!FLEXIBILITIES.has(raw.flexibility)) {
      throw new Error(`${key}: unknown flexibility ${JSON.stringify(raw.flexibility)}`);
    }
    if (![1, 2, 3, 4].includes(raw.rank)) throw new Error(`${key}: rank ${raw.rank} is not 1-4`);
    out.set(key, {
      key, flexibility: raw.flexibility as Flexibility, name: raw.name,
      rank: raw.rank as Rank, colors: raw.colors,
      titleEn: raw.title_en, titleLa: raw.title_la,
    });
  }
  return out;
}

const VOCABULARY = parseVocabulary(rawVocabulary);
export const CALENDAR_SOURCE = rawSource as unknown as CalendarSource;

export function observance(key: string): Observance | undefined {
  return VOCABULARY.get(key);
}

export function allObservances(): readonly Observance[] {
  return [...VOCABULARY.values()];
}

// ------------------------------------------------------------------ dates ---

/** A calendar date with no time zone: the liturgical day is the local day. */
export interface LocalDate { readonly year: number; readonly month: number; readonly day: number }

export function localDate(year: number, month: number, day: number): LocalDate {
  return { year, month, day };
}

/** Today in the viewer's own time zone. `new Date().toISOString()` would give the
 *  UTC date, which is tomorrow for anyone west of Greenwich late in the evening. */
export function today(now: Date = new Date()): LocalDate {
  return localDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function parseIso(iso: string): LocalDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return localDate(year, month, day);
}

export function isoOf(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function toUtc(d: LocalDate): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

function fromUtc(ms: number): LocalDate {
  const x = new Date(ms);
  return localDate(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromUtc(toUtc(d) + n * 86_400_000);
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: LocalDate): number {
  return new Date(toUtc(d)).getUTCDay();
}

/** The next Sunday strictly after `from`, or `from` itself when inclusive. */
export function nextSunday(from: LocalDate, inclusive = false): LocalDate {
  const wd = weekday(from);
  const ahead = wd === 0 ? (inclusive ? 0 : 7) : 7 - wd;
  return addDays(from, ahead);
}

/** Easter Sunday, Gregorian (Meeus/Jones/Butcher). */
export function easter(year: number): LocalDate {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return localDate(year, month, day);
}

/** First Sunday of Advent: the Sunday falling 27 Nov – 3 Dec. */
export function adventStart(year: number): LocalDate {
  return nextSunday(localDate(year, 11, 27), true);
}

export function seasonForDate(d: LocalDate): Season {
  const e = easter(d.year);
  const offset = daysBetween(e, d);
  const advent = adventStart(d.year);
  if (daysBetween(advent, d) >= 0) return d.month === 12 && d.day >= 25 ? "christmas" : "advent";
  if (d.month === 1 && d.day <= 13) return "christmas";
  if (offset < -63) return "epiphany";
  if (offset < -46) return "septuagesima";
  if (offset < -14) return "lent";
  if (offset < 0) return "passiontide";
  if (offset <= 55) return "easter";      // Paschaltide ends the Saturday after Pentecost
  return "pentecost";
}

export const SEASON_ORDER: readonly Season[] = [
  "advent", "christmas", "epiphany", "septuagesima", "lent", "passiontide", "easter", "pentecost",
];

export const SEASON_LABELS: Readonly<Record<Season, { readonly en: string; readonly la: string }>> = {
  advent: { en: "Advent", la: "Tempus Adventus" },
  christmas: { en: "Christmastide", la: "Tempus Nativitatis" },
  epiphany: { en: "Time after Epiphany", la: "Tempus post Epiphaniam" },
  septuagesima: { en: "Septuagesima", la: "Tempus Septuagesimae" },
  lent: { en: "Lent", la: "Tempus Quadragesimae" },
  passiontide: { en: "Passiontide", la: "Tempus Passionis" },
  easter: { en: "Eastertide", la: "Tempus Paschale" },
  pentecost: { en: "Time after Pentecost", la: "Tempus post Pentecosten" },
};

/** Season a Temporale observance belongs to, for grouping the Proper of Time. */
export function seasonOfTempora(o: Observance): Season | null {
  if (o.flexibility !== "tempora") return null;
  const n = o.name;
  if (n.startsWith("Adv")) return "advent";
  if (n.startsWith("Nat")) return "christmas";
  if (n.startsWith("Epi")) return "epiphany";
  if (n.startsWith("Quadp")) {
    // Ash Wednesday (Quadp3-3) and the days after it are Lent, not Septuagesima.
    const [week, day] = n.slice(5).split("-").map(Number);
    return week === 3 && (day ?? 0) >= 3 ? "lent" : "septuagesima";
  }
  if (n.startsWith("Quad")) {
    const week = Number(n.slice(4).split("-")[0]);
    return week >= 5 ? "passiontide" : "lent";
  }
  if (n.startsWith("Pasc")) return "easter";
  if (n.startsWith("Pent") || /^\d/.test(n)) return "pentecost";   // 093-x: September Embers
  return null;
}

// --------------------------------------------------------------- colours ---

export const COLOR_LABELS: Readonly<Record<string, string>> = {
  w: "White", r: "Red", v: "Violet", g: "Green", b: "Black", p: "Rose",
};

const SEASON_COLOR: Readonly<Record<Season, string>> = {
  advent: "v", christmas: "w", epiphany: "g", septuagesima: "v",
  lent: "v", passiontide: "v", easter: "w", pentecost: "g",
};

/** Liturgical colour of an observance on a given date. */
export function colorOf(o: Observance, d: LocalDate): string {
  if (o.flexibility === "") return SEASON_COLOR[seasonForDate(d)];
  return o.colors[0] ?? SEASON_COLOR[seasonForDate(d)];
}

export function classLabel(rank: Rank): string {
  return ["", "I class", "II class", "III class", "IV class"][rank] ?? "";
}

// ------------------------------------------------- the Kyriale suggestion ---

/**
 * A feast of Our Lady -- not merely an observance whose title mentions her.
 * "St. Anne, Mother of the Blessed Virgin" and "St. Gabriel of Our Lady of
 * Sorrows" are feasts of saints; "Dedication of the Basilica of St. Mary Major"
 * is a feast of Our Lady. Naive substring matching gets all three wrong.
 */
export function isFeastOfOurLady(o: Observance): boolean {
  if (o.flexibility === "commune" && o.name.startsWith("C10")) return true;
  if (o.flexibility !== "sancti") return false;
  const t = o.titleEn;
  if (/^(St|Sts|S|SS)\.\s/.test(t)) return false;
  return /Blessed Virgin|\bMary\b|Our Lady|Immaculate/i.test(t);
}

export interface KyrialeSuggestion {
  /** Roman numeral of the recommended Mass, or null when the heading is silent. */
  readonly mass: string | null;
  /** Every Mass the Kyriale heading names for this occasion. */
  readonly candidates: readonly string[];
  /** The NOH5 heading the suggestion rests on, verbatim. */
  readonly heading: string;
  readonly note?: string;
}

function suggest(candidates: readonly string[], heading: string, note?: string): KyrialeSuggestion {
  const base = { mass: candidates[0] ?? null, candidates, heading };
  return note === undefined ? base : { ...base, note };
}

const RANK_NOTE =
  "NOH (1942) ranks feasts as doubles and semidoubles; the 1962 calendar uses classes. " +
  "The correspondence used here is approximate.";

/**
 * Which Kyriale Mass the NOH5 headings assign to this day.
 *
 * Every rule quotes the heading it rests on. Where a heading does not name the
 * occasion -- Septuagesima is the main case -- no single Mass is suggested
 * rather than guessing. The rubrics permit other choices in any case.
 */
export function kyrialeFor(o: Observance, d: LocalDate): KyrialeSuggestion {
  const season = seasonForDate(d);
  const sunday = weekday(d) === 0;

  if (isFeastOfOurLady(o)) {
    return suggest(["IX", "X"], "In Festis B. Mariae V.");
  }
  if (season === "easter") {
    return suggest(["I"], "Missa Tempore Paschali");
  }

  const title = o.titleEn;
  const isSolemnSunday = o.flexibility === "tempora" && o.rank === 1 &&
    season !== "advent" && season !== "lent" && season !== "passiontide";

  if (sunday && (o.flexibility === "tempora" || o.flexibility === "") && !isSolemnSunday) {
    if (season === "advent" || season === "lent" || season === "passiontide") {
      return suggest(["XVII"], "In Dominicis Adventus et Quadragesimae");
    }
    if (season === "septuagesima") {
      return {
        mass: null,
        candidates: ["XVII", "XI"],
        heading: "In Dominicis Adventus et Quadragesimae · In Dominicis infra annum",
        note: "The Kyriale's headings name Advent and Lent, not Septuagesima; both are in use.",
      };
    }
    return suggest(["XI"], "In Dominicis infra annum");
  }

  const weekdayObservance = o.flexibility === "" ||
    (o.flexibility === "tempora" && !sunday && o.rank >= 3) ||
    /Ember|Vigil|rogation/i.test(title);
  if (weekdayObservance) {
    if (/Ember|Vigil|rogation/i.test(title) || season === "advent" ||
        season === "lent" || season === "passiontide") {
      return suggest(["XVIII"],
        "In Feriis Adventus et Quadragesimae, in Vigiliis, Feriis IV. Temporum et in Missa Rogationum");
    }
    return suggest(["XVI"], "In Feriis per annum");
  }

  switch (o.rank) {
    case 1: return suggest(["II", "III"], "In Festis Solemnibus", RANK_NOTE);
    case 2: return suggest(["IV", "V", "VI", "VII", "VIII"], "In Festis Duplicibus", RANK_NOTE);
    case 3: return suggest(["XII", "XIII"], "In Festis Semiduplicibus", RANK_NOTE);
    default: return suggest(["XV"], "In Festis Simplicibus", RANK_NOTE);
  }
}

// ---------------------------------------------------------- year loading ---

const YEAR_FILES = import.meta.glob<{ default: { year: number; days: Record<string, CalendarDay> } }>(
  "../../../data/calendar/20*.json",
);

/** Load one year's calendar on demand; null when outside the generated range. */
export async function loadYear(year: number): Promise<Record<string, CalendarDay> | null> {
  const entry = Object.entries(YEAR_FILES).find(([path]) => path.endsWith(`/${year}.json`));
  if (!entry) return null;
  const module = await entry[1]();
  return module.default.days;
}
