import { describe, expect, it } from "vitest";

import {
  CALENDAR_SOURCE,
  addDays,
  adventStart,
  colorOf,
  daysBetween,
  easter,
  isFeastOfOurLady,
  isoOf,
  kyrialeFor,
  loadYear,
  localDate,
  nextSunday,
  observance,
  parseIso,
  parseVocabulary,
  seasonForDate,
  seasonOfTempora,
  today,
  weekday,
} from "./liturgy";
import type { LocalDate, Observance } from "./liturgy";

const YEARS: number[] = [];
for (let y = CALENDAR_SOURCE.years[0]; y <= CALENDAR_SOURCE.years[1]; y += 1) YEARS.push(y);

/** First date in `year` whose celebrated observance satisfies `pick`. Test dates are
 *  found in the data rather than assumed: a first draft chose 16 Sep, 2 Dec and
 *  7 Jul 2026 as "ordinary weekdays", and all three turned out to be saints' days. */
async function findDate(year: number, pick: (o: Observance, d: LocalDate) => boolean): Promise<string> {
  const days = await loadYear(year);
  for (const [iso, day] of Object.entries(days ?? {})) {
    const o = observance(day.celebration[0] ?? "");
    const d = parseIso(iso)!;
    if (o && pick(o, d)) return iso;
  }
  throw new Error(`no matching date in ${year}`);
}

/** The observance Missalemeum puts first on a date — the day actually celebrated. */
async function celebrated(iso: string): Promise<{ o: Observance; d: LocalDate }> {
  const d = parseIso(iso);
  if (!d) throw new Error(`bad date ${iso}`);
  const days = await loadYear(d.year);
  const key = days?.[iso]?.celebration[0];
  const o = key ? observance(key) : undefined;
  if (!o) throw new Error(`no celebration on ${iso}`);
  return { o, d };
}

describe("dates", () => {
  it("should compute Easter independently of the generated calendar", () => {
    expect(isoOf(easter(2026))).toBe("2026-04-05");
    expect(isoOf(easter(2038))).toBe("2038-04-25");
  });

  it("should agree with Missalemeum's Easter in every generated year", async () => {
    for (const year of YEARS) {
      const days = await loadYear(year);
      expect(days?.[isoOf(easter(year))]?.celebration).toContain("tempora:Pasc0-0");
    }
  });

  it("should place the first Sunday of Advent between 27 November and 3 December", () => {
    for (const year of YEARS) {
      const start = adventStart(year);
      expect(weekday(start)).toBe(0);
      expect(start.month === 11 ? start.day >= 27 : start.day <= 3).toBe(true);
    }
  });

  it("should reject impossible dates rather than rolling them over", () => {
    expect(parseIso("2026-02-30")).toBeNull();
    expect(parseIso("2026-13-01")).toBeNull();
    expect(parseIso("26-1-1")).toBeNull();
    expect(parseIso("2028-02-29")).toEqual(localDate(2028, 2, 29));
  });

  it("should take today from local time, not UTC", () => {
    // 23:30 on 31 Dec in a zone behind UTC is still 31 Dec for the reader.
    const late = new Date(2026, 11, 31, 23, 30);
    expect(isoOf(today(late))).toBe("2026-12-31");
  });

  it("should step across a year boundary", () => {
    expect(isoOf(addDays(localDate(2026, 12, 31), 1))).toBe("2027-01-01");
    expect(daysBetween(localDate(2026, 12, 25), localDate(2027, 1, 6))).toBe(12);
  });

  it("should find the next Sunday, inclusively when asked", () => {
    const sunday = localDate(2026, 11, 29);
    expect(isoOf(nextSunday(sunday))).toBe("2026-12-06");
    expect(isoOf(nextSunday(sunday, true))).toBe("2026-11-29");
    expect(isoOf(nextSunday(localDate(2026, 11, 26)))).toBe("2026-11-29");
  });
});

