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
    blurb: "Feasts of the saints, month by month, with the Masses kept in particular places." },
  { division: "commune", en: "Common of Saints", la: "Commune Sanctorum", slug: "commune",
    blurb: "Masses shared by saints of the same kind: martyrs, confessors, virgins; and the Dedication of a Church." },
  { division: "kyriale", en: "Kyriale", la: "Kyriale", slug: "kyriale",
    blurb: "The eighteen Ordinaries of the Mass, the Credos, and chants ad libitum." },
  { division: "defunctorum", en: "Masses for the Dead", la: "Missa pro Defunctis", slug: "pro-defunctis",
    blurb: "The Requiem Mass, the Absolution and the Burial rite." },
  { division: "vesperale", en: "Vespers", la: "Vesperale", slug: "vespers",
    blurb: "Sunday and feast-day Vespers." },
  { division: "varia", en: "Votive Masses and Varia", la: "Missae Votivae · Varia", slug: "varia",
    blurb: "Votive Masses for the days of the week and for particular needs, and other chants." },
];

const META = new Map(DIVISIONS.map((d) => [d.division, d]));

export function divisionMeta(division: Division): DivisionMeta {
  const meta = META.get(division);
  if (!meta) throw new Error(`unknown division ${division}`);
  return meta;
}

export interface DivisionSummary extends DivisionMeta { readonly count: number }

/** All printed divisions, including books still to be catalogued, in book order. */
export function booksIndex(pieces: readonly Piece[]): readonly DivisionSummary[] {
  const counts = new Map<string, number>();
  for (const piece of pieces) {
    counts.set(piece.division, (counts.get(piece.division) ?? 0) + 1);
  }
  return DIVISIONS.map((division) => ({ ...division, count: counts.get(division.division) ?? 0 }));
}

/** Divisions that have at least one catalogued piece, in liturgical-book order. */
export function divisionsWithContent(pieces: readonly Piece[]): readonly DivisionSummary[] {
  return booksIndex(pieces).filter((division) => division.count > 0);
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

/** Days of the Common keyed by the calendar itself (the Saturdays of Our Lady),
 *  in the order of the year: Christmastide, after the Purification,
 *  Eastertide, after Pentecost. */
export function communeDays(pieces: readonly Piece[]): readonly DayEntry[] {
  const order = ["C10a", "C10b", "C10c", "C10Pasc", "C10t"];
  const rank = (key: string) => {
    const i = order.indexOf(key.split(":")[1] ?? "");
    return i < 0 ? order.length : i;
  };
  return [...dayEntries(pieces, "commune")]
    .map(([key, dayPieces]) => entry(key, dayPieces))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
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

// ---------------------------------------------------------- reader neighbours ---

export interface PieceNeighbours {
  readonly previous: Piece | null;
  readonly next: Piece | null;
  readonly back: { readonly title: string; readonly href: string };
}

export interface MoreFor {
  readonly heading: string;
  readonly links: readonly DayLink[];
}

interface ReaderIndex {
  readonly divisions: Map<string, { pieces: Piece[]; positions: Map<string, number> }>;
  readonly byDay: Readonly<Record<string, readonly DayLink[]>>;
  readonly moreByDay: Map<string, MoreFor>;
}

const readerIndexes = new WeakMap<readonly Piece[], ReaderIndex>();

function uniqueLinks(links: readonly DayLink[], currentHref: string): readonly DayLink[] {
  const seen = new Set([currentHref]);
  return links.filter(({ href }) => {
    if (seen.has(href)) return false;
    seen.add(href);
    return true;
  }).slice(0, 6);
}

/** Catalogue arrays are immutable during a build; share their lookups across pages. */
function readerIndex(pieces: readonly Piece[]): ReaderIndex {
  const cached = readerIndexes.get(pieces);
  if (cached) return cached;
  const divisions: ReaderIndex["divisions"] = new Map();
  for (const piece of pieces) {
    let group = divisions.get(piece.division);
    if (!group) {
      group = { pieces: [], positions: new Map() };
      divisions.set(piece.division, group);
    }
    group.positions.set(piece.slug, group.pieces.length);
    group.pieces.push(piece);
  }
  const moreByDay = new Map<string, MoreFor>();
  function addGroup(days: readonly DayEntry[], heading: string, division: Division): void {
    days.forEach((day, i) => {
      const links = days.slice(Math.max(0, i - 3), i + 4).map(other => ({
        title: other.title, href: dayHref(other.key), division,
      }));
      moreByDay.set(day.key, { heading, links: uniqueLinks(links, dayHref(day.key)) });
    });
  }
  for (const group of temporaleIndex(pieces)) addGroup(group.days, "More for this season", "temporale");
  for (const group of sanctoraleIndex(pieces)) {
    addGroup(group.days, `More for ${MONTHS_EN[group.month - 1]}`, "sanctorale");
  }
  // The Common's days (the Saturdays of Our Lady) run across the seasons.
  addGroup(communeDays(pieces), "More from the Common", "commune");
  const index = { divisions, byDay: dayIndex(pieces), moreByDay };
  readerIndexes.set(pieces, index);
  return index;
}

/** The one day a piece is printed for. Days it is only linked to (a Sunday
 *  Mass repeated on the ferias of its week) do not count. */
function ownDay(piece: Piece): string | undefined {
  const own = piece.days.filter((key) => !piece.linkedDays.includes(key));
  return own.length === 1 ? own[0] : undefined;
}

/** Previous and next distinct pages in the division's printed catalogue order. */
export function neighbours(pieces: readonly Piece[], piece: Piece): PieceNeighbours {
  const group = readerIndex(pieces).divisions.get(piece.division);
  const position = group?.positions.get(piece.slug);
  const href = pieceHref(piece);
  function adjacent(step: number): Piece | null {
    if (!group || position === undefined) return null;
    for (let i = position + step; i >= 0 && i < group.pieces.length; i += step) {
      const candidate = group.pieces[i]!;
      if (pieceHref(candidate) !== href) return candidate;
    }
    return null;
  }
  const day = ownDay(piece);
  const division = divisionMeta(piece.division as Division);
  return {
    previous: adjacent(-1), next: adjacent(1),
    back: day ? { title: observance(day)?.titleEn ?? day, href: dayHref(day) }
      : { title: division.en, href: `/${division.slug}/` },
  };
}

/** Related music for a single day, or nearby days in its season/month/Common. */
export function moreFor(pieces: readonly Piece[], current: { piece: Piece } | { day: string }): MoreFor {
  const index = readerIndex(pieces);
  if ("piece" in current) {
    const { piece } = current;
    const day = ownDay(piece);
    if (!day) return { heading: "More for this day", links: [] };
    const links = uniqueLinks(index.byDay[day] ?? [], pieceHref(piece));
    return links.length ? { heading: "More for this day", links } : moreFor(pieces, { day });
  }
  return index.moreByDay.get(current.day) ?? { heading: "More for this season", links: [] };
}
