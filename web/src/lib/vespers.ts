import raw from "../../../data/vespers-lineup.json";
import { allPieces, systemUrlStem } from "./catalog";
import { observance } from "./liturgy";
import type { Piece } from "./catalog";
import type { ExportSegment } from "./exportParts";

/**
 * Sunday Vespers in the order it is sung, from data/vespers-lineup.json
 * (`noh vespers-lineup`). Each item is printed NOH8 music, a printed
 * accompaniment in the same tone from the tone bank, or a note for what is
 * sung unaccompanied. Keyed by civil date: I Vespers and commemorations
 * depend on the year.
 */
export const LINEUP_SCHEMA_VERSION = 1;

export const ITEM_KINDS = [
  "initium", "antiphon", "psalm", "chapter", "hymn", "versicle", "magnificat-antiphon",
  "magnificat", "oration", "commemoration", "benedicamus", "marian-antiphon",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemSource =
  | { readonly type: "printed"; readonly refs: readonly string[]; readonly text: string | null;
      /** Only the first verses are printed (Advent I and II): continue to the formula. */
      readonly openingOnly: boolean }
  | { readonly type: "bank"; readonly refs: readonly string[];
      readonly bankKind: "magnificat" | "psalm"; readonly bankLabel: string; readonly borrowedFrom: string }
  | { readonly type: "note"; readonly text: string };

export interface LineupItem {
  /** Independent of the source: `<date>/<office>/<kind>/<n>`. */
  readonly key: string;
  readonly group: string;
  readonly kind: ItemKind;
  readonly number: number | null;
  readonly label: string;
  /** As printed: "VII.c2", "IV.A*", "peregrinus". */
  readonly tone: string | null;
  readonly source: ItemSource;
  readonly chant: number | null;
  /** The antiphon sung again after its psalm or the Magnificat. */
  readonly repeat: boolean;
  /** A psalm's verses (Divinum Officium), where NOH prints only a formula. */
  readonly psalmText: readonly string[];
}

export interface LineupDay {
  readonly date: string;
  readonly office: string;
  readonly vespers: "I" | "II";
  /** I Vespers: the evening (the day before) it is sung. */
  readonly eveningOf: string | null;
  readonly items: readonly LineupItem[];
}

export interface Lineup {
  readonly days: ReadonlyMap<string, LineupDay>;
  /** I Vespers of a I class feast, keyed by the feast's date. */
  readonly firstVespers: ReadonlyMap<string, LineupDay>;
  /** Dates held back, and why (a Magnificat tone NOH8 does not print). */
  readonly heldBack: ReadonlyMap<string, string>;
}

type Json = Record<string, unknown>;

function str(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`vespers lineup: ${where} is not a string`);
  return value;
}

function refs(value: unknown, where: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((r) => typeof r !== "string")) {
    throw new Error(`vespers lineup: ${where} has no systems`);
  }
  return value as string[];
}

function parseSource(s: Json, where: string): ItemSource {
  switch (s["type"]) {
    case "printed":
      return { type: "printed", refs: refs(s["refs"], where),
               text: typeof s["text"] === "string" ? s["text"] : null, openingOnly: s["opening_only"] === true };
    case "bank": {
      const kind = s["bank_kind"];
      if (kind !== "magnificat" && kind !== "psalm") throw new Error(`vespers lineup: ${where} bank_kind ${String(kind)}`);
      return { type: "bank", refs: refs(s["refs"], where), bankKind: kind,
               bankLabel: str(s["bank_label"], where), borrowedFrom: str(s["borrowed_from"], where) };
    }
    case "note":
      return { type: "note", text: str(s["text"], where) };
    default:
      throw new Error(`vespers lineup: ${where} has unknown source type ${String(s["type"])}`);
  }
}

