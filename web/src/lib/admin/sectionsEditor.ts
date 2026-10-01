/**
 * The Sections screen's list, as plain data: the rows an editor edits, and the
 * value it saves (a whole list of sections, see targets.ts parseSections).
 * Kept apart from the page so the rules are tested without a browser.
 */
import { PART_LABELS, currentSections, parseSections, sectionsText } from "./targets";
import type { SectionEntry, TargetPiece } from "./targets";

/** One row as the form holds it: every field as typed. */
export interface Row {
  kind: string;
  n: string;
  paschal: boolean;
  /** A name of its own, in place of the number and the Paschaltide form. */
  key: string;
  label: string;
  title: string;
  /** "printed" (starts on a system of this piece) or "elsewhere" (another page). */
  where: "printed" | "elsewhere";
  system: string;
  volume: string;
  page: string;
  chant: string;
}

export function toRow(e: SectionEntry): Row {
  return {
    kind: e.kind, n: e.n ? String(e.n) : "", paschal: e.variant === "paschal", key: e.key ?? "", label: e.label ?? "", title: e.title ?? "",
    where: e.system !== undefined ? "printed" : "elsewhere", system: e.system !== undefined ? String(e.system) : "",
    volume: e.borrowed_volume ?? "", page: e.borrowed_page ? String(e.borrowed_page) : "",
    chant: e.chant === "none" ? "" : String(e.chant),
  };
}

/** A new row starting on a system. */
export function blankRow(system: number | null, kind = "other"): Row {
  return { kind, n: "", paschal: false, key: "", label: "", title: "", where: system === null ? "elsewhere" : "printed",
           system: system === null ? "" : String(system), volume: "", page: "", chant: "" };
}

/** The piece's list as the screen starts from it: the latest one approved but
 * not yet published, if any (so a second edit builds on the first), else the
 * catalogue's. */
export function startingRows(piece: TargetPiece, pending: string | null = null): Row[] {
  const from = pending ? parseSections(pending, piece.systems ?? null) : null;
  return (Array.isArray(from) ? from : currentSections(piece)).map(toRow);
}

const whole = (text: string): number | undefined => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);

/** The rows as the list the API takes (JSON text). Values that are not numbers
 * are passed on as typed, so the check names the row. */
export function rowsValue(rows: readonly Row[]): string {
  return JSON.stringify(rows.map((r) => ({
    kind: r.kind,
    ...(r.n.trim() ? { n: whole(r.n) ?? r.n } : {}),
    ...(r.paschal ? { variant: "paschal" } : {}),
    ...(r.key.trim() ? { key: r.key.trim() } : {}),
    ...(r.label.trim() ? { label: r.label.trim() } : {}),
    ...(r.title.trim() ? { title: r.title.trim() } : {}),
    ...(r.where === "printed" ? { system: whole(r.system) ?? r.system }
      : { borrowed_volume: r.volume, borrowed_page: whole(r.page) ?? r.page }),
    chant: r.chant.trim() ? whole(r.chant) ?? r.chant.trim() : "none",
  })));
}

/** Whether the rows say the same as the list the piece has now. */
export function unchanged(rows: readonly Row[], piece: TargetPiece): boolean {
  const parsed = parseSections(rowsValue(rows), piece.systems ?? null);
  return Array.isArray(parsed) && sectionsText(parsed) === sectionsText(currentSections(piece));
}

/** A new section starting on `system`, placed among the others by where they start. */
export function insertAt(rows: readonly Row[], system: number, kind = "other"): Row[] {
  const out = [...rows];
  const at = out.findIndex((r) => r.where === "printed" && (whole(r.system) ?? 0) > system);
  out.splice(at === -1 ? out.length : at, 0, blankRow(system, kind));
  return out;
}

export function move(rows: readonly Row[], from: number, by: -1 | 1): Row[] {
  const to = from + by;
  if (to < 0 || to >= rows.length) return [...rows];
  const out = [...rows];
  [out[from], out[to]] = [out[to]!, out[from]!];
  return out;
}

/** A row's name in words ("Gradual 2", "Alleluia (paschal)"). */
export function rowName(r: Row): string {
  const base = r.kind === "other" && r.label.trim() ? r.label.trim() : PART_LABELS[r.kind] ?? r.kind;
  return `${base}${r.n.trim() ? ` ${r.n.trim()}` : ""}${r.paschal ? " (paschal)" : ""}`;
}

/** Which sections start on each system, for the marks beside the scans. */
export function startsBySystem(rows: readonly Row[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rows) {
    const n = r.where === "printed" ? whole(r.system) : undefined;
    if (n !== undefined) out.set(n, [...(out.get(n) ?? []), rowName(r)]);
  }
  return out;
}
