import { isoOf, type LocalDate } from "./liturgy";
import { DEFAULT_OF_SETTINGS, type OfSettings } from "./ordinaryForm";
export { DEFAULT_OF_SETTINGS } from "./ordinaryForm";

export type OfPreset = "general-roman" | "sunday-transfers" | "custom";

/** Parse the three URL transfer choices, using General Roman defaults for omitted or invalid values. */
export function readOfSettings(query: URLSearchParams): OfSettings {
  const epiphany = query.get("epiphany");
  const ascension = query.get("ascension");
  const corpusChristi = query.get("corpusChristi");
  return {
    epiphany: epiphany === "sunday" ? "sunday" : epiphany === "jan6" ? "jan6" : DEFAULT_OF_SETTINGS.epiphany,
    ascension: ascension === "sunday" ? "sunday" : ascension === "thursday" ? "thursday" : DEFAULT_OF_SETTINGS.ascension,
    corpusChristi: corpusChristi === "sunday" ? "sunday" : corpusChristi === "thursday" ? "thursday" : DEFAULT_OF_SETTINGS.corpusChristi,
  };
}

export function ofQuery(date: LocalDate, settings: OfSettings): URLSearchParams {
  const query = new URLSearchParams();
  query.set("date", isoOf(date));
  query.set("epiphany", settings.epiphany);
  query.set("ascension", settings.ascension);
  query.set("corpusChristi", settings.corpusChristi);
  return query;
}

export function presetForSettings(settings: OfSettings): OfPreset {
  if (settings.epiphany === "jan6" && settings.ascension === "thursday" && settings.corpusChristi === "thursday")
    return "general-roman";
  if (settings.epiphany === "sunday" && settings.ascension === "sunday" && settings.corpusChristi === "sunday")
    return "sunday-transfers";
  return "custom";
}

export function settingsForPreset(preset: Exclude<OfPreset, "custom">): OfSettings {
  return preset === "general-roman" ? DEFAULT_OF_SETTINGS : {
    epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday",
  };
}