function parseItem(i: Json, where: string): LineupItem {
  const kind = i["kind"];
  if (typeof kind !== "string" || !(ITEM_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`vespers lineup: ${where} has unknown kind ${String(kind)}`);
  }
  const chant = i["chant"];
  const number = i["number"];
  return {
    key: str(i["item_key"], where), group: str(i["group"], where), kind: kind as ItemKind,
    number: typeof number === "number" ? number : null, label: str(i["label"], where),
    tone: typeof i["tone"] === "string" ? i["tone"] : null,
    source: parseSource((i["source"] ?? {}) as Json, `${where} source`),
    chant: typeof chant === "number" && Number.isInteger(chant) && chant > 0 ? chant : null,
    repeat: i["repeat"] === true,
    psalmText: Array.isArray(i["psalm_text"]) ? (i["psalm_text"] as unknown[]).filter((v): v is string => typeof v === "string") : [],
  };
}

function parseDays(raw: Record<string, Json>): Map<string, LineupDay> {
  const days = new Map<string, LineupDay>();
  for (const [date, d] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`vespers lineup: bad date ${date}`);
    const vespers = d["vespers"] === "I" ? "I" : "II";
    const items = ((d["items"] ?? []) as Json[]).map((i, n) => parseItem(i, `${date} item ${n + 1}`));
    days.set(date, { date, office: str(d["office"], date), vespers,
                     eveningOf: typeof d["evening_of"] === "string" ? d["evening_of"] : null, items });
  }
  return days;
}

/** Validates the lineup file the way parseCatalog validates the catalogue. */
export function parseLineup(input: unknown): Lineup {
  const doc = (input ?? {}) as Json;
  if (doc["schema_version"] !== LINEUP_SCHEMA_VERSION) {
    throw new Error(`vespers lineup schema_version ${String(doc["schema_version"])}, expected ${LINEUP_SCHEMA_VERSION}`);
  }
  const days = parseDays((doc["days"] ?? {}) as Record<string, Json>);
  const firstVespers = parseDays((doc["first_vespers"] ?? {}) as Record<string, Json>);
  const held = new Map(Object.entries((doc["held_back"] ?? {}) as Record<string, string>));
  return { days, firstVespers, heldBack: held };
}

let cached: Lineup | null = null;
export function loadLineup(): Lineup {
  cached ??= parseLineup(raw);
  return cached;
}

export function lineupFor(date: string, lineup: Lineup = loadLineup()): LineupDay | undefined {
  return lineup.days.get(date);
}

/** The calendar's key as the lineup keys offices: no "r", no Mass number. */
export function normalKey(key: string): string {
  return key.replace(/r$/, "").replace(/m\d$/, "");
}

/** The first date on or after `from` (ISO) whose lineup keeps `office`. */
export function nextLineupDate(office: string, from: string, lineup: Lineup = loadLineup()): string | null {
  const want = normalKey(office);
  const dates = [...lineup.days.values()].filter((d) => d.office === want && d.vespers === "II")
    .map((d) => d.date).sort();
  return dates.find((d) => d >= from) ?? null;
}

/** The first I Vespers of `office` on or after `from`, keyed by the feast's date. */
export function nextFirstVespers(office: string, from: string, lineup: Lineup = loadLineup()): string | null {
  const want = normalKey(office);
  const dates = [...lineup.firstVespers.values()].filter((d) => d.office === want).map((d) => d.date).sort();
  return dates.find((d) => d >= from) ?? null;
}

/** Where a lineup day's page is: /vespers/<date>/ (II), /vespers/<date>/i/ (I). */
export function lineupHref(day: LineupDay): string {
  return day.eveningOf ? `/vespers/${day.date}/i/` : `/vespers/${day.date}/`;
}

/** The day's title in English: Christmas has three Masses, and Vespers take
 * the title of the Mass of the day. */
export function lineupTitle(day: LineupDay): string {
  const o = observance(day.office) ?? observance(`${day.office}r`) ?? observance(`${day.office}m3`);
  return o?.titleEn ?? day.office;
}

/** The evening a lineup is sung: I Vespers the day before its feast. */
export function sungOn(day: LineupDay): string {
  return day.eveningOf ?? day.date;
}

/** Every Vespers with a page, II and I, in the order they are sung. */
export function allLineups(lineup: Lineup = loadLineup()): readonly LineupDay[] {
  return [...lineup.days.values(), ...lineup.firstVespers.values()]
    .sort((a, b) => sungOn(a).localeCompare(sungOn(b)) || a.vespers.localeCompare(b.vespers));
}

