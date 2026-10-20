import { describe, expect, it } from "vitest";

import { chantEntry } from "./chants";
import { GOOD_FRIDAY_HREF, goodFridayChantIds, goodFridayHref, goodFridayRites } from "./goodFriday";

describe("goodFridayHref", () => {
  it("sends Good Friday in either calendar to its rite on the chant page", () => {
    expect(goodFridayHref("tempora:Quad6-5r")).toBe(`${GOOD_FRIDAY_HREF}#missal-1962`);
    expect(goodFridayHref("good-friday")).toBe(`${GOOD_FRIDAY_HREF}#ordinary-form`);
  });

  it("is null for every other day, Holy Thursday included", () => {
    expect(goodFridayHref("tempora:Quad6-4r")).toBeNull();
    expect(goodFridayHref("holy-thursday")).toBeNull();
    expect(goodFridayHref("")).toBeNull();
  });
});

describe("the Good Friday chants", () => {
  it("has both rites, each anchor matching goodFridayHref", () => {
    expect(goodFridayRites().map((r) => r.id)).toEqual(["missal-1962", "ordinary-form"]);
  });

  it("publishes the notation of every chant it names", () => {
    const ids = goodFridayChantIds();
    expect(ids.length).toBeGreaterThan(10);
    expect(ids.filter((id) => chantEntry(id) === undefined)).toEqual([]);
  });

  it("names each chant with where it is printed", () => {
    for (const rite of goodFridayRites()) {
      for (const item of rite.sections.flatMap((s) => s.items)) expect(item.source, item.label).not.toBe("");
    }
  });
});
