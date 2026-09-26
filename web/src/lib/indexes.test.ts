import { describe, expect, it } from "vitest";

import { allPieces } from "./catalog";
import type { Piece } from "./catalog";
import {
  DIVISIONS,
  catalogedDays,
  dayHref,
  dayIndex,
  divisionMeta,
  divisionsWithContent,
  kyrialeIndex,
  pieceHref,
  sanctoraleIndex,
  temporaOrder,
  temporaleIndex,
} from "./indexes";
import type { Division } from "./indexes";

/**
 * Factory for a synthetic piece. The Proper of Time and Proper of Saints indexes
 * have no catalogued content yet, so they are proven here with synthetic pieces
 * keyed to real 1962 calendar days -- the same keys NOH1-4 will carry.
 */
function piece(overrides: Partial<Piece> = {}): Piece {
  return {
    id: "noh1-x", volume: "noh1", slug: "x", section: "S", division: "temporale", days: [],
    label: "L", title: "T", incipit: null, genre: "mass_ordinary", mode: null, mass: null,
    printedPages: [1, 2], pdfPages: [26, 27], systems: [], systemAssets: [], systemAspect: [],
    movements: [], chant: [], status: "verified",
    ...overrides,
  } as Piece;
}

describe("divisionsWithContent", () => {
  it("should list only divisions that have catalogued pieces", () => {
    const found = divisionsWithContent(allPieces()).map((d) => d.division);
    expect(found).toEqual(["kyriale", "defunctorum"]);   // NOH5 is all that exists today
  });

  it("should appear automatically once a volume is catalogued", () => {
    const pieces = [...allPieces(), piece({ division: "temporale", days: ["tempora:Adv1-0"] })];
    const found = divisionsWithContent(pieces).map((d) => d.division);
    expect(found[0]).toBe("temporale");   // books order: Temporale leads
    expect(found).toContain("kyriale");
  });

  it("should count pieces per division", () => {
    const kyriale = divisionsWithContent(allPieces()).find((d) => d.division === "kyriale");
    expect(kyriale?.count).toBe(43);
  });

  it("should reject an unknown division", () => {
    expect(() => divisionMeta("nonsense" as Division)).toThrow(/unknown division/);
  });

  it("should give every division a distinct URL slug", () => {
    expect(new Set(DIVISIONS.map((d) => d.slug)).size).toBe(DIVISIONS.length);
  });
});

