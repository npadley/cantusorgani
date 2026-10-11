import { addDays, adventStart, daysBetween, easter, localDate, nextSunday, weekday, type LocalDate } from "./liturgy";

export interface OfSettings {
  readonly epiphany: "jan6" | "sunday";
  readonly ascension: "thursday" | "sunday";
  readonly corpusChristi: "thursday" | "sunday";
}

export const DEFAULT_OF_SETTINGS: OfSettings = Object.freeze({
  epiphany: "jan6", ascension: "thursday", corpusChristi: "thursday",
});

export type OfSeason = "advent" | "christmas" | "lent" | "triduum" | "easter" | "ordinary";

export const OF_SEASON_LABELS: Readonly<Record<OfSeason, string>> = Object.freeze({
  advent: "Advent", christmas: "Christmas", lent: "Lent", triduum: "The Paschal Triduum",
  easter: "Easter", ordinary: "Ordinary Time",
});

export interface OfDay {
  readonly occasion: string | null;
  readonly provisionalNotice: string | null;
  readonly vigil: string | null;
  readonly sundayCycle: "A" | "B" | "C";
  readonly weekdayCycle: "I" | "II";
  readonly season: OfSeason;
  readonly otWeek: number | null;
  readonly precedingSundayOccasion: string | null;
}

interface Event { readonly key: string; readonly rank: number }
type Schedule = Map<string, Event[]>;
interface Resolution { readonly occasion: string | null; readonly provisionalNotice: string | null }
const scheduleCache = new Map<string, Schedule>();

