import { describe, expect, it } from "vitest";

import {
  bankNote, consoleLine, exportLineup, isGreenSunday, itemHeading, lineupFor, loadLineup, nextLineupDate,
  parseLineup, sections, spokenTone, toneLabel,
} from "./vespers";
import type { LineupDay } from "./vespers";

function item(kind: string, group: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    item_key: `2026-11-08/tempora:Epi5-0/${kind}/${group}`, group, kind, number: null, label: kind, tone: null,
    source: { type: "printed", piece: "vesperae-dominica-ad-vesperas", refs: ["noh8/0031/000"] },
    chant: null, repeat: false, ...extra,
  };
}

function doc(items: Record<string, unknown>[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1, catalog_sha256: "x", held_back: { "2026-09-06": "Magnificat in IV A" },
    days: { "2026-11-08": { office: "tempora:Epi5-0", vespers: "II", items } }, ...extra,
  };
}

describe("parseLineup", () => {
  it("should read days, items, sources and held-back dates", () => {
    const lineup = parseLineup(doc([
      item("initium", "initium"),
      item("magnificat", "magnificat", { tone: "I.g", source: {
        type: "bank", piece: "vesperae-dominicae-i-iv-adventus", refs: ["noh8/0084/002"], bank_kind: "psalm",
        bank_label: "Psalm 109 in I g", borrowed_from: "Advent II, p. 54" } }),
      item("oration", "oration", { source: { type: "note", text: "The collect of the Sunday, as at Mass." } }),
    ]));
    const day = lineup.days.get("2026-11-08")!;
    expect(day.items.map((i) => i.source.type)).toEqual(["printed", "bank", "note"]);
    expect(lineup.heldBack.get("2026-09-06")).toContain("IV A");
  });

  it("should reject an unknown schema, kind or source type", () => {
    expect(() => parseLineup({ ...doc([]), schema_version: 9 })).toThrow(/schema_version 9/);
    expect(() => parseLineup(doc([item("sermon", "x")]))).toThrow(/unknown kind sermon/);
    expect(() => parseLineup(doc([item("initium", "initium", { source: { type: "video" } })])))
      .toThrow(/unknown source type video/);
    expect(() => parseLineup(doc([item("initium", "initium", { source: { type: "printed", piece: "p", refs: [] } })])))
      .toThrow(/has no systems/);
  });
});

describe("tones", () => {
  it("should label and speak tones as printed", () => {
    expect(toneLabel("VII.c2")).toBe("VII c2");
    expect(toneLabel("peregrinus")).toBe("tonus peregrinus");
    expect(spokenTone("IV.A*")).toBe("tone 4, ending A star");
    expect(spokenTone("I.g2")).toBe("tone 1, ending g 2");
    expect(spokenTone("VIII")).toBe("tone 8");
  });
});

describe("the published lineup", () => {
  const lineup = loadLineup();
  const day = lineupFor("2026-11-08", lineup) as LineupDay;

  it("should have the resumed Epiphany V on 2026-11-08 and hold back Pent XV on 2026-09-06", () => {
    expect(day.office).toBe("tempora:Epi5-0");
    expect(lineupFor("2026-09-06", lineup)).toBeUndefined();
    expect(lineup.heldBack.get("2026-09-06")).toMatch(/IV A/);
  });

  it("should group items into at most twelve sections with at most nine nav links", () => {
    const secs = sections(day);
    expect(secs.map((s) => s.group)).toEqual([
      "initium", "psalm-1", "psalm-2", "psalm-3", "psalm-4", "psalm-5", "chapter", "hymn",
      "magnificat", "oration", "benedicamus", "marian"]);
    expect(secs.filter((s) => s.nav).length).toBeLessThanOrEqual(9);
    expect(secs[1]!.heading).toBe("1. Dixit Dominus — VII c2");
    expect(secs[8]!.heading).toBe("Magnificat — I g");
  });

  it("should head the repeated antiphon apart from the first", () => {
    const psalm1 = sections(day)[1]!;
    expect(psalm1.items.map((i) => itemHeading(i, psalm1))).toEqual([
      "Antiphon: Dixit Dominus Domino meo", "Psalm 109", "Antiphon (repeated)"]);
  });

  it("should give the console line with each psalm's tone, the Magnificat and the Marian antiphon", () => {
    expect(consoleLine(day)).toBe(
      "Pss. 109–113: VII c2, III b, IV g, VII c, tonus peregrinus · Magnificat: I g · Salve Regina");
  });

  it("should say where a tone-bank Magnificat comes from", () => {
    const mag = day.items.find((i) => i.kind === "magnificat")!;
    expect(bankNote(mag)).toContain("Psalm 109 in I g, as printed for Advent II, p. 54");
    expect(bankNote(day.items[0]!)).toBeNull();
  });

  it("should export in sung order with unique ids, repeats included", () => {
    const segments = exportLineup(day);
    const ids = segments.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(segments[0]!.label).toBe("Deus in adjutorium");
    expect(segments.some((s) => s.label.endsWith("Antiphon (repeated)"))).toBe(true);
    expect(segments.every((s) => s.stems.length === s.systems && s.systems > 0)).toBe(true);
  });

  it("should find the next date a green Sunday's lineup falls on, and none for a held-back one", () => {
    expect(nextLineupDate("tempora:Epi5-0", "2026-11-01", lineup)).toBe("2026-11-08");
    expect(nextLineupDate("tempora:Pent15-0", "2026-01-01", lineup)).toBeNull();
  });
});

describe("isGreenSunday", () => {
  it("should cover Epiphany II-VI and Pentecost II-XXIV only", () => {
    expect(isGreenSunday("tempora:Pent02-0r")).toBe(true);
    expect(isGreenSunday("tempora:Epi6-0")).toBe(true);
    expect(isGreenSunday("tempora:Pent01-0r")).toBe(false);
    expect(isGreenSunday("sancti:10-DU")).toBe(false);
  });
});
