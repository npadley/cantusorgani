import { describe, expect, it } from "vitest";
import { loadYear, observance, kyrialeFor, seasonForDate } from "./liturgy";
import { seasonGroup } from "./exportParts";
import type { LocalDate } from "./liturgy";
import { buildDayTable, resolveDate, pdfTitle, serviceSummary } from "./dayService";

const years = Object.fromEntries(await Promise.all([2026, 2027, 2028, 2029].map(async y => [y, (await loadYear(y))!])));
const classify = (key: string) => (d: LocalDate) => ({ suggestion: kyrialeFor(observance(key)!, d), group: seasonGroup(seasonForDate(d)) });
const table = buildDayTable(observance("sancti:05-26")!, 2026, years, classify("sancti:05-26"));
describe("dayService", () => {
  it("chooses XII for St Philip Neri after Pentecost in 2027 and I in Eastertide in 2028", () => {
    expect(resolveDate("2027-05-26", table, "2027-05-26").option?.mass).toBe("XII");
    expect(resolveDate("2028-05-26", table, "2027-05-26").option?.mass).toBe("I");
    expect(resolveDate("2028-05-26", table, "2027-05-26").group).toBe("easter");
  });
  it.each(["garbage", "2027-02-30", "2030-05-26", "2027-03-03", "2026-05-26"])("falls back for %s", query => {
    const result = resolveDate(query, table, "2027-05-26");
    expect(result.iso).toBe("2027-05-26");
    expect(result.message).toContain("Showing 26 May 2027.");
    expect(result.option?.mass).toBe("XII");
  });
  it("names a nonmatching date and leaves an absent query quiet", () => {
    expect(resolveDate("2027-03-03", table, "2027-05-26").message).toBe("This occasion doesn't fall on 3 March 2027. Showing 26 May 2027.");
    expect(resolveDate("garbage", table, "2027-05-26").message).toBe("That isn't a date we can read. Showing 26 May 2027.");
    expect(resolveDate(null, table, "2027-05-26").message).toBeNull();
  });
  it("groups repeated options, including the many ferias, compactly", () => {
    expect(table.options).toHaveLength(2);
    const feria = buildDayTable(observance(":feria")!, 2026, years, classify(":feria"));
    expect(JSON.stringify(feria).length).toBeLessThan(16000);
    expect(feria.options.length).toBeLessThan(8);
    expect(table.groups.flatMap(o => o.dates)).toEqual(expect.arrayContaining(["2027-05-26", "2028-05-26"]));
  });
  it("formats the same date-first summary for build and browser", () => {
    const open = { key: "ordinary-9", mass: null, candidates: ["IX", "X"], heading: "In Festis B. Mariae V.", note: "" };
    const service = { iso: "2027-05-26", option: open, group: "other" as const, message: null };
    expect(serviceSummary(service, ["Gradual", "Alleluia"], ["Offertory: no music on this site"]))
      .toBe("For 26 May 2027: Gradual, Alleluia · Ordinary: no single Mass is assigned · Offertory: no music on this site");
    const chosen = resolveDate("2027-05-26", table, "2027-05-26");
    expect(serviceSummary(chosen, [], [])).toBe("For 26 May 2027");
    // A day with no Ordinary at all claims nothing about one.
    expect(serviceSummary({ ...service, option: null }, [], [])).toBe("For 26 May 2027");
  });
  it("dates the complete PDF title in en-GB style", () => {
    expect(pdfTitle("St. Philip Neri", "I", "2028-05-26")).toBe("St. Philip Neri with Missa I — 26 May 2028");
    expect(pdfTitle("A day", null, null)).toBe("A day");
  });
});
