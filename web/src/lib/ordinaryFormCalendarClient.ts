import { addDays, isoOf, nextSunday, parseIso, today, weekday, type LocalDate } from "./liturgy";
import { OF_SEASON_LABELS, ofDay, type OfSettings } from "./ordinaryForm";
import { ofQuery, readOfSettings } from "./ordinaryFormSettings";
import type { OfSeason } from "./ordinaryForm";

type Cycle = "A" | "B" | "C";
type Season = OfSeason;
export interface OfMusicChoice { readonly key: string; readonly sundayCycle: Cycle; readonly season: Season }
interface OfPart {
  slot: string; sourceSlot: string; kind?: string; variant: string; years: Cycle[]; seasons?: Season[];
  gregobaseId: number; incipit: string; label: string; href: string | null;
}
interface Occasion {
  key: string; titleEn: string; titleLa: string; color: string; rank: string; assignmentStatus: string;
  rubric?: string | null;
  partsByCycle: Record<Cycle, OfPart[]>;
}
interface Data { readonly [key: string]: Occasion }

const MIN_YEAR = 2024, MAX_YEAR = 2050;
const COLORS: Record<string, { label: string; swatch: string }> = {
  w: { label: "White", swatch: "#f6f3ea" }, g: { label: "Green", swatch: "#2e6b30" },
  v: { label: "Violet", swatch: "#5b2a86" }, r: { label: "Red", swatch: "#9b1c1c" },
};
const SEASONS: Record<Season, string> = OF_SEASON_LABELS;
const CHRISTMAS_OPTIONS = [
  ["christmas-night", "Mass during the Night"], ["christmas-dawn", "Mass at Dawn"], ["christmas-day", "Mass during the Day"],
] as const;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function anchor(label: string, href: string): HTMLAnchorElement {
  const link = element("a", label); link.href = href; return link;
}
function occasionHref(key: string, cycle: Cycle, season: Season): string {
  const query = new URLSearchParams({ cycle, season });
  return `/ordinary-form/${encodeURIComponent(key)}/?${query}`;
}
function longDate(date: LocalDate): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}
function inRange(date: LocalDate): boolean { return date.year >= MIN_YEAR && date.year <= MAX_YEAR; }

