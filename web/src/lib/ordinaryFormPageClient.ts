import type { OfCycle, OfSeason } from "./ordinaryFormPieces";

interface PartChoice { readonly years: string; readonly seasons: string; readonly checked: boolean }
const CYCLES = new Set<OfCycle>(["A", "B", "C"]);
const SEASONS = new Set<OfSeason>(["advent", "christmas", "lent", "triduum", "easter", "ordinary"]);

export function initialPartSelection<T extends PartChoice>(parts: readonly T[], cycle: OfCycle | null,
                                                            season: OfSeason | null): boolean[] {
  return parts.map(part => {
    const years = part.years ? part.years.split(",").filter(Boolean) : [];
    const seasons = part.seasons ? part.seasons.split(",").filter(Boolean) : [];
    return part.checked && (!cycle || years.includes(cycle)) && (!season || seasons.length === 0 || seasons.includes(season));
  });
}

/** Apply a validated cycle/season entry to a composed static occasion page. */
export function mountOrdinaryFormPage(root: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const requestedCycle = params.get("cycle");
  const requestedSeason = params.get("season");
  const cycle = requestedCycle && CYCLES.has(requestedCycle as OfCycle) ? requestedCycle as OfCycle : null;
  const season = requestedSeason && SEASONS.has(requestedSeason as OfSeason) ? requestedSeason as OfSeason : null;
  const boxes = [...root.querySelectorAll<HTMLInputElement>('input[name="export-part"]')];
  const values = boxes.map(box => ({
    years: box.dataset["years"] ?? "", seasons: box.dataset["seasons"] ?? "", checked: true,
  }));
  const selected = initialPartSelection(values, cycle, season);
  boxes.forEach((box, i) => {
    box.checked = selected[i] ?? true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const note = root.querySelector<HTMLElement>("#of-export-note");
  if (note) {
    const scope = [cycle ? `Year ${cycle}` : "all years", season ? `${season} season` : "all seasons"].join(" · ");
    note.textContent = `${scope}. Every applicable alternative starts selected; choose the chants required for this celebration.`;
  }
}