describe("seasons", () => {
  it.each([
    ["2026-11-29", "advent"],
    ["2026-12-25", "christmas"],
    ["2027-01-10", "christmas"],
    ["2027-01-20", "epiphany"],
    ["2026-02-01", "septuagesima"],
    ["2026-02-18", "lent"],          // Ash Wednesday
    ["2026-03-22", "passiontide"],   // Passion Sunday
    ["2026-04-05", "easter"],
    ["2026-05-30", "easter"],        // Ember Saturday of Pentecost, still Paschaltide
    ["2026-05-31", "pentecost"],     // Trinity Sunday
  ])("should put %s in %s", (iso, season) => {
    expect(seasonForDate(parseIso(iso)!)).toBe(season);
  });

  it("should agree with the Temporale key for every Temporale day, bar two stated exceptions", async () => {
    // The key answers "which part of the book holds these propers"; the date answers
    // "what season is it". They disagree in exactly two known places:
    //  * leftover Epiphany Sundays resumed in October-November: Epiphany propers,
    //    season after Pentecost;
    //  * the Holy Family (Epi1-0), always 7-13 January: keyed with Epiphany and
    //    printed there in NOH1's index, but by date still the Christmas cycle
    //    (the Epiphany octave), in white.
    const disagreements: string[] = [];
    for (const year of YEARS) {
      const days = await loadYear(year);
      for (const [iso, day] of Object.entries(days ?? {})) {
        for (const key of day.celebration) {
          const o = observance(key);
          if (!o || o.flexibility !== "tempora") continue;
          const byKey = seasonOfTempora(o);
          const byDate = seasonForDate(parseIso(iso)!);
          const resumedEpiphany = byKey === "epiphany" && byDate === "pentecost";
          const holyFamily = key === "tempora:Epi1-0" && byDate === "christmas";
          if (byKey !== byDate && !resumedEpiphany && !holyFamily) {
            disagreements.push(`${iso} ${key} ${byKey}/${byDate}`);
          }
        }
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe("colours", () => {
  it("should colour an ordinary weekday by its season, not the vocabulary's white", () => {
    const feria = observance(":feria")!;
    expect(feria.colors).toEqual(["w"]);
    expect(colorOf(feria, localDate(2026, 3, 3))).toBe("v");    // Lent
    expect(colorOf(feria, localDate(2026, 7, 7))).toBe("g");    // after Pentecost
  });

  it("should use the observance's own colour otherwise", () => {
    expect(colorOf(observance("sancti:12-26")!, localDate(2026, 12, 26))).toBe("r");
  });
});

describe("feasts of Our Lady", () => {
  it.each([
    ["sancti:08-15", true],    // Assumption
    ["sancti:08-05", true],    // Dedication of St Mary Major — a Marian feast
    ["commune:C10b", true],    // Saturday Mass of Our Lady
    ["sancti:07-26", false],   // St. Anne, Mother of the Blessed Virgin
    ["sancti:02-27", false],   // St. Gabriel of Our Lady of Sorrows
    ["sancti:07-22", false],   // St. Mary Magdalene
    ["sancti:03-19", false],   // St. Joseph, Spouse of the Bl. Virgin Mary
  ])("should classify %s as %s", (key, expected) => {
    expect(isFeastOfOurLady(observance(key)!)).toBe(expected);
  });
});

describe("kyrialeFor", () => {
  it.each([
    ["2026-11-29", "XVII", "Adventus et Quadragesimae"],   // I Sunday of Advent
    ["2026-03-01", "XVII", "Adventus et Quadragesimae"],   // II Sunday of Lent
    ["2026-03-29", "XVII", "Adventus et Quadragesimae"],   // Palm Sunday
    ["2026-09-27", "XI", "infra annum"],                   // XVIII Sunday after Pentecost
    ["2026-04-12", "I", "Tempore Paschali"],               // Low Sunday
    ["2026-04-05", "I", "Tempore Paschali"],               // Easter
    ["2026-08-15", "IX", "B. Mariae V."],                  // Assumption
    ["2026-05-31", "II", "Solemnibus"],                    // Trinity Sunday, I class
    ["2026-10-25", "II", "Solemnibus"],                    // Christ the King
    ["2027-07-26", "IV", "Duplicibus"],                    // St. Anne on a weekday — not Marian
    ["2026-09-16", "XII", "Semiduplicibus"],               // SS. Cornelius & Cyprian, III class
    ["2026-12-02", "XII", "Semiduplicibus"],               // St. Bibiana, III class, in Advent
  ])("should assign %s to Missa %s", async (iso, mass, headingPart) => {
    const { o, d } = await celebrated(iso);
    const suggestion = kyrialeFor(o, d);
    expect(suggestion.mass).toBe(mass);
    expect(suggestion.heading).toContain(headingPart);
  });

  it("should assign an Ember Wednesday to Missa XVIII", async () => {
    const iso = await findDate(2026, (o) => o.key === "tempora:093-3");
    const { o, d } = await celebrated(iso);
    expect(kyrialeFor(o, d).mass).toBe("XVIII");
  });

  it("should assign an Advent feria to Missa XVIII", async () => {
    const iso = await findDate(2026, (o, d) =>
      o.flexibility === "tempora" && o.name.startsWith("Adv") && weekday(d) !== 0);
    const { o, d } = await celebrated(iso);
    expect(kyrialeFor(o, d).heading).toContain("Adventus et Quadragesimae");
    expect(kyrialeFor(o, d).mass).toBe("XVIII");
  });

  it("should assign an ordinary weekday after Pentecost to Missa XVI", async () => {
    const iso = await findDate(2026, (o, d) =>
      o.flexibility === "" && seasonForDate(d) === "pentecost");
    const { o, d } = await celebrated(iso);
    expect(kyrialeFor(o, d).mass).toBe("XVI");
  });

  it("should decline to choose where the Kyriale headings are silent", async () => {
    const { o, d } = await celebrated("2026-02-01");    // Septuagesima Sunday
    const suggestion = kyrialeFor(o, d);
    expect(suggestion.mass).toBeNull();
    expect(suggestion.candidates).toEqual(["XVII", "XI"]);
    expect(suggestion.note).toMatch(/not Septuagesima/);
  });

  it("should flag the approximate 1942-to-1962 rank correspondence on feasts", async () => {
    const { o, d } = await celebrated("2027-07-26");
    expect(kyrialeFor(o, d).note).toMatch(/approximate/);
  });

  it("should suggest a Mass for every day in every generated year", async () => {
    for (const year of YEARS) {
      const days = await loadYear(year);
      for (const [iso, day] of Object.entries(days ?? {})) {
        const o = observance(day.celebration[0]!);
        const s = kyrialeFor(o!, parseIso(iso)!);
        expect(s.candidates.length, iso).toBeGreaterThan(0);
      }
    }
  });
});

describe("parseVocabulary", () => {
  const good = { key: "x:y", flexibility: "sancti", name: "y", rank: 2, colors: ["w"], title_en: "A", title_la: "B" };

  it("should map a valid entry", () => {
    expect(parseVocabulary({ "sancti:y": good }).get("sancti:y")?.titleLa).toBe("B");
  });

  it("should reject an unknown flexibility", () => {
    expect(() => parseVocabulary({ k: { ...good, flexibility: "votive" } })).toThrow(/flexibility/);
  });

  it("should reject a rank outside 1-4", () => {
    expect(() => parseVocabulary({ k: { ...good, rank: 5 } })).toThrow(/rank 5/);
  });
});

describe("loadYear", () => {
  it("should load a generated year with every day", async () => {
    expect(Object.keys((await loadYear(2028)) ?? {})).toHaveLength(366);
  });

  it("should return null outside the generated range", async () => {
    expect(await loadYear(1999)).toBeNull();
  });
});
