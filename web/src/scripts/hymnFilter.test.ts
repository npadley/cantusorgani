import { describe, expect, it } from "vitest";
import { matches, noMatchText, normalize, summary } from "./hymnFilter";

describe("hymn filter", () => {
  it("normalizes diacritics, ligatures, case and whitespace", () => {
    expect(normalize("  ÁVE  máris\nÆTERNE Œuvre  ")).toBe("ave maris aeterne oeuvre");
    expect(matches("ÁVE máris", "Ave maris stella")).toBe(true);
    expect(matches("aeterne", "Æterne rex altissime")).toBe(true);
  });

  it("matches Latin, containing piece titles and English substrings", () => {
    expect(matches("Vesperae", "Creator alme siderum Vesperae Dominicae")).toBe(true);
    expect(matches("Christ", "Christe redemptor")).toBe(true);
  });

  it("requires every word, in any order, and matches blank queries", () => {
    expect(matches("stella ave", "Ave maris stella")).toBe(true);
    expect(matches("ave creator", "Ave maris stella")).toBe(false);
    expect(matches(" \n ", "Ave maris stella")).toBe(true);
  });

  it("reports no matches using trimmed text", () => {
    expect(matches("zzzz", "Creator alme siderum")).toBe(false);
    expect(noMatchText("  zzzz  ")).toBe("No hymns match ‘zzzz’.");
  });

  it("summarizes blank and filtered lists with singular and plural nouns", () => {
    expect(summary(7, 7, " ")).toBe("7 hymns");
    expect(summary(1, 1, "")).toBe("1 hymn");
    expect(summary(0, 0, "")).toBe("0 hymns");
    expect(summary(1, 7, "creator")).toBe("1 of 7 hymns");
    expect(summary(1, 1, "creator")).toBe("1 of 1 hymn");
    expect(summary(0, 1, "zzzz")).toBe("0 of 1 hymn");
  });
});
