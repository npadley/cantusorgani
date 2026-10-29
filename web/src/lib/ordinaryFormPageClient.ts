import type { OfCycle, OfSeason } from "./ordinaryFormPieces";
import { preselectOrdinaryForm, selectionFromBoxes, type Selection } from "./selection";

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
  const layout = root.closest<HTMLElement>(".reader-layout") ?? root;
  const boxes = [...layout.querySelectorAll<HTMLInputElement>('.service-rail input[name="export-part"]')];
  const selected = preselectOrdinaryForm(selectionFromBoxes(
    boxes.map(box => ({ value: box.value, dataset: box.dataset, disabled: box.disabled, checked: true })),
    root.querySelector("h1")?.textContent ?? "", () => true,
  ), cycle, season);
  const byId = new Map(selected.segments.map(segment => [segment.id, segment.included]));
  boxes.forEach(box => { box.checked = byId.get(box.value) ?? false; });

  root.querySelectorAll<HTMLAnchorElement>("[data-cycle]").forEach(link => {
    const next = new URLSearchParams(params);
    next.set("cycle", link.dataset["cycle"]!);
    link.href = `?${next}`;
    if (link.dataset["cycle"] === cycle) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });

  const capitalize = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
  root.querySelectorAll<HTMLInputElement>("[data-inline-part]").forEach(inline => {
    const box = boxes.find(box => box.value === inline.dataset["inlinePart"]);
    if (!box) return;
    const years = (box.dataset["years"] ?? "").split(",").filter(Boolean);
    const seasons = (box.dataset["seasons"] ?? "").split(",").filter(Boolean);
    // A part sung in every year and season is no alternative: it needs no label.
    if (!seasons.length && (years.length === 0 || years.length === CYCLES.size)) return;
    const yearLabel = cycle && years.length && !years.includes(cycle) ? `Not for Year ${cycle}`
      : years.length === 1 ? `Year ${years[0]}`
      : years.length > 1 ? `Years ${years.slice(0, -1).join(", ")} and ${years.at(-1)}` : "";
    const label = root.ownerDocument.createElement("span");
    label.className = "muted";
    label.dataset["ofApplicability"] = "";
    label.textContent = ` · ${[yearLabel, ...seasons.map(capitalize)].filter(Boolean).join(" · ")}`;
    inline.parentElement?.append(label);
  });

  const summary = layout.querySelector<HTMLElement>("#selection-summary");
  const missing = [...root.querySelectorAll<HTMLElement>("[data-missing-label]")]
    .map(item => item.dataset["missingLabel"]).filter(Boolean);
  function updateSummary(selection: Selection): void {
    if (!summary) return;
    summary.textContent = [cycle ? `Year ${cycle}` : "All years", season ? `${capitalize(season)} season` : "all seasons",
      `${selection.segments.filter(segment => segment.included).length} of ${selection.segments.length} parts`,
      ...(missing.length ? [`not in NOH: ${missing.join(", ")}`] : []),
    ].join(" · ");
  }
  layout.addEventListener("selectionchange", event => updateSummary((event as CustomEvent<Selection>).detail));
  updateSummary(selected);
  // One change rebuilds ExportBar's selection and synchronizes every inline box.
  boxes[0]?.dispatchEvent(new Event("change", { bubbles: true }));

  // The visible scope only; the rest of the note is for screen readers.
  const scope = root.querySelector<HTMLElement>("#of-export-note [data-of-scope]");
  if (scope) scope.textContent = capitalize([cycle ? `Year ${cycle}` : "all years", season ? `${season} season` : "all seasons"].join(" · "));
}