/** Occasion pairs for Sundays whose proper changes under one of the legacy transfer choices. */
export function dateMusicChoices(date: LocalDate, settings: OfSettings): OfMusicChoice[] {
  if (weekday(date) !== 0) return [];
  const current = ofDay(date, settings);
  if (!current.occasion) return [];
  const alternatives = [
    { feast: "epiphany", settings: { ...settings, epiphany: settings.epiphany === "sunday" ? "jan6" : "sunday" } },
    { feast: "ascension", settings: { ...settings, ascension: settings.ascension === "sunday" ? "thursday" : "sunday" } },
    { feast: "corpus-christi", settings: { ...settings, corpusChristi: settings.corpusChristi === "sunday" ? "thursday" : "sunday" } },
  ] as const;
  for (const alternative of alternatives) {
    const other = ofDay(date, alternative.settings);
    if (!other.occasion || other.occasion === current.occasion ||
        (other.occasion !== alternative.feast && current.occasion !== alternative.feast)) continue;
    return [
      { key: current.occasion, sundayCycle: current.sundayCycle, season: current.season },
      { key: other.occasion, sundayCycle: other.sundayCycle, season: other.season },
    ];
  }
  return [];
}
function readData(): Data {
  const el = document.getElementById("of-occasion-index");
  if (!el) throw new Error("Ordinary Form occasion index is missing");
  const parsed: unknown = JSON.parse(el.textContent ?? "{}");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("Ordinary Form occasion index is invalid");
  return parsed as Data;
}
function readIsoParameter(params: URLSearchParams): { date: LocalDate; error: string | null } {
  const raw = params.get("date");
  if (raw === null) return { date: today(), error: null };
  const parsed = parseIso(raw);
  if (!parsed) return { date: today(), error: `Enter a valid date from ${MIN_YEAR}-01-01 to ${MAX_YEAR}-12-31.` };
  return { date: parsed, error: null };
}
export function mountOrdinaryFormCalendar(root: HTMLElement): void {
  const data = readData();
  const input = root.querySelector<HTMLInputElement>("#date");
  const result = root.querySelector<HTMLElement>("#result");
  const feedback = root.querySelector<HTMLElement>("#date-feedback");
  if (!input || !result || !feedback) return;
  const dateInput = input, results = result, dateFeedback = feedback;
  let params = new URLSearchParams(window.location.search);
  let currentDate = readIsoParameter(params).date;
  let settings = readOfSettings(params);
  let dateError = readIsoParameter(params).error;

  function announceInvalid(message: string): void {
    dateError = message;
    dateInput.setAttribute("aria-invalid", "true");
    dateFeedback.textContent = message;
  }
  function clearInvalid(): void {
    dateError = null;
    dateInput.removeAttribute("aria-invalid");
    dateFeedback.textContent = "";
  }
  function serialize(push: boolean): void {
    const query = ofQuery(currentDate, settings);
    const url = `${window.location.pathname}?${query.toString()}`;
    if (push) history.pushState(null, "", url); else history.replaceState(null, "", url);
  }
  function partLink(part: OfPart): HTMLElement {
    const text = `${part.label} · ${part.incipit}`;
    if (part.href) return anchor(text, part.href);
    const wrap = element("span", text);
    wrap.append(" · ");
    const gb = anchor("Not in Nova Organi Harmonia", `https://gregobase.selapa.net/chant.php?id=${part.gregobaseId}`);
    gb.target = "_blank"; gb.rel = "noopener";
    wrap.append(gb);
    return wrap;
  }
  function render(date: LocalDate): void {
    currentDate = date;
    dateInput.value = isoOf(date);
    results.replaceChildren();
    results.append(element("h2", longDate(date), "date-heading"));
    if (dateError) { announceInvalid(dateError); return; }
    if (!inRange(date)) {
      announceInvalid(`The Ordinary Form calendar covers ${MIN_YEAR}–${MAX_YEAR}. Choose a date in that range.`);
      return;
    }
    clearInvalid();
    const day = ofDay(date, settings);
    results.append(element("p", `${SEASONS[day.season]} · Year ${day.sundayCycle} · Weekday Year ${day.weekdayCycle}`, "season"));
    if (day.provisionalNotice) results.append(element("p", day.provisionalNotice, "notice provisional"));

    const key = day.occasion ?? day.weekdayOccasion;
    if (key) {
      const occasion = data[key];
      if (occasion) {
        const block = element("section", undefined, "observance");
        block.append(element("h2", occasion.titleEn));
        if (occasion.titleLa) {
          const latin = element("p", occasion.titleLa, "latin");
          latin.lang = "la";
          block.append(latin);
        }
        const color = COLORS[occasion.color] ?? { label: occasion.color, swatch: "transparent" };
        const meta = element("p", undefined, "meta");
        const swatch = element("span", undefined, "swatch"); swatch.style.background = color.swatch; swatch.setAttribute("aria-hidden", "true");
        meta.append(swatch, `${color.label} · ${occasion.rank.replaceAll("-", " ")}`);
        block.append(meta);
        if (occasion.rubric) block.append(element("p", occasion.rubric, "note rubric"));
        const music = element("dl", undefined, "music");
        music.append(element("dt", "Proper chants"));
        const dd = element("dd");
        if (occasion.assignmentStatus === "unmapped") {
          dd.append(element("p", "chants not yet mapped", "notice"));
        } else {
          const parts = (occasion.partsByCycle[day.sundayCycle] ?? []).filter(part => !part.seasons || part.seasons.includes(day.season));
          if (!parts.length) dd.append(element("p", "No chant assignment is recorded for this occasion.", "note"));
          const bySourceSlot = new Map<string, OfPart[]>();
          for (const part of parts) bySourceSlot.set(part.sourceSlot, [...(bySourceSlot.get(part.sourceSlot) ?? []), part]);
          const list = element("ul", undefined, "parts");
          for (const part of parts) {
            const li = element("li");
            const dt = partLink(part);
            li.append(dt);
            const same = bySourceSlot.get(part.sourceSlot) ?? [];
            if (same.length > 1 && part === same[0]) li.append(element("p", "Several alternatives are listed for this chant; choose the one required for the celebration.", "alternatives"));
            list.append(li);
          }
          if (parts.length) dd.append(list);
        }
        music.append(dd); block.append(music);
        const choices = dateMusicChoices(date, settings).filter(choice => data[choice.key]);
        if (choices.length === 2) {
          const links = element("div", undefined, "occasion-options accompaniment-choices");
          links.append("Choose the music for your local celebration: ");
          choices.forEach((choice, i) => {
            if (i) links.append(" · ");
            const occasionChoice = data[choice.key]!;
            links.append(anchor(`View ${occasionChoice.titleEn} accompaniments`,
              occasionHref(choice.key, choice.sundayCycle, choice.season)));
          });
          block.append(links);
        } else {
          const cta = anchor("View accompaniments for this occasion", occasionHref(key, day.sundayCycle, day.season));
          cta.className = "accompaniments"; block.append(cta);
        }
        results.append(block);
      }
    } else if (day.season === "ordinary" && day.sundayMassOccasion) {
      const rubric = element("p", "the chants of this week's Sunday Mass may be used", "note");
      const sunday = data[day.sundayMassOccasion];
      if (sunday) rubric.append(" · ", anchor(`${sunday.titleEn} (Sunday Mass of this week)`, occasionHref(sunday.key, day.sundayCycle, day.season)));
      results.append(rubric);
    } else if (day.season === "ordinary") {
      const rubric = element("p", "the chants of the preceding Sunday may be used", "note");
      if (day.precedingSundayOccasion) {
        const prior = data[day.precedingSundayOccasion];
        if (prior) rubric.append(" · ", anchor(`${prior.titleEn} (preceding Sunday)`, occasionHref(prior.key, day.sundayCycle, day.season)));
      }
      results.append(rubric);
    } else if (day.sundayMassOccasion) {
      const rubric = element("p", "the chants of the Sunday are repeated on this weekday", "note");
      const sunday = data[day.sundayMassOccasion];
      if (sunday) rubric.append(" · ", anchor(`${sunday.titleEn} (Mass of the Sunday)`, occasionHref(sunday.key, day.sundayCycle, day.season)));
      results.append(rubric);
    } else if (day.season === "triduum") {
      results.append(element("p", "No Mass is celebrated during the day.", "note"));
    }

    if (day.vigil) {
      const options = element("p", undefined, "occasion-options");
      options.append("Vigil (evening): ", anchor(data[day.vigil]?.titleEn ?? "Vigil", occasionHref(day.vigil, day.sundayCycle, day.season)));
      results.append(options);
    }
    if (day.readingChantsOccasion && data[day.readingChantsOccasion]) {
      const options = element("p", undefined, "occasion-options");
      options.append("Optional chants suited to the readings: ",
        anchor(data[day.readingChantsOccasion]!.titleEn, occasionHref(day.readingChantsOccasion, day.sundayCycle, day.season)));
      results.append(options);
    }
    if (key === "christmas-day") {
      const options = element("div", undefined, "occasion-options");
      options.append("Christmas Mass options: ");
      CHRISTMAS_OPTIONS.forEach(([option, label], i) => {
        if (i) options.append(" · ");
        options.append(anchor(label, occasionHref(option, day.sundayCycle, "christmas")));
      });
      results.append(options);
    }
  }
  function refreshNavigation(): void {
    const prev = root.querySelector<HTMLButtonElement>('[data-step="-1"]');
    const next = root.querySelector<HTMLButtonElement>('[data-step="1"]');
    if (prev) prev.disabled = isoOf(currentDate) <= `${MIN_YEAR}-01-01`;
    if (next) next.disabled = isoOf(currentDate) >= `${MAX_YEAR}-12-31`;
  }
  function move(date: LocalDate): void {
    if (!inRange(date)) { render(date); refreshNavigation(); return; }
    clearInvalid(); currentDate = date; serialize(true); render(date); refreshNavigation();
  }

  root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(button => button.addEventListener("click", () => move(addDays(currentDate, Number(button.dataset["step"])) )));
  root.querySelector<HTMLButtonElement>("[data-go=today]")?.addEventListener("click", () => move(today()));
  root.querySelector<HTMLButtonElement>("[data-go=sunday]")?.addEventListener("click", () => move(nextSunday(currentDate)));
  function submitDate(): void {
    const value = dateInput.value;
    const date = parseIso(value);
    if (!date) { announceInvalid(`Enter a valid date from ${MIN_YEAR}-01-01 to ${MAX_YEAR}-12-31.`); return; }
    dateError = null; move(date);
  }
  dateInput.addEventListener("change", submitDate);
  root.querySelector<HTMLFormElement>("#picker")?.addEventListener("submit", event => {
    event.preventDefault(); submitDate();
  });
  window.addEventListener("popstate", () => {
    params = new URLSearchParams(window.location.search);
    const parsed = readIsoParameter(params); currentDate = parsed.date; dateError = parsed.error;
    settings = readOfSettings(params); render(currentDate); refreshNavigation();
  });
  const initial = readIsoParameter(params);
  currentDate = initial.date; dateError = initial.error;
  render(currentDate); refreshNavigation();
  // Make the effective initial state restorable when Back is pressed after a
  // calendar action, including settings loaded from local storage on a bare URL.
  if (!dateError && inRange(currentDate)) serialize(false);
}