describe("temporaOrder", () => {
  it("should order the liturgical year, not the alphabet", () => {
    const names = ["Pasc0-0", "Quad1-0", "Adv1-0", "Pent03-0", "Epi2-0", "Quadp1-0", "Nat1-0"];
    const sorted = [...names].sort((a, b) => {
      const [x, y] = [temporaOrder(a), temporaOrder(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
    expect(sorted).toEqual(["Adv1-0", "Nat1-0", "Epi2-0", "Quadp1-0", "Quad1-0", "Pasc0-0", "Pent03-0"]);
  });

  it("should place September Ember Days after the Pentecost Sundays", () => {
    expect(temporaOrder("093-3")[0]).toBeGreaterThan(temporaOrder("Pent24-0")[0]);
  });
});

describe("temporaleIndex", () => {
  const pieces = [
    piece({ slug: "easter", days: ["tempora:Pasc0-0"], title: "Dominica Resurrectionis" }),
    piece({ slug: "adv2", days: ["tempora:Adv2-0"] }),
    piece({ slug: "adv1", days: ["tempora:Adv1-0"] }),
    piece({ slug: "ash", days: ["tempora:Quadp3-3"] }),
    piece({ slug: "quinq", days: ["tempora:Quadp3-0"] }),
    piece({ slug: "saint", division: "sanctorale", days: ["sancti:12-26"] }),
  ];

  it("should group days by season in liturgical order", () => {
    expect(temporaleIndex(pieces).map((g) => g.season))
      .toEqual(["advent", "septuagesima", "lent", "easter"]);
  });

  it("should put Ash Wednesday in Lent although it is keyed with Septuagesima", () => {
    const lent = temporaleIndex(pieces).find((g) => g.season === "lent");
    expect(lent?.days.map((d) => d.key)).toEqual(["tempora:Quadp3-3"]);
  });

  it("should order days within a season", () => {
    const advent = temporaleIndex(pieces).find((g) => g.season === "advent");
    expect(advent?.days.map((d) => d.key)).toEqual(["tempora:Adv1-0", "tempora:Adv2-0"]);
  });

  it("should carry the calendar's English and Latin titles", () => {
    const advent = temporaleIndex(pieces).find((g) => g.season === "advent");
    expect(advent?.days[0]?.title).toBe("I Sunday of Advent");
    expect(advent?.days[0]?.titleLa).toBeTruthy();
  });

  it("should ignore saints' days", () => {
    const keys = temporaleIndex(pieces).flatMap((g) => g.days.map((d) => d.key));
    expect(keys).not.toContain("sancti:12-26");
  });

  it("should be empty with nothing catalogued, rather than listing placeholder days", () => {
    expect(temporaleIndex(allPieces())).toEqual([]);
  });
});

describe("sanctoraleIndex", () => {
  const pieces = [
    piece({ slug: "stephen", division: "sanctorale", days: ["sancti:12-26"] }),
    piece({ slug: "christ-king", division: "sanctorale", days: ["sancti:10-DU"] }),
    piece({ slug: "therese", division: "sanctorale", days: ["sancti:10-03"] }),
    piece({ slug: "andrew", division: "sanctorale", days: ["sancti:11-30"] }),
  ];

  it("should group feasts by month in calendar order", () => {
    expect(sanctoraleIndex(pieces).map((m) => m.month)).toEqual([10, 11, 12]);
  });

  it("should file Christ the King at the end of October", () => {
    const october = sanctoraleIndex(pieces).find((m) => m.month === 10);
    expect(october?.days.map((d) => d.key)).toEqual(["sancti:10-03", "sancti:10-DU"]);
  });

  it("should carry the Latin title the printed index uses", () => {
    const december = sanctoraleIndex(pieces).find((m) => m.month === 12);
    expect(december?.days[0]?.titleLa).toBe("S. Stephani Protomartyris");
  });
});

describe("dayIndex", () => {
  it("should link each calendar day to its catalogued music", () => {
    const index = dayIndex([piece({ slug: "adv1", days: ["tempora:Adv1-0"], incipit: "Ad te levavi" })]);
    expect(index["tempora:Adv1-0"]).toEqual([
      { title: "Ad te levavi", href: "/piece/adv1/", division: "temporale" }]);
  });

  it("should give a piece serving several days an entry under each", () => {
    const index = dayIndex([piece({ days: ["sancti:12-25m1", "sancti:12-25m2"] })]);
    expect(Object.keys(index)).toEqual(["sancti:12-25m1", "sancti:12-25m2"]);
  });

  it("should have no days today, because no Proper has been catalogued", () => {
    expect(catalogedDays(allPieces())).toEqual([]);
  });
});

describe("pieceHref", () => {
  it("should send an Ordinary Mass to its Kyriale page", () => {
    expect(pieceHref(piece({ genre: "mass_ordinary", mass: "XVII" }))).toBe("/kyriale/xvii/");
  });

  it("should send anything else to its piece page", () => {
    expect(pieceHref(piece({ genre: "credo", slug: "credo-iii" }))).toBe("/piece/credo-iii/");
  });
});

describe("kyrialeIndex", () => {
  const groups = kyrialeIndex(allPieces());

  it("should group the Kyriale by kind of chant", () => {
    expect(groups.map((g) => g.heading)).toEqual([
      "Ordinaries of the Mass", "Credo", "Asperges me · Vidi aquam",
      "Kyrie ad libitum", "Gloria, Sanctus, Agnus Dei ad libitum", "Tones",
    ]);
  });

  it("should put all eighteen Ordinaries first", () => {
    expect(groups[0]?.pieces).toHaveLength(18);
  });

  it("should list all six Credos", () => {
    expect(groups.find((g) => g.heading === "Credo")?.pieces).toHaveLength(6);
  });

  it("should place every Kyriale piece in exactly one group", () => {
    const placed = groups.flatMap((g) => g.pieces.map((p) => p.id));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toHaveLength(43);
  });
});

describe("dayHref", () => {
  it("should split a calendar key into a path", () => {
    expect(dayHref("tempora:Adv1-0")).toBe("/day/tempora/Adv1-0/");
    expect(dayHref("sancti:12-25m1")).toBe("/day/sancti/12-25m1/");
  });

  it("should give the empty-flexibility feria a readable segment", () => {
    expect(dayHref(":feria")).toBe("/day/feria/feria/");
  });
});
