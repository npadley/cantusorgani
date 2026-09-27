import { describe, expect, it } from "vitest";

import { CHANT_PREF_KEY, cleanGabc, readChantDisplay, writeChantDisplay } from "./gabc";
import type { PrefStore } from "./gabc";

function memory(): PrefStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

const throwing: PrefStore = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceeded"); },
};

describe("cleanGabc", () => {
  it("should drop GregoBase tags Exsurge would print literally, keeping the rest", () => {
    expect(cleanGabc("Glo(f)ri(g)a.(h) <eu>E(f) u(g)</eu> <i>T. P.</i>"))
      .toBe("Glo(f)ri(g)a.(h) E(f) u(g) <i>T. P.</i>");
    expect(cleanGabc("Ký(e)ri(f)e <clear>*(,) e(f) <nlba>lé(g)</nlba>")).toBe("Ký(e)ri(f)e *(,) e(f) lé(g)");
  });

  it("should keep the markup Exsurge does draw", () => {
    const kept = "<sp>R/</sp>.(::) <alt>ij.</alt> <sc>Ps.</sc> <v>x</v>";
    expect(cleanGabc(kept)).toBe(kept);
  });
});

describe("chant display preference", () => {
  it("should default to links and remember showing the chant", () => {
    const store = memory();
    expect(readChantDisplay(store)).toBe("link");
    writeChantDisplay(store, "show");
    expect(store.data.get(CHANT_PREF_KEY)).toBe("show");
    expect(readChantDisplay(store)).toBe("show");
  });

  it("should treat anything unexpected as links", () => {
    const store = memory();
    store.setItem(CHANT_PREF_KEY, "<script>");
    expect(readChantDisplay(store)).toBe("link");
  });

  it("should survive storage that is missing or throws", () => {
    expect(readChantDisplay(null)).toBe("link");
    expect(readChantDisplay(throwing)).toBe("link");
    expect(() => writeChantDisplay(throwing, "show")).not.toThrow();
  });
});
