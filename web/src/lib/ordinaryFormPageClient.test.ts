import { afterEach, describe, expect, it, vi } from "vitest";
import { initialPartSelection, mountOrdinaryFormPage } from "./ordinaryFormPageClient";

describe("cycle-aware Ordinary Form exports", () => {
  const rows = [
    { years: "A,C", seasons: "", checked: true },
    { years: "B", seasons: "", checked: true },
    { years: "A,B,C", seasons: "easter", checked: true },
    { years: "A,B,C", seasons: "", checked: true },
  ];

  it("selects every applicable same-cycle alternative and all-season rows", () => {
    expect(initialPartSelection(rows, "C", "easter")).toEqual([true, false, true, true]);
  });

  it("keeps every assignment selected on an unscoped static page", () => {
    expect(initialPartSelection(rows, null, null)).toEqual([true, true, true, true]);
  });

  it("does not apply an invalid cycle or season as a filter", () => {
    expect(initialPartSelection(rows, null, null)).toEqual([true, true, true, true]);
  });
});

// Vitest runs in Node; these small DOM surfaces keep the client test dependency-free.

function page(search: string) {
  vi.stubGlobal("window", { location: { search } });
  const changes: string[] = [];
  const boxes = [
    { value: "communion-c", checked: true, dataset: { years: "C", seasons: "", label: "Communion II" } },
    { value: "communion-ab", checked: true, dataset: { years: "A,B", seasons: "", label: "Communion I" } },
    { value: "lent", checked: true, dataset: { years: "A,B,C", seasons: "lent", label: "Tract" } },
    { value: "introit", checked: true, dataset: { years: "A,B,C", seasons: "", label: "Introit" } },
  ].map(box => ({ ...box, dispatchEvent: (event: Event) => { changes.push(box.value); expect(event.bubbles).toBe(true); } }));
  const links = ["A", "B", "C"].map(cycle => ({
    dataset: { cycle }, href: `?cycle=${cycle}`, setAttribute: vi.fn(), removeAttribute: vi.fn(),
  }));
  const note = { textContent: "" };
  const summary = { textContent: "" };
  const labels: { className: string; dataset: Record<string, string>; textContent: string }[] = [];
  // Inline order deliberately differs from rail order.
  const inline = [boxes[1]!, boxes[0]!, boxes[2]!, boxes[3]!].map(box => ({
    dataset: { inlinePart: box.value }, parentElement: { append: (label: typeof labels[number]) => labels.push(label) },
  }));
  const root = {
    closest: () => root,
    ownerDocument: { createElement: () => ({ className: "", dataset: {}, textContent: "" }) },
    querySelectorAll: (selector: string) => selector.includes('export-part') ? boxes
      : selector.includes('data-cycle') ? links : selector.includes('data-inline-part') ? inline
      : selector.includes('data-missing-label') ? [{ dataset: { missingLabel: "Sequence" } }] : [],
    querySelector: (selector: string) => selector === "#of-export-note [data-of-scope]" ? note : selector === "#selection-summary" ? summary : null,
    addEventListener: vi.fn(),
  };
  mountOrdinaryFormPage(root as unknown as HTMLElement);
  return { boxes, links, changes, note, labels, summary, root };
}

describe("mountOrdinaryFormPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preselects rail boxes by segment id and refreshes once", () => {
    const { boxes, changes } = page("?cycle=B&season=easter");
    expect(Object.fromEntries(boxes.map(box => [box.value, box.checked])))
      .toEqual({ "communion-c": false, "communion-ab": true, lent: false, introit: true });
    expect(changes).toHaveLength(1);
  });

  it("rewrites year links keeping dates, transfers and unknown parameters", () => {
    const { links } = page("?cycle=A&season=ordinary&date=2026-06-07&epiphany=sunday&ascension=sunday&corpusChristi=sunday&extra=yes");
    const query = new URLSearchParams(links[1]!.href.slice(1));
    expect(Object.fromEntries(query)).toEqual({ cycle: "B", season: "ordinary", date: "2026-06-07",
      epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday", extra: "yes" });
    expect(links[0]!.setAttribute).toHaveBeenCalledWith("aria-current", "true");
  });

  it("invalid URL values leave all alternatives selected", () => {
    expect(page("?cycle=D&season=wrong").boxes.every(box => box.checked)).toBe(true);
  });

  it("labels inline choices by segment id while keeping excluded choices available", () => {
    const { labels, boxes } = page("?cycle=B&season=easter");
    expect(labels.map(label => label.textContent)).toEqual([
      " · Years A and B", " · Not for Year B", " · Years A, B and C · Lent",
    ]);
    expect(boxes.every(box => !("disabled" in box))).toBe(true);
  });

  it("shows the chosen scope, or all years and seasons", () => {
    expect(page("?cycle=B&season=easter").note.textContent).toBe("Year B · easter season");
    expect(page("?cycle=D").note.textContent).toBe("All years · all seasons");
  });

  it("updates the plain rail summary when selection changes", () => {
    const { summary, root } = page("?cycle=B&season=easter");
    expect(summary.textContent).toBe("Year B · Easter season · 2 of 4 parts · not in NOH: Sequence");
    const listener = root.addEventListener.mock.calls[0]?.[1] as EventListener;
    listener({ detail: { segments: [{ included: true }, { included: true }, { included: false }] } } as unknown as Event);
    expect(summary.textContent).toContain("2 of 3 parts");
  });
});
