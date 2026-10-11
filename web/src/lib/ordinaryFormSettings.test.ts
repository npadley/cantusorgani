import { localDate } from "./liturgy";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OF_SETTINGS, OF_SETTINGS_STORAGE_KEY, ofQuery, presetForSettings,
  readOfSettings, settingsForPreset,
} from "./ordinaryFormSettings";

describe("ordinary form settings", () => {
  it("uses recognized query fields and defaults omitted values when any is present", () => {
    const saved = { epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" };
    expect(readOfSettings(new URLSearchParams("ascension=sunday"), saved)).toEqual({
      epiphany: "jan6", ascension: "sunday", corpusChristi: "thursday",
    });
    expect(readOfSettings(new URLSearchParams("epiphany=bad&unknown=yes"), saved)).toEqual(DEFAULT_OF_SETTINGS);
    expect(readOfSettings(new URLSearchParams("unknown=yes"), saved)).toEqual(saved);
  });

  it("uses validated storage only when the URL has no recognized settings fields", () => {
    const saved = { epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" };
    expect(readOfSettings(new URLSearchParams(), saved)).toEqual(saved);
    expect(readOfSettings(new URLSearchParams(), { ...saved, extra: true })).toEqual(DEFAULT_OF_SETTINGS);
    expect(readOfSettings(new URLSearchParams(), "{" )).toEqual(DEFAULT_OF_SETTINGS);
  });

  it("serializes date and all settings so defaults override saved preferences", () => {
    const query = ofQuery(localDate(2026, 11, 29), DEFAULT_OF_SETTINGS);
    expect(query.toString()).toBe("date=2026-11-29&epiphany=jan6&ascension=thursday&corpusChristi=thursday");
    expect(readOfSettings(query, { epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" })).toEqual(DEFAULT_OF_SETTINGS);
  });

  it("uses named presets and derives Custom for all other combinations", () => {
    expect(settingsForPreset("general-roman")).toEqual(DEFAULT_OF_SETTINGS);
    expect(settingsForPreset("sunday-transfers")).toEqual({ epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday" });
    for (const epiphany of ["jan6", "sunday"] as const)
      for (const ascension of ["thursday", "sunday"] as const)
        for (const corpusChristi of ["thursday", "sunday"] as const) {
          const settings = { epiphany, ascension, corpusChristi };
          expect(presetForSettings(settings)).toBe(
            epiphany === "jan6" && ascension === "thursday" && corpusChristi === "thursday" ? "general-roman"
              : epiphany === "sunday" && ascension === "sunday" && corpusChristi === "sunday" ? "sunday-transfers" : "custom",
          );
        }
  });

  it("publishes the stable storage key", () => {
    expect(OF_SETTINGS_STORAGE_KEY).toBe("cantusorgani.ordinary-form.settings.v1");
  });
});
