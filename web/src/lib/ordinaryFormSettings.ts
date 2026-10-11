import { isoOf, type LocalDate } from "./liturgy";
import { DEFAULT_OF_SETTINGS, type OfSettings } from "./ordinaryForm";
export { DEFAULT_OF_SETTINGS } from "./ordinaryForm";

export type OfPreset = "general-roman" | "sunday-transfers" | "custom";
export const OF_SETTINGS_STORAGE_KEY = "cantusorgani.ordinary-form.settings.v1";
const SETTING_KEYS = ["epiphany", "ascension", "corpusChristi"] as const;

function validSettingValues(value: unknown): OfSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== SETTING_KEYS.length ||
      !SETTING_KEYS.every(key => Object.prototype.hasOwnProperty.call(record, key))) return null;
  if ((record.epiphany !== "jan6" && record.epiphany !== "sunday") ||
      (record.ascension !== "thursday" && record.ascension !== "sunday") ||
      (record.corpusChristi !== "thursday" && record.corpusChristi !== "sunday")) return null;
  return {
    epiphany: record.epiphany,
    ascension: record.ascension,
    corpusChristi: record.corpusChristi,
  };
}

/** Parse only the three transfer choices. A recognized URL field makes the URL authoritative. */
export function readOfSettings(query: URLSearchParams, stored: unknown): OfSettings {
  const hasSetting = SETTING_KEYS.some(key => query.has(key));
  if (hasSetting) {
    const epiphany = query.get("epiphany");
    const ascension = query.get("ascension");
    const corpusChristi = query.get("corpusChristi");
    return {
      epiphany: epiphany === "sunday" ? "sunday" : epiphany === "jan6" ? "jan6" : DEFAULT_OF_SETTINGS.epiphany,
      ascension: ascension === "sunday" ? "sunday" : ascension === "thursday" ? "thursday" : DEFAULT_OF_SETTINGS.ascension,
      corpusChristi: corpusChristi === "sunday" ? "sunday" : corpusChristi === "thursday" ? "thursday" : DEFAULT_OF_SETTINGS.corpusChristi,
    };
  }
  if (typeof stored === "string") {
    try { stored = JSON.parse(stored) as unknown; } catch { return DEFAULT_OF_SETTINGS; }
  }
  return validSettingValues(stored) ?? DEFAULT_OF_SETTINGS;
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