/** The Vespers whose own music comes from `slug` (the day's antiphons,
 * Magnificat antiphon or hymn) -- not borrowed tone-bank formulas. */
export function lineupsUsing(slug: string, lineup: Lineup = loadLineup()): readonly LineupDay[] {
  return allLineups(lineup).filter((day) => day.items.some((item) =>
    item.source.type === "printed" && itemSystems(item).some((s) => s.piece.slug === slug)));
}

/** A Sunday of the Proper of the Time ("tempora:Pent15-0"). */
export function isSunday(key: string): boolean {
  return /^tempora:\w+-0r?$/.test(key);
}

// ------------------------------------------------------------ presentation ---

/** "VII.c2" -> "VII c2"; "peregrinus" -> "tonus peregrinus". */
export function toneLabel(tone: string): string {
  return tone === "peregrinus" ? "tonus peregrinus" : tone.replace(".", " ");
}

const SPOKEN_MODES: Readonly<Record<string, number>> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
};

/** For screen readers: "IV.A*" -> "tone 4, ending A star". */
export function spokenTone(tone: string): string {
  if (tone === "peregrinus") return "tonus peregrinus";
  const [mode = "", ending = ""] = tone.split(".");
  const n = SPOKEN_MODES[mode];
  const end = ending.replace("*", " star").replace(/(\d)$/, " $1");
  return `tone ${n ?? mode}${end ? `, ending ${end}` : ""}`;
}

export interface Section {
  readonly group: string;
  /** The h2: the tone as printed is part of it where the section has one. */
  readonly heading: string;
  readonly anchor: string;
  /** The nav's short label, or null when the section is left out of the nav. */
  readonly nav: string | null;
  readonly items: readonly LineupItem[];
}

function psalmTitle(item: LineupItem): string {
  return item.label.replace(/^Psalm \d+:\s*/, "");
}

