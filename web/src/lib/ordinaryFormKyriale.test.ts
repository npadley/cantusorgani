import { describe, expect, it } from "vitest";
import { ofKyrialeSuggestion, ofOccasionKyrialeContext, ofMarianTitle } from "./ordinaryFormKyriale";
import type { OfSeason } from "./ordinaryForm";

describe("OF Kyriale suggestions", () => {
  it.each<[OfSeason, string, number, boolean, string]>([
    ["easter", "solemnity", 0, false, "I"], ["easter", "weekday", 3, false, "I"],
    ["advent", "sunday", 0, false, "XVII"], ["lent", "privileged", 0, false, "XVII"],
    ["advent", "weekday", 2, false, "XVIII"], ["lent", "weekday", 5, false, "XVIII"],
    ["ordinary", "solemnity", 2, false, "II"], ["ordinary", "solemnity", 2, true, "IX"],
    ["ordinary", "feast", 3, false, "IV"], ["ordinary", "feast-of-the-lord", 3, false, "IV"],
    ["ordinary", "feast", 3, true, "IX"], ["ordinary", "memorial", 4, false, "VII"],
    ["ordinary", "memorial", 4, true, "X"], ["ordinary", "optional-memorial", 4, true, "X"],
    ["ordinary", "sunday", 0, false, "XI"], ["christmas", "sunday", 0, false, "XI"],
    ["ordinary", "weekday", 1, false, "XVI"], ["christmas", "weekday", 1, false, "XVI"],
  ])("%s / %s / weekday %i / Marian %s → %s", (season, rank, weekday, marian, expected) => {
    expect(ofKyrialeSuggestion(season, rank, weekday, marian)).toBe(expected);
  });
  it.each(["In Assumptione Beatae Mariae Virginis", "In Nativitate Mariae", "In Praesentatione B. M. V."])("recognizes a Marian title: %s", title => {
    expect(ofMarianTitle(title)).toBe(true);
    expect(ofKyrialeSuggestion("ordinary", "solemnity", 1, ofMarianTitle(title))).toBe("IX");
  });
  it("treats the Annunciation as a solemnity of the Lord", () => {
    const title = "In Annuntiatione Domini";
    expect(ofMarianTitle(title)).toBe(false);
    expect(ofKyrialeSuggestion("ordinary", "solemnity", 1, ofMarianTitle(title))).toBe("II");
  });
  it.each([
    ["easter", "privileged", "easter", 0], ["ot-8", "sunday", "ordinary", 0],
    ["lent-2", "privileged", "lent", 0], ["ash-wednesday", "privileged", "lent", 3],
    ["second-christmas", "sunday", "christmas", 0], ["easter-2-monday", "weekday", "easter", 1],
  ] as const)("uses %s's own season without a date", (key, rank, season, weekday) => {
    expect(ofOccasionKyrialeContext(key, rank)).toMatchObject({ season, weekday });
  });
});

describe("OF Ordinary switching", () => {
  it("activates only the chosen export boxes, keeps the Proper and preserves the query", async () => {
    const { vi } = await import("vitest");
    const { mountOfKyriale } = await import("./ordinaryFormKyriale");
    class Input {
      checked = false; disabled = true;
      constructor(readonly dataset: Record<string, string>) {}
      dispatchEvent = vi.fn();
    }
    const boxes = [new Input({ ordinaryOption: "I" }), new Input({ ordinaryOption: "XVII" })];
    const proper = new Input({}); proper.disabled = false; proper.checked = true;
    const sections = ["I", "XVII"].map(ordinaryOption => ({ dataset: { ordinaryOption }, hidden: true }));
    const listeners = new Map<string, () => void>();
    const select = { value: "I", options: ["I", "XVII"].map(value => ({ value, textContent: `Missa ${value}` })),
      addEventListener: (event: string, fn: () => void) => listeners.set(event, fn) };
    const bar = { dataset: { title: "Easter with Missa I" }, querySelectorAll: () => [], querySelector: (selector: string) => selector.includes("export-part") ? proper : null };
    const layout = { addEventListener: vi.fn(), querySelector: () => bar, querySelectorAll: () => [...boxes, ...sections] };
    const root = { dataset: { ofSeason: "easter", ofRank: "privileged", ofWeekday: "0", ofMarian: "false" },
      closest: () => layout, querySelector: (selector: string) => selector === "[data-of-mass]" ? select : selector === "h1" ? { textContent: "Easter" } : null, querySelectorAll: () => [] };
    const replaceState = vi.fn();
    vi.stubGlobal("location", { search: "?cycle=A&mass=XVII", href: "https://cantusorgani.org/ordinary-form/easter/?cycle=A&mass=XVII" });
    vi.stubGlobal("history", { state: { retained: true }, replaceState });
    vi.stubGlobal("document", { querySelectorAll: () => [select] });
    vi.stubGlobal("HTMLInputElement", Input);
    try {
      await mountOfKyriale(root as unknown as HTMLElement);
      expect(select.value).toBe("XVII");
      expect(boxes.map(box => [box.disabled, box.checked])).toEqual([[true, false], [false, true]]);
      expect(sections.map(section => section.hidden)).toEqual([true, false]);
      expect(proper.checked).toBe(true);
      expect(replaceState).not.toHaveBeenCalled();
      select.value = "I";
      listeners.get("change")?.();
      expect(boxes.map(box => box.disabled)).toEqual([false, true]);
      expect(replaceState.mock.calls[0]?.[0]).toEqual({ retained: true });
      expect(String(replaceState.mock.calls[0]?.[2])).toContain("cycle=A&mass=I");
      expect(bar.dataset.title).toContain("Missa I");
      expect(proper.dispatchEvent).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });
});
