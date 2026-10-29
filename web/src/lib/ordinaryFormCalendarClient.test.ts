import { describe, expect, it } from "vitest";
import { localDate } from "./liturgy";
import { DEFAULT_OF_SETTINGS, ofDay, type OfSettings } from "./ordinaryForm";
import { dateMusicChoices } from "./ordinaryFormCalendarClient";

describe("date-specific Ordinary Form accompaniment choices", () => {
  const sundayTransfers: OfSettings = { epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" };

  it("offers Second Christmas and Epiphany on the transferred Epiphany Sunday", () => {
    const date = localDate(2026, 1, 4);
    const choices = dateMusicChoices(date, DEFAULT_OF_SETTINGS);
    expect(choices.map(choice => choice.key)).toEqual(["second-christmas", "epiphany"]);
    expect(choices.map(choice => [choice.season, choice.sundayCycle])).toEqual([ ["christmas", "A"], ["christmas", "A"] ]);
  });

  it("offers Baptism and Epiphany when the transferred date displaces the Baptism Sunday", () => {
    expect(dateMusicChoices(localDate(2034, 1, 8), DEFAULT_OF_SETTINGS).map(choice => choice.key))
      .toEqual(["baptism", "epiphany"]);
  });

  it("offers the seventh Sunday of Easter and Ascension on the relevant Sunday", () => {
    const date = localDate(2026, 5, 17);
    expect(dateMusicChoices(date, DEFAULT_OF_SETTINGS).map(choice => choice.key)).toEqual(["easter-7", "ascension"]);
  });

  it("offers the Ordinary Time Sunday and Corpus Christi when they share the transferred Sunday", () => {
    const date = localDate(2026, 6, 7);
    const choices = dateMusicChoices(date, DEFAULT_OF_SETTINGS);
    expect(choices.map(choice => choice.key)).toEqual(["ot-10", "corpus-christi"]);
    expect(choices.every(choice => choice.season === "ordinary" && choice.sundayCycle === "A")).toBe(true);
  });

  it("offers no duplicate pair when January 6 itself falls on Sunday", () => {
    expect(dateMusicChoices(localDate(2030, 1, 6), DEFAULT_OF_SETTINGS)).toEqual([]);
  });

  it("does not manufacture Sunday choices on the 2038 Corpus Christi and John collision weekdays", () => {
    expect(dateMusicChoices(localDate(2038, 6, 24), DEFAULT_OF_SETTINGS)).toEqual([]);
    expect(dateMusicChoices(localDate(2038, 6, 25), DEFAULT_OF_SETTINGS)).toEqual([]);
  });

  it.each([localDate(2026, 4, 5), localDate(2026, 6, 8)])("shows no transfer choices on unrelated dates (%j)", date => {
    expect(dateMusicChoices(date, sundayTransfers)).toEqual([]);
  });

  it("uses the active legacy transfer settings when ordering the links", () => {
    expect(dateMusicChoices(localDate(2026, 5, 17), sundayTransfers).map(choice => choice.key))
      .toEqual(["ascension", "easter-7"]);
    expect(ofDay(localDate(2026, 5, 17), sundayTransfers).occasion).toBe("ascension");
  });
});

describe("occasion links", () => {
  it("keeps cycle, season, date and all transfers in order", async () => {
    const { occasionHref } = await import("./ordinaryFormCalendarClient");
    expect(occasionHref("easter", "A", "easter", localDate(2026, 4, 5), {
      epiphany: "jan6", ascension: "sunday", corpusChristi: "thursday",
    })).toBe("/ordinary-form/easter/?cycle=A&season=easter&date=2026-04-05&epiphany=jan6&ascension=sunday&corpusChristi=thursday");
  });
});