function iso(d: LocalDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

function push(out: Schedule, date: LocalDate, key: string, rank: number): void {
  const k = iso(date), events = out.get(k) ?? [];
  events.push({ key, rank });
  out.set(k, events);
}

function sundaySeason(d: LocalDate, e: LocalDate, adv: LocalDate, settings: OfSettings): "advent" | "christmas" | "lent" | "easter" | "ordinary" {
  const offset = daysBetween(e, d);
  if ((d.month === 12 && d.day >= 25) || (d.month === 1 && daysBetween(d, baptismDate(d.year, settings)) >= 0)) return "christmas";
  if (daysBetween(adv, d) >= 0 && (d.month < 12 || d.day < 25)) return "advent";
  if (offset >= -46 && offset < 0) return "lent";
  if (offset >= 0 && offset <= 56) return "easter";
  return "ordinary";
}

function buildSchedule(year: number, settings: OfSettings): Schedule {
  const cacheKey = `${year}:${settings.epiphany}:${settings.ascension}:${settings.corpusChristi}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached) return cached;
  const out: Schedule = new Map();
  const e = easter(year), adv = adventStart(year);
  const palm = addDays(e, -7), ash = addDays(e, -46), pentecost = addDays(e, 49);
  const christKing = addDays(adv, -7);

  // Sundays in the proper of time. Solemnities and feasts of the Lord can
  // replace Ordinary Time or Christmas Sundays according to their table rank.
  for (let d = localDate(year, 1, 1); d.year === year; d = addDays(d, 1)) {
    if (weekday(d) !== 0) continue;
    const season = sundaySeason(d, e, adv, settings);
    const offset = daysBetween(e, d);
    if (season === "advent") {
      const week = Math.floor(daysBetween(adv, d) / 7) + 1;
      if (week <= 4) push(out, d, `advent-${week}`, 2);
    } else if (season === "lent") {
      const week = Math.floor((daysBetween(ash, d) + 4) / 7);
      if (week >= 1 && week <= 5) push(out, d, `lent-${week}`, 2);
      if (iso(d) === iso(palm)) push(out, d, "palm-sunday", 2);
    } else if (season === "easter") {
      if (offset === 0) push(out, d, "easter", 2);
      else if (offset >= 7 && offset <= 49 && offset % 7 === 0 && !(settings.ascension === "sunday" && offset === 42)) {
        const week = offset / 7 + 1;
        if (week <= 7) push(out, d, `easter-${week}`, 2);
      }
      if (offset === 56) push(out, d, "trinity", 3);
      if (settings.ascension === "sunday" && offset === 42) push(out, d, "ascension", 2);
      if (settings.corpusChristi === "sunday" && offset === 63) push(out, d, "corpus-christi", 3);
    } else if (season === "christmas") {
      push(out, d, "christmas-sunday", 6);
    } else {
      const baptism = baptismDate(year, settings);
      const start = nextSunday(baptism, false);
      if (daysBetween(start, d) >= 0 && daysBetween(d, palm) > 0) {
        const week = 2 + Math.floor(daysBetween(start, d) / 7);
        if (week <= 33) push(out, d, `ot-${week}`, 6);
      } else if (daysBetween(pentecost, d) > 0 && daysBetween(d, christKing) >= 0) {
        const week = 34 - Math.floor(daysBetween(d, christKing) / 7);
        if (week >= 2 && week <= 33) push(out, d, `ot-${week}`, 6);
      }
      if (iso(d) === iso(christKing)) push(out, d, "christ-the-king", 3);
    }
  }

  // Christmas and Epiphany cycle. Christmas Mass choices are separate links;
  // the daytime celebration remains Christmas Day.
  push(out, localDate(year, 12, 25), "christmas-day", 2);
  push(out, localDate(year, 1, 1), "mary-mother-of-god", 3);
  const epiphany = settings.epiphany === "jan6"
    ? localDate(year, 1, 6)
    : nextSunday(localDate(year, 1, 2), true);
  push(out, epiphany, "epiphany", 2);
  const baptism = baptismDate(year, settings);
  push(out, baptism, "baptism", 5);
  if (settings.epiphany === "jan6") {
    const secondChristmas = [2, 3, 4, 5].map(day => localDate(year, 1, day)).find(d => weekday(d) === 0);
    if (secondChristmas) {
      removeEvent(out, secondChristmas, "christmas-sunday");
      push(out, secondChristmas, "second-christmas", 6);
    }
  }
  const holyFamily = [26, 27, 28, 29, 30, 31].map(day => localDate(year, 12, day))
    .find(d => weekday(d) === 0);
  push(out, holyFamily ?? localDate(year, 12, 30), "holy-family", 5);

  // Principal movable days and vigils.
  push(out, ash, "ash-wednesday", 2);
  push(out, addDays(e, -3), "holy-thursday", 1);
  push(out, addDays(e, -2), "good-friday", 1);
  push(out, e, "easter", 2);
  if (settings.ascension === "thursday") push(out, addDays(e, 39), "ascension", 2);
  else push(out, addDays(e, 42), "ascension", 2);
  push(out, addDays(e, 49), "pentecost", 2);
  if (settings.corpusChristi === "thursday") push(out, addDays(e, 60), "corpus-christi", 3);
  else push(out, addDays(e, 63), "corpus-christi", 3);
  push(out, addDays(e, 68), "sacred-heart", 3);

  // Fixed solemnities, feasts of the Lord, and the explicitly named exceptions.
  const solemnities: Array<[number, number, string]> = [
    [3, 19, "st-joseph"], [3, 25, "annunciation"], [6, 24, "nativity-john-baptist"],
    [6, 29, "peter-paul"], [8, 15, "assumption"], [11, 1, "all-saints"],
    [11, 2, "all-souls"], [12, 8, "immaculate-conception"],
  ];
  for (const [month, day, key] of solemnities) push(out, localDate(year, month, day), key, 3);
  const lords: Array<[number, number, string]> = [
    [2, 2, "presentation"], [8, 6, "transfiguration"], [9, 14, "exaltation-cross"], [11, 9, "lateran-dedication"],
  ];
  for (const [month, day, key] of lords) push(out, localDate(year, month, day), key, 5);
  push(out, localDate(year, 9, 8), "birth-mary", 7);
  push(out, localDate(year, 11, 21), "presentation-mary", 10);

  // The CDW resolved this exact collision for 2022 only. Per the user's
  // approved provisional policy, apply the same transfer in later recurrences
  // while making its provisional status visible on both affected dates.
  const sacredHeart = addDays(e, 68);
  if (sacredHeart.month === 6 && sacredHeart.day === 24) {
    removeEvent(out, localDate(year, 6, 24), "nativity-john-baptist");
    push(out, localDate(year, 6, 23), "nativity-john-baptist", 3);
  }
  const thursdayCorpus = settings.corpusChristi === "thursday" ? addDays(e, 60) : null;
  const corpusJohnCollision = thursdayCorpus?.month === 6 && thursdayCorpus.day === 24;
  if (corpusJohnCollision) {
    // User-approved provisional product policy: leave Corpus Christi on its
    // movable Thursday and transfer John to June 25. This is not a claimed
    // year-specific decree; show the provisional decision on both dates.
    removeEvent(out, thursdayCorpus, "nativity-john-baptist");
    push(out, addDays(thursdayCorpus, 1), "nativity-john-baptist", 3);
  }

  // Transfer solemnities impeded by table positions 1–8. St Joseph has a
  // specific anticipation rule in Holy Week; Annunciation has its own date.
  for (const [month, day, key] of solemnities) {
    const original = localDate(year, month, day);
    if (key === "all-souls") continue;
    if (key === "st-joseph") {
      if (isHolyWeek(original, e)) {
        removeEvent(out, original, key);
        push(out, addDays(palm, -1), key, 3);
      } else if (weekday(original) === 0 && daysBetween(ash, original) >= 0 && daysBetween(original, palm) > 0) {
        removeEvent(out, original, key);
        push(out, addDays(original, 1), key, 3);
      }
      continue;
    }
    if (key === "annunciation" && (isHolyWeek(original, e) || isEasterOctave(original, e))) {
      removeEvent(out, original, key);
      push(out, addDays(e, 8), key, 3);
      continue;
    }
    if (isImpeded(out.get(iso(original)), key, original, e)) {
      removeEvent(out, original, key);
      let target = addDays(original, 1);
      for (let guard = 0; guard < 14 && isTablePositionOneToEight(out, target, e); guard++) target = addDays(target, 1);
      push(out, target, key, 3);
    }
  }

  scheduleCache.set(cacheKey, out);
  return out;
}

function removeEvent(out: Schedule, date: LocalDate, key: string): void {
  const list = out.get(iso(date));
  if (list) out.set(iso(date), list.filter(e => e.key !== key));
}

function isImpeded(events: readonly Event[] | undefined, key: string, date: LocalDate, e: LocalDate): boolean {
  return isHolyWeek(date, e) || isEasterOctave(date, e) ||
    !!events?.some(event => event.key !== key && event.rank < 3);
}

function isTablePositionOneToEight(out: Schedule, date: LocalDate, e: LocalDate): boolean {
  if (out.has(iso(date))) return out.get(iso(date))!.some(x => x.rank <= 8);
  if (weekday(date) === 0) return true;
  if (isHolyWeek(date, e) || isEasterOctave(date, e)) return true;
  return false;
}

function isHolyWeek(d: LocalDate, e: LocalDate): boolean {
  return daysBetween(e, d) >= -7 && daysBetween(e, d) <= -1;
}
function isEasterOctave(d: LocalDate, e: LocalDate): boolean {
  return daysBetween(e, d) >= 1 && daysBetween(e, d) <= 7;
}

function baptismDate(year: number, settings: OfSettings): LocalDate {
  const epiphany = settings.epiphany === "jan6" ? localDate(year, 1, 6) : nextSunday(localDate(year, 1, 2), true);
  if (settings.epiphany === "sunday" && epiphany.day >= 7) return addDays(epiphany, 1);
  return nextSunday(epiphany);
}

function activeOccasion(schedule: Schedule, d: LocalDate): Resolution {
  const candidates = schedule.get(iso(d)) ?? [];
  if (weekday(d) !== 0) {
    // Feasts and memorials are never placed on Sundays; solemnities and Lord's
    // feasts may share a Sunday, with precedence deciding the winner.
    return selectByPrecedence(candidates, d);
  }
  const valid = candidates.filter(e => e.rank <= 6 && e.key !== "birth-mary" && e.key !== "presentation-mary");
  return selectByPrecedence(valid, d);
}

function selectByPrecedence(events: readonly Event[], date: LocalDate): Resolution {
  if (!events.length) return { occasion: null, provisionalNotice: null };
  const rank = Math.min(...events.map(event => event.rank));
  const keys = [...new Set(events.filter(event => event.rank === rank).map(event => event.key))];
  if (keys.length > 1) throw new Error(`Unresolved equal-rank calendar collision on ${iso(date)}: ${keys.join(", ")}`);
  return { occasion: keys[0] ?? null, provisionalNotice: null };
}

function computedOtWeek(d: LocalDate, settings: OfSettings, active: string | null): number | null {
  if (weekday(d) !== 0) {
    if (dateSeason(d, settings) !== "ordinary") return null;
    const e = easter(d.year), christKing = addDays(adventStart(d.year), -7);
    if (daysBetween(e, d) >= 50)
      return 34 - Math.ceil(daysBetween(d, christKing) / 7);
    const previousSunday = addDays(d, -weekday(d));
    const previous = resolve(previousSunday, settings).occasion;
    const previousWeek = sundayOtWeek(previousSunday, settings, previous);
    if (previousWeek !== null) return previousWeek;
    const baptism = baptismDate(d.year, settings);
    if (daysBetween(baptism, d) > 0 && daysBetween(d, nextSunday(baptism)) > 0) return 1;
    return null;
  }
  return sundayOtWeek(d, settings, active);
}

function sundayOtWeek(d: LocalDate, settings: OfSettings, active: string | null): number | null {
  if (active?.startsWith("ot-")) return Number(active.slice(3));
  if (active === "christ-the-king") return 34;
  if (active === "trinity") return 34 - Math.floor(daysBetween(d, addDays(adventStart(d.year), -7)) / 7);
  if (active === "corpus-christi" && settings.corpusChristi === "sunday")
    return 34 - Math.floor(daysBetween(d, addDays(adventStart(d.year), -7)) / 7);
  const e = easter(d.year), adv = adventStart(d.year), baptism = baptismDate(d.year, settings);
  if (weekday(d) === 0 && sundaySeason(d, e, adv, settings) === "ordinary") {
    const afterBaptism = nextSunday(baptism);
    if (daysBetween(afterBaptism, d) >= 0 && daysBetween(d, addDays(e, -7)) > 0)
      return 2 + Math.floor(daysBetween(afterBaptism, d) / 7);
    const ck = addDays(adv, -7);
    if (daysBetween(addDays(e, 56), d) > 0 && daysBetween(d, ck) >= 0)
      return 34 - Math.floor(daysBetween(d, ck) / 7);
  }
  return null;
}

function dateSeason(d: LocalDate, settings: OfSettings): OfSeason {
  const e = easter(d.year), adv = adventStart(d.year), offset = daysBetween(e, d);
  if (d.month === 12 && daysBetween(adv, d) >= 0 && d.day < 25) return "advent";
  if ((d.month === 12 && d.day >= 25) || (d.month === 1 && daysBetween(d, baptismDate(d.year, settings)) >= 0)) return "christmas";
  if (daysBetween(adv, d) >= 0) return "advent";
  if (offset >= -3 && offset <= -1) return "triduum";
  if (offset >= -46 && offset <= -4) return "lent";
  if (offset >= 0 && offset <= 49) return "easter";
  return "ordinary";
}

function cycleYear(d: LocalDate): number {
  return daysBetween(adventStart(d.year), d) >= 0 ? d.year + 1 : d.year;
}

function cycleForYear(year: number): "A" | "B" | "C" {
  return (["C", "A", "B"] as const)[year % 3]!;
}

function resolve(d: LocalDate, settings: OfSettings): { occasion: string | null; otWeek: number | null } {
  const schedule = buildSchedule(d.year, settings);
  const result = activeOccasion(schedule, d);
  return { occasion: result.occasion, otWeek: computedOtWeek(d, settings, result.occasion) };
}

/** Resolve a Gregorian civil date under the three General Roman transfer choices. */
export function ofDay(date: LocalDate, settings: OfSettings = DEFAULT_OF_SETTINGS): OfDay {
  const { occasion, otWeek } = resolve(date, settings);
  const season = dateSeason(date, settings);
  const e = easter(date.year);
  const sacredHeartDate = addDays(e, 68);
  const sacredHeartCollision = sacredHeartDate.month === 6 && sacredHeartDate.day === 24 &&
    date.year >= 2024 && (iso(date) === iso(localDate(date.year, 6, 23)) || iso(date) === iso(localDate(date.year, 6, 24)))
    ? "Provisional: the 2022 transfer is applied here, placing the Nativity of John the Baptist on June 23 and the Sacred Heart on June 24."
    : null;
  const corpusJohnCollision = settings.corpusChristi === "thursday" && addDays(e, 60).month === 6 && addDays(e, 60).day === 24 &&
    (iso(date) === iso(localDate(date.year, 6, 24)) || iso(date) === iso(localDate(date.year, 6, 25)))
    ? "Provisional: Corpus Christi remains on June 24 and the Nativity of John the Baptist is transferred to June 25 by user-approved product policy. No 2038 annual ordo confirms this outcome; the 2022 transfer is an analogy, not a standing directive."
    : null;
  const provisionalNotice = corpusJohnCollision ?? sacredHeartCollision;
  const vig = date.month === 12 && date.day === 24 ? "christmas-vigil"
    : iso(date) === iso(addDays(e, -1)) ? "easter-vigil"
      : iso(date) === iso(addDays(e, 48)) ? "pentecost-vigil" : null;
  let precedingSundayOccasion: string | null = null;
  if (weekday(date) !== 0 && season === "ordinary") {
    const prev = addDays(date, -weekday(date));
    if (dateSeason(prev, settings) === "ordinary") precedingSundayOccasion = resolve(prev, settings).occasion;
  }
  const year = cycleYear(date);
  return {
    occasion: occasion === "christmas-sunday" ? null : occasion,
    provisionalNotice,
    vigil: vig,
    sundayCycle: cycleForYear(year),
    weekdayCycle: year % 2 === 0 ? "II" : "I",
    season,
    otWeek,
    precedingSundayOccasion,
  };
}
