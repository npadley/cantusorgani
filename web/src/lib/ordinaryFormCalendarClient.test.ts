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

// A small DOM surface exercises the real calendar renderer without Chromium.
describe("calendar music buttons", () => {
  it.each([
    ["2026-04-05", "easter"], ["2026-06-08", "ot-10"],
    ["2026-01-13", "ot-1"],
  ])("%s links to %s with the date and transfer settings", async (iso, expected) => {
    const { vi } = await import("vitest");
    const { mountOrdinaryFormCalendar } = await import("./ordinaryFormCalendarClient");
    class Node {
      readonly children: (Node | string)[] = [];
      readonly dataset: Record<string, string> = {};
      textContent = ""; className = ""; href = ""; value = "";
      constructor(readonly tagName: string, text = "") { this.textContent = text; }
      append(...nodes: (Node | string)[]) { this.children.push(...nodes); }
      replaceChildren() { this.children.length = 0; }
      setAttribute() {} removeAttribute() {} addEventListener() {}
      querySelector() { return null; }
    }
    const data = Object.fromEntries(["easter", "ot-10", "ot-1"].map(key => [key, {
      key, titleEn: key, titleLa: "", color: "w", rank: "sunday", assignmentStatus: "mapped",
      partsByCycle: { A: [], B: [], C: [] },
    }]));
    const index = { textContent: JSON.stringify(data) };
    const input = new Node("input"), results = new Node("article"), feedback = new Node("p");
    const root = {
      querySelector: (selector: string) => selector === "#date" ? input : selector === "#result" ? results
        : selector === "#date-feedback" ? feedback : null,
      querySelectorAll: () => [],
    };
    vi.stubGlobal("document", { getElementById: () => index, createElement: (tag: string) => new Node(tag) });
    vi.stubGlobal("window", { location: { pathname: "/calendar/ordinary-form/", search: `?date=${iso}` }, addEventListener() {} });
    vi.stubGlobal("history", { replaceState() {} });
    function descendants(node: Node): Node[] { return [node, ...node.children.flatMap(child => typeof child === "string" ? [] : descendants(child))]; }
    try {
      mountOrdinaryFormCalendar(root as unknown as HTMLElement);
      const buttons = descendants(results).filter(node => node.className === "accompaniments");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.textContent).toBe("Read and choose this day's music");
      expect(buttons[0]?.href).toContain(`/ordinary-form/${expected}/?`);
      expect(buttons[0]?.href).toContain(`date=${iso}`);
      expect(buttons[0]?.href).toContain("ascension=thursday");
    } finally { vi.unstubAllGlobals(); }
  });
});
