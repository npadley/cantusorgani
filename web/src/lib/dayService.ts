import type { CalendarDay, KyrialeSuggestion, LocalDate, Observance } from "./liturgy";
import type { SeasonGroup } from "./exportParts";

export interface OrdinaryOption extends KyrialeSuggestion { readonly key: string }
export interface DayTable {
  readonly start: string;
  readonly end: string;
  readonly options: readonly OrdinaryOption[];
  readonly groups: readonly { readonly option: string; readonly group: SeasonGroup; readonly dates: readonly string[] }[];
}
export interface DayDefaults {
  readonly option: string;
  readonly group: SeasonGroup;
  readonly included: readonly string[];
  readonly unticked: readonly string[];
}

export interface DatedService {
  readonly iso: string | null;
  readonly option: OrdinaryOption | null;
  readonly group: SeasonGroup;
  readonly message: string | null;
}

/** Pure: callers load the four calendar years; the browser only receives this grouped table. */
export function buildDayTable(occasion: Observance, year: number,
  years: Readonly<Record<number, Readonly<Record<string, CalendarDay>>>>,
  classify: (date: LocalDate) => { suggestion: KyrialeSuggestion; group: SeasonGroup }): DayTable {
  const options: OrdinaryOption[] = [];
  const groups: { option: string; group: SeasonGroup; dates: string[] }[] = [];
  for (let y = year; y <= year + 3; y++) {
    for (const [iso, day] of Object.entries(years[y] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (!day.celebration.includes(occasion.key)) continue;
      if (!validIso(iso)) continue;
      const [year, month, date] = iso.split("-").map(Number);
      const { suggestion, group } = classify({ year: year!, month: month!, day: date! });
      let option = options.find(o => JSON.stringify({ ...o, key: undefined }) === JSON.stringify(suggestion));
      if (!option) { option = { ...suggestion, key: `ordinary-${options.length}` }; options.push(option); }
      let entry = groups.find(g => g.option === option.key && g.group === group);
      if (!entry) { entry = { option: option.key, group, dates: [] }; groups.push(entry); }
      entry.dates.push(iso);
    }
  }
  return { start: `${year}-01-01`, end: `${year + 3}-12-31`, options, groups };
}

function validIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

export function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

export function resolveDate(query: string | null, table: DayTable, buildDefaultIso: string | null): DatedService {
  const lookup = (iso: string | null) => iso && iso >= table.start && iso <= table.end
    ? table.groups.find(g => g.dates.includes(iso)) : undefined;
  const valid = query !== null && validIso(query) && lookup(query);
  const iso = valid ? query : buildDefaultIso;
  const entry = lookup(iso);
  const reason = query && validIso(query) ? `This occasion doesn't fall on ${dateLabel(query)}` : "That isn't a date we can read";
  return { iso, option: table.options.find(o => o.key === entry?.option) ?? null, group: entry?.group ?? "all",
    message: query !== null && !valid ? `${reason}. Showing ${iso ? dateLabel(iso) : "the build default"}.` : null };
}

export function pdfTitle(title: string, ordinaryLabel: string | null, date: string | null): string {
  return `${title}${ordinaryLabel ? ` with Missa ${ordinaryLabel}` : ""}${date ? ` — ${dateLabel(date)}` : ""}`;
}


/** Pure formatting, re-exported by exportParts without pulling its catalogue into the browser. */
export function formatDefaultsNote(unticked: readonly string[], date: string | null): string | null {
  if (date === null || unticked.length === 0) return null;
  const labels = [...new Set(unticked)];
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `Defaults for ${date} (${list} unticked).`;
}

export function serviceSummary(service: DatedService, alternatives: readonly string[], unavailable: readonly string[]): string {
  const details = [
    [...new Set(alternatives)].join(", "),
    ...(service.option?.mass ? [] : ["Ordinary: no single Mass is assigned"]),
    ...unavailable,
  ].filter(Boolean).join(" · ");
  return `For ${service.iso ? dateLabel(service.iso) : "the build default"}${details ? `: ${details}` : ""}`;
}
