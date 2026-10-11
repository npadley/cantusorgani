import fixtures from "../../../data/ordinary-form/calendar-fixtures.json";
import propers from "../../../data/ordinary-form-propers.json";
import { describe, expect, it } from "vitest";
import { addDays, adventStart, daysBetween, easter, isoOf, localDate, weekday } from "./liturgy";
import { DEFAULT_OF_SETTINGS, ofDay, type OfSettings } from "./ordinaryForm";

const presets: Record<string, OfSettings> = {
  "general-roman": DEFAULT_OF_SETTINGS,
  "sunday-transfers": { epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" },
};

describe("Ordinary Form calendar fixtures", () => {
  it.each(fixtures.cases)("resolves $date ($settings)", (fixture) => {
    const result = ofDay(localDate(...fixture.date.split("-").map(Number) as [number, number, number]), presets[fixture.settings]!);
    expect({
      occasion: result.occasion,
      vigil: result.vigil,
      provisionalNotice: result.provisionalNotice,
      season: result.season,
      sundayCycle: result.sundayCycle,
      weekdayCycle: result.weekdayCycle,
      otWeek: result.otWeek,
    }).toMatchObject(fixture.expected);
  });
});

describe("Ordinary Form calendar rules", () => {
  it("assigns the liturgical year cycle on both sides of Advent", () => {
    expect(ofDay(localDate(2025, 11, 29), DEFAULT_OF_SETTINGS).sundayCycle).toBe("C");
    expect(ofDay(localDate(2025, 11, 30), DEFAULT_OF_SETTINGS).sundayCycle).toBe("A");
    expect(ofDay(localDate(2025, 11, 30), DEFAULT_OF_SETTINGS).weekdayCycle).toBe("II");
    expect(ofDay(localDate(2026, 11, 28), DEFAULT_OF_SETTINGS).sundayCycle).toBe("A");
    expect(ofDay(localDate(2026, 11, 29), DEFAULT_OF_SETTINGS).sundayCycle).toBe("B");
  });

  it("returns the actual Ordinary Time Sunday before a weekday", () => {
    expect(ofDay(localDate(2025, 6, 30), DEFAULT_OF_SETTINGS)).toMatchObject({ precedingSundayOccasion: "peter-paul", otWeek: 13 });
    const transferredCorpus = { ...DEFAULT_OF_SETTINGS, corpusChristi: "sunday" as const };
    expect(ofDay(localDate(2025, 6, 23), transferredCorpus)).toMatchObject({ precedingSundayOccasion: "corpus-christi", otWeek: 12 });
    expect(ofDay(localDate(2025, 4, 21), DEFAULT_OF_SETTINGS).precedingSundayOccasion).toBeNull();
  });

  it("keeps named Lord feasts on weekdays when no higher day impedes them", () => {
    expect(ofDay(localDate(2024, 2, 2), DEFAULT_OF_SETTINGS).occasion).toBe("presentation");
    expect(ofDay(localDate(2024, 8, 6), DEFAULT_OF_SETTINGS).occasion).toBe("transfiguration");
    expect(ofDay(localDate(2024, 9, 14), DEFAULT_OF_SETTINGS).occasion).toBe("exaltation-cross");
  });

  it("shows the BVM feast and memorial exceptions on weekdays and omits them on Sundays", () => {
    expect(ofDay(localDate(2025, 9, 8), DEFAULT_OF_SETTINGS).occasion).toBe("birth-mary");
    expect(ofDay(localDate(2024, 9, 8), DEFAULT_OF_SETTINGS).occasion).toBe("ot-23");
    expect(ofDay(localDate(2024, 11, 21), DEFAULT_OF_SETTINGS).occasion).toBe("presentation-mary");
  });

  it("keeps Christmas Sundays out of Advent and starts the Triduum on Holy Thursday", () => {
    expect(ofDay(localDate(2027, 12, 26), DEFAULT_OF_SETTINGS)).toMatchObject({ occasion: "holy-family", season: "christmas" });
    expect(ofDay(localDate(2025, 4, 13), DEFAULT_OF_SETTINGS).season).toBe("lent");
    expect(ofDay(localDate(2025, 4, 16), DEFAULT_OF_SETTINGS).season).toBe("lent");
    expect(ofDay(localDate(2025, 4, 17), DEFAULT_OF_SETTINGS).season).toBe("triduum");
    expect(ofDay(localDate(2025, 6, 15), DEFAULT_OF_SETTINGS).season).toBe("ordinary");
  });

  it("transfers St Joseph from a Lenten Sunday to Monday", () => {
    expect(ofDay(localDate(2028, 3, 19), DEFAULT_OF_SETTINGS).occasion).toBe("lent-3");
    expect(ofDay(localDate(2028, 3, 20), DEFAULT_OF_SETTINGS).occasion).toBe("st-joseph");
  });

  it("derives weekday Ordinary Time numbering after Pentecost from Christ the King", () => {
    expect(ofDay(localDate(2024, 5, 20), DEFAULT_OF_SETTINGS).otWeek).toBe(7);
    expect(ofDay(localDate(2024, 5, 27), DEFAULT_OF_SETTINGS).otWeek).toBe(8);
    expect(ofDay(localDate(2025, 6, 9), DEFAULT_OF_SETTINGS).otWeek).toBe(10);
    expect(ofDay(localDate(2025, 6, 16), DEFAULT_OF_SETTINGS).otWeek).toBe(11);
  });

  it("provides evening vigils and distinct Christmas options without clock selection", () => {
    expect(ofDay(localDate(2025, 12, 24), DEFAULT_OF_SETTINGS)).toMatchObject({ occasion: null, vigil: "christmas-vigil" });
    expect(ofDay(localDate(2025, 12, 25), DEFAULT_OF_SETTINGS)).toMatchObject({ occasion: "christmas-day", vigil: null });
    expect(ofDay(localDate(2025, 4, 19), DEFAULT_OF_SETTINGS).vigil).toBe("easter-vigil");
    expect(ofDay(localDate(2025, 6, 7), DEFAULT_OF_SETTINGS).vigil).toBe("pentecost-vigil");
  });

  it("selects at most one Sunday celebration for all years and settings", () => {
    const values = ["jan6", "sunday"] as const;
    for (let year = 2024; year <= 2050; year++) {
      for (const epiphany of values) for (const ascension of ["thursday", "sunday"] as const)
        for (const corpusChristi of ["thursday", "sunday"] as const) {
          const settings: OfSettings = { epiphany, ascension, corpusChristi };
          for (let day = localDate(year, 1, 1); day.year === year; day = addDays(day, 1)) {
            if (weekday(day) === 0) expect(ofDay(day, settings).occasion, `${isoOf(day)} ${JSON.stringify(settings)}`).toBeTruthy();
          }
        }
    }
  }, 30_000);

  it("keeps every date's season, cycle, and Ordinary Time week valid under all eight settings", () => {
    const values = ["jan6", "sunday"] as const;
    const seasons = new Set(["advent", "christmas", "lent", "triduum", "easter", "ordinary"]);
    const occasionKeys = new Set(propers.occasions.map((occasion) => occasion.key));
    for (let year = 2024; year <= 2050; year++) {
      for (const epiphany of values) for (const ascension of ["thursday", "sunday"] as const)
        for (const corpusChristi of ["thursday", "sunday"] as const) {
          const settings: OfSettings = { epiphany, ascension, corpusChristi };
          for (let day = localDate(year, 1, 1); day.year === year; day = addDays(day, 1)) {
            const result = ofDay(day, settings);
            const label = `${isoOf(day)} ${JSON.stringify(settings)}`;
            expect(seasons.has(result.season), label).toBe(true);
            expect(["A", "B", "C"]).toContain(result.sundayCycle);
            expect(["I", "II"]).toContain(result.weekdayCycle);
            if (result.occasion) expect(occasionKeys.has(result.occasion), `${label}: occasion ${result.occasion}`).toBe(true);
            if (result.vigil) expect(occasionKeys.has(result.vigil), `${label}: vigil ${result.vigil}`).toBe(true);
            if (result.precedingSundayOccasion) expect(occasionKeys.has(result.precedingSundayOccasion), `${label}: preceding Sunday ${result.precedingSundayOccasion}`).toBe(true);
            if (result.season === "ordinary") expect(result.otWeek, label).toBeGreaterThanOrEqual(1);
            if (result.otWeek !== null) expect(result.otWeek, label).toBeLessThanOrEqual(34);
            if (result.season === "ordinary" && daysBetween(easter(year), day) >= 50) {
              const weeksRemaining = daysBetween(day, addDays(adventStart(year), -7)) / 7;
              const expectedWeek = 34 - (weekday(day) === 0 ? Math.floor(weeksRemaining) : Math.ceil(weeksRemaining));
              expect(result.otWeek, label).toBe(expectedWeek);
            }
          }
        }
    }
  }, 30_000);

  it("places every explicitly named weekday exception at least once on an unimpeded weekday", () => {
    const requiredWeekdayExceptions = ["birth-mary", "presentation-mary", "presentation", "transfiguration", "exaltation-cross", "lateran-dedication"];
    const observed = new Set<string>();
    for (let year = 2024; year <= 2050; year++) {
      for (let day = localDate(year, 1, 1); day.year === year; day = addDays(day, 1)) {
        if (weekday(day) !== 0) {
          const occasion = ofDay(day, DEFAULT_OF_SETTINGS).occasion;
          if (occasion) observed.add(occasion);
        }
      }
    }
    for (const key of requiredWeekdayExceptions) expect(observed.has(key), key).toBe(true);
  });

  it("marks Easter, Christmas and Advent boundaries in the expected seasons", () => {
    for (let y = 2024; y <= 2050; y++) {
      const e = easter(y);
      expect(ofDay(e, DEFAULT_OF_SETTINGS).season).toBe("easter");
      expect(ofDay(addDays(e, -46), DEFAULT_OF_SETTINGS).season).toBe("lent");
      expect(ofDay(localDate(y, 12, 25), DEFAULT_OF_SETTINGS).season).toBe("christmas");
      expect(ofDay(addDays(localDate(y, 11, 27), (7 - weekday(localDate(y, 11, 27))) % 7), DEFAULT_OF_SETTINGS).season).toBe("advent");
    }
  });

  it("does not turn an Ordinary Time Sunday feast into a weekday elsewhere", () => {
    expect(ofDay(localDate(2025, 6, 29), DEFAULT_OF_SETTINGS).occasion).toBe("peter-paul");
  });

  it("keeps the user-approved provisional collision policy visible under every transfer combination", () => {
    for (const epiphany of ["jan6", "sunday"] as const)
      for (const ascension of ["thursday", "sunday"] as const)
        for (const corpusChristi of ["thursday", "sunday"] as const) {
          const settings: OfSettings = { epiphany, ascension, corpusChristi };
          expect(ofDay(localDate(2033, 6, 23), settings)).toMatchObject({
            occasion: "nativity-john-baptist", provisionalNotice: expect.stringContaining("Provisional"),
          });
          expect(ofDay(localDate(2033, 6, 24), settings)).toMatchObject({
            occasion: "sacred-heart", provisionalNotice: expect.stringContaining("Provisional"),
          });
          expect(ofDay(localDate(2044, 6, 23), settings).occasion).toBe("nativity-john-baptist");
          expect(ofDay(localDate(2044, 6, 24), settings).occasion).toBe("sacred-heart");
        }
  });

  it("provisionally moves John the Baptist after Thursday Corpus Christi in 2038", () => {
    for (const epiphany of ["jan6", "sunday"] as const)
      for (const ascension of ["thursday", "sunday"] as const) {
        const thursdaySettings: OfSettings = { epiphany, ascension, corpusChristi: "thursday" };
        expect(ofDay(localDate(2038, 6, 24), thursdaySettings)).toMatchObject({
          occasion: "corpus-christi",
          provisionalNotice: expect.stringContaining("Provisional"),
        });
        expect(ofDay(localDate(2038, 6, 25), thursdaySettings)).toMatchObject({
          occasion: "nativity-john-baptist",
          provisionalNotice: expect.stringContaining("Provisional"),
        });
        const sundaySettings: OfSettings = { epiphany, ascension, corpusChristi: "sunday" };
        expect(ofDay(localDate(2038, 6, 24), sundaySettings)).toMatchObject({
          occasion: "nativity-john-baptist", provisionalNotice: null,
        });
      }
  });
});
