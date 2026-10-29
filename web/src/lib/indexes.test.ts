import { describe, expect, it } from "vitest";

import { allPieces } from "./catalog";
import { observance } from "./liturgy";
import type { Piece } from "./catalog";
import {
  DIVISIONS,
  booksIndex,
  catalogedDays,
  communeDays,
  dayHref,
  dayIndex,
  divisionMeta,
  divisionsWithContent,
  kyrialeIndex,
  neighbours,
  moreFor,
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
    id: "noh1-x", volume: "noh1", slug: "x", section: "S", division: "temporale", days: [], linkedDays: [],
    label: "L", title: "T", incipit: null, genre: "mass_ordinary", mode: null, mass: null,
    printedPages: [1, 2], pdfPages: [26, 27], systems: [], systemAssets: [], systemAspect: [],
    movements: [], chant: [], status: "verified",
    ...overrides,
  } as Piece;
}

describe("divisionsWithContent", () => {
  it("should list only divisions that have catalogued pieces, in book order", () => {
    const found = divisionsWithContent([piece({ division: "defunctorum" }), piece({ division: "kyriale" })])
      .map((d) => d.division);
    expect(found).toEqual(["kyriale", "defunctorum"]);
  });

  it("should count every catalogued piece in exactly one division", () => {
    const total = divisionsWithContent(allPieces()).reduce((n, d) => n + d.count, 0);
    expect(total).toBe(allPieces().length);
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
    expect(temporaleIndex([piece({ division: "kyriale" })])).toEqual([]);
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

  it("should have no days when no Proper is catalogued", () => {
    expect(catalogedDays([piece({ division: "kyriale", days: [] })])).toEqual([]);
  });

  it("should give every catalogued day a key the 1962 calendar knows", () => {
    for (const key of catalogedDays(allPieces())) expect(observance(key), key).toBeDefined();
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

describe("communeDays", () => {
  it("should list the Saturdays of Our Lady in the order of the year", () => {
    const pieces = [
      piece({ slug: "after-pentecost", days: ["commune:C10t"] }),
      piece({ slug: "christmastide", days: ["commune:C10b"] }),
      piece({ slug: "eastertide", days: ["commune:C10Pasc"] }),
    ];
    expect(communeDays(pieces).map((d) => d.key)).toEqual(["commune:C10b", "commune:C10Pasc", "commune:C10t"]);
  });

  it("should list nothing when no piece has a Common day", () => {
    expect(communeDays([piece({ slug: "x", days: ["sancti:10-DU"] })])).toEqual([]);
  });
});

describe("booksIndex", () => {
  it("keeps printed book order and names uncatalogued divisions with zero counts", () => {
    const books = booksIndex([piece({ division: "kyriale" }), piece({ division: "temporale" })]);
    expect(books.map(book => book.division)).toEqual([
      "temporale", "sanctorale", "commune", "kyriale", "defunctorum", "vesperale", "varia",
    ]);
    expect(books.map(book => book.count)).toEqual([1, 0, 0, 1, 0, 0, 0]);
    expect(books.map(book => book.slug)).toEqual(DIVISIONS.map(book => book.slug));
  });

  it("counts each real catalogue piece once without changing the content-only index", () => {
    const books = booksIndex(allPieces());
    expect(books.reduce((total, book) => total + book.count, 0)).toBe(allPieces().length);
    expect(books.filter(book => book.count > 0)).toEqual(divisionsWithContent(allPieces()));
  });
});

describe("neighbours", () => {
  const pieces = allPieces();

  it("should keep first, middle and last neighbours in each division's catalogue order", () => {
    for (const { division } of DIVISIONS) {
      const ordered = pieces.filter(p => p.division === division);
      ordered.forEach((p, i) => {
        const result = neighbours(pieces, p);
        expect(result.previous).toBe(ordered.slice(0, i).reverse().find(q => pieceHref(q) !== pieceHref(p)) ?? null);
        expect(result.next).toBe(ordered.slice(i + 1).find(q => pieceHref(q) !== pieceHref(p)) ?? null);
      });
    }
  });

  it("should cross from noh1 to noh2 within the Temporale", () => {
    const ordered = pieces.filter(p => p.division === "temporale");
    const i = ordered.findIndex((p, i) => p.volume === "noh2" && ordered[i - 1]?.volume === "noh1");
    expect(i).toBeGreaterThan(0);
    expect(neighbours(pieces, ordered[i - 1]!).next).toBe(ordered[i]);
    expect(neighbours(pieces, ordered[i]!).previous).toBe(ordered[i - 1]);
  });

  it("should skip another entry for the same Kyriale page and link directly to Mass pages", () => {
    const mass = piece({ division: "kyriale", mass: "I" });
    const duplicate = piece({ ...mass, id: "duplicate", slug: "duplicate" });
    const next = piece({ division: "kyriale", mass: "II", slug: "second" });
    const result = neighbours([mass, duplicate, next], mass);
    expect(result.next).toBe(next);
    expect(pieceHref(result.next!)).toBe("/kyriale/ii/");
  });

  it("should return to the only day, or otherwise to the division", () => {
    const day = "tempora:Adv1-0";
    expect(neighbours(pieces, piece({ days: [day] })).back).toEqual({ title: observance(day)!.titleEn, href: dayHref(day) });
    expect(neighbours(pieces, piece({ days: ["unknown:key"] })).back.title).toBe("unknown:key");
    for (const { division, en, slug } of DIVISIONS) {
      for (const days of [[], [day, "tempora:Adv2-0"]]) {
        expect(neighbours(pieces, piece({ division, days })).back).toEqual({ title: en, href: `/${slug}/` });
      }
    }
  });
});

describe("a piece linked to other days", () => {
  it("should count only the day it is printed for", () => {
    const sunday = piece({ slug: "sunday", days: ["tempora:Adv1-0", "tempora:Adv1-1", "tempora:Adv1-2"],
      linkedDays: ["tempora:Adv1-1", "tempora:Adv1-2"] });
    const vespers = piece({ slug: "vespers", division: "vesperale", days: ["tempora:Adv1-0"] });
    expect(neighbours([sunday, vespers], sunday).back.href).toBe(dayHref("tempora:Adv1-0"));
    expect(moreFor([sunday, vespers], { piece: sunday })).toEqual({
      heading: "More for this day", links: [{ title: "T", href: "/piece/vespers/", division: "vesperale" }],
    });
  });
});

describe("moreFor", () => {
  const pieces = allPieces();

  it("should exclude the current page, deduplicate and cap every catalogue result", () => {
    const results = [
      ...pieces.map(piece => ({ href: pieceHref(piece), result: moreFor(pieces, { piece }) })),
      ...catalogedDays(pieces).map(day => ({ href: dayHref(day), result: moreFor(pieces, { day }) })),
    ];
    for (const { href, result } of results) {
      const hrefs = result.links.map(link => link.href);
      expect(hrefs).not.toContain(href);
      expect(new Set(hrefs).size).toBe(hrefs.length);
      expect(hrefs.length).toBeLessThanOrEqual(6);
    }
  });

  it("should list same-day siblings in catalogue order using incipits and canonical URLs", () => {
    const current = piece({ slug: "current", days: ["tempora:Adv1-0"] });
    const sibling = piece({ slug: "sibling", days: current.days, incipit: "Ad te levavi" });
    const mass = piece({ slug: "mass", days: current.days, mass: "I" });
    expect(moreFor([current, sibling, sibling, mass], { piece: current })).toEqual({
      heading: "More for this day", links: [
        { title: "Ad te levavi", href: pieceHref(sibling), division: "temporale" },
        { title: mass.title, href: "/kyriale/i/", division: "temporale" },
      ],
    });
  });

  it("should fall back to the day's season when a one-day piece has no siblings", () => {
    const current = piece({ slug: "advent1", days: ["tempora:Adv1-0"] });
    const next = piece({ slug: "advent2", days: ["tempora:Adv2-0"] });
    const pieces = [current, next];
    expect(moreFor(pieces, { piece: current })).toEqual(moreFor(pieces, { day: current.days[0]! }));
    expect(moreFor(pieces, { piece: current }).links.map(l => l.href)).toEqual([dayHref(next.days[0]!)]);
  });

  it("should take up to three days on each side in the same group's order", () => {
    const group = sanctoraleIndex(pieces).find(g => g.days.length >= 9)!;
    const current = group.days[4]!;
    const result = moreFor(pieces, { day: current.key });
    expect(result.heading).toBe("More for January");
    expect(result.links.map(l => l.href)).toEqual(group.days.slice(1, 8).filter(d => d.key !== current.key).map(d => dayHref(d.key)));
    expect(result.links.map(l => l.title)).toEqual(group.days.slice(1, 8).filter(d => d.key !== current.key).map(d => d.title));
  });

  it("should keep Tempora and Common suggestions inside their season or Common group", () => {
    const groups = [...temporaleIndex(pieces).map(g => ({ days: g.days, heading: "More for this season" })),
      { days: communeDays(pieces), heading: "More from the Common" }];
    for (const { days: group, heading } of groups) {
      group.forEach((day, i) => {
        const result = moreFor(pieces, { day: day.key });
        expect(result.heading).toBe(heading);
        expect(result.links.map(l => l.href)).toEqual(group.slice(Math.max(0, i - 3), i + 4).filter(d => d.key !== day.key).map(d => dayHref(d.key)));
      });
    }
  });

  it("should render no suggestions for pieces with zero or several days, or ungrouped days", () => {
    for (const days of [[], ["tempora:Adv1-0", "tempora:Adv2-0"]]) {
      expect(moreFor(pieces, { piece: piece({ days }) }).links).toEqual([]);
    }
    expect(moreFor(pieces, { day: "unknown:key" }).links).toEqual([]);
  });
});
