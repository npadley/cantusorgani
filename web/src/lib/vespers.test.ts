import { describe, expect, it } from "vitest";

import {
  allLineups, bankNote, consoleLine, exportLineup, itemSystems, lineupTitle, lineupsUsing, sungOn, isFormula, isSunday, itemHeading, lineupFor, lineupHref, loadLineup, nextFirstVespers, nextLineupDate,
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
        type: "bank", refs: ["noh8/0084/002"], bank_kind: "psalm",
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

  it("should have the resumed Epiphany V on 2026-11-08, and Pent XV with a note for its Magnificat in IV A", () => {
    expect(day.office).toBe("tempora:Epi5-0");
    const pent15 = lineupFor("2026-09-06", lineup)!;
    const mag = pent15.items.find((i) => i.kind === "magnificat")!;
    expect(mag.source.type).toBe("note");
    expect(mag.source.type === "note" && mag.source.text).toContain("IV A");
  });

  it("should give I Vespers of Christmas on the evening of 24 December, and of a I class feast the evening before", () => {
    const eve = lineupFor("2026-12-24", lineup)!;
    expect(eve.office).toBe("sancti:12-25");
    expect(eve.vespers).toBe("I");
    const assumption = nextFirstVespers("sancti:08-15", "2027-01-01", lineup)!;
    const first = lineup.firstVespers.get(assumption)!;
    expect(first.eveningOf).toBe("2027-08-14");
    expect(lineupHref(first)).toBe("/vespers/2027-08-15/i/");
  });

  it("should give psalm text where NOH prints only a formula, and none for a psalm printed in full", () => {
    const christmas = lineupFor("2026-12-25", lineup)!;
    const psalm110 = christmas.items.find((i) => i.kind === "psalm" && i.number === 110)!;
    expect(isFormula(psalm110)).toBe(true);
    expect(psalm110.psalmText[0]).toMatch(/^Confitébor tibi/);
    const lent = lineupFor("2027-02-14", lineup)!;
    expect(lent.items.find((i) => i.kind === "psalm" && i.number === 109)!.psalmText).toEqual([]);
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

  it("should list a feast's psalms by number where they are not a run", () => {
    const first = loadLineup().firstVespers.get("2027-08-15")!;
    expect(consoleLine(first)).toMatch(/^Pss\. 109, 112, 121, 126, 147: /);
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
    expect(nextLineupDate("tempora:Pent02-0r", "2026-01-01", lineup)).toBe("2026-06-07");
    expect(nextLineupDate("sancti:08-06", "2026-01-01", lineup)).toBeNull();
  });
});

describe("isSunday", () => {
  it("should tell a Sunday of the Time from a feast", () => {
    expect(isSunday("tempora:Pent02-0r")).toBe(true);
    expect(isSunday("tempora:Adv1-0")).toBe(true);
    expect(isSunday("tempora:Pent01-4")).toBe(false);
    expect(isSunday("sancti:10-DU")).toBe(false);
  });
});

describe("finding the dated pages", () => {
  const lineup = loadLineup();

  it("should list every Vespers in the order sung, I Vespers on the evening before", () => {
    const all = allLineups(lineup);
    expect(all.length).toBe(lineup.days.size + lineup.firstVespers.size);
    const sung = all.map(sungOn);
    expect([...sung].sort()).toEqual(sung);
    const assumption = lineup.firstVespers.get("2027-08-15")!;
    expect(sungOn(assumption)).toBe("2027-08-14");
  });

  it("should find a green Sunday's dates from its Vesperale section, and title them", () => {
    const days = lineupsUsing("vesperae-dominicae-iv-xxiv-post-pentecosten", lineup);
    const today = days.find((d) => d.date === "2026-09-27");
    expect(today).toBeDefined();
    expect(lineupTitle(today!)).toBe("XVIII Sunday after Pentecost");
    expect(lineupTitle(lineup.days.get("2026-12-25")!)).not.toBe("sancti:12-25");
  });

  it("should not count a piece that only lends a tone-bank formula", () => {
    const christmas = lineup.days.get("2026-12-25")!;
    const bankSlugs = christmas.items.filter((i) => i.source.type === "bank")
      .flatMap((i) => itemSystems(i).map((s) => s.piece.slug));
    for (const slug of bankSlugs) {
      const own = christmas.items.some((i) => i.source.type === "printed" && itemSystems(i).some((s) => s.piece.slug === slug));
      expect(lineupsUsing(slug, lineup).includes(christmas)).toBe(own);
    }
  });
});
