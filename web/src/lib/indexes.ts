import type { Piece } from "./catalog";
import { SEASON_ORDER, observance, seasonOfTempora } from "./liturgy";
import type { Season } from "./liturgy";

/**
 * Index construction for every division of the site.
 *
 * Everything here is driven by the catalog: a division appears on the site the
 * moment a catalogued piece belongs to it, and not before. There are no
 * placeholder pages for books that have not been processed yet.
 */

export type Division =
  | "kyriale" | "temporale" | "sanctorale" | "commune" | "defunctorum" | "vesperale" | "varia";

export interface DivisionMeta {
  readonly division: Division;
  readonly en: string;
  readonly la: string;
  readonly slug: string;
  readonly blurb: string;
}

export const DIVISIONS: readonly DivisionMeta[] = [
  { division: "temporale", en: "Proper of Time", la: "Proprium de Tempore", slug: "proper-of-time",
    blurb: "Sundays and seasons of the year, Advent to the last Sunday after Pentecost." },
  { division: "sanctorale", en: "Proper of Saints", la: "Proprium Sanctorum", slug: "proper-of-saints",
    blurb: "Feasts of the saints, month by month." },
  { division: "commune", en: "Common of Saints", la: "Commune Sanctorum", slug: "commune",
    blurb: "Masses shared by saints of the same kind: martyrs, confessors, virgins." },
  { division: "kyriale", en: "Kyriale", la: "Kyriale", slug: "kyriale",
    blurb: "The eighteen Ordinaries of the Mass, the Credos, and chants ad libitum." },
  { division: "defunctorum", en: "Masses for the Dead", la: "Missa pro Defunctis", slug: "pro-defunctis",
    blurb: "The Requiem Mass, the Absolution and the Burial rite." },
  { division: "vesperale", en: "Vespers", la: "Vesperale", slug: "vespers",
    blurb: "Sunday and feast-day Vespers." },
  { division: "varia", en: "Varia", la: "Varia", slug: "varia",
    blurb: "Hymns, antiphons and other chants." },
];

const META = new Map(DIVISIONS.map((d) => [d.division, d]));

export function divisionMeta(division: Division): DivisionMeta {
  const meta = META.get(division);
  if (!meta) throw new Error(`unknown division ${division}`);
  return meta;
}

export interface DivisionSummary extends DivisionMeta { readonly count: number }

/** Divisions that have at least one catalogued piece, in liturgical-book order. */
export function divisionsWithContent(pieces: readonly Piece[]): readonly DivisionSummary[] {
  const counts = new Map<Division, number>();
  for (const p of pieces) {
    const division = p.division as Division;
    counts.set(division, (counts.get(division) ?? 0) + 1);
  }
  return DIVISIONS
    .filter((d) => (counts.get(d.division) ?? 0) > 0)
    .map((d) => ({ ...d, count: counts.get(d.division) ?? 0 }));
}

export function piecesIn(pieces: readonly Piece[], division: Division): readonly Piece[] {
  return pieces.filter((p) => p.division === division);
}

// ----------------------------------------------------------- Proper of Time ---

const PREFIX_ORDER = ["Adv", "Nat", "Epi", "Quadp", "Quad", "Pasc", "Pent"];

/**
 * Liturgical order for Temporale names such as "Adv2-3" or "Pent01-0r".
 * Alphabetical order would put Easter ("Pasc") before Lent ("Quad") and Advent
 * after both.
 */
export function temporaOrder(name: string): readonly [number, number, number] {
  const m = /^([A-Za-z]*)(\d+)-(\d+)/.exec(name);
  if (!m) return [99, 0, 0];
  const prefix = m[1] ?? "";
  const rank = prefix === "" ? PREFIX_ORDER.length : PREFIX_ORDER.indexOf(prefix);
  return [rank === -1 ? 98 : rank, Number(m[2]), Number(m[3])];
}

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface DayEntry {
  readonly key: string;
  readonly title: string;
  readonly titleLa: string;
  readonly pieces: readonly Piece[];
}

export interface SeasonGroup {
  readonly season: Season;
  readonly days: readonly DayEntry[];
}

function dayEntries(pieces: readonly Piece[], flexibility: string): Map<string, Piece[]> {
  const byDay = new Map<string, Piece[]>();
  for (const piece of pieces) {
    for (const key of piece.days) {
      if (!key.startsWith(`${flexibility}:`)) continue;
      byDay.set(key, [...(byDay.get(key) ?? []), piece]);
    }
  }
  return byDay;
}

function entry(key: string, pieces: readonly Piece[]): DayEntry {
  const o = observance(key);
  return { key, title: o?.titleEn ?? key, titleLa: o?.titleLa ?? "", pieces };
}