/** The lineup grouped into h2 sections in sung order. */
export function sections(day: LineupDay): readonly Section[] {
  const groups: { group: string; items: LineupItem[] }[] = [];
  for (const item of day.items) {
    const last = groups[groups.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else groups.push({ group: item.group, items: [item] });
  }
  return groups.map((g): Section => {
    const s: Section = { group: g.group, heading: "", anchor: g.group, nav: null, items: g.items };
    const first = s.items[0];
    const tone = s.items.find((i) => i.tone)?.tone ?? null;
    const t = tone ? ` — ${toneLabel(tone)}` : "";
    if (s.group.startsWith("psalm-")) {
      const n = s.group.slice(6);
      const psalm = s.items.find((i) => i.kind === "psalm");
      return { ...s, heading: `${n}. ${psalm ? psalmTitle(psalm) : first?.label ?? ""}${t}`, nav: `Ps ${n}` };
    }
    switch (s.group) {
      case "initium": return { ...s, heading: "Deus in adjutorium", nav: "Deus in adjutorium" };
      case "chapter": return { ...s, heading: "Chapter" };
      case "hymn": {
        const hymn = s.items.find((i) => i.kind === "hymn");
        return { ...s, heading: `Hymn: ${hymn?.label ?? ""}${t}`, nav: "Hymn" };
      }
      case "magnificat": return { ...s, heading: `Magnificat${t}`, nav: "Magnificat" };
      case "oration": return { ...s, heading: "Collect" };
      case "benedicamus": return { ...s, heading: "Benedicamus Domino", nav: "End" };
      case "marian": return { ...s, heading: first?.label ?? "Antiphon of Our Lady" };
      default: return { ...s, heading: first?.label ?? s.group };
    }
  });
}

/** An item's h3, or null for a section of one item (the h2 names it). */
export function itemHeading(item: LineupItem, section: Section): string | null {
  if (section.items.length === 1) return null;
  if (item.kind === "antiphon" || item.kind === "magnificat-antiphon") {
    return item.repeat ? "Antiphon (repeated)" : `Antiphon: ${item.label}`;
  }
  if (item.kind === "psalm") return item.label.replace(/:.*$/, "");
  if (item.kind === "hymn" && item.tone) return `${item.label} — ${toneLabel(item.tone)}`;
  return item.label;
}

/** One line for the console: each psalm's tone, the Magnificat's, the Marian antiphon. */
export function consoleLine(day: LineupDay): string {
  const psalms = day.items.filter((i) => i.kind === "psalm");
  const numbers = psalms.map((p) => p.number).filter((n): n is number => n !== null);
  const consecutive = numbers.every((n, i) => i === 0 || n === (numbers[i - 1] ?? 0) + 1);
  const span = numbers.length > 1 && consecutive ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(", ");
  const tones = psalms.map((p) => (p.tone ? toneLabel(p.tone) : "?")).join(", ");
  const mag = day.items.find((i) => i.kind === "magnificat");
  const marian = day.items.find((i) => i.kind === "marian-antiphon");
  return [`Pss. ${span}: ${tones}`, mag?.tone ? `Magnificat: ${toneLabel(mag.tone)}` : null,
          marian ? marian.label : null].filter(Boolean).join(" · ");
}

/** The provenance line under a tone-bank item's heading. */
export function bankNote(item: LineupItem): string | null {
  if (item.source.type !== "bank" || !item.tone) return null;
  const tone = toneLabel(item.tone);
  if (item.source.bankKind === "magnificat") {
    return `Magnificat in ${tone}, as printed for ${item.source.borrowedFrom}.`;
  }
  if (item.kind === "psalm") {
    return `NOH VIII does not print this psalm in ${tone}: the formula in the same tone and ending serves — `
      + `${item.source.bankLabel}, as printed for ${item.source.borrowedFrom}.`;
  }
  return `NOH VIII prints no Magnificat in ${tone}: the psalm formula in the same tone and ending serves — `
    + `${item.source.bankLabel}, as printed for ${item.source.borrowedFrom}. The Magnificat repeats the `
    + `intonation at every verse.`;
}

/** Whether a psalm item shows only a formula to continue (a bank entry or a printed opening). */
export function isFormula(item: LineupItem): boolean {
  return item.source.type === "bank" || (item.source.type === "printed" && item.source.openingOnly);
}

export interface ItemSystem {
  readonly piece: Piece;
  readonly ref: string;
  readonly stem: string;
  readonly aspect: readonly [number, number];
}

let owners: Map<string, { piece: Piece; index: number }> | null = null;
function ownerOf(ref: string): { piece: Piece; index: number } | undefined {
  if (!owners) {
    owners = new Map();
    for (const piece of allPieces()) piece.systems.forEach((r, index) => owners?.set(r, { piece, index }));
  }
  return owners.get(ref);
}

/** The systems an item shows, resolved against the catalogue (an item may
 * run across two catalogued pieces: Veni Creator). */
export function itemSystems(item: LineupItem): readonly ItemSystem[] {
  if (item.source.type === "note") return [];
  return item.source.refs.flatMap((ref) => {
    const owner = ownerOf(ref);
    if (!owner) return [];
    const aspect = owner.piece.systemAspect[owner.index] ?? [1600, 400];
    return [{ piece: owner.piece, ref, stem: systemUrlStem(owner.piece, owner.index),
              aspect: [aspect[0], aspect[1]] as const }];
  });
}

/** The widest system on the page: every system shares one scale. */
export function widestSystem(day: LineupDay): number {
  return Math.max(1, ...day.items.flatMap((i) => itemSystems(i).map((s) => s.aspect[0])));
}

/** Export segments in sung order, one per item with music; ids never collide
 * even when the tone bank reuses a system. */
export function exportLineup(day: LineupDay): readonly ExportSegment[] {
  const secs = sections(day);
  return day.items.flatMap((item, index) => {
    const systems = itemSystems(item);
    if (systems.length === 0) return [];
    const section = secs.find((s) => s.items.includes(item));
    const label = section && section.items.length > 1
      ? `${section.heading}: ${itemHeading(item, section) ?? item.label}`
      : section?.heading ?? item.label;
    return [{
      id: `${day.date}:${index}`, label, part: null, variant: "", pieceSlug: `vespers:${day.date}`,
      systems: systems.length, stems: systems.map((s) => s.stem),
    }];
  });
}