/** Proper of Time: catalogued days grouped by season, in liturgical order. */
export function temporaleIndex(pieces: readonly Piece[]): readonly SeasonGroup[] {
  const bySeason = new Map<Season, DayEntry[]>();
  for (const [key, dayPieces] of dayEntries(pieces, "tempora")) {
    const o = observance(key);
    const season = o ? seasonOfTempora(o) : null;
    if (!season) continue;
    bySeason.set(season, [...(bySeason.get(season) ?? []), entry(key, dayPieces)]);
  }
  return SEASON_ORDER
    .filter((s) => bySeason.has(s))
    .map((season) => ({
      season,
      days: [...(bySeason.get(season) ?? [])].sort((a, b) =>
        compareTuples(temporaOrder(a.key.split(":")[1] ?? ""), temporaOrder(b.key.split(":")[1] ?? ""))),
    }));
}

// ---------------------------------------------------------- Proper of Saints ---

export const MONTHS_LA = [
  "Januarius", "Februarius", "Martius", "Aprilis", "Majus", "Junius",
  "Julius", "Augustus", "September", "October", "November", "December",
];
export const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface MonthGroup {
  readonly month: number;           // 1-12
  readonly days: readonly (DayEntry & { readonly day: number })[];
}

/** Proper of Saints: catalogued feasts grouped by month, in date order. */
export function sanctoraleIndex(pieces: readonly Piece[]): readonly MonthGroup[] {
  const byMonth = new Map<number, (DayEntry & { day: number })[]>();
  for (const [key, dayPieces] of dayEntries(pieces, "sancti")) {
    const m = /^sancti:(\d{2})-(\d{2}|DU)/.exec(key);
    if (!m) continue;
    const month = Number(m[1]);
    // Christ the King ("10-DU") is the last Sunday of October: file it at month end.
    const day = m[2] === "DU" ? 31 : Number(m[2]);
    byMonth.set(month, [...(byMonth.get(month) ?? []), { ...entry(key, dayPieces), day }]);
  }
  return [...byMonth.keys()].sort((a, b) => a - b).map((month) => ({
    month,
    days: [...(byMonth.get(month) ?? [])].sort((a, b) => a.day - b.day || a.key.localeCompare(b.key)),
  }));
}

// ------------------------------------------------------------- day lookup ---

export interface DayLink { readonly title: string; readonly href: string; readonly division: string }

export function pieceHref(piece: Piece): string {
  if (piece.genre === "mass_ordinary" && piece.mass) return `/kyriale/${piece.mass.toLowerCase()}/`;
  return `/piece/${piece.slug}/`;
}

/** Calendar key -> the catalogued music for that day, for the date lookup. */
export function dayIndex(pieces: readonly Piece[]): Readonly<Record<string, readonly DayLink[]>> {
  const out: Record<string, DayLink[]> = {};
  for (const piece of pieces) {
    for (const key of piece.days) {
      (out[key] ??= []).push({ title: piece.incipit ?? piece.title, href: pieceHref(piece),
                               division: piece.division });
    }
  }
  return out;
}

/** URL of a calendar day's page. One function, so the calendar, the division
 *  indexes and the /day/ routes can never disagree about the shape. */
export function dayHref(key: string): string {
  const [flex, name] = key.split(":");
  return `/day/${flex || "feria"}/${name ?? ""}/`;
}

/** Calendar keys that have catalogued music, and so earn a /day/ page. */
export function catalogedDays(pieces: readonly Piece[]): readonly string[] {
  return Object.keys(dayIndex(pieces)).sort();
}

// ----------------------------------------------------------------- Kyriale ---

export interface KyrialeGroup { readonly heading: string; readonly pieces: readonly Piece[] }

const KYRIALE_GROUPS: readonly { heading: string; test: (p: Piece) => boolean }[] = [
  { heading: "Ordinaries of the Mass", test: (p) => p.genre === "mass_ordinary" },
  { heading: "Credo", test: (p) => p.genre === "credo" },
  { heading: "Asperges me · Vidi aquam", test: (p) => p.genre === "asperges" },
  { heading: "Kyrie ad libitum", test: (p) => p.genre === "kyrie" },
  { heading: "Gloria, Sanctus, Agnus Dei ad libitum",
    test: (p) => ["gloria", "sanctus", "agnus"].includes(p.genre) },
  { heading: "Tones", test: (p) => p.genre === "tonus" },
];

/** The Kyriale grouped as a reader looks for it: by kind of chant, not page order. */
export function kyrialeIndex(pieces: readonly Piece[]): readonly KyrialeGroup[] {
  const kyriale = piecesIn(pieces, "kyriale");
  const claimed = new Set<string>();
  const groups: KyrialeGroup[] = [];
  for (const { heading, test } of KYRIALE_GROUPS) {
    const found = kyriale.filter((p) => test(p) && !claimed.has(p.id));
    found.forEach((p) => claimed.add(p.id));
    if (found.length) groups.push({ heading, pieces: found });
  }
  const rest = kyriale.filter((p) => !claimed.has(p.id));
  if (rest.length) groups.push({ heading: "Other", pieces: rest });
  return groups;
}
